/**
 * Shared data model for the oracle service, the on-chain contract and the demo verifier.
 */

export type Hex = `0x${string}`;
export type Address = `0x${string}`;

/** A market's settlement conditions. Its canonical JSON form is stored on-chain as `rules`. */
export interface MarketSpec {
  slug: string;
  question: string;
  /** Earliest time the market may be settled (ISO 8601). */
  resolutionTime: string;
  /** Minimum confidence (0..1) needed to settle instead of delaying. */
  confidenceThreshold: number;
  conditions: {
    yes: string[];
    no: string[];
    /** Clarifications that apply to both sides (definitions, edge cases). */
    notes: string[];
  };
  /** Which publications count as evidence and over which period. */
  evidence: {
    window: { from: string; to: string };
    acceptedSources: string;
    /** News providers the oracle must query. */
    providers: ProviderId[];
    /** Search queries the oracle runs against each news provider. Part of the signed rules. */
    searchQueries: string[];
  };
}

export type ProviderId = 'guardian' | 'gdelt' | 'nasa';

/** One piece of evidence exactly as it was given to the model. */
export interface EvidenceItem {
  /** Stable id used for citations, e.g. "S3". */
  id: string;
  provider: ProviderId;
  outlet: string;
  url: string;
  title: string;
  publishedAt: string | null;
  retrievedAt: string;
  /** How `text` was obtained. */
  textSource: 'api-body' | 'article-page';
  /** The exact text the model read (already truncated). */
  text: string;
  /** SHA-256 of UTF-8 `text`. */
  contentHash: Hex;
}

export interface ProviderStatus {
  provider: ProviderId;
  ok: boolean;
  queries: string[];
  /** Results returned by the provider before filtering. */
  found: number;
  /** Items kept after trust, date and content filters (before de-duplication across providers). */
  kept: number;
  errors: string[];
  notes: string[];
}

export type DecisionLabel = 'YES' | 'NO' | 'INSUFFICIENT_EVIDENCE';

export interface ConditionAssessment {
  side: 'YES' | 'NO';
  condition: string;
  status: 'MET' | 'NOT_MET' | 'UNCLEAR';
  explanation: string;
  sourceIds: string[];
}

export interface ReasoningStep {
  finding: string;
  sourceIds: string[];
}

/** What the model returns (validated). */
export interface ModelDecision {
  decision: DecisionLabel;
  confidence: number;
  summary: string;
  conditionAssessments: ConditionAssessment[];
  reasoningSteps: ReasoningStep[];
  citedSourceIds: string[];
  insufficiencyReason: string | null;
}

/**
 * The decision logic posted on-chain. Its canonical JSON is the `reasoning` string whose
 * keccak256 is signed as `reasoningHash`.
 */
export interface DecisionRecord {
  decision: ModelDecision;
  /** Model that actually served the request (may differ from requested if a fallback ran). */
  model: string;
  requestedModel: string;
  /** sha256 of the prompt template (system prompt + output schema + template version). */
  promptHash: Hex;
  /** sha256 of the exact user message given to the model (reconstructible from the report). */
  inputHash: Hex;
  /** Oracle-side corrections applied to the raw model output, if any. */
  adjustments: string[];
}

export type OracleAction = 'RESOLVE' | 'DELAY';

/** EIP-712 Resolution message with bigint-free encoding for JSON. */
export interface ResolutionMessageJson {
  marketId: string;
  attempt: number;
  decision: number;
  confidenceBps: number;
  rulesHash: Hex;
  evidenceHash: Hex;
  reasoningHash: Hex;
  reportHash: Hex;
  timestamp: string;
}

export interface Eip712DomainJson {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

/** The part of the report covered by `reportHash`. */
export interface ReportBody {
  version: 1;
  reportId: string;
  createdAt: string;
  market: {
    slug: string;
    chainMarketId: string;
    question: string;
    rulesText: string;
    rulesHash: Hex;
    confidenceThresholdBps: number;
  };
  attempt: number;
  sourcing: {
    providers: ProviderStatus[];
    evidence: EvidenceItem[];
    evidenceHash: Hex;
  };
  decision: {
    reasoning: string;
    reasoningHash: Hex;
    record: DecisionRecord;
    decisionCode: number;
    confidenceBps: number;
    action: OracleAction;
  };
}

export interface Publication {
  chainId: number;
  contract: Address;
  txHash: Hex;
  blockNumber: string;
  marketStatusAfter: string;
  postedAt: string;
}

export interface OracleReport extends ReportBody {
  reportHash: Hex;
  attestation: {
    domain: Eip712DomainJson;
    message: ResolutionMessageJson;
    digest: Hex;
    signer: Address;
    signature: Hex;
  };
  publication: Publication | null;
  publicationError: string | null;
}

export const MARKET_STATUS = ['NONE', 'OPEN', 'DELAYED', 'RESOLVED', 'PAUSED'] as const;
export type MarketStatus = (typeof MARKET_STATUS)[number];
export const OUTCOME = ['NONE', 'YES', 'NO'] as const;
export type Outcome = (typeof OUTCOME)[number];
