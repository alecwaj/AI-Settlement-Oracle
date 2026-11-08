/**
 * Outlets the oracle accepts as evidence. A URL is trusted when its host equals one of these
 * domains or is a subdomain of it.
 */
export const TRUSTED_OUTLETS: ReadonlyArray<{ domain: string; outlet: string }> = [
  { domain: 'theguardian.com', outlet: 'The Guardian' },
  { domain: 'reuters.com', outlet: 'Reuters' },
  { domain: 'apnews.com', outlet: 'Associated Press' },
  { domain: 'bbc.com', outlet: 'BBC' },
  { domain: 'bbc.co.uk', outlet: 'BBC' },
  { domain: 'npr.org', outlet: 'NPR' },
  { domain: 'nasa.gov', outlet: 'NASA' },
  { domain: 'nature.com', outlet: 'Nature' },
  { domain: 'science.org', outlet: 'Science' },
];

export function trustedOutlet(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const match = TRUSTED_OUTLETS.find((t) => host === t.domain || host.endsWith(`.${t.domain}`));
  return match ? match.outlet : null;
}

/** Normalizes a URL for de-duplication: https, no www., no query/hash, no trailing slash. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    return `https://${host}${path}`;
  } catch {
    return url;
  }
}
