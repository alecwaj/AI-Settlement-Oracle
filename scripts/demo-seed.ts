/**
 * Seeds the local demo:
 *   1. Registers the running oracle's enclave signer on the contract (reads GET /attestation).
 *   2. Market #1 (NASA 2025): proposed, disputed twice, escalated, with three staked evidence submissions.
 *   3. Market #2: open, ready for you to walk through propose → dispute → dispute → evidence yourself.
 * Usage: npm run demo:seed  (anvil + oracle must be running)
 */
import { readFileSync } from 'node:fs';
import { parseEther, zeroHash, type Address, type Hex } from 'viem';
import { settlementOracleAbi as abi } from '../oracle/src/abi.js';
import { deploymentFile, ORACLE_URL, publicClient, walletFor } from './lib.js';

const contract = (process.env.CONTRACT_ADDRESS ?? JSON.parse(readFileSync(deploymentFile, 'utf8')).address) as Address;
const YES = 1;
const NO = 2;

async function send(i: number, functionName: string, args: unknown[], value?: bigint): Promise<void> {
  const wallet = walletFor(i);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hash = await wallet.writeContract({ address: contract, abi, functionName: functionName as any, args: args as any, value } as any);
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${functionName} reverted`);
}

// 1. Register the enclave signer
const att = (await (await fetch(`${ORACLE_URL}/attestation`)).json()) as {
  signer: Address;
  mode: string;
  composeHash: Hex | null;
  bootQuote: { quoteHash: Hex } | null;
};
await send(0, 'registerEnclaveSigner', [att.signer, att.composeHash ?? zeroHash, att.bootQuote?.quoteHash ?? zeroHash]);
console.log(`🔐 Registered enclave signer ${att.signer} (mode: ${att.mode})`);
if (att.mode === 'dev') console.log('   ⚠️  oracle is in dev mode — this signer is NOT TEE-backed');

const bond = parseEther('0.1');
const now = (await publicClient.getBlock()).timestamp;

// 2. NASA market, escalated with evidence
await send(1, 'createMarket', [
  'Will NASA find definitive evidence of extraterrestrial life in 2025?',
  'Resolves YES if, during calendar year 2025, NASA officially announces the discovery of living organisms, fossilized life, or an unambiguous biosignature from beyond Earth. Resolves NO if NASA only reports precursor molecules (e.g. amino acids, nucleobases, organic compounds) or "potential" biosignatures that NASA itself describes as requiring further study.',
  now - 60n,
  7000,
]);
const nasaId = await publicClient.readContract({ address: contract, abi, functionName: 'marketCount' });
await send(2, 'propose', [nasaId, YES], bond); // proposer says YES
await send(3, 'dispute', [nasaId], bond); // single challenge → reset
await send(4, 'propose', [nasaId, YES], bond); // proposes YES again
await send(5, 'dispute', [nasaId], bond); // double challenge → escalate

const evidence: Array<[number, number, string, string]> = [
  [6, YES, 'https://www.nasa.gov/news-release/nasa-says-mars-rover-discovered-potential-biosignature-last-year/', '0.05'],
  [7, NO, 'https://www.nasa.gov/news-release/nasas-asteroid-bennu-sample-reveals-mix-of-lifes-ingredients/', '0.03'],
  [8, NO, 'https://www.nasa.gov/news-release/nasa-says-mars-rover-discovered-potential-biosignature-last-year/', '0.02'],
];
for (const [acct, verdict, uri, stake] of evidence) {
  // Hash check is optional: submitters may commit to 0x0 if the page is dynamic. Here we ask the oracle helper.
  const h = (await (await fetch(`${ORACLE_URL}/evidence/hash`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: uri }) })).json()) as { contentHash: Hex | null };
  await send(acct, 'submitEvidence', [nasaId, verdict, uri, h.contentHash ?? zeroHash], parseEther(stake));
}
const m = await publicClient.readContract({ address: contract, abi, functionName: 'getMarket', args: [nasaId] });
console.log(`⚖️  Market #${nasaId} escalated with ${evidence.length} evidence submissions; window closes ${new Date(Number(m.evidenceDeadline) * 1000).toISOString()}`);

// 3. A fresh open market for a hands-on walkthrough
await send(1, 'createMarket', [
  'Will a crewed mission land on the Moon before 2026?',
  'Resolves YES if any crewed spacecraft performs a soft landing on the lunar surface between 2024-01-01 and 2025-12-31 UTC, as confirmed by the operating space agency. Otherwise NO.',
  now - 60n,
  7000,
]);
console.log('🆕 Market #2 open for proposals.');
console.log(`\nNext: run \`npm run demo:warp -- 300\` to close the evidence window — the oracle watcher resolves market #${nasaId} automatically.`);
