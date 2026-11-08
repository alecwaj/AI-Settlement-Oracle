import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { verifyReportOffline, verifyReportOnChain, type OracleReport } from '@oracle/shared';
import { claudeDecider, type Decider } from './ai/decide.ts';
import { bootstrapChain, readMarket, type ChainContext } from './chain.ts';
import { loadConfig } from './config.ts';
import { findMarket, MARKETS } from './markets.ts';
import { gatherEvidence } from './news/aggregator.ts';
import { runResolution, serializeMarket } from './pipeline.ts';
import { ReportStore } from './reports.ts';
import { RunManager } from './runs.ts';

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
  });
});

async function marketView(slug: string, c: ChainContext): Promise<Record<string, unknown> | null> {
  const spec = findMarket(slug);
  const id = c.marketIds.get(slug);
  if (!spec || id === undefined) return null;
  const onchain = await readMarket(c, id);
  const active = runs.activeFor(slug);
  return {
    spec,
    onchain: serializeMarket(onchain),
    reports: reports.list(slug, c.contract).map(reportSummary),
    activeRunId: active?.id ?? null,
    chainTime: (await c.publicClient.getBlock()).timestamp.toString(),
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

  const run = runs.start(slug, async (emit) => {
    const report = await runResolution(
      {
        chain: c,
        decider,
        reports,
        gather: (s, log) =>
          gatherEvidence(
            s,
            { timeoutMs: config.httpTimeoutMs, guardianApiKey: config.guardianApiKey, log },
            { maxEvidence: config.maxEvidence, maxCharsPerSource: config.maxCharsPerSource },
          ),
      },
      spec,
      emit,
    );
    return report.reportId;
  });
  res.status(202).json({ runId: run.id });
});

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
  void getChain();
});
