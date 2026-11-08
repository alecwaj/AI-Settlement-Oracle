import type { MarketSpec } from '@oracle/shared';
import { fetchArticlePage } from './fetch-page.ts';
import { httpGetJson, mapLimit } from './http.ts';
import { normalizeUrl } from './trusted.ts';
import { emptyStatus, type ProviderContext, type ProviderResult, type RawArticle } from './types.ts';

interface WpSearchResult {
  id: number;
  title: string;
  url: string;
  type?: string;
  subtype?: string;
}

/** nasa.gov runs WordPress; its public REST search endpoint covers news releases and articles. */
const API = 'https://www.nasa.gov/wp-json/wp/v2/search';

export function nasaUrl(query: string): string {
  const url = new URL(API);
  url.searchParams.set('search', query);
  url.searchParams.set('per_page', '10');
  return url.toString();
}

export async function searchNasa(spec: MarketSpec, ctx: ProviderContext): Promise<ProviderResult> {
  const queries = spec.evidence.searchQueries;
  const status = emptyStatus('nasa', queries);
  const hits = new Map<string, WpSearchResult>();
  for (const q of queries) {
    try {
      const data = await httpGetJson<WpSearchResult[]>(nasaUrl(q), ctx.timeoutMs);
      if (!Array.isArray(data)) throw new Error('unexpected response shape');
      status.found += data.length;
      for (const r of data) if (r.url) hits.set(normalizeUrl(r.url), r);
      ctx.log(`NASA: "${q}" → ${data.length} pages`);
    } catch (err) {
      status.errors.push(`"${q}": ${(err as Error).message}`);
      ctx.log(`NASA: "${q}" failed: ${(err as Error).message}`);
    }
  }
  const fetched = await mapLimit([...hits.values()], 4, (h) =>
    fetchArticlePage('nasa', h.url, { title: h.title }, ctx.timeoutMs),
  );
  const articles: RawArticle[] = fetched.flatMap((f) => (f.article ? [f.article] : []));
  const skipped = fetched.length - articles.length;
  if (skipped > 0) status.notes.push(`${skipped} pages could not be used`);
  ctx.log(`NASA: fetched text for ${articles.length} of ${hits.size} pages`);
  status.ok = status.errors.length < queries.length;
  return { status, articles };
}
