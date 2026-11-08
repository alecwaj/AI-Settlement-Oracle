/**
 * Minimal, dependency-free article extraction: title, publication date and paragraph text.
 * The extracted text is what gets hashed and given to the model.
 */

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', eacute: 'é', copy: '©',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED[code.toLowerCase()] ?? m;
  });
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function metaContent(html: string, key: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name|itemprop)=["']${key}["'][^>]*>`,
    'i',
  );
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  const content = tag.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decodeEntities(content).trim() : null;
}

export function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface ExtractedArticle {
  title: string;
  publishedAt: string | null;
  text: string;
}

export function extractArticle(html: string): ExtractedArticle {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|figure|button)\b[\s\S]*?<\/\1>/gi, ' ');

  const title =
    metaContent(html, 'og:title') ??
    stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '') ??
    '';

  const jsonLdDate = html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1];
  const timeTag = html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1];
  const publishedAt = toIso(
    metaContent(html, 'article:published_time') ??
      metaContent(html, 'parsely-pub-date') ??
      metaContent(html, 'datePublished') ??
      metaContent(html, 'dc.date') ??
      metaContent(html, 'date') ??
      jsonLdDate ??
      timeTag,
  );

  // Prefer the <article> element when present; otherwise use the whole page.
  const articles = [...cleaned.matchAll(/<article\b[\s\S]*?<\/article>/gi)].map((m) => m[0]);
  const scope = articles.sort((a, b) => b.length - a.length)[0] ?? cleaned;
  const paragraphs = [...scope.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripTags(m[1] ?? ''))
    .filter((p) => p.length >= 40);
  const seen = new Set<string>();
  const text = paragraphs.filter((p) => (seen.has(p) ? false : (seen.add(p), true))).join('\n\n');

  return { title, publishedAt, text };
}
