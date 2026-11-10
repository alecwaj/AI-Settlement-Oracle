import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  type Address,
  type Chain,
  type Hex,
  type WalletClient,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { settlementOracleAbi } from './abi';

export const RPC_URL: string = import.meta.env.VITE_RPC_URL ?? 'http://127.0.0.1:8545';
export const ORACLE_URL: string = import.meta.env.VITE_ORACLE_URL ?? 'http://127.0.0.1:3001';
export const abi = settlementOracleAbi;
export const CHAIN_NAME: string | undefined = import.meta.env.VITE_CHAIN_NAME;
export const EXPLORER_URL: string | undefined = import.meta.env.VITE_EXPLORER_URL;
export const DEPLOY_BLOCK: bigint = BigInt(import.meta.env.VITE_DEPLOY_BLOCK ?? 0);
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export function explorerLink(kind: 'tx' | 'address', value: string): string | null {
  return EXPLORER_URL ? `${EXPLORER_URL.replace(/\/$/, '')}/${kind}/${value}` : null;
}

export const publicClient = createPublicClient({ transport: http(RPC_URL) });

export const STATUS = ['Open', 'Proposed', 'Escalated', 'Resolved', 'Paused for manual'] as const;
export const OUTCOME = ['—', 'YES', 'NO', 'INVALID'] as const;

// Anvil dev accounts — only offered when connected to a local chain (31337).
const MNEMONIC = 'test test test test test test test test test test test junk';
export const DEV_ACCOUNTS = Array.from({ length: 10 }, (_, i) => mnemonicToAccount(MNEMONIC, { addressIndex: i }));
export const DEV_LABELS = ['Owner', 'Creator', 'Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank', 'Grace', 'Heidi'];

let chainCache: Chain | null = null;
export async function getChain(): Promise<Chain> {
  if (chainCache) return chainCache;
  const id = await publicClient.getChainId();
  chainCache = defineChain({ id, name: `chain-${id}`, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } });
  return chainCache;
}

export type Signer = { kind: 'dev'; index: number } | { kind: 'injected'; address: Address };

export async function walletFor(signer: Signer): Promise<WalletClient> {
  const chain = await getChain();
  if (signer.kind === 'dev') return createWalletClient({ account: DEV_ACCOUNTS[signer.index], chain, transport: http(RPC_URL) });
  const eth = (window as unknown as { ethereum?: Parameters<typeof custom>[0] }).ethereum;
  if (!eth) throw new Error('No injected wallet found');
  const wallet = createWalletClient({ account: signer.address, chain, transport: custom(eth) });
  try {
    await wallet.switchChain({ id: chain.id });
  } catch {
    await wallet.addChain({ chain }).catch(() => undefined);
  }
  return wallet;
}

/** Whether the current signer can send transactions (dev account, or a connected browser wallet). */
export function canWrite(s: Signer): boolean {
  return s.kind === 'dev' || s.address !== ZERO_ADDRESS;
}

export function signerAddress(s: Signer): Address {
  return s.kind === 'dev' ? DEV_ACCOUNTS[s.index].address : s.address;
}

export function short(a: string, n = 6): string {
  return a.length > 2 * n + 2 ? `${a.slice(0, n + 2)}…${a.slice(-n)}` : a;
}

export async function oracle<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ORACLE_URL}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await res.json();
  if (!res.ok && body?.error) throw new Error(body.error);
  return body as T;
}

export async function warp(seconds: number): Promise<void> {
  const call = (method: string, params: unknown[]) =>
    fetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  await call('evm_increaseTime', [seconds]);
  await call('evm_mine', []);
}

export interface Attestation {
  mode: 'tdx' | 'tdx-simulator' | 'dev';
  inTee: boolean;
  signer: Address;
  bootQuote: { quote: Hex; reportData: Hex; quoteHash: Hex; eventLog: string } | null;
  appId: string | null;
  composeHash: Hex | null;
  tcb: Record<string, string> | null;
  verification: string[];
  llm: { provider: string; model: string; gateway: string | null; requireAttestedInference: boolean };
}

export interface ResolutionRecord {
  marketId: string;
  round: number;
  status: 'signed' | 'submitted' | 'confirmed' | 'failed';
  error: string | null;
  createdAt: string;
  outcome: 'YES' | 'NO' | 'INVALID';
  confidenceBps: number;
  thresholdBps: number;
  willDelay: boolean;
  reasoning: string;
  decision: {
    key_facts: string[];
    evidence_assessments: Array<{ submission_index: number; reliability: string; supports: string; note: string }>;
    missing_information: string;
  };
  model: string;
  provider: string;
  submissionsHash: Hex;
  transcriptHash: Hex;
  digest: Hex;
  signature: Hex;
  signer: Address;
  teeMode: string;
  inference: InferenceAttestation;
  quote: { quote: Hex; reportData: Hex; quoteHash: Hex } | null;
  txHash: Hex | null;
  evidence: Array<{ uri: string; ok: boolean; status: number | null; error: string | null; hashCheck: string; submissionIndex: number; verdict: string }>;
}

export interface InferenceAttestation {
  provider: 'confidential' | 'anthropic' | 'mock';
  attested: boolean;
  model: string;
  gateway: { checked: boolean; local: string; remote: string | null; mode: string | null; verdict: string; details: string | null; error: string | null } | null;
  publicEvidence: {
    fetchedAt: string;
    publicBase: string;
    allowlistSha256: string | null;
    discoverySha256: string | null;
    modelPins: Array<{ workload: string; servedModelName: string | null; repository: string | null; revision: string | null; expectedFiles: Record<string, string> }>;
    error: string | null;
  } | null;
  modelPinned: boolean;
  pinnedRevision: string | null;
  reason: string;
}
