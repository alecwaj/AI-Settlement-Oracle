/**
 * Shared helpers for the deploy/seed scripts. Works against local anvil (default) or any EVM network.
 *
 *   --network local         anvil at http://127.0.0.1:8545, well-known dev accounts, fast timings
 *   --network base-sepolia  RPC_URL (default https://sepolia.base.org) + DEPLOYER_KEY from env
 *
 * On a public network the deployer is account 0; demo participants (proposers, disputers, evidence
 * submitters) are derived deterministically from DEPLOYER_KEY and funded by the deployer.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import 'dotenv/config';
import {
  concat,
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseEther,
  toBytes,
  type Address,
  type Chain,
  type Hex,
  type LocalAccount,
} from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export interface NetworkProfile {
  name: string;
  rpcUrl: string;
  explorer: string | null;
  isLocal: boolean;
  params: {
    proposalBond: bigint;
    minEvidenceStake: bigint;
    liveness: bigint;
    evidenceWindow: bigint;
    delayPeriod: bigint;
    maxDelays: number;
  };
}

const env = (k: string) => process.env[k] || undefined;

const PROFILES: Record<string, Omit<NetworkProfile, 'rpcUrl'> & { rpcUrl: string }> = {
  local: {
    name: 'local',
    rpcUrl: 'http://127.0.0.1:8545',
    explorer: null,
    isLocal: true,
    params: { proposalBond: parseEther('0.1'), minEvidenceStake: parseEther('0.01'), liveness: 120n, evidenceWindow: 300n, delayPeriod: 180n, maxDelays: 3 },
  },
  'base-sepolia': {
    name: 'base-sepolia',
    rpcUrl: 'https://sepolia.base.org',
    explorer: 'https://sepolia.basescan.org',
    isLocal: false,
    // Cheap test-ETH amounts; windows long enough for a human reviewer to watch, short enough to finish quickly.
    params: { proposalBond: parseEther('0.0005'), minEvidenceStake: parseEther('0.0001'), liveness: 900n, evidenceWindow: 300n, delayPeriod: 600n, maxDelays: 3 },
  },
};

export const networkName = arg('network') ?? env('NETWORK') ?? 'local';
const base = PROFILES[networkName];
if (!base) throw new Error(`Unknown network "${networkName}". Known: ${Object.keys(PROFILES).join(', ')}`);
export const network: NetworkProfile = { ...base, rpcUrl: env('RPC_URL') ?? base.rpcUrl };
export const ORACLE_URL = env('ORACLE_URL') ?? 'http://127.0.0.1:3001';
export const deploymentFile = path.join(root, 'deployments', `${network.name}.json`);

const MNEMONIC = 'test test test test test test test test test test test junk'; // anvil dev accounts (local only)

export function account(i: number): LocalAccount {
  if (network.isLocal) return mnemonicToAccount(MNEMONIC, { addressIndex: i });
  const key = env('DEPLOYER_KEY') as Hex | undefined;
  if (!key) throw new Error('DEPLOYER_KEY is required for non-local networks (use a fresh test-only wallet)');
  if (i === 0) return privateKeyToAccount(key);
  return privateKeyToAccount(keccak256(concat([toBytes(key), toBytes(`ai-settlement-oracle/demo-participant/${i}`)])));
}

export const publicClient = createPublicClient({ transport: http(network.rpcUrl) });
export const testClient = createTestClient({ mode: 'anvil', transport: http(network.rpcUrl) });

let chainCache: Chain | null = null;
export async function getChain(): Promise<Chain> {
  if (chainCache) return chainCache;
  const id = await publicClient.getChainId();
  chainCache = defineChain({ id, name: network.name, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [network.rpcUrl] } } });
  return chainCache;
}

export async function walletFor(i: number) {
  return createWalletClient({ account: account(i), chain: await getChain(), transport: http(network.rpcUrl) });
}

export function loadArtifact(): { abi: unknown[]; bytecode: Hex } {
  const a = JSON.parse(readFileSync(path.join(root, 'contracts/out/SettlementOracle.sol/SettlementOracle.json'), 'utf8'));
  return { abi: a.abi, bytecode: a.bytecode.object as Hex };
}

export interface Deployment {
  network: string;
  chainId: number;
  address: Address;
  deployBlock: string;
  owner: Address;
  explorer: string | null;
  params: Record<string, string | number>;
  deployedAt: string;
}

export function readDeployment(): Deployment {
  if (env('CONTRACT_ADDRESS')) {
    return { network: network.name, chainId: 0, address: env('CONTRACT_ADDRESS') as Address, deployBlock: '0', owner: account(0).address, explorer: network.explorer, params: {}, deployedAt: '' };
  }
  if (!existsSync(deploymentFile)) throw new Error(`No deployment at ${deploymentFile}; run the deploy script first`);
  return JSON.parse(readFileSync(deploymentFile, 'utf8')) as Deployment;
}

export function writeDeployment(d: Deployment): void {
  mkdirSync(path.dirname(deploymentFile), { recursive: true });
  writeFileSync(deploymentFile, JSON.stringify(d, null, 2) + '\n');
}

export function explorerTx(hash: Hex): string {
  return network.explorer ? `${network.explorer}/tx/${hash}` : hash;
}

export async function warp(seconds: number): Promise<void> {
  if (!network.isLocal) throw new Error('Time warp only works on local anvil');
  await testClient.increaseTime({ seconds });
  await testClient.mine({ blocks: 1 });
}
