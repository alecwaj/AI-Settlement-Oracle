/**
 * Orchestrates one AI resolution round for an escalated market:
 *   chain state -> verify submissions hash -> fetch evidence (in TEE) -> Claude -> transcript hash
 *   -> EIP-712 sign with enclave key -> per-resolution TDX quote -> submit on-chain.
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  formatEther,
  hashTypedData,
  http,
  keccak256,
  toBytes,
  zeroHash,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from 'viem';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { settlementOracleAbi } from './abi.js';
import type { OracleConfig } from './config.js';
import { fetchEvidence, type FetchedEvidence } from './evidence.js';
import { verdictLabel, type Decision, type Resolver } from './resolver.js';
import type { Quote, TeeIdentity } from './tee.js';

export const Status = { Open: 0, Proposed: 1, Escalated: 2, Resolved: 3, PausedForManual: 4 } as const;
export const OutcomeCode = { None: 0, YES: 1, NO: 2, INVALID: 3 } as const;

export const RESOLUTION_TYPES = {
  Resolution: [
    { name: 'marketId', type: 'uint256' },
    { name: 'outcome', type: 'uint8' },
    { name: 'confidenceBps', type: 'uint16' },
    { name: 'submissionsHash', type: 'bytes32' },
    { name: 'reasoningHash', type: 'bytes32' },
    { name: 'transcriptHash', type: 'bytes32' },
    { name: 'round', type: 'uint8' },
  ],
} as const;

export interface ResolutionRecord {
  marketId: string;
  round: number;
  status: 'signed' | 'submitted' | 'confirmed' | 'failed';
  error: string | null;
  createdAt: string;
  outcome: Decision['outcome'];
  confidenceBps: number;
  thresholdBps: number;
  willDelay: boolean;
  reasoning: string;
  decision: Decision;
  model: string;
  provider: string;
  submissionsHash: Hex;
  transcriptHash: Hex;
  digest: Hex;
  signature: Hex;
  signer: Address;
  teeMode: string;
  quote: Quote | null;
  txHash: Hex | null;
  evidence: Array<Omit<FetchedEvidence, 'text'> & { submissionIndex: number; verdict: 'YES' | 'NO' }>;
}

/** Deterministic JSON (sorted keys) so the transcript hash is reproducible by auditors. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === 'bigint') return v.toString();
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]));
    }
    return v;
  });
}

/** Mirrors SettlementOracle.submitEvidence's rolling hash. */
export function rollSubmissionsHash(
  subs: ReadonlyArray<{ submitter: Address; verdict: number; stake: bigint; evidenceURI: string; contentHash: Hex }>,
): Hex {
  let h: Hex = zeroHash;
  for (const s of subs) {
    h = keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'address' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes32' }],
        [h, s.submitter, s.verdict, s.stake, keccak256(toBytes(s.evidenceURI)), s.contentHash],
      ),
    );
  }
  return h;
}

