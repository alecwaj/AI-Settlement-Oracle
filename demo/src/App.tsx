import { useCallback, useEffect, useState } from 'react';
import { isAddress, type Address } from 'viem';
import {
  abi,
  canWrite,
  CHAIN_NAME,
  DEV_ACCOUNTS,
  explorerLink,
  DEV_LABELS,
  oracle,
  publicClient,
  short,
  signerAddress,
  STATUS,
  warp,
  walletFor,
  type Attestation,
  type Signer,
  ZERO_ADDRESS,
} from './lib';
import { MarketView, type Market } from './MarketView';
import { ReviewerGuide } from './ReviewerGuide';

function initialMarket(): bigint | null {
  const m = new URLSearchParams(window.location.search).get('market');
  return m && /^\d+$/.test(m) ? BigInt(m) : null;
}

export default function App() {
  const [contract, setContract] = useState<Address | null>((import.meta.env.VITE_CONTRACT_ADDRESS as Address) ?? null);
  const [att, setAtt] = useState<Attestation | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [chainTime, setChainTime] = useState<bigint>(0n);
  const [signer, setSigner] = useState<Signer>({ kind: 'dev', index: 2 });
  const [markets, setMarkets] = useState<Array<{ id: bigint; m: Market }>>([]);
  const [selected, setSelectedState] = useState<bigint | null>(initialMarket);
  const setSelected = useCallback((id: bigint | null) => {
    setSelectedState(id);
    const url = new URL(window.location.href);
    if (id === null) url.searchParams.delete('market');
    else url.searchParams.set('market', id.toString());
    window.history.replaceState(null, '', url);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // Oracle identity + contract discovery
  useEffect(() => {
    oracle<Attestation>('/attestation')
      .then(setAtt)
      .catch(() => setError('The oracle service is not reachable right now. On-chain data is still shown, and each verdict is read from the chain.'));
    if (!contract) {
      oracle<{ contract: Address | null }>('/health')
        .then((h) => h.contract && isAddress(h.contract) && setContract(h.contract))
        .catch(() => undefined);
    }
  }, [contract]);

  // Chain state
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [id, block] = await Promise.all([publicClient.getChainId(), publicClient.getBlock()]);
        if (cancelled) return;
        setChainId(id);
        setChainTime(block.timestamp);
        if (id !== 31337) setSigner((s) => (s.kind === 'dev' ? { kind: 'injected', address: ZERO_ADDRESS } : s));
        if (!contract) return;
        const count = await publicClient.readContract({ address: contract, abi, functionName: 'marketCount' });
        const list = await Promise.all(
          Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1)).map(async (id) => ({
            id,
            m: await publicClient.readContract({ address: contract, abi, functionName: 'getMarket', args: [id] }),
          })),
        );
        if (!cancelled) {
          setMarkets(list.reverse());
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message.split('\n')[0] : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contract, tick]);

  // Light polling so watcher-driven resolutions appear without a manual refresh
  useEffect(() => {
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const connectInjected = async () => {
    const eth = (window as unknown as { ethereum?: { request: (a: { method: string }) => Promise<string[]> } }).ethereum;
    if (!eth) return setError('No injected wallet (e.g. MetaMask) found.');
    const [address] = await eth.request({ method: 'eth_requestAccounts' });
    setSigner({ kind: 'injected', address: address as Address });
  };

  const selectedMarket = markets.find((x) => x.id === selected);

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>AI Settlement Oracle</h1>
          <p className="muted">Optimistic resolution · double-challenge escalation · TEE-attested open-weight AI arbiter</p>
        </div>
        <TeeBadge att={att} />
      </header>

      <ReviewerGuide onOpenMarket={(id) => setSelected(id)} hasMarkets={markets.length > 0} />

      <section className="bar">
        <div>
          <span className="label">Acting as</span>
          {chainId === 31337 ? (
            <select
              value={signer.kind === 'dev' ? signer.index : 'injected'}
              onChange={(e) => (e.target.value === 'injected' ? connectInjected() : setSigner({ kind: 'dev', index: Number(e.target.value) }))}
            >
              {DEV_ACCOUNTS.map((a, i) => (
                <option key={a.address} value={i}>
                  {DEV_LABELS[i]} · {short(a.address, 4)}
                </option>
              ))}
              <option value="injected">Browser wallet…</option>
            </select>
          ) : (
            <>
              <button className="ghost" onClick={connectInjected}>
                {canWrite(signer) ? short(signerAddress(signer), 4) : 'Connect wallet (optional)'}
              </button>
              {!canWrite(signer) && <span className="muted small"> read-only: no wallet needed to explore & verify</span>}
            </>
          )}
        </div>
        <div className="muted small">
          {chainId !== null && <>{CHAIN_NAME ?? `chain ${chainId}`} · </>}
          {chainTime > 0n && <>chain time {new Date(Number(chainTime) * 1000).toLocaleString()} · </>}
          {contract ? (
            explorerLink('address', contract) ? (
              <a href={explorerLink('address', contract)!} target="_blank" rel="noreferrer">
                contract {short(contract, 4)}
              </a>
            ) : (
              <>contract {short(contract, 4)}</>
            )
          ) : (
            'no contract'
          )}
        </div>
        {chainId === 31337 && (
          <div className="row">
            <button className="ghost" onClick={() => warp(130).then(refresh)} title="Skip the liveness window">
              ⏩ +2 min
            </button>
            <button className="ghost" onClick={() => warp(310).then(refresh)} title="Close the evidence window">
              ⏩ +5 min
            </button>
          </div>
        )}
      </section>

      {error && <div className="error">{error}</div>}

      {selectedMarket && contract ? (
        <MarketView
          contract={contract}
          id={selectedMarket.id}
          market={selectedMarket.m}
          signer={signer}
          canWrite={canWrite(signer)}
          chainTime={chainTime}
          att={att}
          onBack={() => setSelected(null)}
          onChange={refresh}
          onError={setError}
        />
      ) : (
        <>
          <section className="card">
            <h2>Markets</h2>
            {markets.length === 0 && <p className="muted">No markets yet. Run <code>npm run demo:seed</code> or create one below.</p>}
            {markets.map(({ id, m }) => (
              <button key={id.toString()} className="market-row" onClick={() => setSelected(id)}>
                <span className={`pill s${m.status}`}>{STATUS[m.status]}</span>
                <span className="q">
                  #{id.toString()} {m.question}
                </span>
                {m.disputeCount > 0 && <span className="muted small">{m.disputeCount}× disputed</span>}
              </button>
            ))}
          </section>
          {contract && canWrite(signer) && <CreateMarket contract={contract} signer={signer} onCreated={refresh} onError={setError} />}
        </>
      )}

      <footer className="muted small">
        Enclave signer {att ? short(att.signer, 4) : '…'} · model {att?.llm.model ?? '…'} ·{' '}
        <a href="https://github.com/alecwaj/AI-Settlement-Oracle" target="_blank" rel="noreferrer">
          source & docs
        </a>
      </footer>
    </div>
  );
}

