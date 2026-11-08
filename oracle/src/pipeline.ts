import { hashTypedData, parseEventLogs } from 'viem';
import {
  actionFor,
  buildDecisionInput,
  canonicalJson,
  DECISION_CODE,
  domainFor,
  evidenceHash,
  keccakText,
  messageToJson,
  promptHash,
  reportHash,
  rulesTextFor,
  settlementOracleAbi,
  sha256Text,
  toBps,
  typedData,
  type DecisionRecord,
  type MarketSpec,
  type OracleReport,
  type ReportBody,
  type ResolutionMessage,
} from '@oracle/shared';
import type { Decider } from './ai/decide.ts';
import { chainTime, readMarket, type ChainContext } from './chain.ts';
import type { EvidenceResult } from './news/aggregator.ts';
import type { ReportStore } from './reports.ts';

export type StepId = 'rules' | 'sourcing' | 'evidence' | 'decision' | 'attestation' | 'publication' | 'complete';

export interface PipelineEvent {
  seq: number;
  at: string;
  step: StepId;
  status: 'running' | 'progress' | 'done' | 'failed';
  message: string;
  data?: unknown;
}

export interface PipelineDeps {
  chain: ChainContext;
  decider: Decider;
  gather: (spec: MarketSpec, log: (msg: string) => void) => Promise<EvidenceResult>;
  reports: ReportStore;
  now?: () => Date;
}

