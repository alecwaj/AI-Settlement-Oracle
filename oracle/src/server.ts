import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { isHex, type Hex } from 'viem';
import { loadConfig } from './config.js';
import { TeeIdentity } from './tee.js';
import { AnthropicResolver, ConfidentialResolver, MockResolver, type Resolver } from './resolver.js';
import { attestInference } from './inference-attestation.js';
import { SettlementOracleService, canonicalJson } from './oracle.js';
import { fetchEvidence } from './evidence.js';
import { WindowLimiter } from './rate-limit.js';

const cfg = loadConfig();
const tee = await TeeIdentity.init(cfg);
const resolver: Resolver =
  cfg.llmMode === 'confidential'
    ? new ConfidentialResolver(cfg.model, cfg.confidentialBaseUrl, cfg.confidentialApiKey)
    : cfg.llmMode === 'anthropic'
      ? new AnthropicResolver(cfg.anthropicModel, cfg.effort)
      : new MockResolver();
if (cfg.llmMode === 'mock') console.warn('⚠️  LLM_MODE=mock — decisions are NOT made by a real model.');
if (cfg.llmMode === 'anthropic') console.warn('⚠️  LLM_MODE=anthropic — inference is NOT hardware-attested.');
if (cfg.llmMode === 'confidential' && !cfg.teerminatorBin) {
  console.warn('⚠️  TEERMINATOR_BIN not set — Confidential AI calls are not attestation-gated by this process.');
}
const inferenceOpts = {
  provider: cfg.llmMode,
  model: cfg.model,
  baseUrl: cfg.llmMode === 'confidential' ? cfg.confidentialBaseUrl : null,
  publicBase: cfg.confidentialPublicBase,
  teerminatorBin: cfg.teerminatorBin,
} as const;
const service = new SettlementOracleService(cfg, tee, resolver, () => attestInference(inferenceOpts));

const app = express();
app.set('trust proxy', 1); // behind the Phala gateway / one reverse proxy: use its X-Forwarded-For hop
app.use(cors({ origin: cfg.allowedOrigins === '*' ? '*' : cfg.allowedOrigins }));
app.use(express.json({ limit: '64kb' }));

const resolveLimiter = new WindowLimiter(cfg.resolveRateLimitPerHour, 60 * 60_000);
const evidenceLimiter = new WindowLimiter(30, 60 * 60_000);
function limited(limiter: WindowLimiter, req: Request, res: Response): boolean {
  const retry = limiter.take(req.ip ?? 'unknown');
  if (retry === 0) return false;
  res.setHeader('Retry-After', String(retry));
  send(res, { error: `Rate limited — try again in ${retry}s` }, 429);
  return true;
}

// BigInt-safe JSON responses
function send(res: Response, body: unknown, status = 200): void {
  res.status(status).type('application/json').send(canonicalJson(body));
}

function parseMarketId(req: Request, res: Response): bigint | null {
  const raw = String(req.params.id ?? '');
  if (!/^\d+$/.test(raw)) {
    send(res, { error: 'market id must be a positive integer' }, 400);
    return null;
  }
  return BigInt(raw);
}

app.get('/health', (_req, res) => {
  send(res, {
    status: 'ok',
    signer: tee.info.signer,
    teeMode: tee.info.mode,
    inTee: tee.info.inTee,
    llm: { provider: cfg.llmMode, model: cfg.model },
    requireAttestedInference: cfg.requireAttestedInference,
    aiCallsRemainingToday: service.budget.remaining(),
    contract: cfg.contractAddress ?? null,
    autoSubmit: cfg.autoSubmit,
  });
});

/** Everything a third party needs to verify that the signer key lives in this enclave. */
app.get('/attestation', (_req, res) => {
  send(res, {
    ...tee.info,
    llm: { provider: cfg.llmMode, model: cfg.model, gateway: inferenceOpts.baseUrl, requireAttestedInference: cfg.requireAttestedInference },
  });
});

/** Live check of the inference enclave: TEErminator verdict + attested allowlist model pins. */
app.get('/inference-attestation', async (_req, res) => {
  send(res, await attestInference(inferenceOpts));
});

app.get('/markets/:id/resolutions', (req, res) => {
  const id = parseMarketId(req, res);
  if (id === null) return;
  send(res, { marketId: id.toString(), resolutions: service.getRecords(id.toString()) });
});

app.post('/markets/:id/resolve', async (req, res) => {
  const id = parseMarketId(req, res);
  if (id === null) return;
  if (limited(resolveLimiter, req, res)) return;
  try {
    const record = await service.resolveMarket(id);
    send(res, { success: record.status !== 'failed', resolution: record });
  } catch (err) {
    send(res, { success: false, error: err instanceof Error ? err.message : String(err) }, 409);
  }
});

app.get('/transcripts/:hash', (req, res) => {
  const hash = req.params.hash;
  if (!isHex(hash) || hash.length !== 66) return send(res, { error: 'expected a 32-byte hex hash' }, 400);
  const transcript = service.getTranscript(hash as Hex);
  if (!transcript) return send(res, { error: 'transcript not found' }, 404);
  res.type('application/json').send(transcript); // exact bytes that were hashed
});

/** Convenience for evidence submitters: fetch a URL the same way the oracle will and return its keccak256. */
app.post('/evidence/hash', async (req, res) => {
  if (limited(evidenceLimiter, req, res)) return;
  const url = typeof req.body?.url === 'string' ? req.body.url : '';
  const ev = await fetchEvidence(url, undefined, { allowPrivateHosts: cfg.allowPrivateEvidenceHosts });
  send(res, { url, ok: ev.ok, status: ev.status, error: ev.error, contentHash: ev.contentHash, preview: ev.text.slice(0, 400) });
});

app.listen(cfg.port, () => {
  console.log(`🔮 AI Settlement Oracle listening on :${cfg.port}`);
  console.log(`   signer ${tee.info.signer} | TEE ${tee.info.mode} | LLM ${cfg.llmMode}:${cfg.model}`);
  console.log(`   attested inference ${cfg.requireAttestedInference ? 'REQUIRED' : 'not required'}${inferenceOpts.baseUrl ? ` via ${inferenceOpts.baseUrl}` : ''}`);
  console.log(`   contract ${cfg.contractAddress ?? '(not configured — set CONTRACT_ADDRESS)'}`);
  service.startWatcher();
});
