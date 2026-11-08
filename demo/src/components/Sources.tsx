import type { EvidenceItem, OracleReport, ProviderStatus } from '@oracle/shared';
import type { SourcePreview } from '../api.ts';
import { fmtDate, short } from '../format.ts';

interface ListProps {
  heading: string;
  subtitle: string;
  evidence: EvidenceItem[];
  providers: ProviderStatus[];
  cited: Set<string>;
  banner?: string;
  preview?: boolean;
}

function SourceList({ heading, subtitle, evidence, providers, cited, banner, preview = false }: ListProps) {
  return (
    <section className="card sources">
      <div className="section-head">
        <h3>{heading}</h3>
        <span className="muted">{subtitle}</span>
      </div>
      {banner && <p className="banner">{banner}</p>}
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
                <summary className="muted small">
                  Text the model {preview ? 'would read' : 'read'} ({e.text.length.toLocaleString()} chars) · sha256{' '}
                  <span className="mono">{short(e.contentHash)}</span>
                </summary>
                <pre className="source-text">{e.text}</pre>
              </details>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function Sources({ report }: { report: OracleReport }) {
  const cited = new Set(report.decision.record.decision.citedSourceIds);
  return (
    <SourceList
      heading="Sources"
      subtitle={`${report.sourcing.evidence.length} given to the model · ${cited.size} cited`}
      evidence={report.sourcing.evidence}
      providers={report.sourcing.providers}
      cited={cited}
    />
  );
}

export function PreviewSources({ preview, onClose }: { preview: SourcePreview; onClose: () => void }) {
  return (
    <div className="preview-wrap">
      <SourceList
        heading="Source preview"
        subtitle={`${preview.evidence.length} sources · fetched ${preview.finishedAt.slice(11, 19)} UTC`}
        evidence={preview.evidence}
        providers={preview.providers}
        cited={new Set()}
        preview
        banner="Preview only: these are the sources a resolution would use right now. Nothing was sent to the model, signed or posted on-chain."
      />
      <button className="link-button preview-close" onClick={onClose}>Close preview</button>
    </div>
  );
}
