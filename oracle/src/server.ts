import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { settlementOracleAbi, verifyReportOffline, verifyReportOnChain, type MarketSpec, type OracleReport } from '@oracle/shared';
import { claudeDecider, type Decider } from './ai/decide.ts';
import { bootstrapChain, chainTime, readMarket, type ChainContext } from './chain.ts';
import { loadConfig } from './config.ts';
import { findMarket, MARKETS } from './markets.ts';
import { gatherEvidence, type EvidenceResult } from './news/aggregator.ts';
import { runResolution, serializeMarket } from './pipeline.ts';
import { ReportStore } from './reports.ts';
import { RunManager, type Run, type RunTrigger } from './runs.ts';

/** Seconds added after a delay ends before an automatic retry, to absorb clock differences. */
const AUTO_RETRY_BUFFER_S = 5;

interface SourcePreview extends EvidenceResult {
  startedAt: string;
  finishedAt: string;
  log: string[];
}

const config = loadConfig();
const reports = new ReportStore(config.dataDir);
const runs = new RunManager();
const decider: Decider | null = config.anthropicApiKey
  ? claudeDecider({ apiKey: config.anthropicApiKey, model: config.model, effort: config.effort, fallbacks: config.fallbacks })
  : null;

let chain: ChainContext | null = null;
let chainError: string | null = null;
let connecting: Promise<ChainContext | null> | null = null;

/** Connects (and bootstraps) lazily, so the server starts even before the chain is up. */
async function getChain(): Promise<ChainContext | null> {
  if (chain) return chain;
  connecting ??= bootstrapChain({
    rpcUrl: config.rpcUrl,
    deployerKey: config.deployerKey,
    oracleKey: config.oracleKey,
    contractAddress: config.contractAddress,
    retryDelaySeconds: config.retryDelaySeconds,
    dataDir: config.dataDir,
    contractsOutDir: config.contractsOutDir,
    markets: MARKETS,
    log: (m) => console.log(`[chain] ${m}`),
  })
    .then((c) => {
      chain = c;
      chainError = null;
      return c;
    })
    .catch((err: Error) => {
      chainError = err.message;
      console.error(`[chain] ${err.message}`);
      return null;
    })
    .finally(() => {
      connecting = null;
    });
  return connecting;
}

function reportSummary(r: OracleReport): Record<string, unknown> {
  return {
    reportId: r.reportId,
    createdAt: r.createdAt,
    attempt: r.attempt,
    decision: r.decision.record.decision.decision,
    confidenceBps: r.decision.confidenceBps,
    action: r.decision.action,
    published: r.publication !== null,
    publicationError: r.publicationError,
  };
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', async (_req: Request, res: Response) => {
  const c = await getChain();
  res.json({
    ok: true,
    anthropic: { configured: decider !== null, model: config.model, effort: config.effort },
    autoRetry: config.autoRetry,
    guardian: { key: config.guardianApiKey === 'test' ? 'public test key' : 'configured' },
    chain: c
      ? { connected: true, chainId: c.chain.id, contract: c.contract, oracleSigner: c.oracleAccount.address }
      : { connected: false, error: chainError },
    devKeys: config.usingDevKeys,
  });
});

app.get('/config', async (_req: Request, res: Response) => {
  const c = await getChain();
  if (!c) return res.status(503).json({ error: chainError ?? 'chain unavailable' });
  res.json({
    chainId: c.chain.id,
    contract: c.contract,
    rpcUrl: process.env.PUBLIC_RPC_URL ?? config.rpcUrl,
    oracleSigner: c.oracleAccount.address,
    model: config.model,
    modelConfigured: decider !== null,
    autoRetry: config.autoRetry && decider !== null,
  });
});

