/**
 * Attestation of the *inference* enclave (Confidential AI).
 *
 * The oracle's own TDX enclave (dstack) proves which code ran and holds the signing key. The model itself
 * runs in a second set of enclaves operated by Confidential AI: Intel TDX confidential VMs with
 * NVIDIA confidential-computing GPUs (c8s). The bridge between the two is TEErminator, a verifying proxy
 * that runs *inside* the oracle container and forwards a request only after it has attested the
 * upstream TLS session: TDX quote → Intel root, pinned image measurements, operator-signed route, and the
 * exact bytes of the published workload allowlist.
 *
 * That allowlist pins the inference workers to a specific Hugging Face repository, revision and weight
 * index hash, so a verified session proves *which open weights* produced the decision. Each round we
 * record:
 *   - the TEErminator verdict for the session (`teerminator status`), which must be `Verified`;
 *   - a snapshot of the public evidence (`/allowlist` sha256 + the model pins it contains, and a
 *     `/v1/discovery` hash) so auditors can check the policy that was in force.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type GatewayVerdict = 'Verified' | 'Partial' | 'Failed' | 'Untrusted' | 'Unknown';

export interface GatewayStatus {
  checked: boolean;
  local: string;
  remote: string | null;
  mode: string | null;
  verdict: GatewayVerdict;
  details: string | null; // measurement / workload / trust / route digest line
  raw: string | null;
  error: string | null;
}

export interface ModelPin {
  workload: string;
  servedModelName: string | null;
  repository: string | null;
  revision: string | null;
  expectedFiles: Record<string, string>; // filename -> sha256
}

export interface PublicEvidence {
  fetchedAt: string;
  publicBase: string;
  allowlistSha256: string | null;
  allowlistBytes: number | null;
  discoverySha256: string | null;
  modelPins: ModelPin[];
  error: string | null;
}

export interface InferenceAttestation {
  provider: 'confidential' | 'anthropic' | 'mock';
  attested: boolean;
  model: string;
  gateway: GatewayStatus | null;
  publicEvidence: PublicEvidence | null;
  modelPinned: boolean; // requested model appears as a served-model-name in the attested allowlist
  pinnedRevision: string | null;
  reason: string;
}

/** Parse `teerminator status` output for the row whose local address matches. */
export function parseTeerminatorStatus(raw: string, local: string): Omit<GatewayStatus, 'checked' | 'error' | 'raw'> {
  const lines = raw.split('\n');
  const row = lines.find((l) => l.trim().split(/\s+/)[0] === local);
  if (!row) return { local, remote: null, mode: null, verdict: 'Unknown', details: null };
  const cols = row.trim().split(/\s+/);
  const last = cols[cols.length - 1];
  const verdict: GatewayVerdict = (['Verified', 'Partial', 'Failed', 'Untrusted'] as const).find((v) => v === last) ?? 'Unknown';
  const details = lines.find((l) => l.startsWith(`${local}:`) && l !== row)?.slice(local.length + 1).trim() ?? null;
  return { local, remote: cols[1] ?? null, mode: cols[3] ?? null, verdict, details };
}

export async function teerminatorStatus(bin: string, local: string): Promise<GatewayStatus> {
  try {
    // `status` exits non-zero when any remote is Failed; we still want its output.
    const out = await run(bin, ['status'], { timeout: 60_000 }).catch((e: { stdout?: string; stderr?: string; message: string }) => {
      if (e.stdout) return { stdout: e.stdout, stderr: e.stderr ?? '' };
      throw e;
    });
    return { checked: true, raw: out.stdout, error: null, ...parseTeerminatorStatus(out.stdout, local) };
  } catch (err) {
    return {
      checked: false,
      local,
      remote: null,
      mode: null,
      verdict: 'Unknown',
      details: null,
      raw: null,
      error: err instanceof Error ? err.message.split('\n')[0] : String(err),
    };
  }
}

