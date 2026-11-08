/**
 * Owner-only manual decision for a market that exhausted its three automatic attempts (PAUSED).
 *   npm run manual-resolve -- <market-slug> <YES|NO> "<reason>"
 * Uses DEPLOYER_PRIVATE_KEY (the contract owner) and the deployment recorded by the oracle service.
 */
import { settlementOracleAbi } from '@oracle/shared';
import { bootstrapChain, readMarket } from '../chain.ts';
import { loadConfig } from '../config.ts';
import { findMarket, MARKETS } from '../markets.ts';

const [slug, outcomeArg, ...reasonParts] = process.argv.slice(2);
const reason = reasonParts.join(' ').trim();
const outcome = outcomeArg?.toUpperCase();
if (!slug || (outcome !== 'YES' && outcome !== 'NO') || !reason) {
  console.error('usage: npm run manual-resolve -- <market-slug> <YES|NO> "<reason>"');
  process.exit(2);
}
if (!findMarket(slug)) {
  console.error(`unknown market "${slug}". Known: ${MARKETS.map((m) => m.slug).join(', ')}`);
  process.exit(2);
}

const config = loadConfig();
const chain = await bootstrapChain({
  rpcUrl: config.rpcUrl,
  deployerKey: config.deployerKey,
  oracleKey: config.oracleKey,
  contractAddress: config.contractAddress,
  retryDelaySeconds: config.retryDelaySeconds,
  dataDir: config.dataDir,
  contractsOutDir: config.contractsOutDir,
  markets: MARKETS,
  log: (m) => console.log(`[chain] ${m}`),
});
const id = chain.marketIds.get(slug);
if (id === undefined) throw new Error(`market ${slug} is not registered`);
const before = await readMarket(chain, id);
if (before.status !== 'PAUSED') {
  console.error(`market #${id} is ${before.status}; manual decisions are only allowed once it is PAUSED`);
  process.exit(1);
}
const hash = await chain.deployer.writeContract({
  address: chain.contract,
  abi: settlementOracleAbi,
  functionName: 'manualResolve',
  args: [id, outcome === 'YES' ? 1 : 2, reason],
});
await chain.publicClient.waitForTransactionReceipt({ hash });
const after = await readMarket(chain, id);
console.log(`market #${id} is now ${after.status} (${after.outcome}) · tx ${hash}`);
