import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { isAddress, type Address, type Hex } from 'viem';

export type TeeMode = 'dstack' | 'dev';
export type LlmMode = 'confidential' | 'anthropic' | 'mock';

/** Default arbiter model: open weights, served inside Confidential AI's TDX + confidential-GPU enclaves. */
export const DEFAULT_CONFIDENTIAL_MODEL = 'deepseek-ai/DeepSeek-V4.1-Flash-1017';

export interface OracleConfig {
  port: number;
  rpcUrl: string;
  contractAddress: Address | undefined;
  teeMode: TeeMode;
  simulator: boolean;
  devPrivateKey: Hex | undefined;
  llmMode: LlmMode;
  model: string;
  // Confidential AI
  confidentialBaseUrl: string; // TEErminator local endpoint (attested) — or the public API (unattested)
  confidentialPublicBase: string; // for /allowlist + /v1/discovery snapshots
  confidentialApiKey: string | undefined;
  teerminatorBin: string | undefined;
  requireAttestedInference: boolean;
  // Anthropic (optional, not hardware-attested)
  anthropicModel: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  autoSubmit: boolean;
  watchIntervalMs: number;
  allowPrivateEvidenceHosts: boolean;
  dataDir: string | undefined;
  maxAiCallsPerDay: number;
  resolveRateLimitPerHour: number;
  allowedOrigins: string[] | '*';
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OracleConfig {
  const teeMode = (env.TEE_MODE ?? 'dstack') as TeeMode;
  if (teeMode !== 'dstack' && teeMode !== 'dev') throw new Error(`TEE_MODE must be "dstack" or "dev", got "${teeMode}"`);
  const simulator = Boolean(env.DSTACK_SIMULATOR_ENDPOINT);
  const realTee = teeMode === 'dstack' && !simulator;

  const llmMode = (env.LLM_MODE ?? 'confidential') as LlmMode;
  if (!['confidential', 'anthropic', 'mock'].includes(llmMode)) throw new Error('LLM_MODE must be "confidential", "anthropic" or "mock"');
  if (llmMode === 'mock' && realTee) {
    // A mocked model inside a real enclave would produce attestations that look trustworthy but mean nothing.
    throw new Error('LLM_MODE=mock is not allowed in a real TEE deployment');
  }

  // In a real TEE the default is fail-closed: no signature unless the inference enclave was verified.
  const requireAttestedInference = bool(env.REQUIRE_ATTESTED_INFERENCE, realTee);
  if (requireAttestedInference && llmMode !== 'confidential') {
    throw new Error(`REQUIRE_ATTESTED_INFERENCE is on but LLM_MODE=${llmMode} has no inference attestation; use LLM_MODE=confidential`);
  }

  // CONTRACT_ADDRESS wins; otherwise fall back to the file written by `npm run demo:deploy`.
  let contract = env.CONTRACT_ADDRESS;
  const deploymentFile = env.DEPLOYMENT_FILE ?? '../deployments/local.json';
  if (!contract && existsSync(deploymentFile)) {
    contract = (JSON.parse(readFileSync(deploymentFile, 'utf8')) as { address?: string }).address;
  }
  if (contract && !isAddress(contract)) throw new Error(`CONTRACT_ADDRESS is not a valid address: ${contract}`);

  const anthropicModel = env.ANTHROPIC_MODEL ?? 'claude-opus-5-5';
  const confidentialModel = env.CONFIDENTIAL_MODEL ?? DEFAULT_CONFIDENTIAL_MODEL;

  return {
    port: Number(env.PORT ?? 3001),
    rpcUrl: env.RPC_URL ?? 'http://127.0.0.1:8545',
    contractAddress: contract as Address | undefined,
    teeMode,
    simulator,
    devPrivateKey: env.ORACLE_DEV_PRIVATE_KEY as Hex | undefined,
    llmMode,
    model: llmMode === 'anthropic' ? anthropicModel : llmMode === 'mock' ? 'mock' : confidentialModel,
    confidentialBaseUrl: env.CONFIDENTIAL_BASE_URL ?? 'http://127.0.0.1:8080/v1',
    confidentialPublicBase: env.CONFIDENTIAL_PUBLIC_BASE ?? 'https://api.confidential.ai',
    confidentialApiKey: env.CONFIDENTIAL_API_KEY || undefined,
    teerminatorBin: env.TEERMINATOR_BIN || undefined,
    requireAttestedInference,
    anthropicModel,
    effort: (env.ANTHROPIC_EFFORT ?? 'high') as OracleConfig['effort'],
    autoSubmit: bool(env.AUTO_SUBMIT, true),
    watchIntervalMs: Number(env.WATCH_INTERVAL_MS ?? 15_000),
    allowPrivateEvidenceHosts: bool(env.ALLOW_PRIVATE_EVIDENCE_HOSTS, false),
    dataDir: env.DATA_DIR || undefined,
    maxAiCallsPerDay: Number(env.MAX_AI_CALLS_PER_DAY ?? 50),
    resolveRateLimitPerHour: Number(env.RESOLVE_RATE_LIMIT_PER_HOUR ?? 10),
    allowedOrigins: env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean) : '*',
  };
}
