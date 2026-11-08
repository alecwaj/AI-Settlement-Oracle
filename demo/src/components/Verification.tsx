import { useState } from 'react';
import { createPublicClient, http, type PublicClient } from 'viem';
import { verifyReportOffline, verifyReportOnChain, type Check, type OracleReport } from '@oracle/shared';
import type { OracleConfig } from '../api.ts';
import { API } from '../api.ts';
import { short } from '../format.ts';

export function Verification({ report, config }: { report: OracleReport; config: OracleConfig }) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a = report.attestation;
  const pub = report.publication;

  async function verify(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const offline = await verifyReportOffline(report);
      const client = createPublicClient({ transport: http(config.rpcUrl) }) as PublicClient;
      const onchain = await verifyReportOnChain(client, report).catch((err: Error) => [
        { id: 'rpc', label: 'Read the chain', ok: false, detail: err.message.split('\n')[0] ?? 'RPC error' },
      ]);
      setChecks([...offline, ...onchain]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const allOk = checks?.every((c) => c.ok);

  return (
    <section className="card verification">
      <div className="section-head">
        <h3>Cryptographic verification</h3>
        <a className="muted small" href={`${API}/reports/${encodeURIComponent(report.reportId)}`} target="_blank" rel="noreferrer">
          Download signed report (JSON)
        </a>
      </div>
      <dl className="facts compact">
        <div><dt>Signer</dt><dd className="mono">{a.signer}</dd></div>
        <div><dt>EIP-712 digest</dt><dd className="mono">{short(a.digest, 14, 10)}</dd></div>
        <div><dt>Signature</dt><dd className="mono">{short(a.signature, 14, 10)}</dd></div>
        <div><dt>Rules hash</dt><dd className="mono">{short(a.message.rulesHash, 14, 10)}</dd></div>
        <div><dt>Evidence hash</dt><dd className="mono">{short(a.message.evidenceHash, 14, 10)}</dd></div>
        <div><dt>Decision logic hash</dt><dd className="mono">{short(a.message.reasoningHash, 14, 10)}</dd></div>
        <div><dt>Report hash</dt><dd className="mono">{short(a.message.reportHash, 14, 10)}</dd></div>
        <div><dt>Contract</dt><dd className="mono">{a.domain.verifyingContract} (chain {a.domain.chainId})</dd></div>
        <div>
          <dt>Transaction</dt>
          <dd className="mono">{pub ? `${short(pub.txHash, 14, 10)} · block ${pub.blockNumber}` : `not published${report.publicationError ? `: ${report.publicationError}` : ''}`}</dd>
        </div>
      </dl>

      <p className="muted small">
        This check runs in your browser using the published report and a direct connection to the chain at {config.rpcUrl}. It does not
        rely on the oracle service: it recomputes every hash, rebuilds the exact model input, recovers the signer, and compares
        everything with the events the contract emitted.
      </p>
      <button onClick={verify} disabled={busy}>{busy ? 'Verifying…' : checks ? 'Verify again' : 'Verify independently'}</button>
      {error && <p className="error">{error}</p>}
      {checks && (
        <>
          <p className={allOk ? 'ok-line' : 'error'}>{allOk ? `All ${checks.length} checks passed.` : `${checks.filter((c) => !c.ok).length} checks failed.`}</p>
          <ul className="checks">
            {checks.map((c) => (
              <li key={c.id} className={c.ok ? 'pass' : 'fail'}>
                <span className="mark">{c.ok ? '✓' : '✗'}</span>
                <span className="check-label">{c.label}</span>
                <span className="muted mono small">{c.detail}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
