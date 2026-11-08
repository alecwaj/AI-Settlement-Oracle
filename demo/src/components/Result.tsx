import type { OracleReport } from '@oracle/shared';
import { pct } from '../format.ts';

function SourceChips({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <span className="cites">
      {ids.map((id) => (
        <a key={id} href={`#source-${id}`} className="chip chip-link">{id}</a>
      ))}
    </span>
  );
}

export function Result({ report }: { report: OracleReport }) {
  const { record, confidenceBps, action } = report.decision;
  const d = record.decision;
  const threshold = report.market.confidenceThresholdBps;
  const verdictClass = action === 'DELAY' ? 'delay' : d.decision.toLowerCase();

  return (
    <section className="card result">
      <div className="section-head">
        <h3>Settlement decision</h3>
        <span className="muted">attempt {report.attempt + 1} · {report.createdAt.replace('T', ' ').slice(0, 19)} UTC</span>
      </div>

      <div className="verdict-row">
        <div className={`verdict ${verdictClass}`}>
          {d.decision === 'INSUFFICIENT_EVIDENCE' ? 'INSUFFICIENT EVIDENCE' : d.decision}
        </div>
        <div className="confidence">
          <div className="confidence-label">
            <span>Confidence {pct(confidenceBps)}</span>
            <span className="muted">needs {pct(threshold)} to settle</span>
          </div>
          <div className="meter" role="img" aria-label={`confidence ${pct(confidenceBps)}, threshold ${pct(threshold)}`}>
            <div className={`meter-fill ${confidenceBps >= threshold ? 'ok' : 'low'}`} style={{ width: `${confidenceBps / 100}%` }} />
            <div className="meter-mark" style={{ left: `${threshold / 100}%` }} />
          </div>
          <div className="action-line">
            {action === 'RESOLVE'
              ? `Market settles ${d.decision}.`
              : report.publication?.marketStatusAfter === 'PAUSED'
                ? 'Third delay: the market is paused for a manual decision by the contract owner.'
                : 'Market delayed: the oracle will look again for more evidence.'}
            {report.publication ? ` On-chain status: ${report.publication.marketStatusAfter}.` : ''}
          </div>
        </div>
      </div>

      <p className="summary">{d.summary}</p>
      {d.insufficiencyReason && <p className="warn">Missing evidence: {d.insufficiencyReason}</p>}

      {d.conditionAssessments.length > 0 && (
        <>
          <h4>Settlement conditions</h4>
          <ul className="assessments">
            {d.conditionAssessments.map((c, i) => (
              <li key={i}>
                <span className={`chip side-${c.side.toLowerCase()}`}>{c.side}</span>
                <span className={`chip status-${c.status.toLowerCase()}`}>{c.status.replace('_', ' ')}</span>
                <div>
                  <div className="cond-text">{c.condition}</div>
                  <div className="muted">{c.explanation} <SourceChips ids={c.sourceIds} /></div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {d.reasoningSteps.length > 0 && (
        <>
          <h4>Decision logic</h4>
          <ol className="reasoning">
            {d.reasoningSteps.map((s, i) => (
              <li key={i}>{s.finding} <SourceChips ids={s.sourceIds} /></li>
            ))}
          </ol>
        </>
      )}

      <dl className="facts compact">
        <div><dt>Model</dt><dd className="mono">{record.model}{record.model !== record.requestedModel ? ` (requested ${record.requestedModel})` : ''}</dd></div>
        <div><dt>Oracle adjustments</dt><dd>{record.adjustments.length ? record.adjustments.join('; ') : 'none'}</dd></div>
      </dl>
    </section>
  );
}
