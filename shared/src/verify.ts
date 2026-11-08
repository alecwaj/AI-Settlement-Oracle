import { hashTypedData, recoverTypedDataAddress, type PublicClient } from 'viem';
import { settlementOracleAbi } from './abi.ts';
import { messageFromJson, typedData } from './eip712.ts';
import {
  actionFor,
  canonicalJson,
  contentHash,
  DECISION_CODE,
  evidenceHash,
  keccakText,
  reportHash,
  sha256Text,
  toBps,
} from './hashing.ts';
import { buildDecisionInput, promptHash } from './prompt.ts';
import type { DecisionRecord, OracleReport } from './types.ts';
import { MARKET_STATUS } from './types.ts';

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

function check(id: string, label: string, ok: boolean, detail: string): Check {
  return { id, label, ok, detail };
}

const short = (h: string): string => (h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h);

/** Compares two hex strings case-insensitively (addresses may be checksummed). */
const eq = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * Recomputes every hash in a report from its published contents and checks the signature.
 * Needs no network access and does not trust the oracle service.
 */
export async function verifyReportOffline(report: OracleReport): Promise<Check[]> {
  const checks: Check[] = [];
  const msg = report.attestation.message;

  const rulesHash = keccakText(report.market.rulesText);
  checks.push(
    check(
      'rules',
      'Settlement rules hash',
      eq(rulesHash, report.market.rulesHash) && eq(rulesHash, msg.rulesHash),
      `keccak256(rules) = ${short(rulesHash)}`,
    ),
  );

  const badContent = report.sourcing.evidence.filter((e) => !eq(contentHash(e.text), e.contentHash));
  checks.push(
    check(
      'content',
      'Source content hashes',
      badContent.length === 0,
      badContent.length === 0
        ? `sha256 matches for all ${report.sourcing.evidence.length} sources`
        : `mismatch for ${badContent.map((e) => e.id).join(', ')}`,
    ),
  );

  const evHash = evidenceHash(report.sourcing.evidence);
  checks.push(
    check(
      'evidence',
      'Evidence set hash',
      eq(evHash, report.sourcing.evidenceHash) && eq(evHash, msg.evidenceHash),
      `recomputed ${short(evHash)}`,
    ),
  );

  const reasoningHash = keccakText(report.decision.reasoning);
  let record: DecisionRecord | null = null;
  try {
    record = JSON.parse(report.decision.reasoning) as DecisionRecord;
  } catch {
    record = null;
  }
  checks.push(
    check(
      'reasoning',
      'Decision logic hash',
      eq(reasoningHash, report.decision.reasoningHash) &&
        eq(reasoningHash, msg.reasoningHash) &&
        record !== null &&
        canonicalJson(record) === report.decision.reasoning,
      `keccak256(decision logic) = ${short(reasoningHash)}`,
    ),
  );

  if (record) {
    const code = DECISION_CODE[record.decision.decision];
    const bps = toBps(record.decision.confidence);
    const action = actionFor(record.decision.decision, bps, report.market.confidenceThresholdBps);
    checks.push(
      check(
        'decision',
        'Signed decision matches decision logic',
        code === msg.decision && bps === msg.confidenceBps && action === report.decision.action,
        `${record.decision.decision} at ${(bps / 100).toFixed(1)}% → ${action}`,
      ),
    );

    const known = new Set(report.sourcing.evidence.map((e) => e.id));
    const cited = [
      ...record.decision.citedSourceIds,
      ...record.decision.reasoningSteps.flatMap((s) => s.sourceIds),
      ...record.decision.conditionAssessments.flatMap((c) => c.sourceIds),
    ];
    const unknown = cited.filter((id) => !known.has(id));
    checks.push(
      check(
        'citations',
        'Citations point to published sources',
        unknown.length === 0,
        unknown.length === 0 ? `${new Set(cited).size} distinct sources cited` : `unknown ids: ${unknown.join(', ')}`,
      ),
    );

    const input = buildDecisionInput(report.market.rulesText, report.sourcing.evidence, report.createdAt);
    const inputHash = sha256Text(input);
    checks.push(
      check(
        'input',
        'Model input reconstructs from report',
        eq(inputHash, record.inputHash),
        `sha256(model input) = ${short(inputHash)}`,
      ),
    );
    const pHash = promptHash();
    checks.push(
      check(
        'prompt',
        'Prompt template matches this verifier',
        eq(pHash, record.promptHash),
        eq(pHash, record.promptHash)
          ? `prompt ${short(pHash)}`
          : `report used prompt ${short(record.promptHash)}, verifier has ${short(pHash)}`,
      ),
    );
  }

  const rHash = reportHash(report);
  checks.push(
    check(
      'report',
      'Report hash',
      eq(rHash, report.reportHash) && eq(rHash, msg.reportHash),
      `keccak256(report) = ${short(rHash)}`,
    ),
  );

  const td = typedData(report.attestation.domain, messageFromJson(msg));
  const digest = hashTypedData(td);
  let recovered = '0x';
  try {
    recovered = await recoverTypedDataAddress({ ...td, signature: report.attestation.signature });
  } catch {
    recovered = '0x';
  }
  checks.push(
    check(
      'signature',
      'EIP-712 signature',
      eq(digest, report.attestation.digest) && eq(recovered, report.attestation.signer),
      `recovered signer ${recovered}`,
    ),
  );

  return checks;
}

