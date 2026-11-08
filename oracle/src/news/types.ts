import type { MarketSpec, ProviderId, ProviderStatus } from '@oracle/shared';

export interface RawArticle {
  provider: ProviderId;
  outlet: string;
  url: string;
  title: string;
  publishedAt: string | null;
  text: string;
  textSource: 'api-body' | 'article-page';
  retrievedAt: string;
}

export interface ProviderResult {
  status: ProviderStatus;
  articles: RawArticle[];
}

export interface ProviderContext {
  timeoutMs: number;
  guardianApiKey: string;
  /** Progress callback for the live pipeline view. */
  log: (message: string) => void;
}

export type Provider = (spec: MarketSpec, ctx: ProviderContext) => Promise<ProviderResult>;

export function emptyStatus(provider: ProviderId, queries: string[]): ProviderStatus {
  return { provider, ok: true, queries, found: 0, kept: 0, errors: [], notes: [] };
}
