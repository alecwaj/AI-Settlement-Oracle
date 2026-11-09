import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createPublicClient, createTestClient, createWalletClient, http, type Hex } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
export const ORACLE_URL = process.env.ORACLE_URL ?? 'http://127.0.0.1:3001';
export const deploymentFile = path.join(root, 'deployments/local.json');

// Anvil's well-known dev mnemonic. Local demo only.
const MNEMONIC = 'test test test test test test test test test test test junk';
export const anvilAccount = (i: number) => mnemonicToAccount(MNEMONIC, { addressIndex: i });

export const publicClient = createPublicClient({ chain: foundry, transport: http(RPC_URL) });
export const testClient = createTestClient({ chain: foundry, mode: 'anvil', transport: http(RPC_URL) });
export const walletFor = (i: number) => createWalletClient({ account: anvilAccount(i), chain: foundry, transport: http(RPC_URL) });

export function loadArtifact(): { abi: unknown[]; bytecode: Hex } {
  const a = JSON.parse(readFileSync(path.join(root, 'contracts/out/SettlementOracle.sol/SettlementOracle.json'), 'utf8'));
  return { abi: a.abi, bytecode: a.bytecode.object as Hex };
}

export async function warp(seconds: number): Promise<void> {
  await testClient.increaseTime({ seconds });
  await testClient.mine({ blocks: 1 });
}