/** Extract model pins (repo, revision, file hashes) from a c8s allowlist document. */
export function extractModelPins(allowlist: unknown): ModelPin[] {
  const pins: ModelPin[] = [];
  const workloads = (allowlist as { workloads?: Record<string, { containers?: Array<{ args?: { argv?: string[] }; command?: { argv?: string[] } }> }> })
    ?.workloads;
  if (!workloads) return pins;
  for (const [name, w] of Object.entries(workloads)) {
    for (const c of w.containers ?? []) {
      const argv = [...(c.command?.argv ?? []), ...(c.args?.argv ?? [])];
      const get = (flag: string) => argv.find((a) => a.startsWith(`--${flag}=`))?.slice(flag.length + 3) ?? null;
      const servedModelName = get('served-model-name');
      const repository = get('expected-repository');
      if (!servedModelName && !repository) continue;
      const expectedFiles: Record<string, string> = {};
      for (const a of argv.filter((x) => x.startsWith('--expected-file='))) {
        const [file, hash] = a.slice('--expected-file='.length).split('=');
        if (file && hash) expectedFiles[file] = hash;
      }
      pins.push({ workload: name, servedModelName, repository, revision: get('expected-revision') ?? get('revision'), expectedFiles });
    }
  }
  return pins;
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export async function snapshotPublicEvidence(publicBase: string): Promise<PublicEvidence> {
  const base = publicBase.replace(/\/+$/, '');
  const ev: PublicEvidence = {
    fetchedAt: new Date().toISOString(),
    publicBase: base,
    allowlistSha256: null,
    allowlistBytes: null,
    discoverySha256: null,
    modelPins: [],
    error: null,
  };
  try {
    const [allow, disc] = await Promise.all([
      fetch(`${base}/allowlist`, { signal: AbortSignal.timeout(15_000) }),
      fetch(`${base}/v1/discovery`, { signal: AbortSignal.timeout(15_000) }),
    ]);
    if (allow.ok) {
      const bytes = new Uint8Array(await allow.arrayBuffer());
      ev.allowlistSha256 = sha256(bytes);
      ev.allowlistBytes = bytes.byteLength;
      ev.modelPins = extractModelPins(JSON.parse(new TextDecoder().decode(bytes)));
    }
    if (disc.ok) ev.discoverySha256 = sha256(new Uint8Array(await disc.arrayBuffer()));
    if (!allow.ok || !disc.ok) ev.error = `allowlist HTTP ${allow.status}, discovery HTTP ${disc.status}`;
  } catch (err) {
    ev.error = err instanceof Error ? err.message : String(err);
  }
  return ev;
}

export interface InferenceAttestationOptions {
  provider: InferenceAttestation['provider'];
  model: string;
  baseUrl: string | null;
  publicBase: string;
  teerminatorBin: string | undefined;
}

/** Collect inference-side evidence for one round. Never throws; `attested` says whether it holds. */
export async function attestInference(o: InferenceAttestationOptions): Promise<InferenceAttestation> {
  if (o.provider !== 'confidential') {
    return {
      provider: o.provider,
      attested: false,
      model: o.model,
      gateway: null,
      publicEvidence: null,
      modelPinned: false,
      pinnedRevision: null,
      reason: o.provider === 'anthropic' ? 'Anthropic API: inference is not hardware-attested' : 'mock model',
    };
  }
  const local = o.baseUrl ? new URL(o.baseUrl).host : '';
  const [gateway, publicEvidence] = await Promise.all([
    o.teerminatorBin
      ? teerminatorStatus(o.teerminatorBin, local)
      : Promise.resolve<GatewayStatus>({ checked: false, local, remote: null, mode: null, verdict: 'Unknown', details: null, raw: null, error: 'TEERMINATOR_BIN not set: requests are not attestation-gated' }),
    snapshotPublicEvidence(o.publicBase),
  ]);
  const pin = publicEvidence.modelPins.find((p) => p.servedModelName === o.model || p.repository === o.model) ?? null;
  const attested = gateway.verdict === 'Verified' && Boolean(pin);
  const reason = attested
    ? `TEErminator verified the inference enclave; ${o.model} pinned at revision ${pin?.revision}`
    : gateway.verdict !== 'Verified'
      ? `TEErminator verdict: ${gateway.verdict}${gateway.error ? ` (${gateway.error})` : ''}`
      : `model ${o.model} is not pinned in the attested allowlist`;
  return { provider: 'confidential', attested, model: o.model, gateway, publicEvidence, modelPinned: Boolean(pin), pinnedRevision: pin?.revision ?? null, reason };
}
