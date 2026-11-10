import { useEffect, useState } from 'react';
import { formatEther, parseEther, zeroHash, type Address, type Hex } from 'viem';
import { abi, oracle, OUTCOME, publicClient, short, signerAddress, STATUS, walletFor, type Attestation, type ResolutionRecord, type Signer } from './lib';
import { ResolutionPanel } from './ResolutionPanel';
import { OnchainRecord } from './OnchainRecord';

export type Market = Awaited<ReturnType<typeof readMarket>>;
async function readMarket(contract: Address, id: bigint) {
  return publicClient.readContract({ address: contract, abi, functionName: 'getMarket', args: [id] });
}
type Submission = Awaited<ReturnType<typeof readSubs>>[number];
async function readSubs(contract: Address, id: bigint) {
  return publicClient.readContract({ address: contract, abi, functionName: 'getSubmissions', args: [id] });
}

interface Props {
  contract: Address;
  id: bigint;
  market: Market;
  signer: Signer;
  canWrite: boolean;
  chainTime: bigint;
  att: Attestation | null;
  onBack: () => void;
  onChange: () => void;
  onError: (e: string | null) => void;
}

const STEPS = ['Proposed', 'Disputed', 'Re-proposed', 'Disputed again → escalated', 'Evidence', 'AI arbiter', 'Resolved'];

