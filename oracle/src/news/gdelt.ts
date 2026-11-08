import type { MarketSpec } from '@oracle/shared';
import { fetchArticlePage } from './fetch-page.ts';
import { httpGetJson, mapLimit, sleep } from './http.ts';
import { normalizeUrl, TRUSTED_OUTLETS } from './trusted.ts';
import { emptyStatus, type ProviderContext, type ProviderResult, type RawArticle } from './types.ts';

interface GdeltResponse {
  articles?: Array<{ url: string; title?: string; seendate?: string; domain?: string; language?: string }>;
}

const API = 'https://api.gdeltproject.org/api/v2/doc/doc';
/** GDELT asks clients to keep to roughly one request every five seconds. */
const GDELT_SPACING_MS = 5500;

function gdeltDate(iso: string): string {
  return iso.replace(/[-:T]/g, '').slice(0, 14);
}

/** "20250115T123000Z" → ISO */
export function parseSeenDate(s: string | undefined): string | null {
  const m = s?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : null;
}

export function gdeltUrl(query: string, spec: MarketSpec): string {
  // The Guardian has its own provider; GDELT covers the other trusted outlets.
  const domains = TRUSTED_OUTLETS.map((t) => t.domain).filter((d) => d !== 'theguardian.com');
  const url = new URL(API);
  url.searchParams.set('query', `${query} (${domains.map((d) => `domainis:${d}`).join(' OR ')})`);
  url.searchParams.set('mode', 'artlist');
  url.searchParams.set('format', 'json');
  url.searchParams.set('maxrecords', '25');
  url.searchParams.set('sort', 'hybridrel');
  url.searchParams.set('startdatetime', gdeltDate(spec.evidence.window.from));
  url.searchParams.set('enddatetime', gdeltDate(spec.evidence.window.to));
  return url.toString();
}

/**
 * GDELT returns article metadata only, so each trusted hit is fetched and its text extracted.
 * Note: GDELT's DOC API may not cover dates far in the past; failures are recorded, not hidden.
 */
export async function searchGdelt(spec: MarketSpec, ctx: ProviderContext): Promise<ProviderResult> {
  const queries = spec.evidence.searchQueries;
  const status = emptyStatus('gdelt', queries);
  const hits = new Map<string, { url: string; title?: string; publishedAt: string | null }>();

  for (const [i, q] of queries.entries()) {
    if (i > 0) await sleep(GDELT_SPACING_MS);
    try {
      const data = await httpGetJson<GdeltResponse>(gdeltUrl(q, spec), ctx.timeoutMs);
      const list = (data.articles ?? []).filter((a) => !a.language || a.language === 'English');
      status.found += list.length;
      for (const a of list) {
        hits.set(normalizeUrl(a.url), { url: a.url, title: a.title, publishedAt: parseSeenDate(a.seendate) });
      }
      ctx.log(`GDELT: "${q}" → ${list.length} articles`);
    } catch (err) {
      status.errors.push(`"${q}": ${(err as Error).message}`);
      ctx.log(`GDELT: "${q}" failed: ${(err as Error).message}`);
    }
  }

  const fetched = await mapLimit([...hits.values()], 4, (h) =>
    fetchArticlePage('gdelt', h.url, { title: h.title, publishedAt: h.publishedAt }, ctx.timeoutMs),
  );
  const articles: RawArticle[] = [];
  let skipped = 0;
  for (const f of fetched) {
    if (f.article) articles.push(f.article);
    else skipped++;
  }
  if (skipped > 0) status.notes.push(`${skipped} article pages could not be used (blocked, paywalled or too short)`);
  ctx.log(`GDELT: fetched text for ${articles.length} of ${hits.size} articles`);
  status.ok = status.errors.length < queries.length;
  return { status, articles };
}
