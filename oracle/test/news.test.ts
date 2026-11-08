import { describe, expect, it } from 'vitest';
import { contentHash, type MarketSpec, type ProviderStatus } from '@oracle/shared';
import { extractArticle } from '../src/news/article.ts';
import { parseSeenDate } from '../src/news/gdelt.ts';
import { guardianUrl, parseGuardian } from '../src/news/guardian.ts';
import { selectEvidence, truncateText } from '../src/news/aggregator.ts';
import { normalizeUrl, trustedOutlet } from '../src/news/trusted.ts';
import type { RawArticle } from '../src/news/types.ts';
import { MARKETS } from '../src/markets.ts';

const spec = MARKETS[0] as MarketSpec;

describe('trusted outlets', () => {
  it('accepts listed domains and their subdomains only', () => {
    expect(trustedOutlet('https://www.theguardian.com/science/x')).toBe('The Guardian');
    expect(trustedOutlet('https://science.nasa.gov/x')).toBe('NASA');
    expect(trustedOutlet('https://apnews.com/article/x')).toBe('Associated Press');
    expect(trustedOutlet('https://nasa.gov.evil.example/x')).toBeNull();
    expect(trustedOutlet('https://notreuters.com/x')).toBeNull();
    expect(trustedOutlet('not a url')).toBeNull();
  });

  it('normalizes URLs for de-duplication', () => {
    expect(normalizeUrl('http://www.BBC.com/news/x/?utm=1#top')).toBe('https://bbc.com/news/x');
  });
});

describe('Guardian provider', () => {
  it('builds a windowed search URL', () => {
    const u = new URL(guardianUrl('NASA biosignature', spec, 'k'));
    expect(u.host).toBe('content.guardianapis.com');
    expect(u.searchParams.get('from-date')).toBe('2025-01-01');
    expect(u.searchParams.get('to-date')).toBe('2026-01-31');
    expect(u.searchParams.get('show-fields')).toContain('bodyText');
  });

  it('parses results and skips items without body text', () => {
    const articles = parseGuardian(
      {
        response: {
          status: 'ok',
          results: [
            {
              webUrl: 'https://www.theguardian.com/science/a',
              webTitle: 'Web title',
              webPublicationDate: '2025-09-10T15:00:00Z',
              fields: { bodyText: '  Body text.  ', headline: 'Headline A' },
            },
            { webUrl: 'https://www.theguardian.com/science/b', webTitle: 'No body', fields: {} },
          ],
        },
      },
      '2026-11-08T00:00:00.000Z',
    );
    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({ title: 'Headline A', text: 'Body text.', publishedAt: '2025-09-10T15:00:00.000Z' });
  });

  it('surfaces API errors', () => {
    expect(() => parseGuardian({ response: { status: 'error', message: 'Invalid authentication credentials' } }, '')).toThrow(
      /Invalid authentication/,
    );
  });
});

describe('GDELT provider', () => {
  it('parses seendate', () => {
    expect(parseSeenDate('20250115T123000Z')).toBe('2025-01-15T12:30:00.000Z');
    expect(parseSeenDate('garbage')).toBeNull();
  });
});

describe('article extraction', () => {
  it('extracts title, date and paragraph text, ignoring navigation and scripts', () => {
    const html = `<html><head><title>Fallback</title>
      <meta property="og:title" content="Agency reports &quot;potential&quot; finding">
      <meta property="article:published_time" content="2025-09-10T14:00:00Z"></head>
      <body><nav><p>Home | News | Science | Subscribe to our newsletter today</p></nav>
      <script>var p = "<p>should not appear in the extracted article text</p>";</script>
      <article><p>The first paragraph of the article is long enough to be kept by the extractor.</p>
      <p>Short.</p><p>The second paragraph explains the finding &amp; what it does not show yet.</p></article>
      </body></html>`;
    const a = extractArticle(html);
    expect(a.title).toBe('Agency reports "potential" finding');
    expect(a.publishedAt).toBe('2025-09-10T14:00:00.000Z');
    expect(a.text).toBe(
      'The first paragraph of the article is long enough to be kept by the extractor.\n\nThe second paragraph explains the finding & what it does not show yet.',
    );
  });
});

describe('evidence selection', () => {
  const status = (provider: ProviderStatus['provider']): ProviderStatus => ({
    provider,
    ok: true,
    queries: [],
    found: 0,
    kept: 0,
    errors: [],
    notes: [],
  });
  const art = (over: Partial<RawArticle>): RawArticle => ({
    provider: 'guardian',
    outlet: 'The Guardian',
    url: 'https://www.theguardian.com/science/a',
    title: 'NASA biosignature report',
    publishedAt: '2025-06-01T00:00:00.000Z',
    text: 'NASA biosignature text '.repeat(30),
    textSource: 'api-body',
    retrievedAt: '2026-11-08T00:00:00.000Z',
    ...over,
  });

  it('filters untrusted and out-of-window items, de-duplicates, ranks and hashes', () => {
    const g = status('guardian');
    const n = status('nasa');
    const result = selectEvidence(
      spec,
      [
        {
          status: g,
          articles: [
            art({}),
            art({ url: 'https://theguardian.com/science/a/' }), // duplicate URL
            art({ url: 'https://www.theguardian.com/b', publishedAt: '2024-12-31T23:00:00.000Z' }), // too early
            art({ url: 'https://www.theguardian.com/c', publishedAt: null, title: 'Undated' }),
          ],
        },
        {
          status: n,
          articles: [
            art({ provider: 'nasa', outlet: 'NASA', url: 'https://www.nasa.gov/x', title: 'Unrelated mission update', text: 'x'.repeat(400) }),
            art({ provider: 'nasa', url: 'https://example.com/fake-nasa', title: 'Fake' }),
          ],
        },
      ],
      { maxEvidence: 10, maxCharsPerSource: 100 },
    );
    expect(result.evidence.map((e) => e.url)).toEqual(['https://www.theguardian.com/science/a', 'https://www.nasa.gov/x']);
    expect(result.evidence[0]?.id).toBe('S1');
    for (const e of result.evidence) {
      expect(e.text.length).toBeLessThanOrEqual(104);
      expect(e.contentHash).toBe(contentHash(e.text));
    }
    expect(g.kept).toBe(2);
    expect(g.notes.join(' ')).toMatch(/outside the evidence window/);
    expect(n.notes.join(' ')).toMatch(/not on the trusted list/);
  });

  it('truncates at a word boundary', () => {
    expect(truncateText('alpha beta gamma delta epsilon', 24)).toBe('alpha beta gamma delta […]');
    expect(truncateText('short', 13)).toBe('short');
  });
});
