import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { PipelineEvent } from './pipeline.ts';

export interface Run {
  id: string;
  slug: string;
  startedAt: string;
  status: 'running' | 'succeeded' | 'failed';
  reportId: string | null;
  error: string | null;
  events: PipelineEvent[];
}

/** Tracks pipeline runs and fans their events out to Server-Sent-Event subscribers. */
export class RunManager {
  private readonly runs = new Map<string, Run>();
  private readonly subscribers = new Map<string, Set<Response>>();

  get(id: string): Run | undefined {
    return this.runs.get(id);
  }

  activeFor(slug: string): Run | undefined {
    return [...this.runs.values()].find((r) => r.slug === slug && r.status === 'running');
  }

  latestFor(slug: string): Run | undefined {
    return [...this.runs.values()].filter((r) => r.slug === slug).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  }

  start(slug: string, work: (emit: (e: Omit<PipelineEvent, 'seq' | 'at'>) => void) => Promise<string>): Run {
    const run: Run = {
      id: randomUUID(),
      slug,
      startedAt: new Date().toISOString(),
      status: 'running',
      reportId: null,
      error: null,
      events: [],
    };
    this.runs.set(run.id, run);
    const emit = (e: Omit<PipelineEvent, 'seq' | 'at'>): void => {
      const event: PipelineEvent = { ...e, seq: run.events.length, at: new Date().toISOString() };
      run.events.push(event);
      for (const res of this.subscribers.get(run.id) ?? []) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    void work(emit)
      .then((reportId) => {
        run.status = 'succeeded';
        run.reportId = reportId;
        emit({ step: 'complete', status: 'done', message: 'Resolution complete', data: { reportId } });
      })
      .catch((err: Error & { step?: string; reportId?: string | null }) => {
        run.status = 'failed';
        run.error = err.message;
        const reportId = err.reportId ?? null;
        run.reportId = reportId;
        emit({ step: 'complete', status: 'failed', message: err.message, data: { failedStep: err.step ?? null, reportId } });
      })
      .finally(() => {
        for (const res of this.subscribers.get(run.id) ?? []) res.end();
        this.subscribers.delete(run.id);
      });
    return run;
  }

  /** Replays past events, then streams new ones until the run ends. */
  subscribe(run: Run, res: Response): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    for (const e of run.events) res.write(`data: ${JSON.stringify(e)}\n\n`);
    if (run.status !== 'running') {
      res.end();
      return;
    }
    const set = this.subscribers.get(run.id) ?? new Set<Response>();
    set.add(res);
    this.subscribers.set(run.id, set);
    res.on('close', () => set.delete(res));
  }
}
