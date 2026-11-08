import type { ProviderId } from '@oracle/shared';
import { extractArticle, toIso } from './article.ts';
import { httpGet } from './http.ts';
import { trustedOutlet } from './trusted.ts';
import type { RawArticle } from './types.ts';

export const MIN_ARTICLE_CHARS = 300;

/** Fetches an article page and extracts its text. Returns null (with a reason) when unusable. */
export async function fetchArticlePage(
  provider: ProviderId,
  url: string,
  hint: { title?: string; publishedAt?: string | null },
  timeoutMs: number,
): Promise<{ article: RawArticle | null; reason?: string }> {
  const outlet = trustedOutlet(url);
  if (!outlet) return { article: null, reason: 'untrusted domain' };
  try {
    const { body, contentType } = await httpGet(url, timeoutMs, { accept: 'text/html' });
    if (!contentType.includes('html')) return { article: null, reason: `not HTML (${contentType})` };
    const extracted = extractArticle(body);
    if (extracted.text.length < MIN_ARTICLE_CHARS) {
      return { article: null, reason: `too little article text (${extracted.text.length} chars; paywalled or script-rendered?)` };
    }
    return {
      article: {
        provider,
        outlet,
        url,
        title: extracted.title || hint.title || url,
        publishedAt: extracted.publishedAt ?? toIso(hint.publishedAt ?? null),
        text: extracted.text,
        textSource: 'article-page',
        retrievedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    return { article: null, reason: (err as Error).message };
  }
}