function TeeBadge({ att }: { att: Attestation | null }) {
  if (!att) return <span className="badge off">Oracle offline</span>;
  const oracle =
    att.mode === 'tdx' ? (
      <span className="badge ok" title={`app ${att.appId}`}>🔐 Oracle: Intel TDX</span>
    ) : att.mode === 'tdx-simulator' ? (
      <span className="badge warn">🧪 Oracle: dstack simulator</span>
    ) : (
      <span className="badge bad">⚠️ Oracle: dev mode, no TEE</span>
    );
  const inference =
    att.llm.provider === 'confidential' ? (
      <span
        className={`badge ${att.llm.requireAttestedInference ? 'ok' : 'warn'}`}
        title={att.llm.requireAttestedInference ? `verified via ${att.llm.gateway}` : 'Runs on Confidential AI TEE infrastructure; this oracle does not yet verify the attestation'}
      >
        {att.llm.requireAttestedInference ? '🔐 Inference: Confidential AI enclave (verified)' : '🟡 Inference: Confidential AI (attestation not yet verified)'}
      </span>
    ) : (
      <span className="badge bad">⚠️ Inference: {att.llm.provider}, not attested</span>
    );
  return (
    <div className="row">
      {oracle}
      {inference}
    </div>
  );
}

function CreateMarket({ contract, signer, onCreated, onError }: { contract: Address; signer: Signer; onCreated: () => void; onError: (e: string) => void }) {
  const [question, setQuestion] = useState('');
  const [criteria, setCriteria] = useState('');
  const [minutes, setMinutes] = useState(0);
  const [threshold, setThreshold] = useState(70);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const wallet = await walletFor(signer);
      const now = (await publicClient.getBlock()).timestamp;
      const hash = await wallet.writeContract({
        address: contract,
        abi,
        functionName: 'createMarket',
        args: [question, criteria, now + BigInt(minutes * 60), threshold * 100],
        account: wallet.account!,
        chain: wallet.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setQuestion('');
      setCriteria('');
      onCreated();
    } catch (e) {
      onError(e instanceof Error ? e.message.split('\n')[0] : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Create market</h2>
      <label>Question</label>
      <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Will … happen by …?" />
      <label>Resolution criteria (the AI applies these literally)</label>
      <textarea rows={3} value={criteria} onChange={(e) => setCriteria(e.target.value)} placeholder="Resolves YES if … Resolves NO if …" />
      <div className="row">
        <div>
          <label>Resolves in (minutes)</label>
          <input type="number" min={0} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </div>
        <div>
          <label>AI confidence threshold (%)</label>
          <input type="number" min={1} max={100} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
        </div>
      </div>
      <button disabled={busy || !question || !criteria} onClick={submit}>
        {busy ? 'Creating…' : 'Create market'}
      </button>
    </section>
  );
}
