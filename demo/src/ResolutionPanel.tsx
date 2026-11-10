import { useState } from 'react';
import { keccak256, recoverAddress, toBytes, type Address } from 'viem';
import { abi, explorerLink, ORACLE_URL, publicClient, short, type Attestation, type ResolutionRecord } from './lib';

type Check = { label: string; ok: boolean | null; detail: string };

const OUTCOME_CODE = { YES: 1, NO: 2, INVALID: 3 } as const;

export function ResolutionPanel({ contract, record: r, att }: { contract: Address; record: ResolutionRecord; att: Attestation | null }) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [running, setRunning] = useState(false);

  async function verify() {
    setRunning(true);
    const out: Check[] = [];
    try {
      // 1. Digest recomputed by the contract from the public fields
      const onchainDigest = await publicClient.readContract({
        address: contract,
        abi,
        functionName: 'resolutionDigest',
        args: [BigInt(r.marketId), OUTCOME_CODE[r.outcome], r.confidenceBps, r.submissionsHash, keccak256(toBytes(r.reasoning)), r.transcriptHash, r.round],
      });
      out.push({ label: 'EIP-712 digest matches contract', ok: onchainDigest === r.digest, detail: short(onchainDigest, 8) });

      // 2. Signature recovers to the oracle's enclave signer
      const recovered = await recoverAddress({ hash: r.digest, signature: r.signature });
      out.push({ label: 'Signature recovers to enclave signer', ok: recovered === r.signer, detail: short(recovered, 6) });

      // 3. Signer registered on-chain, bound to the boot quote
      const [active, composeHash, quoteHash] = await publicClient.readContract({ address: contract, abi, functionName: 'enclaveSigners', args: [r.signer] });
      out.push({ label: 'Signer registered & active on contract', ok: active, detail: `compose ${short(composeHash, 6)}` });
      if (att?.bootQuote) {
        out.push({ label: 'On-chain quote hash = oracle boot quote', ok: quoteHash === att.bootQuote.quoteHash, detail: short(quoteHash, 8) });
      } else {
        out.push({ label: 'Hardware attestation (TDX quote)', ok: false, detail: 'none: oracle is in dev mode, not a TEE' });
      }

      // 4. Per-resolution quote commits to this exact digest
      if (r.quote) {
        out.push({ label: 'Resolution quote report_data = digest', ok: r.quote.reportData.toLowerCase().startsWith(r.digest.toLowerCase()), detail: short(r.quote.quoteHash, 8) });
      }

      // 5. Inference ran in an attested enclave on pinned open weights
      const inf = r.inference;
      out.push({
        label: inf.provider === 'confidential' ? 'Inference enclave verified (TEErminator)' : 'Inference enclave attested',
        ok: inf.attested,
        detail: inf.attested ? `gateway ${inf.gateway?.verdict}` : inf.reason,
      });
      if (inf.provider === 'confidential') {
        out.push({
          label: 'Model weights pinned in attested policy',
          ok: inf.modelPinned,
          detail: inf.pinnedRevision ? `${inf.model} @ ${inf.pinnedRevision.slice(0, 10)}…` : 'not found in allowlist',
        });
      }

      // 6. Transcript bytes hash to the signed transcriptHash
      const res = await fetch(`${ORACLE_URL}/transcripts/${r.transcriptHash}`);
      if (res.ok) {
        const text = await res.text();
        out.push({ label: 'Transcript hashes to signed value', ok: keccak256(toBytes(text)) === r.transcriptHash, detail: `${(text.length / 1024).toFixed(1)} KB` });
      } else {
        out.push({ label: 'Transcript available', ok: false, detail: `HTTP ${res.status}` });
      }
    } catch (e) {
      out.push({ label: 'Verification error', ok: false, detail: e instanceof Error ? e.message.split('\n')[0] : String(e) });
    }
    setChecks(out);
    setRunning(false);
  }

  const conf = (r.confidenceBps / 100).toFixed(1);
  return (
    <div className={`resolution ${r.willDelay ? 'delayed' : ''}`}>
      <div className="row between">
        <div>
          <span className="label">Round {r.round + 1}</span>{' '}
          <b className="big">{r.outcome}</b> <span className="muted">at {conf}% confidence</span>
        </div>
        <span className={`pill ${r.willDelay ? "tx-delayed" : `tx-${r.status}`}`}>{r.willDelay ? `delayed (< ${r.thresholdBps / 100}%)` : r.status}</span>
      </div>
      <p className="reasoning">{r.reasoning}</p>
      {r.decision.key_facts.length > 0 && (
        <ul className="facts">
          {r.decision.key_facts.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
      {r.decision.missing_information && <p className="muted small">Would change the decision: {r.decision.missing_information}</p>}

      <details>
        <summary>Evidence assessment</summary>
        <table>
          <tbody>
            {r.decision.evidence_assessments.map((a) => {
              const fetched = r.evidence.find((e) => e.submissionIndex === a.submission_index);
              return (
                <tr key={a.submission_index}>
                  <td>#{a.submission_index}</td>
                  <td>{a.reliability}</td>
                  <td>supports {a.supports}</td>
                  <td className="muted small">
                    {a.note}
                    {fetched && <> · fetched {fetched.ok ? `HTTP ${fetched.status}` : fetched.error} · hash {fetched.hashCheck}</>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>

      <details>
        <summary>Attestation</summary>
        <dl className="kv">
          <dt>Model</dt>
          <dd>
            {r.model} ({r.provider})
          </dd>
          <dt>Oracle TEE</dt>
          <dd>{r.teeMode}</dd>
          <dt>Inference</dt>
          <dd>
            {r.inference.attested ? '🔐 attested' : '⚠️ not attested'} · {r.inference.reason}
          </dd>
          {r.inference.publicEvidence?.allowlistSha256 && (
            <>
              <dt>Policy</dt>
              <dd className="mono">
                allowlist sha256 {short(r.inference.publicEvidence.allowlistSha256, 10)}
                {r.inference.gateway?.details && <> · {r.inference.gateway.details}</>}
              </dd>
            </>
          )}
          <dt>Signer</dt>
          <dd className="mono">{r.signer}</dd>
          <dt>Digest</dt>
          <dd className="mono">{r.digest}</dd>
          <dt>Transcript</dt>
          <dd className="mono">
            <a href={`${ORACLE_URL}/transcripts/${r.transcriptHash}`} target="_blank" rel="noreferrer">
              {r.transcriptHash}
            </a>
          </dd>
          <dt>Tx</dt>
          <dd className="mono">
            {r.txHash && explorerLink('tx', r.txHash) ? (
              <a href={explorerLink('tx', r.txHash)!} target="_blank" rel="noreferrer">
                {r.txHash}
              </a>
            ) : (
              (r.txHash ?? '—')
            )}
          </dd>
          {r.quote && (
            <>
              <dt>TDX quote</dt>
              <dd className="mono">
                {short(r.quote.quote, 16)} ·{' '}
                <a href="https://proof.t16z.com" target="_blank" rel="noreferrer">
                  verify on proof.t16z.com
                </a>
              </dd>
            </>
          )}
        </dl>
        {r.error && <p className="error">{r.error}</p>}
      </details>

      <button className="ghost" disabled={running} onClick={verify}>
        {running ? 'Verifying…' : '🔍 Verify this resolution'}
      </button>
      {checks && (
        <ul className="checks">
          {checks.map((c) => (
            <li key={c.label} className={c.ok ? 'ok' : 'bad'}>
              {c.ok ? '✓' : '✗'} {c.label} <span className="muted small">{c.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
