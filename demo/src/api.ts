import type { EvidenceItem, MarketSpec, OracleReport, ProviderStatus } from '@oracle/shared';

export const API = (import.meta.env.VITE_ORACLE_API as string | undefined) ?? 'http://localhost:3001';

export interface OracleConfig {
  chainId: number;
  contract: `0x${string}`;
  rpcUrl: string;
  oracleSigner: `0x${string}`;
  model: string;
  modelConfigured: boolean;
  autoRetry: boolean;
}

export interface SourcePreview {
  startedAt: string;
  finishedAt: string;
  log: string[];
  providers: ProviderStatus[];
  evidence: EvidenceItem[];
}

export interface OnChainMarketJson {
  marketId: string;
  status: 'NONE' | 'OPEN' | 'DELAYED' | 'RESOLVED' | 'PAUSED';
  outcome: 'NONE' | 'YES' | 'NO';
  rulesHash: `0x${string}`;
  confidenceThresholdBps: number;
  delayCount: number;
  delayedUntil: string;
  attempts: number;
}

export interface ReportSummary {
  reportId: string;
  createdAt: string;
  attempt: number;
  decision: string;
  confidenceBps: number;
  action: 'RESOLVE' | 'DELAY';
  published: boolean;
  publicationError: string | null;
}

export interface MarketView {
  spec: MarketSpec;
  onchain: OnChainMarketJson;
  reports: ReportSummary[];
  activeRunId: string | null;
  autoRetryAt: number | null;
  autoRetryHalted: string | null;
  manualResolution: { outcome: 'YES' | 'NO'; reason: string; txHash: string } | null;
  chainTime: string;
}

export type StepId = 'rules' | 'sourcing' | 'evidence' | 'decision' | 'attestation' | 'publication' | 'complete';

export interface PipelineEvent {
  seq: number;
  at: string;
  step: StepId;
  status: 'running' | 'progress' | 'done' | 'failed';
  message: string;
  data?: { providers?: ProviderStatus[]; reportId?: string | null; failedStep?: string | null } & Record<string, unknown>;
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export const getConfig = (): Promise<OracleConfig> => fetch(`${API}/config`).then((r) => json<OracleConfig>(r));
export const getMarkets = (): Promise<MarketView[]> => fetch(`${API}/markets`).then((r) => json<MarketView[]>(r));
export const getReport = (id: string): Promise<OracleReport> =>
  fetch(`${API}/reports/${encodeURIComponent(id)}`).then((r) => json<OracleReport>(r));
export const startResolution = (slug: string): Promise<{ runId: string }> =>
  fetch(`${API}/markets/${encodeURIComponent(slug)}/resolve`, { method: 'POST' }).then((r) => json<{ runId: string }>(r));

export const previewSources = (slug: string): Promise<SourcePreview> =>
  fetch(`${API}/markets/${encodeURIComponent(slug)}/preview-sources`, { method: 'POST' }).then((r) => json<SourcePreview>(r));

export function subscribeRun(runId: string, onEvent: (e: PipelineEvent) => void, onEnd: () => void): () => void {
  const es = new EventSource(`${API}/runs/${runId}/events`);
  es.onmessage = (m) => {
    const e = JSON.parse(m.data as string) as PipelineEvent;
    onEvent(e);
    if (e.step === 'complete') {
      es.close();
      onEnd();
    }
  };
  es.onerror = () => {
    es.close();
    onEnd();
  };
  return () => es.close();
}
