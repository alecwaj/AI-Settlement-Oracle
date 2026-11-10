/**
 * Deploy SettlementOracle and write deployments/<network>.json.
 *   npm run demo:deploy                                   # local anvil
 *   npm run testnet:deploy                                # Base Sepolia (RPC_URL, DEPLOYER_KEY in .env)
 */
import { formatEther } from 'viem';
import { account, explorerTx, getChain, loadArtifact, network, publicClient, walletFor, writeDeployment, deploymentFile } from './lib.js';

const p = network.params;
const owner = await walletFor(0);
const chain = await getChain();
const balance = await publicClient.getBalance({ address: account(0).address });
console.log(`Deploying to ${network.name} (chain ${chain.id}) from ${account(0).address} — balance ${formatEther(balance)} ETH`);

const { abi, bytecode } = loadArtifact();
const hash = await owner.deployContract({
  abi,
  bytecode,
  args: [p.proposalBond, p.minEvidenceStake, p.liveness, p.evidenceWindow, p.delayPeriod, p.maxDelays],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (!receipt.contractAddress) throw new Error('deployment failed');

writeDeployment({
  network: network.name,
  chainId: chain.id,
  address: receipt.contractAddress,
  deployBlock: receipt.blockNumber.toString(),
  owner: account(0).address,
  explorer: network.explorer,
  params: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])),
  deployedAt: new Date().toISOString(),
});
console.log(`✅ SettlementOracle at ${receipt.contractAddress} (block ${receipt.blockNumber})`);
console.log(`   tx ${explorerTx(hash)}`);
console.log(`   wrote ${deploymentFile.replace(process.cwd() + '/', '')}`);