async function marketView(slug: string, c: ChainContext): Promise<Record<string, unknown> | null> {
  const spec = findMarket(slug);
  const id = c.marketIds.get(slug);
  if (!spec || id === undefined) return null;
  const onchain = await readMarket(c, id);
  const active = runs.activeFor(slug);
  let manualResolution: { outcome: string; reason: string; txHash: string } | null = null;
  if (onchain.status === 'RESOLVED' && onchain.delayCount >= 3) {
    const [ev] = await c.publicClient.getContractEvents({
      address: c.contract,
      abi: settlementOracleAbi,
      eventName: 'ManualResolution',
      args: { marketId: id },
      fromBlock: 0n,
    });
    if (ev) {
      manualResolution = {
        outcome: ev.args.outcome === 1 ? 'YES' : 'NO',
        reason: ev.args.reason ?? '',
        txHash: ev.transactionHash,
      };
    }
  }
  return {
    spec,
    onchain: serializeMarket(onchain),
    reports: reports.list(slug, c.contract).map(reportSummary),
    activeRunId: active?.id ?? null,
    autoRetryAt: retryTimers.get(slug)?.at ?? null,
    autoRetryHalted: autoRetryHalted(slug),
    manualResolution,
    chainTime: (await chainTime(c)).toString(),
  };
}

app.get('/markets', async (_req: Request, res: Response) => {
  const c = await getChain();
  if (!c) return res.status(503).json({ error: chainError ?? 'chain unavailable' });
  res.json(await Promise.all(MARKETS.map((m) => marketView(m.slug, c))));
});

app.get('/markets/:slug', async (req: Request, res: Response) => {
  const c = await getChain();
  if (!c) return res.status(503).json({ error: chainError ?? 'chain unavailable' });
  const view = await marketView(String(req.params.slug), c);
  if (!view) return res.status(404).json({ error: 'unknown market' });
  res.json(view);
});

const evidenceDeps = (log: (msg: string) => void) => ({
  ctx: { timeoutMs: config.httpTimeoutMs, guardianApiKey: config.guardianApiKey, log },
  opts: { maxEvidence: config.maxEvidence, maxCharsPerSource: config.maxCharsPerSource },
});

/** Starts a resolution run; callers have already checked that the model and chain are available. */
function startRun(spec: MarketSpec, c: ChainContext, d: Decider, trigger: RunTrigger): Run {
  return runs.start(
    spec.slug,
    trigger,
    async (emit) => {
      const report = await runResolution(
        {
          chain: c,
          decider: d,
          reports,
          gather: (s, log) => {
            const { ctx, opts } = evidenceDeps(log);
            return gatherEvidence(s, ctx, opts);
          },
        },
        spec,
        emit,
      );
      return report.reportId;
    },
    (run) => {
      if (run.status === 'failed') autoFailures.set(spec.slug, (autoFailures.get(spec.slug) ?? 0) + 1);
      else autoFailures.delete(spec.slug);
      void scheduleAutoRetries();
    },
  );
}

app.post('/markets/:slug/resolve', async (req: Request, res: Response) => {
  const slug = String(req.params.slug);
  const spec = findMarket(slug);
  if (!spec) return res.status(404).json({ error: 'unknown market' });
  if (!decider) {
    return res.status(503).json({
      error: 'ANTHROPIC_API_KEY is not set. The oracle only settles from a model decision over real sources, so it will not run without one.',
    });
  }
  const c = await getChain();
  if (!c) return res.status(503).json({ error: chainError ?? 'chain unavailable' });
  const active = runs.activeFor(slug);
  if (active) return res.status(409).json({ error: 'a resolution is already running', runId: active.id });
  cancelAutoRetry(slug);
  const run = startRun(spec, c, decider, 'manual');
  res.status(202).json({ runId: run.id });
});

/**
 * Source preview: runs only the sourcing and evidence steps. Nothing is sent to the model, signed
 * or published, so it works without an Anthropic key and is safe to repeat.
 */
