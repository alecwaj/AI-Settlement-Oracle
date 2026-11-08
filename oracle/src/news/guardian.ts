import type { MarketSpec } from '@oracle/shared';
import { httpGetJson } from './http.ts';
import { emptyStatus, type ProviderContext, type ProviderResult, type RawArticle } from './types.ts';
import { toIso } from './article.ts';

interface GuardianResponse {
  response?: {
    status?: string;
    message?: string;
    results?: Array<{
      webUrl: string;
      webTitle: string;
      webPublicationDate?: string;
      fields?: { bodyText?: string; headline?: string };
    }>;
  };
  message?: string;
}

const API = 'https://content.guardianapis.com/search';

export function guardianUrl(query: string, spec: MarketSpec, apiKey: string): string {
  const url = new URL(API);
  url.searchParams.set('q', query);
  url.searchParams.set('from-date', spec.evidence.window.from.slice(0, 10));
  url.searchParams.set('to-date', spec.evidence.window.to.slice(0, 10));
  url.searchParams.set('show-fields', 'bodyText,headline');
  url.searchParams.set('order-by', 'relevance');
  url.searchParams.set('page-size', '10');
  url.searchParams.set('api-key', apiKey);
  return url.toString();
}

export function parseGuardian(data: GuardianResponse, retrievedAt: string): RawArticle[] {
  if (data.response?.status !== 'ok') {
    throw new Error(`Guardian API error: ${data.response?.message ?? data.message ?? 'unexpected response'}`);
  }
  return (data.response.results ?? [])
    .filter((r) => (r.fields?.bodyText ?? '').trim().length > 0)
    .map((r) => ({
      provider: 'guardian' as const,
      outlet: 'The Guardian',
      url: r.webUrl,
      title: r.fields?.headline ?? r.webTitle,
      publishedAt: toIso(r.webPublicationDate),
      text: (r.fields?.bodyText ?? '').trim(),
      textSource: 'api-body' as const,
      retrievedAt,
    }));
}

/** The Guardian Open Platform returns full article text, so no page fetch is needed. */
export async function searchGuardian(spec: MarketSpec, ctx: ProviderContext): Promise<ProviderResult> {
  const queries = spec.evidence.searchQueries;
  const status = emptyStatus('guardian', queries);
  const articles: RawArticle[] = [];
  if (ctx.guardianApiKey === 'test') status.notes.push('using the public "test" API key (rate limited)');
  for (const q of queries) {
    try {
      const data = await httpGetJson<GuardianResponse>(guardianUrl(q, spec, ctx.guardianApiKey), ctx.timeoutMs);
      const found = parseGuardian(data, new Date().toISOString());
      status.found += found.length;
      articles.push(...found);
      ctx.log(`Guardian: "${q}" → ${found.length} articles`);
    } catch (err) {
      status.errors.push(`"${q}": ${(err as Error).message}`);
      ctx.log(`Guardian: "${q}" failed: ${(err as Error).message}`);
    }
  }
  status.ok = status.errors.length < queries.length;
  return { status, articles };
}
