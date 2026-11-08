import { useEffect, useRef } from 'react';
import type { ProviderStatus } from '@oracle/shared';
import type { PipelineEvent, StepId } from '../api.ts';

const STEPS: Array<{ id: Exclude<StepId, 'complete'>; label: string; detail: string }> = [
  { id: 'rules', label: 'Rules', detail: 'Read settlement conditions' },
  { id: 'sourcing', label: 'Sources', detail: 'Query trusted outlets' },
  { id: 'evidence', label: 'Evidence', detail: 'Hash what the model reads' },
  { id: 'decision', label: 'Decision', detail: 'Apply rules to evidence' },
  { id: 'attestation', label: 'Signature', detail: 'EIP-712 attestation' },
  { id: 'publication', label: 'On-chain', detail: 'Post logic + sources' },
];

type State = 'idle' | 'running' | 'done' | 'failed';

function stepStates(events: PipelineEvent[]): Record<string, State> {
  const s: Record<string, State> = {};
  for (const e of events) {
    if (e.step === 'complete') {
      if (e.status === 'failed') {
        const failed = (e.data?.failedStep as string | null) ?? STEPS.find((x) => s[x.id] === 'running')?.id;
        if (failed) s[failed] = 'failed';
      }
      continue;
    }
    if (e.status === 'done') s[e.step] = 'done';
    else if (e.status === 'failed') s[e.step] = 'failed';
    else if (s[e.step] !== 'done') s[e.step] = 'running';
  }
  return s;
}

export function Pipeline({ events, running }: { events: PipelineEvent[]; running: boolean }) {
  const states = stepStates(events);
  const providers = events.find((e) => e.step === 'sourcing' && e.status === 'done')?.data?.providers as
    | ProviderStatus[]
    | undefined;
  const log = events.filter((e) => e.step !== 'complete' || e.status === 'failed');
  const end = events.find((e) => e.step === 'complete');
  const logRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log.length]);

  return (
    <section className="card pipeline">
      <div className="section-head">
        <h3>Oracle pipeline</h3>
        <span className="muted">{running ? 'live' : end ? (end.status === 'done' ? 'completed' : 'stopped') : 'not started'}</span>
      </div>
      <ol className="steps">
        {STEPS.map((step, i) => {
          const st = states[step.id] ?? 'idle';
          const next = STEPS[i + 1];
          const flowing = st === 'done' && next && (states[next.id] ?? 'idle') === 'running';
          return (
            <li key={step.id} className={`step ${st}`}>
              <div className="node">
                <span className="dot" />
                <span className="index">{i + 1}</span>
              </div>
              {next && <div className={`link ${st === 'done' ? 'lit' : ''} ${flowing ? 'flowing' : ''}`} />}
              <div className="step-label">{step.label}</div>
              <div className="step-detail">{step.detail}</div>
              {step.id === 'sourcing' && providers && (
                <div className="providers">
                  {providers.map((p) => (
                    <span key={p.provider} className={`chip ${p.ok ? '' : 'chip-bad'}`} title={[...p.errors, ...p.notes].join('\n')}>
                      {p.provider} {p.kept}/{p.found}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {log.length > 0 && (
        <ul className="log" ref={logRef}>
          {log.map((e) => (
            <li key={e.seq} className={`log-${e.status}`}>
              <span className="mono muted">{e.at.slice(11, 19)}</span>
              <span className="log-step">{e.step}</span>
              <span>{e.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
