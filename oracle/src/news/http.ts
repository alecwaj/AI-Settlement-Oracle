const USER_AGENT = 'AI-Settlement-Oracle/0.2 (+https://github.com/alecwaj/AI-Settlement-Oracle)';
const MAX_BYTES = 3_000_000;

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export async function httpGet(
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: '*/*', ...headers },
      redirect: 'follow',
      signal: controller.signal,
    });
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) throw new HttpError(`response too large (${buf.byteLength} bytes)`, res.status);
    const body = new TextDecoder('utf-8').decode(buf);
    if (!res.ok) throw new HttpError(`HTTP ${res.status} from ${new URL(url).host}`, res.status);
    return { status: res.status, body, contentType: res.headers.get('content-type') ?? '' };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const reason = controller.signal.aborted ? `timed out after ${timeoutMs}ms` : networkReason(err);
    throw new HttpError(`request to ${safeHost(url)} failed: ${reason}`, null);
  } finally {
    clearTimeout(timer);
  }
}

export async function httpGetJson<T>(url: string, timeoutMs: number, headers: Record<string, string> = {}): Promise<T> {
  const { body } = await httpGet(url, timeoutMs, { accept: 'application/json', ...headers });
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new HttpError(`invalid JSON from ${safeHost(url)}: ${body.slice(0, 120).replace(/\s+/g, ' ')}`, null);
  }
}

/** Node's fetch reports "fetch failed" and keeps the real network error in `cause`. */
function networkReason(err: unknown): string {
  const e = err as Error & { cause?: { code?: string; message?: string } };
  const cause = e.cause?.code ?? e.cause?.message;
  return cause ? `${e.message} (${cause})` : e.message;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Runs `fn` over items with bounded concurrency, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
