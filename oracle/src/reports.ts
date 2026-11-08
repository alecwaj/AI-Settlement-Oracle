import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OracleReport } from '@oracle/shared';

/** Signed reports, persisted as JSON files so they survive restarts and can be shared. */
export class ReportStore {
  private readonly dir: string;
  private readonly reports = new Map<string, OracleReport>();

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'reports');
    mkdirSync(this.dir, { recursive: true });
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const r = JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as OracleReport;
        this.reports.set(r.reportId, r);
      } catch {
        // ignore unreadable files
      }
    }
  }

  save(report: OracleReport): void {
    this.reports.set(report.reportId, report);
    writeFileSync(join(this.dir, `${report.reportId}.json`), JSON.stringify(report, null, 2));
  }

  get(id: string): OracleReport | undefined {
    return this.reports.get(id);
  }

  /** Reports for a market on a given contract, newest first. */
  list(slug: string, contract: string): OracleReport[] {
    return [...this.reports.values()]
      .filter((r) => r.market.slug === slug && r.attestation.domain.verifyingContract.toLowerCase() === contract.toLowerCase())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  path(id: string): string | null {
    const p = join(this.dir, `${id}.json`);
    return existsSync(p) ? p : null;
  }
}
