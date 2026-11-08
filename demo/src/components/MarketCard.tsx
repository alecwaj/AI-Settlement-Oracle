import type { MarketView, OracleConfig } from '../api.ts';
import { fmtDate, fmtDuration, pct, short } from '../format.ts';

interface Props {
  market: MarketView;
  config: OracleConfig;
  running: boolean;
  retryIn: number;
  onRun: () => void;
  runError: string | null;
  autoRetryIn: number | null;
  previewing: boolean;
  onPreview: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Awaiting resolution',
  DELAYED: 'Delayed for more evidence',
  RESOLVED: 'Settled',
  PAUSED: 'Paused for manual review',
};

export function MarketCard({ market, config, running, retryIn, onRun, runError, autoRetryIn, previewing, onPreview }: Props) {
  const { spec, onchain } = market;
  const accepting = onchain.status === 'OPEN' || onchain.status === 'DELAYED';
  const waiting = onchain.status === 'DELAYED' && retryIn > 0;
  const disabled = running || !accepting || waiting || !config.modelConfigured;

  return (
    <section className="card market">
      <div className="market-head">
        <span className={`pill status-${onchain.status.toLowerCase()}`}>
          {STATUS_LABEL[onchain.status] ?? onchain.status}
          {onchain.status === 'RESOLVED' ? `: ${onchain.outcome}` : ''}
        </span>
        <span className="muted mono">market #{onchain.marketId}</span>
      </div>
      <h2>{spec.question}</h2>

      <div className="conditions">
        <div className="cond yes">
          <h4>Resolves YES if</h4>
          <ul>{spec.conditions.yes.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
        <div className="cond no">
          <h4>Resolves NO if</h4>
          <ul>{spec.conditions.no.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      </div>
      {spec.conditions.notes.length > 0 && (
        <ul className="notes">{spec.conditions.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      )}

      <dl className="facts">
        <div><dt>Evidence window</dt><dd>{fmtDate(spec.evidence.window.from)} → {fmtDate(spec.evidence.window.to)}</dd></div>
        <div><dt>Accepted sources</dt><dd>{spec.evidence.acceptedSources}</dd></div>
        <div><dt>Confidence to settle</dt><dd>{pct(onchain.confidenceThresholdBps)}</dd></div>
        <div><dt>Delays used</dt><dd>{onchain.delayCount} of 3</dd></div>
        <div><dt>Rules hash (on-chain)</dt><dd className="mono">{short(onchain.rulesHash)}</dd></div>
        <div><dt>Search queries</dt><dd>{spec.evidence.searchQueries.join(' · ')}</dd></div>
      </dl>

      <div className="actions">
        <div className="buttons">
          <button className="primary" disabled={disabled} onClick={onRun}>
            {running ? 'Oracle running…' : onchain.attempts === 0 ? 'Run the oracle' : 'Run the oracle again'}
          </button>
          <button onClick={onPreview} disabled={previewing || running} title="Fetch sources only: no model call, nothing signed or posted">
            {previewing ? 'Fetching sources…' : 'Preview sources'}
          </button>
        </div>
        {!config.modelConfigured && (
          <p className="warn">The oracle service has no ANTHROPIC_API_KEY, so it will not resolve. Set it and restart the service.</p>
        )}
        {waiting && autoRetryIn === null && <p className="muted">Retry allowed in {fmtDuration(retryIn)} (on-chain delay).</p>}
        {onchain.status === 'DELAYED' && autoRetryIn !== null && !running && (
          <p className="muted">The oracle will look again automatically in {fmtDuration(autoRetryIn)}.</p>
        )}
        {onchain.status === 'DELAYED' && market.autoRetryHalted && <p className="warn">{market.autoRetryHalted}</p>}
        {onchain.status === 'PAUSED' && <p className="warn">Three delays used. The contract now requires a manual decision by its owner.</p>}
        {market.manualResolution && (
          <p className="warn">
            Settled {market.manualResolution.outcome} by the contract owner after three delays: &ldquo;{market.manualResolution.reason}&rdquo;{' '}
            <span className="mono muted">(tx {short(market.manualResolution.txHash)})</span>
          </p>
        )}
        {runError && <p className="error">{runError}</p>}
      </div>
    </section>
  );
}
