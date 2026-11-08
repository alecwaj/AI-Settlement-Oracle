import { useCallback, useEffect, useRef, useState } from 'react';
import type { OracleReport } from '@oracle/shared';
import {
  getConfig,
  getMarkets,
  getReport,
  previewSources,
  startResolution,
  subscribeRun,
  type MarketView,
  type OracleConfig,
  type PipelineEvent,
  type SourcePreview,
} from './api.ts';
import { MarketCard } from './components/MarketCard.tsx';
import { Pipeline } from './components/Pipeline.tsx';
import { Result } from './components/Result.tsx';
import { PreviewSources, Sources } from './components/Sources.tsx';
import { Verification } from './components/Verification.tsx';
import { pct } from './format.ts';

export default function App() {
  const [config, setConfig] = useState<OracleConfig | null>(null);
  const [market, setMarket] = useState<MarketView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [report, setReport] = useState<OracleReport | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const runningRef = useRef(false);
  const chainOffset = useRef(0);
  const unsubscribe = useRef<(() => void) | null>(null);

  const refresh = useCallback(async (): Promise<MarketView | null> => {
    const [cfg, markets] = await Promise.all([getConfig(), getMarkets()]);
    const m = markets[0] ?? null;
    setConfig(cfg);
    setMarket(m);
    if (m) chainOffset.current = Number(m.chainTime) - Date.now() / 1000;
    return m;
  }, []);

  const follow = useCallback(
    (runId: string) => {
      unsubscribe.current?.();
      setEvents([]);
      setRunning(true);
      runningRef.current = true;
      setRunError(null);
      unsubscribe.current = subscribeRun(
        runId,
        (e) => {
          setEvents((prev) => (prev.some((p) => p.seq === e.seq) ? prev : [...prev, e]));
          if (e.step === 'complete') {
            if (e.status === 'failed') setRunError(e.message);
            const id = e.data?.reportId;
            if (id) void getReport(id).then(setReport);
          }
        },
        () => {
          setRunning(false);
          runningRef.current = false;
          void refresh();
        },
      );
    },
    [refresh],
  );

  useEffect(() => {
    refresh()
      .then((m) => {
        if (!m) return;
        if (m.activeRunId) follow(m.activeRunId);
        else if (m.reports[0]) void getReport(m.reports[0].reportId).then(setReport);
      })
      .catch((err: Error) => setLoadError(err.message));
    const timer = setInterval(() => setNow(Date.now()), 1000);
    // Poll so that automatic retries started by the service show up live.
    const poll = setInterval(() => {
      if (runningRef.current) return;
      refresh()
        .then((m) => {
          if (m?.activeRunId && !runningRef.current) follow(m.activeRunId);
        })
        .catch(() => undefined);
    }, 5000);
    return () => {
      clearInterval(timer);
      clearInterval(poll);
      unsubscribe.current?.();
    };
  }, [refresh, follow]);

  async function run(): Promise<void> {
    if (!market) return;
    setRunError(null);
    try {
      const { runId } = await startResolution(market.spec.slug);
      setReport(null);
      follow(runId);
    } catch (err) {
      setRunError((err as Error).message);
    }
  }

  async function preview_(): Promise<void> {
    if (!market) return;
    setPreviewing(true);
    setRunError(null);
    try {
      setPreview(await previewSources(market.spec.slug));
    } catch (err) {
      setRunError((err as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  const chainNow = now / 1000 + chainOffset.current;
  const retryIn = market ? Number(market.onchain.delayedUntil) - chainNow : 0;
  const autoRetryIn = market?.autoRetryAt ? Math.max(0, market.autoRetryAt - chainNow) : null;

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>AI Settlement Oracle</h1>
          <p className="muted">
            Reads a market&rsquo;s settlement conditions, gathers evidence from trusted outlets, decides with a model, and posts a
            signed, verifiable decision on-chain.
          </p>
        </div>
        {config && (
          <div className="env mono small">
            <div>chain {config.chainId}</div>
            <div>model {config.model}</div>
          </div>
        )}
      </header>

      {loadError && (
        <section className="card">
          <p className="error">Cannot reach the oracle service: {loadError}</p>
          <p className="muted">Start a local chain with <code>anvil</code> and the service with <code>npm run oracle</code>, then reload.</p>
        </section>
      )}

      {market && config && (
        <>
          <MarketCard
            market={market}
            config={config}
            running={running}
            retryIn={retryIn}
            onRun={run}
            runError={runError}
            autoRetryIn={autoRetryIn}
            previewing={previewing}
            onPreview={preview_}
          />
          {preview && <PreviewSources preview={preview} onClose={() => setPreview(null)} />}
          {(events.length > 0 || running) && <Pipeline events={events} running={running} />}
          {report && (
            <>
              <Result report={report} />
              <Sources report={report} />
              <Verification report={report} config={config} />
            </>
          )}
          {market.reports.length > 1 && (
            <section className="card history">
              <h3>Previous attempts</h3>
              <ul>
                {market.reports.map((r) => (
                  <li key={r.reportId}>
                    <button className="link-button" onClick={() => void getReport(r.reportId).then(setReport)}>
                      Attempt {r.attempt + 1}: {r.decision.replace('_', ' ')} at {pct(r.confidenceBps)} → {r.action}
                      {r.published ? '' : ' (not published)'}
                    </button>
                    <span className="muted small"> {r.createdAt.slice(0, 19).replace('T', ' ')}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