export class SettlementOracleService {
  readonly publicClient: PublicClient;
  private chain: Chain | null = null;
  private readonly records = new Map<string, ResolutionRecord[]>();
  private readonly transcripts = new Map<Hex, string>();
  private readonly inflight = new Set<string>();
  private readonly lastAttempt = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly cfg: OracleConfig,
    readonly tee: TeeIdentity,
    private readonly resolver: Resolver,
  ) {
    this.publicClient = createPublicClient({ transport: http(cfg.rpcUrl) });
    this.load();
  }

  get contract(): Address {
    if (!this.cfg.contractAddress) throw new Error('CONTRACT_ADDRESS is not configured');
    return this.cfg.contractAddress;
  }

  private async getChain(): Promise<Chain> {
    if (this.chain) return this.chain;
    const id = await this.publicClient.getChainId();
    this.chain = defineChain({
      id,
      name: `chain-${id}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [this.cfg.rpcUrl] } },
    });
    return this.chain;
  }

  getRecords(marketId: string): ResolutionRecord[] {
    return this.records.get(marketId) ?? [];
  }

  getTranscript(hash: Hex): string | undefined {
    return this.transcripts.get(hash.toLowerCase() as Hex);
  }

  async readMarket(marketId: bigint) {
    const [market, submissions] = await Promise.all([
      this.publicClient.readContract({ address: this.contract, abi: settlementOracleAbi, functionName: 'getMarket', args: [marketId] }),
      this.publicClient.readContract({ address: this.contract, abi: settlementOracleAbi, functionName: 'getSubmissions', args: [marketId] }),
    ]);
    return { market, submissions };
  }

  /** Run one resolution round. Throws if the market is not ready. */
  async resolveMarket(marketId: bigint): Promise<ResolutionRecord> {
    const key = marketId.toString();
    if (this.inflight.has(key)) throw new Error(`Resolution for market ${key} already in progress`);
    this.inflight.add(key);
    this.lastAttempt.set(key, Date.now());
    try {
      return await this.doResolve(marketId);
    } finally {
      this.inflight.delete(key);
    }
  }

  private async doResolve(marketId: bigint): Promise<ResolutionRecord> {
    const { market, submissions } = await this.readMarket(marketId);
    if (market.creator === '0x0000000000000000000000000000000000000000') throw new Error('Market not found');
    if (market.status !== Status.Escalated) throw new Error(`Market is not escalated (status ${market.status})`);
    const block = await this.publicClient.getBlock();
    if (block.timestamp < market.evidenceDeadline) {
      throw new Error(`Evidence window open until ${new Date(Number(market.evidenceDeadline) * 1000).toISOString()}`);
    }

    // The AI must see exactly the on-chain submission set: recompute and compare the rolling hash.
    const submissionsHash = rollSubmissionsHash(submissions);
    if (submissionsHash !== market.submissionsHash) throw new Error('Submissions hash mismatch between contract storage and events');

    const evidence = await Promise.all(
      submissions.map((s) => fetchEvidence(s.evidenceURI, s.contentHash, { allowPrivateHosts: this.cfg.allowPrivateEvidenceHosts })),
    );

    const round = market.aiRound;
    const result = await this.resolver.resolve({
      question: market.question,
      resolutionCriteria: market.resolutionCriteria,
      resolutionTime: Number(market.resolutionTime),
      round,
      submissions: submissions.map((s, i) => ({
        index: i,
        submitter: s.submitter,
        verdict: verdictLabel(s.verdict),
        stakeEth: formatEther(s.stake),
        evidence: evidence[i],
      })),
    });

    const chain = await this.getChain();
    const confidenceBps = Math.round(result.decision.confidence * 10_000);
    const reasoning = result.decision.reasoning;

    const transcript = canonicalJson({
      version: 'ai-settlement-oracle/transcript/v1',
      chainId: chain.id,
      contract: this.contract,
      marketId: marketId.toString(),
      round,
      block: { number: block.number, timestamp: block.timestamp },
      market: { question: market.question, resolutionCriteria: market.resolutionCriteria, resolutionTime: market.resolutionTime },
      submissionsHash,
      evidence: evidence.map((e, i) => ({ ...e, submitter: submissions[i].submitter, verdict: verdictLabel(submissions[i].verdict) })),
      llm: {
        provider: result.provider,
        model: result.model,
        responseId: result.responseId,
        stopReason: result.stopReason,
        usage: result.usage,
        request: result.request,
        rawText: result.rawText,
      },
      decision: result.decision,
      tee: { mode: this.tee.info.mode, signer: this.tee.info.signer, appId: this.tee.info.appId, composeHash: this.tee.info.composeHash },
    });
    const transcriptHash = keccak256(toBytes(transcript));
    this.transcripts.set(transcriptHash.toLowerCase() as Hex, transcript);

    const message = {
      marketId,
      outcome: OutcomeCode[result.decision.outcome],
      confidenceBps,
      submissionsHash,
      reasoningHash: keccak256(toBytes(reasoning)),
      transcriptHash,
      round,
    };
    const domain = { name: 'SettlementOracle', version: '1', chainId: chain.id, verifyingContract: this.contract } as const;
    const digest = hashTypedData({ domain, types: RESOLUTION_TYPES, primaryType: 'Resolution', message });

    // Sanity check against the contract's own digest so a domain/type drift fails loudly off-chain.
    const onchainDigest = await this.publicClient.readContract({
      address: this.contract,
      abi: settlementOracleAbi,
      functionName: 'resolutionDigest',
      args: [marketId, message.outcome, confidenceBps, submissionsHash, message.reasoningHash, transcriptHash, round],
    });
    if (onchainDigest !== digest) throw new Error('EIP-712 digest mismatch with contract');

    const signature = await this.tee.account.signTypedData({ domain, types: RESOLUTION_TYPES, primaryType: 'Resolution', message });
    const quote = await this.tee.quoteForDigest(digest);

    const record: ResolutionRecord = {
      marketId: marketId.toString(),
      round,
      status: 'signed',
      error: null,
      createdAt: new Date().toISOString(),
      outcome: result.decision.outcome,
      confidenceBps,
      thresholdBps: market.confidenceThresholdBps,
      willDelay: confidenceBps < market.confidenceThresholdBps,
      reasoning,
      decision: result.decision,
      model: result.model,
      provider: result.provider,
      submissionsHash,
      transcriptHash,
      digest,
      signature,
      signer: this.tee.account.address,
      teeMode: this.tee.info.mode,
      quote,
      txHash: null,
      evidence: evidence.map(({ text: _text, ...e }, i) => ({ ...e, submissionIndex: i, verdict: verdictLabel(submissions[i].verdict) })),
    };
    this.pushRecord(record);

    if (this.cfg.autoSubmit) {
      try {
        const wallet = createWalletClient({ account: this.tee.account, chain, transport: http(this.cfg.rpcUrl) });
        const txHash = await wallet.writeContract({
          address: this.contract,
          abi: settlementOracleAbi,
          functionName: 'resolveWithAttestation',
          args: [marketId, message.outcome, confidenceBps, submissionsHash, reasoning, transcriptHash, signature],
        });
        record.txHash = txHash;
        record.status = 'submitted';
        const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
        record.status = receipt.status === 'success' ? 'confirmed' : 'failed';
        if (receipt.status !== 'success') record.error = 'transaction reverted';
      } catch (err) {
        record.status = 'failed';
        record.error = err instanceof Error ? err.message.split('\n')[0] : String(err);
      }
      this.persist();
    }
    return record;
  }

  /** Poll for escalated markets whose evidence window has closed and resolve them. */
  startWatcher(): void {
    if (!this.cfg.contractAddress || this.timer) return;
    const tick = async () => {
      try {
        const count = await this.publicClient.readContract({ address: this.contract, abi: settlementOracleAbi, functionName: 'marketCount' });
        const now = (await this.publicClient.getBlock()).timestamp;
        for (let id = 1n; id <= count; id++) {
          const key = id.toString();
          if (this.inflight.has(key)) continue;
          const m = await this.publicClient.readContract({ address: this.contract, abi: settlementOracleAbi, functionName: 'getMarket', args: [id] });
          if (m.status !== Status.Escalated || now < m.evidenceDeadline) continue;
          const last = this.lastAttempt.get(key) ?? 0;
          if (Date.now() - last < 5 * 60_000) continue; // back off after a failed/finished attempt
          console.log(`⚖️  Market ${key} ready for AI resolution (round ${m.aiRound + 1})`);
          this.resolveMarket(id)
            .then((r) => console.log(`   → ${r.outcome} @ ${(r.confidenceBps / 100).toFixed(1)}% [${r.status}]${r.error ? ` ${r.error}` : ''}`))
            .catch((e) => console.error(`   ✗ market ${key}:`, e instanceof Error ? e.message : e));
        }
      } catch (err) {
        console.error('watcher tick failed:', err instanceof Error ? err.message.split('\n')[0] : err);
      }
    };
    this.timer = setInterval(tick, this.cfg.watchIntervalMs);
    void tick();
  }

  stopWatcher(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private pushRecord(r: ResolutionRecord): void {
    const list = this.records.get(r.marketId) ?? [];
    list.push(r);
    this.records.set(r.marketId, list);
    this.persist();
  }

  /** State is scoped per contract so redeploys (e.g. a fresh anvil) never mix records. */
  private stateFile(): string | null {
    if (!this.cfg.dataDir || !this.cfg.contractAddress) return null;
    return path.join(this.cfg.dataDir, `oracle-state-${this.cfg.contractAddress.toLowerCase()}.json`);
  }

  private persist(): void {
    const file = this.stateFile();
    if (!file) return;
    mkdirSync(path.dirname(file), { recursive: true });
    const data = { records: Object.fromEntries(this.records), transcripts: Object.fromEntries(this.transcripts) };
    writeFileSync(file, canonicalJson(data));
  }

  private load(): void {
    const file = this.stateFile();
    if (!file) return;
    if (!existsSync(file)) return;
    const data = JSON.parse(readFileSync(file, 'utf8')) as {
      records: Record<string, ResolutionRecord[]>;
      transcripts: Record<string, string>;
    };
    for (const [k, v] of Object.entries(data.records ?? {})) this.records.set(k, v);
    for (const [k, v] of Object.entries(data.transcripts ?? {})) this.transcripts.set(k as Hex, v);
  }
}
