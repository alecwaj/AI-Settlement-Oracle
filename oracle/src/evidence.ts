/**
 * Evidence retrieval. Runs inside the TEE, so the fetch time, the raw bytes' hash and the text the model
 * saw are all covered by the resolution's attestation (via the transcript hash).
 */
import { keccak256, toBytes, toHex, zeroHash, type Hex } from 'viem';
import { isIP } from 'node:net';

const MAX_BYTES = 2_000_000;
const MAX_TEXT_CHARS = 20_000;
const TIMEOUT_MS = 15_000;

export interface FetchedEvidence {
  uri: string;
  ok: boolean;
  status: number | null;
  error: string | null;
  fetchedAt: string;
  contentType: string | null;
  /** keccak256 of the normalized extracted text (before truncation). Raw HTML bytes change on every load
   *  (nonces, timestamps), so hashing the readable text is what makes a submitter's commitment checkable. */
  contentHash: Hex | null;
  rawBytesHash: Hex | null; // keccak256 of the raw response bytes, for the audit transcript
  /** 'match' | 'mismatch' when the submitter supplied a hash; 'unchecked' when they supplied 0x0 */
  hashCheck: 'match' | 'mismatch' | 'unchecked' | 'unavailable';
  text: string; // extracted, truncated text passed to the model
  truncated: boolean;
}

function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  const v = isIP(h);
  if (v === 4) {
    const [a, b] = h.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (v === 6) return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80');
  return false;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export async function fetchEvidence(
  uri: string,
  submittedHash: Hex = zeroHash,
  opts: { allowPrivateHosts?: boolean } = {},
): Promise<FetchedEvidence> {
  const base: FetchedEvidence = {
    uri,
    ok: false,
    status: null,
    error: null,
    fetchedAt: new Date().toISOString(),
    contentType: null,
    contentHash: null,
    rawBytesHash: null,
    hashCheck: 'unavailable',
    text: '',
    truncated: false,
  };

  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return { ...base, error: 'not a valid URL' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ...base, error: 'only http(s) evidence is fetched' };
  if (!opts.allowPrivateHosts && isPrivateHost(url.hostname)) return { ...base, error: 'private/loopback hosts are not fetched' };

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'ai-settlement-oracle/1.0 (+evidence fetcher)', accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' },
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    const bytes = buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf;
    const rawBytesHash = keccak256(toHex(bytes));
    const contentType = res.headers.get('content-type');
    const raw = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const isHtml = (contentType ?? '').includes('html') || /^\s*<(!doctype|html)/i.test(raw);
    const isTextual = isHtml || /text|json|xml/.test(contentType ?? 'text');
    let text = isTextual ? (isHtml ? htmlToText(raw) : raw.trim()) : `[binary content: ${contentType}]`;
    const contentHash = isTextual ? keccak256(toBytes(text)) : rawBytesHash;
    const truncated = text.length > MAX_TEXT_CHARS;
    if (truncated) text = text.slice(0, MAX_TEXT_CHARS);

    return {
      ...base,
      ok: res.ok,
      status: res.status,
      error: res.ok ? null : `HTTP ${res.status}`,
      contentType,
      contentHash,
      rawBytesHash,
      hashCheck: submittedHash === zeroHash ? 'unchecked' : submittedHash.toLowerCase() === contentHash ? 'match' : 'mismatch',
      text,
      truncated,
    };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}
