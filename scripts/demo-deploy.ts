/**
 * Deploys SettlementOracle to a local anvil chain with short demo timings and writes deployments/local.json.
 * Usage: anvil (in another terminal) && npm run build:contracts && npm run demo:deploy
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseEther } from 'viem';
import { deploymentFile, loadArtifact, publicClient, walletFor } from './lib.js';

const params = {
  proposalBond: parseEther('0.1'),
  minEvidenceStake: parseEther('0.01'),
  liveness: 120n, // 2 min (UMA uses ~2h)
  evidenceWindow: 300n, // 5 min
  delayPeriod: 180n, // 3 min
  maxDelays: 3,
};

const { abi, bytecode } = loadArtifact();
const owner = walletFor(0);
const hash = await owner.deployContract({
  abi,
  bytecode,
  args: [params.proposalBond, params.minEvidenceStake, params.liveness, params.evidenceWindow, params.delayPeriod, params.maxDelays],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (!receipt.contractAddress) throw new Error('deployment failed');

mkdirSync(path.dirname(deploymentFile), { recursive: true });
writeFileSync(
  deploymentFile,
  JSON.stringify(
    { address: receipt.contractAddress, chainId: 31337, owner: owner.account.address, params, deployedAt: new Date().toISOString() },
    (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
    2,
  ),
);
console.log(`✅ SettlementOracle deployed at ${receipt.contractAddress}`);
console.log(`   wrote ${path.relative(process.cwd(), deploymentFile)} (the oracle and demo pick this up automatically)`);