/**
 * Checks the report against the chain: the signer is authorized, and the ResolutionPosted /
 * EvidenceSource events for this attempt carry exactly the published decision logic and sources.
 */
export async function verifyReportOnChain(client: PublicClient, report: OracleReport): Promise<Check[]> {
  const checks: Check[] = [];
  const address = report.attestation.domain.verifyingContract;
  const marketId = BigInt(report.market.chainMarketId);
  const msg = report.attestation.message;

  const chainId = await client.getChainId();
  checks.push(
    check(
      'chain',
      'Connected to the signing chain',
      chainId === report.attestation.domain.chainId,
      `chain ${chainId}, contract ${address}`,
    ),
  );
  if (chainId !== report.attestation.domain.chainId) return checks;

  const authorized = await client.readContract({
    address,
    abi: settlementOracleAbi,
    functionName: 'authorizedOracles',
    args: [report.attestation.signer],
  });
  checks.push(check('authorized', 'Signer is an authorized oracle', authorized, report.attestation.signer));

  const market = await client.readContract({
    address,
    abi: settlementOracleAbi,
    functionName: 'getMarket',
    args: [marketId],
  });
  checks.push(
    check(
      'onchain-rules',
      'On-chain rules match',
      eq(market.rulesHash, report.market.rulesHash) && market.rules === report.market.rulesText,
      `market #${marketId} status ${MARKET_STATUS[market.status] ?? market.status}`,
    ),
  );

  const fromBlock = report.publication ? BigInt(report.publication.blockNumber) : 0n;
  const toBlock = report.publication ? BigInt(report.publication.blockNumber) : 'latest';
  const posted = await client.getContractEvents({
    address,
    abi: settlementOracleAbi,
    eventName: 'ResolutionPosted',
    args: { marketId, attempt: msg.attempt },
    fromBlock,
    toBlock,
  });
  const ev = posted[0]?.args;
  checks.push(
    check(
      'onchain-decision',
      'Posted decision matches signed report',
      !!ev &&
        ev.decision === msg.decision &&
        ev.confidenceBps === msg.confidenceBps &&
        eq(ev.reasoningHash ?? '', msg.reasoningHash) &&
        eq(ev.evidenceHash ?? '', msg.evidenceHash) &&
        eq(ev.reportHash ?? '', msg.reportHash) &&
        eq(ev.signer ?? '', report.attestation.signer) &&
        ev.reasoning === report.decision.reasoning,
      ev ? `ResolutionPosted in tx ${short(posted[0]?.transactionHash ?? '')}` : 'no ResolutionPosted event found',
    ),
  );

  const sourceEvents = await client.getContractEvents({
    address,
    abi: settlementOracleAbi,
    eventName: 'EvidenceSource',
    args: { marketId, attempt: msg.attempt },
    fromBlock,
    toBlock,
  });
  const onchain = sourceEvents
    .map((e) => e.args)
    .sort((a, b) => Number((a.index ?? 0n) - (b.index ?? 0n)));
  const sourcesMatch =
    onchain.length === report.sourcing.evidence.length &&
    onchain.every((s, i) => {
      const e = report.sourcing.evidence[i];
      return !!e && s.url === e.url && eq(s.contentHash ?? '', e.contentHash);
    });
  checks.push(
    check(
      'onchain-sources',
      'Posted sources match report',
      sourcesMatch,
      `${onchain.length} EvidenceSource events`,
    ),
  );

  return checks;
}
