import { useEffect, useState } from 'react';
import type { Address, Hex } from 'viem';
import { abi, DEPLOY_BLOCK, explorerLink, OUTCOME, publicClient, short } from './lib';

interface Entry {
  kind: 'resolved' | 'delayed';
  outcome?: number;
  confidenceBps: number;
  reasoning: string;
  transcriptHash: Hex;
  signer?: Address;
  txHash: Hex | null;
  round?: number;
}

/**
 * Verdicts read straight from contract events. Shown when the oracle's API has no records (e.g. it is
 * offline or was redeployed). The reasoning is in the chain itself, so the decision never depends on the
 * oracle staying up.
 */
export function OnchainRecord({ contract, marketId }: { contract: Address; marketId: bigint }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [resolved, delayed] = await Promise.all([
        publicClient.getContractEvents({ address: contract, abi, eventName: 'AIResolved', args: { marketId }, fromBlock: DEPLOY_BLOCK }),
        publicClient.getContractEvents({ address: contract, abi, eventName: 'ResolutionDelayed', args: { marketId }, fromBlock: DEPLOY_BLOCK }),
      ]);
      const list: Entry[] = [
        ...delayed.map((e) => ({
          kind: 'delayed' as const,
          confidenceBps: e.args.confidenceBps ?? 0,
          reasoning: e.args.reasoning ?? '',
          transcriptHash: (e.args.transcriptHash ?? '0x') as Hex,
          round: e.args.aiRound,
          txHash: e.transactionHash,
        })),
        ...resolved.map((e) => ({
          kind: 'resolved' as const,
          outcome: e.args.outcome,
          confidenceBps: e.args.confidenceBps ?? 0,
          reasoning: e.args.reasoning ?? '',
          transcriptHash: (e.args.transcriptHash ?? '0x') as Hex,
          signer: e.args.enclaveSigner,
          txHash: e.transactionHash,
        })),
      ];
      if (!cancelled) setEntries(list);
    })().catch(() => !cancelled && setEntries([]));
    return () => {
      cancelled = true;
    };
  }, [contract, marketId]);

  if (!entries || entries.length === 0) return null;
  return (
    <>
      <h3>AI verdicts (from on-chain events)</h3>
      {entries.map((e, i) => (
        <div key={i} className={`resolution ${e.kind === 'delayed' ? 'delayed' : ''}`}>
          <div className="row between">
            <div>
              {e.kind === 'resolved' ? <b className="big">{OUTCOME[e.outcome ?? 0]}</b> : <b>Delayed (round {e.round})</b>}{' '}
              <span className="muted">at {(e.confidenceBps / 100).toFixed(1)}% confidence</span>
            </div>
            {e.txHash && explorerLink('tx', e.txHash) && (
              <a className="small" href={explorerLink('tx', e.txHash)!} target="_blank" rel="noreferrer">
                view tx
              </a>
            )}
          </div>
          <p className="reasoning">{e.reasoning}</p>
          <p className="muted small mono">
            transcript {short(e.transcriptHash, 10)}
            {e.signer && <> · enclave signer {short(e.signer, 6)}</>}
          </p>
        </div>
      ))}
    </>
  );
}
