import type { Hex } from '@oracle/shared';

/** Anvil's default dev keys. Only acceptable on a local chain. */
const ANVIL_DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ANVIL_ORACLE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

function env(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? undefined : v.trim();
}

function int(name: string, fallback: number): number {
  const v = env(name);
  const n = v === undefined ? fallback : Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be an integer`);
  return n;
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface Config {
  port: number;
  anthropicApiKey: string | undefined;
  model: string;
  effort: Effort;
  /** Server-side refusal fallback ("default") or disabled ("off"). */
  fallbacks: 'default' | 'off';
  guardianApiKey: string;
  rpcUrl: string;
  contractAddress: Hex | undefined;
  deployerKey: Hex;
  oracleKey: Hex;
  usingDevKeys: boolean;
  retryDelaySeconds: number;
  /** Re-run delayed markets automatically when their on-chain delay ends. */
  autoRetry: boolean;
  maxEvidence: number;
  maxCharsPerSource: number;
  httpTimeoutMs: number;
  dataDir: string;
  contractsOutDir: string;
}

export function loadConfig(): Config {
  const effort = (env('ANTHROPIC_EFFORT') ?? 'high') as Effort;
  if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) throw new Error('ANTHROPIC_EFFORT is invalid');
  const fallbacks = env('ANTHROPIC_FALLBACKS') === 'off' ? 'off' : 'default';
  const oracleKey = (env('ORACLE_PRIVATE_KEY') ?? ANVIL_ORACLE_KEY) as Hex;
  const deployerKey = (env('DEPLOYER_PRIVATE_KEY') ?? ANVIL_DEPLOYER_KEY) as Hex;
  return {
    port: int('PORT', 3001),
    anthropicApiKey: env('ANTHROPIC_API_KEY'),
    model: env('ANTHROPIC_MODEL') ?? 'claude-opus-5-5',
    effort,
    fallbacks,
    // "test" is the Guardian's public developer key (rate limited).
    guardianApiKey: env('GUARDIAN_API_KEY') ?? 'test',
    rpcUrl: env('RPC_URL') ?? 'http://127.0.0.1:8545',
    contractAddress: env('CONTRACT_ADDRESS') as Hex | undefined,
    deployerKey,
    oracleKey,
    usingDevKeys: oracleKey === ANVIL_ORACLE_KEY || deployerKey === ANVIL_DEPLOYER_KEY,
    retryDelaySeconds: int('RETRY_DELAY_SECONDS', 300),
    autoRetry: env('AUTO_RETRY') !== 'false',
    maxEvidence: int('MAX_EVIDENCE', 20),
    maxCharsPerSource: int('MAX_CHARS_PER_SOURCE', 6000),
    httpTimeoutMs: int('HTTP_TIMEOUT_MS', 20000),
    dataDir: env('DATA_DIR') ?? new URL('../data', import.meta.url).pathname,
    contractsOutDir: env('CONTRACTS_OUT') ?? new URL('../../contracts/out', import.meta.url).pathname,
  };
}
