import { useState } from 'react';

const KEY = 'aso.guide.collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(v: boolean): void {
  try {
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    /* storage unavailable (private mode): the guide just reopens next visit */
  }
}

/** A 60-second tour for first-time visitors (e.g. reviewers). Collapsible; remembered per browser. */
export function ReviewerGuide({ onOpenMarket, hasMarkets }: { onOpenMarket: (id: bigint) => void; hasMarkets: boolean }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => {
    writeCollapsed(!collapsed);
    setCollapsed(!collapsed);
  };

  if (collapsed) {
    return (
      <button className="ghost guide-toggle" onClick={toggle}>
        ? How to explore this demo
      </button>
    );
  }

  return (
    <section className="card guide">
      <div className="row between">
        <h2>60-second tour</h2>
        <button className="ghost" onClick={toggle}>
          Hide
        </button>
      </div>
      <p className="muted">
        Prediction markets settle easy questions with a price feed. Fuzzy ones, like <i>"Is a 'potential biosignature' definitive evidence of life?"</i>,
        end up decided by token-holder votes, and those can be bought or herded. Here, a market that's disputed twice goes to an AI arbiter running inside hardware
        enclaves, and every verdict can be verified. No wallet is needed to explore.
      </p>
      <ol className="tour">
        <li>
          <b>Check the two badges under the title.</b> The oracle runs in an Intel TDX enclave, and the model (DeepSeek V4.1 Flash, open weights) runs in Confidential AI's
          confidential-GPU enclave.
        </li>
        <li>
          <b>Open the NASA market.</b> It was proposed, disputed twice, and escalated. Staked participants submitted NASA press releases as evidence on both sides.
          Read the AI's verdict, its confidence, and how it rated each piece of evidence.
          {hasMarkets && (
            <>
              {' '}
              <button className="link" onClick={() => onOpenMarket(1n)}>
                Open market #1 →
              </button>
            </>
          )}
        </li>
        <li>
          <b>Click "🔍 Verify this resolution".</b> Your browser recomputes the signed digest, recovers the enclave signer, checks it is registered on-chain, checks the
          inference-enclave attestation and the pinned model weights, and re-hashes the full transcript.
        </li>
        <li className="muted">
          Optional: connect a wallet with Base Sepolia test ETH and walk the open market through propose → dispute → dispute → evidence yourself.
        </li>
      </ol>
    </section>
  );
}
