/**
 * Seed demo markets so a visitor sees the whole lifecycle without doing anything:
 *   #1 NASA 2025: proposed → disputed → re-proposed → disputed (escalated) + 3 staked evidence submissions.
 *      The oracle resolves it automatically once the evidence window closes.
 *   #2 JWST / K2-18b: same path, with a contested scientific claim as evidence.
 *   #3 Crewed Moon landing: left open so a visitor can try the interactive flow with a wallet.
 *
 * Also registers the running oracle's enclave signer (from GET /attestation) and, on public networks,
 * funds the derived participant wallets from the deployer.
 *
 *   npm run demo:seed                 # local anvil (oracle must be running)
 *   npm run testnet:seed              # Base Sepolia (ORACLE_URL = your Phala CVM endpoint)
 */
import { formatEther, parseEther, zeroHash, type Address, type Hex } from 'viem';
import { settlementOracleAbi as abi } from '../oracle/src/abi.js';
import { account, explorerTx, network, ORACLE_URL, publicClient, readDeployment, walletFor } from './lib.js';

const { address: contract } = readDeployment();
const YES = 1;
const NO = 2;

async function send(i: number, functionName: string, args: unknown[], value?: bigint): Promise<Hex> {
  const wallet = await walletFor(i);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hash = await wallet.writeContract({ address: contract, abi, functionName: functionName as any, args: args as any, value } as any);
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${functionName} reverted (${explorerTx(hash)})`);
  return hash;
}

async function contentHash(url: string): Promise<Hex> {
  try {
    const r = (await (
      await fetch(`${ORACLE_URL}/evidence/hash`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) })
    ).json()) as { contentHash: Hex | null };
    return r.contentHash ?? zeroHash;
  } catch {
    return zeroHash; // commit to "unchecked" if the helper is unavailable
  }
}

// ---------- 1. Register the oracle's enclave signer ----------
const att = (await (await fetch(`${ORACLE_URL}/attestation`)).json()) as {
  signer: Address;
  mode: string;
  composeHash: Hex | null;
  bootQuote: { quoteHash: Hex } | null;
};
const [active, , registeredQuote] = await publicClient.readContract({ address: contract, abi, functionName: 'enclaveSigners', args: [att.signer] });
const quoteHash = att.bootQuote?.quoteHash ?? zeroHash;
if (!active || registeredQuote !== quoteHash) {
  await send(0, 'registerEnclaveSigner', [att.signer, att.composeHash ?? zeroHash, quoteHash]);
}
console.log(`🔐 Enclave signer ${att.signer} registered (oracle mode: ${att.mode})`);
if (att.mode !== 'tdx') console.log('   ⚠️  oracle is not running in a real TDX enclave — fine for local testing only');

// ---------- 2. Fund participants on public networks ----------
const bond = await publicClient.readContract({ address: contract, abi, functionName: 'proposalBond' });
const minStake = await publicClient.readContract({ address: contract, abi, functionName: 'minEvidenceStake' });
const PARTICIPANTS = [1, 2, 3, 4, 5, 6, 7, 8];
if (!network.isLocal) {
  // Covers the whole seed: proposers/disputers post a bond in each of the 2 escalated markets;
  // evidence submitters stake up to 5 + 4 × minStake across them. Plus gas headroom.
  const gasBuffer = parseEther('0.001');
  const need = bond * 2n + minStake * 10n + gasBuffer;
  // Market creation by #1 (oracle signer pays its own gas — fund it too).
  const toFund: Address[] = [...PARTICIPANTS.map((i) => account(i).address), att.signer];
  const deployer = await walletFor(0);
  for (const addr of toFund) {
    const bal = await publicClient.getBalance({ address: addr });
    if (bal >= need) continue;
    const hash = await deployer.sendTransaction({ to: addr, value: need - bal, account: deployer.account, chain: deployer.chain });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`   funded ${addr} with ${formatEther(need - bal)} ETH`);
  }
}

const now = (await publicClient.getBlock()).timestamp;

async function escalated(question: string, criteria: string, evidence: Array<[number, number, string, bigint]>): Promise<bigint> {
  await send(1, 'createMarket', [question, criteria, now - 60n, 7000]);
  const id = await publicClient.readContract({ address: contract, abi, functionName: 'marketCount' });
  await send(2, 'propose', [id, YES], bond); // proposer
  await send(3, 'dispute', [id], bond); // single challenge → reset
  await send(4, 'propose', [id, YES], bond); // proposes again
  await send(5, 'dispute', [id], bond); // double challenge → escalate to the AI arbiter
  for (const [acct, verdict, uri, stake] of evidence) {
    await send(acct, 'submitEvidence', [id, verdict, uri, await contentHash(uri)], stake);
  }
  const m = await publicClient.readContract({ address: contract, abi, functionName: 'getMarket', args: [id] });
  console.log(`⚖️  #${id} escalated with ${evidence.length} evidence submissions — AI resolves after ${new Date(Number(m.evidenceDeadline) * 1000).toISOString()}`);
  return id;
}

// ---------- 3. Markets ----------
await escalated(
  'Will NASA find definitive evidence of extraterrestrial life in 2025?',
  'Resolves YES if, during calendar year 2025, NASA officially announces the discovery of living organisms, fossilized life, or an unambiguous biosignature from beyond Earth. Resolves NO if NASA only reports precursor molecules (e.g. amino acids, nucleobases, organic compounds) or "potential" biosignatures that NASA itself describes as requiring further study.',
  [
    [6, YES, 'https://www.nasa.gov/news-release/nasa-says-mars-rover-discovered-potential-biosignature-last-year/', minStake * 5n],
    [7, NO, 'https://www.nasa.gov/news-release/nasas-asteroid-bennu-sample-reveals-mix-of-lifes-ingredients/', minStake * 3n],
    [8, NO, 'https://www.nasa.gov/news-release/nasa-says-mars-rover-discovered-potential-biosignature-last-year/', minStake * 2n],
  ],
);

await escalated(
  'Will JWST observations confirm a biosignature on exoplanet K2-18b by the end of 2025?',
  'Resolves YES only if, by 2025-12-31 UTC, a biosignature gas on K2-18b is reported at or above the conventional 5-sigma detection threshold and described as a confirmed detection by NASA, ESA, or the discovering team. Tentative signals, "hints", or detections below 5 sigma resolve NO.',
  [
    [6, YES, 'https://www.cam.ac.uk/stories/strongest-hints-of-biological-activity', minStake * 4n],
    [7, NO, 'https://science.nasa.gov/missions/webb/webb-discovers-methane-carbon-dioxide-in-atmosphere-of-k2-18-b/', minStake * 2n],
    [8, NO, 'https://science.nasa.gov/exoplanet-catalog/k2-18-b/', minStake * 2n],
  ],
);

await send(1, 'createMarket', [
  'Will a crewed mission land on the Moon before 2026?',
  'Resolves YES if any crewed spacecraft performs a soft landing on the lunar surface between 2024-01-01 and 2025-12-31 UTC, as confirmed by the operating space agency. Otherwise NO.',
  now - 60n,
  7000,
]);
const openId = await publicClient.readContract({ address: contract, abi, functionName: 'marketCount' });
console.log(`🆕 #${openId} open for proposals (interactive path).`);

if (network.isLocal) console.log('\nNext: `npm run demo:warp -- 300` closes the evidence windows; the oracle resolves #1 and #2 automatically.');
else console.log('\nThe oracle watcher resolves #1 and #2 automatically once their evidence windows close (~5 min).');