const previews = new Map<string, Promise<SourcePreview>>();
app.post('/markets/:slug/preview-sources', async (req: Request, res: Response) => {
  const slug = String(req.params.slug);
  const spec = findMarket(slug);
  if (!spec) return res.status(404).json({ error: 'unknown market' });
  let pending = previews.get(slug);
  if (!pending) {
    const log: string[] = [];
    const startedAt = new Date().toISOString();
    const { ctx, opts } = evidenceDeps((m) => log.push(m));
    pending = gatherEvidence(spec, ctx, opts)
      .then((r) => ({ startedAt, finishedAt: new Date().toISOString(), log, ...r }))
      .finally(() => previews.delete(slug));
    previews.set(slug, pending);
  }
  try {
    res.json(await pending);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============ Automatic retries ============

const retryTimers = new Map<string, { timer: NodeJS.Timeout; at: number }>();
/** Consecutive failed runs per market (errors, not delays). Reset by any successful run. */
const autoFailures = new Map<string, number>();
const MAX_AUTO_FAILURES = 3;

function autoRetryHalted(slug: string): string | null {
  const n = autoFailures.get(slug) ?? 0;
  return n >= MAX_AUTO_FAILURES
    ? `Automatic retries stopped after ${n} failed runs in a row. Check the last run's error, then run the oracle by hand.`
    : null;
}

function cancelAutoRetry(slug: string): void {
  const t = retryTimers.get(slug);
  if (t) clearTimeout(t.timer);
  retryTimers.delete(slug);
}

/**
 * For every DELAYED market, schedules the next attempt for when the on-chain delay ends.
 * The contract caps this at three delays, after which the market pauses for a manual decision.
 */
async function scheduleAutoRetries(): Promise<void> {
  if (!config.autoRetry || !decider) return;
  const c = await getChain();
  if (!c) return;
  const now = await chainTime(c);
  for (const spec of MARKETS) {
    const id = c.marketIds.get(spec.slug);
    if (id === undefined) continue;
    cancelAutoRetry(spec.slug);
    const m = await readMarket(c, id);
    if (m.status !== 'DELAYED' || runs.activeFor(spec.slug)) continue;
    const failures = autoFailures.get(spec.slug) ?? 0;
    if (failures >= MAX_AUTO_FAILURES) {
      console.warn(`[auto-retry] ${spec.slug}: stopped after ${failures} consecutive failures`);
      continue;
    }
    // Back off after failed runs (60s, 120s) so a persistent error cannot loop.
    const backoffS = failures > 0 ? 60 * 2 ** (failures - 1) : 0;
    const waitS = Math.max(0, Number(m.delayedUntil - now)) + AUTO_RETRY_BUFFER_S + backoffS;
    const d = decider;
    const timer = setTimeout(() => {
      retryTimers.delete(spec.slug);
      if (runs.activeFor(spec.slug)) return;
      console.log(`[auto-retry] starting attempt ${m.attempts + 1} for ${spec.slug}`);
      startRun(spec, c, d, 'auto');
    }, waitS * 1000);
    timer.unref();
    retryTimers.set(spec.slug, { timer, at: Number(now) + waitS });
    console.log(`[auto-retry] ${spec.slug} scheduled in ${waitS}s`);
  }
}

app.get('/runs/:id', (req: Request, res: Response) => {
  const run = runs.get(String(req.params.id));
  if (!run) return res.status(404).json({ error: 'unknown run' });
  res.json(run);
});

app.get('/runs/:id/events', (req: Request, res: Response) => {
  const run = runs.get(String(req.params.id));
  if (!run) return res.status(404).json({ error: 'unknown run' });
  runs.subscribe(run, res);
});

app.get('/reports/:id', (req: Request, res: Response) => {
  const report = reports.get(String(req.params.id));
  if (!report) return res.status(404).json({ error: 'unknown report' });
  res.json(report);
});

/** Convenience server-side check; the demo also verifies independently in the browser. */
app.get('/reports/:id/verify', async (req: Request, res: Response) => {
  const report = reports.get(String(req.params.id));
  if (!report) return res.status(404).json({ error: 'unknown report' });
  const checks = await verifyReportOffline(report);
  const c = await getChain();
  if (c) checks.push(...(await verifyReportOnChain(c.publicClient, report)));
  res.json({ ok: checks.every((x) => x.ok), checks });
});

app.listen(config.port, () => {
  console.log(`Oracle service listening on http://localhost:${config.port}`);
  if (!decider) console.warn('ANTHROPIC_API_KEY is not set: resolutions are disabled until it is.');
  if (config.usingDevKeys) console.warn('Using Anvil development keys. Never use them outside a local chain.');
  void getChain().then(() => scheduleAutoRetries());
});
