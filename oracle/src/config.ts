import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { isAddress, type Address, type Hex } from 'viem';

export type TeeMode = 'dstack' | 'dev';
export type LlmMode = 'anthropic' | 'mock';

export interface OracleConfig {
  port: number;
  rpcUrl: string;
  contractAddress: Address | undefined;
  teeMode: TeeMode;
  devPrivateKey: Hex | undefined;
  llmMode: LlmMode;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  autoSubmit: boolean;
  watchIntervalMs: number;
  allowPrivateEvidenceHosts: boolean;
  dataDir: string | undefined;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OracleConfig {
  const teeMode = (env.TEE_MODE ?? 'dstack') as TeeMode;
  if (teeMode !== 'dstack' && teeMode !== 'dev') throw new Error(`TEE_MODE must be "dstack" or "dev", got "${teeMode}"`);

  const llmMode = (env.LLM_MODE ?? 'anthropic') as LlmMode;
  if (llmMode !== 'anthropic' && llmMode !== 'mock') throw new Error(`LLM_MODE must be "anthropic" or "mock"`);
  if (llmMode === 'mock' && teeMode === 'dstack' && !env.DSTACK_SIMULATOR_ENDPOINT) {
    // A mocked model inside a real enclave would produce attestations that look trustworthy but mean nothing.
    throw new Error('LLM_MODE=mock is not allowed in a real TEE deployment');
  }

  // CONTRACT_ADDRESS wins; otherwise fall back to the file written by `npm run demo:deploy`.
  let contract = env.CONTRACT_ADDRESS;
  const deploymentFile = env.DEPLOYMENT_FILE ?? '../deployments/local.json';
  if (!contract && existsSync(deploymentFile)) {
    contract = (JSON.parse(readFileSync(deploymentFile, 'utf8')) as { address?: string }).address;
  }
  if (contract && !isAddress(contract)) throw new Error(`CONTRACT_ADDRESS is not a valid address: ${contract}`);

  const effort = (env.ANTHROPIC_EFFORT ?? 'high') as OracleConfig['effort'];

  return {
    port: Number(env.PORT ?? 3001),
    rpcUrl: env.RPC_URL ?? 'http://127.0.0.1:8545',
    contractAddress: contract as Address | undefined,
    teeMode,
    devPrivateKey: env.ORACLE_DEV_PRIVATE_KEY as Hex | undefined,
    llmMode,
    model: env.ANTHROPIC_MODEL ?? 'claude-opus-5-5',
    effort,
    autoSubmit: bool(env.AUTO_SUBMIT, true),
    watchIntervalMs: Number(env.WATCH_INTERVAL_MS ?? 15_000),
    allowPrivateEvidenceHosts: bool(env.ALLOW_PRIVATE_EVIDENCE_HOSTS, false),
    dataDir: env.DATA_DIR || undefined,
  };
}