export function MarketView({ contract, id, market: m, signer, canWrite, chainTime, att, onBack, onChange, onError }: Props) {
  const [subs, setSubs] = useState<readonly Submission[]>([]);
  const [records, setRecords] = useState<ResolutionRecord[]>([]);
  const [bond, setBond] = useState<bigint>(0n);
  const [minStake, setMinStake] = useState<bigint>(0n);
  const [claimable, setClaimable] = useState<bigint>(0n);
  const [busy, setBusy] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<1 | 2>(2);
  const [uri, setUri] = useState('');
  const [stake, setStake] = useState('');

  const me = signerAddress(signer);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, b, ms, c] = await Promise.all([
        readSubs(contract, id),
        publicClient.readContract({ address: contract, abi, functionName: 'proposalBond' }),
        publicClient.readContract({ address: contract, abi, functionName: 'minEvidenceStake' }),
        publicClient.readContract({ address: contract, abi, functionName: 'claimable', args: [id, me] }),
      ]);
      const r = await oracle<{ resolutions: ResolutionRecord[] }>(`/markets/${id}/resolutions`).catch(() => ({ resolutions: [] }));
      if (cancelled) return;
      setSubs(s);
      setBond(b);
      setMinStake(ms);
      setStake((cur) => cur || formatEther(ms));
      setClaimable(c);
      setRecords(r.resolutions);
    })().catch((e) => onError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [contract, id, m, me, onError]);

  async function tx(label: string, functionName: string, args: unknown[], value?: bigint) {
    setBusy(label);
    onError(null);
    try {
      const wallet = await walletFor(signer);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hash = await wallet.writeContract({ address: contract, abi, functionName: functionName as any, args: args as any, value, account: wallet.account!, chain: wallet.chain } as any);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error(`${label} reverted`);
      onChange();
    } catch (e) {
      onError(e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message.split('\n')[0] : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function submitEvidence() {
    setBusy('Hashing evidence');
    let contentHash: Hex = zeroHash;
    try {
      const h = await oracle<{ contentHash: Hex | null; ok: boolean; error: string | null }>('/evidence/hash', { method: 'POST', body: JSON.stringify({ url: uri }) });
      if (h.contentHash) contentHash = h.contentHash;
    } catch {
      /* commit to 0x0 (unchecked) if the helper is unavailable */
    }
    await tx('Submit evidence', 'submitEvidence', [id, verdict, uri, contentHash], parseEther(stake || '0'));
    setUri('');
  }

  async function requestAI() {
    setBusy('Claude is deliberating inside the enclave…');
    onError(null);
    try {
      const r = await oracle<{ success: boolean; error?: string; resolution?: ResolutionRecord }>(`/markets/${id}/resolve`, { method: 'POST' });
      if (!r.success) onError(r.error ?? r.resolution?.error ?? 'Resolution failed');
      onChange();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const now = chainTime;
  const status = m.status;
  const progress = status === 3 ? 6 : status === 4 ? 5 : status === 2 ? (now >= m.evidenceDeadline ? 5 : 4) : status === 1 ? (m.disputeCount === 1 ? 2 : 0) : m.disputeCount === 1 ? 1 : -1;
  const remaining = (until: bigint) => {
    const s = Number(until - now);
    return s <= 0 ? 'now' : s < 120 ? `${s}s` : `${Math.round(s / 60)} min`;
  };

  return (
    <section className="card">
      <button className="ghost back" onClick={onBack}>
        ← All markets
      </button>
      <div className="row between">
        <span className={`pill s${status}`}>{STATUS[status]}</span>
        <span className="muted small">
          threshold {m.confidenceThresholdBps / 100}% · pools YES {formatEther(m.yesPool)} / NO {formatEther(m.noPool)} ETH
        </span>
      </div>
      <h2 className="question">
        #{id.toString()} {m.question}
      </h2>
      <div className="criteria">
        <span className="label">Resolution criteria</span>
        <p>{m.resolutionCriteria}</p>
      </div>

      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i <= progress ? 'done' : ''}>
            {s}
          </li>
        ))}
      </ol>

      {busy && <div className="busy">{busy}</div>}
      {!canWrite && (status === 0 || status === 1 || (status === 2 && now < m.evidenceDeadline) || (status === 3 && claimable > 0n)) && (
        <p className="muted small">Read-only: connect a wallet (Base Sepolia) to take part. Exploring and verifying need no wallet.</p>
      )}

      {/* ---- Actions by status ---- */}
      {status === 0 && (
        <div className="action">
          {now < m.resolutionTime ? (
            <p className="muted">Proposals open in {remaining(m.resolutionTime)}.</p>
          ) : (
            <>
              <p>
                {m.disputeCount === 1 ? 'The first proposal was disputed (single challenge). Propose again — ' : 'Propose the outcome — '}
                bond {formatEther(bond)} ETH. If undisputed for the liveness window, it becomes final.
              </p>
              <div className="row">
                <button disabled={!!busy || !canWrite} onClick={() => tx('Propose YES', 'propose', [id, 1], bond)}>
                  Propose YES
                </button>
                <button disabled={!!busy || !canWrite} onClick={() => tx('Propose NO', 'propose', [id, 2], bond)}>
                  Propose NO
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {status === 1 && (
        <div className="action">
          <p>
            {short(m.proposer, 4)} proposed <b>{OUTCOME[m.proposedOutcome]}</b>. Liveness ends in {remaining(m.livenessEnd)}.
            {m.disputeCount === 1 && ' A second dispute escalates to the AI arbiter.'}
          </p>
          <div className="row">
            {now < m.livenessEnd ? (
              <button disabled={!!busy} className="danger" onClick={() => tx('Dispute', 'dispute', [id], bond)}>
                Dispute (bond {formatEther(bond)} ETH)
              </button>
            ) : (
              <button disabled={!!busy || !canWrite} onClick={() => tx('Settle', 'settle', [id])}>
                Settle as {OUTCOME[m.proposedOutcome]}
              </button>
            )}
          </div>
        </div>
      )}

      {status === 2 && now < m.evidenceDeadline && (
        <div className="action">
          <p>
            {m.aiRound > 0 ? `The AI delayed resolution (round ${m.aiRound}): confidence was below threshold. ` : 'Escalated. '}
            Stake on a verdict and submit evidence. Evidence window closes in {remaining(m.evidenceDeadline)}.
          </p>
          <div className="row">
            <select value={verdict} onChange={(e) => setVerdict(Number(e.target.value) as 1 | 2)}>
              <option value={1}>Verdict: YES</option>
              <option value={2}>Verdict: NO</option>
            </select>
            <input className="grow" placeholder="https://… evidence URL" value={uri} onChange={(e) => setUri(e.target.value)} />
            <input className="narrow" value={stake} onChange={(e) => setStake(e.target.value)} title={`min ${formatEther(minStake)} ETH`} />
            <button disabled={!!busy || !uri || !canWrite} onClick={submitEvidence}>
              Stake & submit
            </button>
          </div>
        </div>
      )}

      {status === 2 && now >= m.evidenceDeadline && (
        <div className="action">
          <p>Evidence window closed. The oracle watcher will pick this up automatically, or trigger it now.</p>
          <button disabled={!!busy} onClick={requestAI}>
            ⚖️ Request AI resolution
          </button>
        </div>
      )}

      {status === 4 && (
        <div className="action">
          <p>The AI stayed below the confidence threshold for the maximum number of rounds. The contract owner must resolve manually.</p>
          <div className="row">
            {[1, 2, 3].map((o) => (
              <button key={o} disabled={!!busy || !canWrite} onClick={() => tx('Manual resolve', 'manualResolve', [id, o])}>
                Owner: {OUTCOME[o]}
              </button>
            ))}
          </div>
        </div>
      )}

      {status === 3 && (
        <div className="action">
          <p>
            Final outcome: <b className="big">{OUTCOME[m.finalOutcome]}</b>
          </p>
          {claimable > 0n ? (
            <button disabled={!!busy || !canWrite} onClick={() => tx('Claim', 'claim', [id])}>
              Claim {formatEther(claimable)} ETH
            </button>
          ) : (
            <p className="muted small">Nothing to claim for this account.</p>
          )}
        </div>
      )}

      {/* ---- Evidence ---- */}
      {subs.length > 0 && (
        <>
          <h3>Evidence submissions</h3>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Verdict</th>
                <th>Stake</th>
                <th>Evidence</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s, i) => (
                <tr key={i}>
                  <td>{i}</td>
                  <td>
                    <span className={`pill v${s.verdict}`}>{OUTCOME[s.verdict]}</span>
                  </td>
                  <td>{formatEther(s.stake)}</td>
                  <td className="uri">
                    <a href={s.evidenceURI} target="_blank" rel="noreferrer">
                      {s.evidenceURI.replace(/^https?:\/\//, '').slice(0, 60)}
                    </a>
                  </td>
                  <td className="mono">{short(s.submitter, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {records.length === 0 && (status === 3 || m.aiRound > 0) && <OnchainRecord contract={contract} marketId={id} />}

      {records.length > 0 && (
        <>
          <h3>AI arbiter rounds</h3>
          {[...records].reverse().map((r) => (
            <ResolutionPanel key={`${r.round}-${r.createdAt}`} contract={contract} record={r} att={att} />
          ))}
        </>
      )}
    </section>
  );
}
