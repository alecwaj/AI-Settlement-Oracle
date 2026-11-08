import { contentHash, type EvidenceItem, type MarketSpec, type ProviderId, type ProviderStatus } from '@oracle/shared';
import { searchGdelt } from './gdelt.ts';
import { searchGuardian } from './guardian.ts';
import { searchNasa } from './nasa.ts';
import { normalizeUrl, trustedOutlet } from './trusted.ts';
import type { Provider, ProviderContext, RawArticle } from './types.ts';

export const PROVIDERS: Record<ProviderId, Provider> = {
  guardian: searchGuardian,
  gdelt: searchGdelt,
  nasa: searchNasa,
};

export interface EvidenceOptions {
  maxEvidence: number;
  maxCharsPerSource: number;
}

export interface EvidenceResult {
  providers: ProviderStatus[];
  evidence: EvidenceItem[];
}

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'about', 'nasa']);

function keywords(spec: MarketSpec): string[] {
  const words = spec.evidence.searchQueries
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  return [...new Set(words)];
}

/** Simple, deterministic relevance score: keyword hits in the title count triple. */
export function relevance(article: Pick<RawArticle, 'title' | 'text'>, terms: string[]): number {
  const title = article.title.toLowerCase();
  const text = article.text.toLowerCase();
  return terms.reduce((s, t) => s + (title.includes(t) ? 3 : 0) + (text.includes(t) ? 1 : 0), 0);
}

export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > maxChars * 0.8 ? lastSpace : maxChars)} […]`;
}

function inWindow(publishedAt: string | null, spec: MarketSpec): boolean {
  if (!publishedAt) return false;
  const t = Date.parse(publishedAt);
  return t >= Date.parse(spec.evidence.window.from) && t <= Date.parse(spec.evidence.window.to);
}

/**
 * Filters provider results to trusted outlets and the evidence window, de-duplicates across
 * providers, ranks by relevance, truncates and hashes each text. Pure: no network access.
 */
export function selectEvidence(
  spec: MarketSpec,
  results: Array<{ status: ProviderStatus; articles: RawArticle[] }>,
  opts: EvidenceOptions,
): EvidenceResult {
  const terms = keywords(spec);
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const candidates: Array<RawArticle & { score: number }> = [];

  for (const { status, articles } of results) {
    let untrusted = 0;
    let outOfWindow = 0;
    for (const a of articles) {
      if (!trustedOutlet(a.url)) {
        untrusted++;
        continue;
      }
      if (!inWindow(a.publishedAt, spec)) {
        outOfWindow++;
        continue;
      }
      status.kept++;
      const urlKey = normalizeUrl(a.url);
      const titleKey = a.title.trim().toLowerCase();
      if (seenUrls.has(urlKey) || seenTitles.has(titleKey)) continue;
      seenUrls.add(urlKey);
      seenTitles.add(titleKey);
      candidates.push({ ...a, score: relevance(a, terms) });
    }
    if (untrusted > 0) status.notes.push(`${untrusted} results dropped: outlet not on the trusted list`);
    if (outOfWindow > 0) status.notes.push(`${outOfWindow} results dropped: outside the evidence window or undated`);
  }

  candidates.sort(
    (a, b) => b.score - a.score || (Date.parse(b.publishedAt ?? '') || 0) - (Date.parse(a.publishedAt ?? '') || 0),
  );

  const evidence: EvidenceItem[] = candidates.slice(0, opts.maxEvidence).map((a, i) => {
    const text = truncateText(a.text, opts.maxCharsPerSource);
    return {
      id: `S${i + 1}`,
      provider: a.provider,
      outlet: a.outlet,
      url: a.url,
      title: a.title,
      publishedAt: a.publishedAt,
      retrievedAt: a.retrievedAt,
      textSource: a.textSource,
      text,
      contentHash: contentHash(text),
    };
  });

  return { providers: results.map((r) => r.status), evidence };
}

/** Queries every provider the market lists, in parallel, then selects the evidence set. */
export async function gatherEvidence(
  spec: MarketSpec,
  ctx: ProviderContext,
  opts: EvidenceOptions,
  providers: Record<ProviderId, Provider> = PROVIDERS,
): Promise<EvidenceResult> {
  const results = await Promise.all(
    spec.evidence.providers.map(async (id) => {
      try {
        return await providers[id](spec, ctx);
      } catch (err) {
        const status: ProviderStatus = {
          provider: id,
          ok: false,
          queries: spec.evidence.searchQueries,
          found: 0,
          kept: 0,
          errors: [(err as Error).message],
          notes: [],
        };
        return { status, articles: [] };
      }
    }),
  );
  return selectEvidence(spec, results, opts);
}
