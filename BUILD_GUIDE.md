# AI Settlement Oracle — Build Guide

Setup, demo walkthrough, configuration and deployment.

---

## Prerequisites

- **Node.js 22+** and npm
- **Foundry** (`forge`, `anvil`): `curl -L https://foundry.paradigm.xyz | bash && foundryup`, or `npm i -g @foundry-rs/forge @foundry-rs/anvil`
- **Anthropic API key**: required. The oracle will not resolve without a model.
- **Guardian API key**: optional but recommended (free at https://open-platform.theguardian.com/access/). Without one it uses the public, rate-limited `test` key.

---

## 1. Install and build

```bash
git clone --recurse-submodules https://github.com/alecwaj/AI-Settlement-Oracle.git
cd AI-Settlement-Oracle
npm run setup                     # npm install + forge build + ABI export
(cd contracts && forge test)
```

`forge build` must run before the oracle starts: the oracle deploys the compiled contract to your local chain.

After changing the contract, regenerate the TypeScript ABI:

```bash
node scripts/export-abi.mjs
```

## 2. Check the news sources (no keys needed)

```bash
npm run preview-sources
```

This runs only the sourcing step for the demo market and prints each provider's status and the sources a resolution would use. It uses the Guardian's public `test` key unless `GUARDIAN_API_KEY` is set. Nothing is sent to a model, signed or posted. The demo's **Preview sources** button does the same.

## 3. Configure the oracle

```bash
cp oracle/.env.example oracle/.env
```

Set at least `ANTHROPIC_API_KEY`. Every option is documented in `oracle/.env.example`.

## 4. Run

```bash
anvil                 # terminal 1
npm run oracle        # terminal 2 (http://localhost:3001)
npm run demo          # terminal 3 (http://localhost:5173)
```

On first start the oracle:
1. connects to Anvil,
2. deploys `SettlementOracle` with the oracle signer authorized,
3. registers each market in `oracle/src/markets.ts` by storing its canonical rules on-chain,
4. saves the deployment to `oracle/data/deployment.31337.json`.

If you restart Anvil, the oracle notices the contract is gone and redeploys. Signed reports are saved in `oracle/data/reports/`.

---

## Demo walkthrough

### The market

**Will NASA find definitive evidence of extraterrestrial life in 2025?**

- **YES:** NASA officially announced, during 2025, living organisms, fossilised life, or a biosignature it presents as confirmed, unambiguous evidence of life beyond Earth.
- **NO:** NASA made no such announcement, or its 2025 findings were limited to precursor molecules, habitability indicators, or potential biosignatures it does not present as confirmed.
- **Notes** define "definitive", exclude media characterisations, and require NASA endorsement of third-party findings.
- **Evidence window:** 1 Jan 2025 to 31 Jan 2026. **Threshold to settle:** 70%.

The market is a good test of nuance: candidate or "potential" findings must be told apart from definitive ones.

### Running the oracle

Click **Run the oracle**. The pipeline view lights up as each real step completes, and the log streams what is happening:

| Step | What happens |
|---|---|
| **Rules** | Loads the market spec, checks its hash against the on-chain market, and checks the market accepts a resolution (not settled, not inside a delay). |
| **Sources** | Runs every search query against The Guardian (full article text from the API), GDELT (trusted outlets only, then fetches article text) and nasa.gov. Per-provider counts and errors appear under the node. |
| **Evidence** | Drops untrusted domains and anything outside the evidence window or undated, de-duplicates, ranks by relevance, truncates each text and computes its SHA-256. |
| **Decision** | Claude receives the rules and the sources and returns a structured verdict. The oracle validates it, removes citations to unknown sources and downgrades any YES/NO that cites no source to INSUFFICIENT_EVIDENCE. Every adjustment is recorded. If no evidence was retrieved at all, the model is not called and the result is INSUFFICIENT_EVIDENCE. |
| **Signature** | Builds the report, hashes it, and signs the EIP-712 `Resolution`. |
| **On-chain** | Calls `submitResolution` with the signed message, the decision logic and the sources. The contract re-derives the hashes, checks the signer, then settles or delays the market. |

A run takes from about 30 seconds to a few minutes, depending on news APIs and model latency.

### Reading the result

- **Settlement decision:** the verdict, confidence against the threshold, whether the market settled or was delayed, a per-condition assessment, and the decision logic with clickable source citations.
- **Sources:** every source the model saw, with outlet, date, link, the exact text it read and its SHA-256, plus each provider's errors and notes.
- **Cryptographic verification:** the attestation fields and the transaction. **Verify independently** runs 15 checks in your browser against the published report and the chain.

### Delays and automatic retries

If the verdict is INSUFFICIENT_EVIDENCE or confidence is below 70%, the contract marks the market **DELAYED** until `RETRY_DELAY_SECONDS` have passed (default 300). The oracle then runs again automatically, sourcing fresh evidence, and the demo picks up the new run live. Set `AUTO_RETRY=false` to retry by hand with **Run the oracle again**. Each retry is a new model call.

After three delays the market is **PAUSED**. Only the contract owner can then settle it:

```bash
cd oracle
npm run manual-resolve -- nasa-extraterrestrial-life-2025 NO "Reviewed the posted sources; no definitive announcement in 2025."
```

The manual decision and its reason are emitted on-chain (`ManualResolution`).

---

## Verifying a report from the command line

```bash
cd oracle
npm run verify -- data/reports/<report-id>.json --rpc http://127.0.0.1:8545
```

Without `--rpc` only the offline checks run (hashes, input reconstruction, signature).

---

## Adding a market

Add a `MarketSpec` to `oracle/src/markets.ts`. On the next start it is registered on-chain. Changing an existing spec changes its rules hash, so the oracle registers it as a new market rather than silently changing the rules of an existing one. The demo shows the first market.

---

## Deploying to a testnet

```bash
cd contracts
ORACLE_ADDRESS=<oracle signer address> RETRY_DELAY_SECONDS=3600 \
  forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC --broadcast --private-key $DEPLOYER_KEY
```

Then set `RPC_URL`, `CONTRACT_ADDRESS`, `DEPLOYER_PRIVATE_KEY` (the relayer that pays gas; the owner if markets need registering) and `ORACLE_PRIVATE_KEY` in `oracle/.env`. Never use the Anvil default keys outside a local chain; the service warns when it detects them.

---

## Testing

```bash
cd contracts && forge test -vv
npm test --workspace=oracle
npm run typecheck
```

The oracle's integration test starts its own Anvil on a random port, deploys from `contracts/out`, and runs the full pipeline (with test doubles for the news providers and the model) through delay, early-retry rejection, settlement and tamper detection. It is skipped if `anvil` or the build output is missing.

---

## Troubleshooting

| Issue | Fix |
|---|---|
| `contract artifact not found` | Run `forge build` in `contracts/`. |
| `cannot reach an Ethereum node` | Start `anvil`, or set `RPC_URL`. |
| Run button disabled with a key warning | Set `ANTHROPIC_API_KEY` in `oracle/.env` and restart the oracle. |
| A provider shows errors | Open the provider row under **Sources** to see the error. Guardian errors usually mean a missing or rate-limited key. GDELT may not cover old dates. Some outlets block automated fetches. |
| Behind an HTTP proxy | Node's `fetch` ignores proxy variables by default. Start the oracle with `NODE_USE_ENV_PROXY=1`. |
| Browser verification fails at "Read the chain" | The browser must reach the RPC URL. Set `PUBLIC_RPC_URL` if it differs from `RPC_URL`. |
