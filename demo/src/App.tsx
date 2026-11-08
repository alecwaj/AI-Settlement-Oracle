import { useCallback, useEffect, useRef, useState } from 'react';
import type { OracleReport } from '@oracle/shared';
import {
  getConfig,
  getMarkets,
  getReport,
  startResolution,
  subscribeRun,
  type MarketView,
  type OracleConfig,
  type PipelineEvent,
} from './api.ts';
import { MarketCard } from './components/MarketCard.tsx';
import { Pipeline } from './components/Pipeline.tsx';
import { Result } from './components/Result.tsx';
import { Sources } from './components/Sources.tsx';
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
    return () => {
      clearInterval(timer);
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

  const retryIn = market ? Number(market.onchain.delayedUntil) - (now / 1000 + chainOffset.current) : 0;

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
          <MarketCard market={market} config={config} running={running} retryIn={retryIn} onRun={run} runError={runError} />
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
