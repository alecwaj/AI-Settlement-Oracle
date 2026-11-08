import type { OracleReport } from '@oracle/shared';
import { fmtDate, short } from '../format.ts';

export function Sources({ report }: { report: OracleReport }) {
  const cited = new Set(report.decision.record.decision.citedSourceIds);
  const { evidence, providers } = report.sourcing;
  return (
    <section className="card sources">
      <div className="section-head">
        <h3>Sources</h3>
        <span className="muted">{evidence.length} given to the model · {cited.size} cited</span>
      </div>
      <div className="provider-status">
        {providers.map((p) => (
          <details key={p.provider}>
            <summary>
              <span className={`chip ${p.ok ? '' : 'chip-bad'}`}>{p.provider}</span> {p.found} found, {p.kept} usable
              {p.errors.length > 0 ? `, ${p.errors.length} errors` : ''}
            </summary>
            <ul className="muted small">
              {[...p.errors.map((e) => `Error: ${e}`), ...p.notes].map((x) => <li key={x}>{x}</li>)}
              {p.errors.length + p.notes.length === 0 && <li>No issues.</li>}
            </ul>
          </details>
        ))}
      </div>
      {evidence.length === 0 ? (
        <p className="muted">No usable sources were retrieved.</p>
      ) : (
        <ol className="source-list">
          {evidence.map((e) => (
            <li key={e.id} id={`source-${e.id}`} className={cited.has(e.id) ? 'cited' : ''}>
              <div className="source-head">
                <span className="chip">{e.id}</span>
                <span className="outlet">{e.outlet}</span>
                <span className="muted">{fmtDate(e.publishedAt)}</span>
                {cited.has(e.id) && <span className="chip chip-cited">cited</span>}
              </div>
              <a href={e.url} target="_blank" rel="noreferrer" className="source-title">{e.title}</a>
              <details>
                <summary className="muted small">Text the model read ({e.text.length.toLocaleString()} chars) · sha256 <span className="mono">{short(e.contentHash)}</span></summary>
                <pre className="source-text">{e.text}</pre>
              </details>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