export class PipelineError extends Error {
  constructor(
    readonly step: StepId,
    message: string,
    /** Set when a signed report was saved before the failure. */
    readonly reportId: string | null = null,
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

const short = (h: string): string => `${h.slice(0, 10)}…${h.slice(-6)}`;

/** Decision record used when no evidence was retrieved: nothing to judge, so the market is delayed. */
function noEvidenceRecord(rulesText: string, asOf: string): DecisionRecord {
  return {
    decision: {
      decision: 'INSUFFICIENT_EVIDENCE',
      confidence: 0,
      summary: 'No sources from trusted outlets inside the evidence window could be retrieved, so there is nothing to judge.',
      conditionAssessments: [],
      reasoningSteps: [],
      citedSourceIds: [],
      insufficiencyReason: 'No evidence was retrieved from any provider.',
    },
    model: 'none',
    requestedModel: 'none',
    promptHash: promptHash(),
    inputHash: sha256Text(buildDecisionInput(rulesText, [], asOf)),
    adjustments: ['no evidence retrieved; model not called'],
  };
}

/**
 * Runs one oracle resolution end to end. Every step reports progress through `emit`; the
 * resulting signed report is stored even if publication fails, so nothing is hidden.
 */
export async function runResolution(
  deps: PipelineDeps,
  spec: MarketSpec,
  emit: (e: Omit<PipelineEvent, 'seq' | 'at'>) => void,
): Promise<OracleReport> {
  const now = deps.now ?? (() => new Date());
  const { chain } = deps;
  const marketId = chain.marketIds.get(spec.slug);
  if (marketId === undefined) throw new PipelineError('rules', `market ${spec.slug} is not registered on-chain`);

  // 1. Read the settlement conditions and check the on-chain market accepts a resolution.
  emit({ step: 'rules', status: 'running', message: 'Reading settlement conditions' });
  const rulesText = rulesTextFor(spec);
  const rulesHash = keccakText(rulesText);
  const market = await readMarket(chain, marketId);
  if (market.rulesHash !== rulesHash) {
    throw new PipelineError('rules', 'on-chain rules hash does not match the market definition');
  }
  if (market.status !== 'OPEN' && market.status !== 'DELAYED') {
    throw new PipelineError('rules', `market is ${market.status}; it no longer accepts oracle resolutions`);
  }
  const t = await chainTime(chain);
  if (market.status === 'DELAYED' && t < market.delayedUntil) {
    throw new PipelineError('rules', `market is delayed until ${new Date(Number(market.delayedUntil) * 1000).toISOString()}`);
  }
  const decisionTime = now();
  if (decisionTime.getTime() < Date.parse(spec.resolutionTime)) {
    throw new PipelineError('rules', `market cannot be resolved before ${spec.resolutionTime}`);
  }
  emit({
    step: 'rules',
    status: 'done',
    message: `Rules ${short(rulesHash)} match on-chain market #${marketId} (attempt ${market.attempts + 1})`,
    data: { rulesHash, marketId: marketId.toString(), attempt: market.attempts, conditions: spec.conditions },
  });

  // 2. Source from trusted outlets.
  emit({ step: 'sourcing', status: 'running', message: `Querying ${spec.evidence.providers.join(', ')}` });
  const gathered = await deps.gather(spec, (msg) => emit({ step: 'sourcing', status: 'progress', message: msg }));
  emit({
    step: 'sourcing',
    status: 'done',
    message: gathered.providers.map((p) => `${p.provider}: ${p.kept}/${p.found} usable`).join(' · '),
    data: { providers: gathered.providers },
  });

  // 3. Fix and hash the evidence set.
  const { evidence } = gathered;
  const evHash = evidenceHash(evidence);
  emit({
    step: 'evidence',
    status: 'done',
    message: `${evidence.length} sources selected · evidence hash ${short(evHash)}`,
    data: {
      evidenceHash: evHash,
      sources: evidence.map(({ id, outlet, title, url, publishedAt, contentHash }) => ({ id, outlet, title, url, publishedAt, contentHash })),
    },
  });

  // 4. Decide.
  const asOf = decisionTime.toISOString();
  let record: DecisionRecord;
  if (evidence.length === 0) {
    record = noEvidenceRecord(rulesText, asOf);
    emit({ step: 'decision', status: 'done', message: 'No evidence retrieved: INSUFFICIENT_EVIDENCE (model not called)' });
  } else {
    emit({ step: 'decision', status: 'running', message: `Applying the rules to ${evidence.length} sources` });
    record = await deps.decider({ rulesText, evidence, asOf });
  }
  const decisionCode = DECISION_CODE[record.decision.decision];
  const confidenceBps = toBps(record.decision.confidence);
  const action = actionFor(record.decision.decision, confidenceBps, market.confidenceThresholdBps);
  const reasoning = canonicalJson(record);
  const reasoningHash = keccakText(reasoning);
  emit({
    step: 'decision',
    status: 'done',
    message: `${record.decision.decision} at ${(confidenceBps / 100).toFixed(1)}% confidence → ${action === 'RESOLVE' ? 'settle' : 'delay'}`,
    data: { decision: record.decision, model: record.model, action, adjustments: record.adjustments },
  });

  // 5. Sign the attestation.
  emit({ step: 'attestation', status: 'running', message: 'Signing EIP-712 attestation' });
  const reportId = `${spec.slug}-attempt${market.attempts + 1}-${asOf.replace(/[:.]/g, '-')}`;
  const body: ReportBody = {
    version: 1,
    reportId,
    createdAt: asOf,
    market: {
      slug: spec.slug,
      chainMarketId: marketId.toString(),
      question: spec.question,
      rulesText,
      rulesHash,
      confidenceThresholdBps: market.confidenceThresholdBps,
    },
    attempt: market.attempts,
    sourcing: { providers: gathered.providers, evidence, evidenceHash: evHash },
    decision: { reasoning, reasoningHash, record, decisionCode, confidenceBps, action },
  };
  const rHash = reportHash(body);
  const message: ResolutionMessage = {
    marketId,
    attempt: market.attempts,
    decision: decisionCode,
    confidenceBps,
    rulesHash,
    evidenceHash: evHash,
    reasoningHash,
    reportHash: rHash,
    timestamp: BigInt(Math.floor(decisionTime.getTime() / 1000)),
  };
  const domain = domainFor(chain.chain.id, chain.contract);
  const td = typedData(domain, message);
  if (!chain.oracleAccount.signTypedData) throw new PipelineError('attestation', 'oracle account cannot sign typed data');
  const signature = await chain.oracleAccount.signTypedData(td);
  const report: OracleReport = {
    ...body,
    reportHash: rHash,
    attestation: {
      domain,
      message: messageToJson(message),
      digest: hashTypedData(td),
      signer: chain.oracleAccount.address,
      signature,
    },
    publication: null,
    publicationError: null,
  };
  deps.reports.save(report);
  emit({
    step: 'attestation',
    status: 'done',
    message: `Signed by ${chain.oracleAccount.address} · report hash ${short(rHash)}`,
    data: { signer: chain.oracleAccount.address, signature, reportHash: rHash, digest: report.attestation.digest },
  });

  // 6. Publish decision logic, sources and signature on-chain.
  emit({ step: 'publication', status: 'running', message: `Posting to SettlementOracle ${chain.contract}` });
  try {
    const args = [
      message,
      reasoning,
      evidence.map((e) => ({ url: e.url, contentHash: e.contentHash })),
      signature,
    ] as const;
    const { request } = await chain.publicClient.simulateContract({
      address: chain.contract,
      abi: settlementOracleAbi,
      functionName: 'submitResolution',
      args,
      account: chain.deployer.account,
    });
    const txHash = await chain.deployer.writeContract(request);
    const receipt = await chain.publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') throw new Error(`transaction ${txHash} reverted`);
    const posted = parseEventLogs({ abi: settlementOracleAbi, eventName: 'ResolutionPosted', logs: receipt.logs });
    if (posted.length !== 1) throw new Error('ResolutionPosted event missing from receipt');
    const after = await readMarket(chain, marketId);
    report.publication = {
      chainId: chain.chain.id,
      contract: chain.contract,
      txHash,
      blockNumber: receipt.blockNumber.toString(),
      marketStatusAfter: after.status,
      postedAt: new Date().toISOString(),
    };
    deps.reports.save(report);
    emit({
      step: 'publication',
      status: 'done',
      message: `Posted in block ${receipt.blockNumber} · market is now ${after.status}`,
      data: { txHash, blockNumber: receipt.blockNumber.toString(), market: serializeMarket(after) },
    });
  } catch (err) {
    report.publicationError = (err as Error).message.split('\n')[0] ?? 'unknown error';
    deps.reports.save(report);
    throw new PipelineError(
      'publication',
      `signed report saved but not published: ${report.publicationError}`,
      report.reportId,
    );
  }

  return report;
}

export function serializeMarket(m: Awaited<ReturnType<typeof readMarket>>): Record<string, unknown> {
  return {
    ...m,
    marketId: m.marketId.toString(),
    resolutionTime: m.resolutionTime.toString(),
    delayedUntil: m.delayedUntil.toString(),
  };
}
