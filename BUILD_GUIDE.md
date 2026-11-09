# Build & Deployment Guide

Runbook for the AI Settlement Oracle MVP. See the [README](README.md) for the concept, architecture and trust model.

## 0. Prerequisites

- Node.js 20+ and npm
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `anvil`, `cast`)
- An Anthropic API key ([console.anthropic.com](https://console.anthropic.com))
- For TEE deployment: Docker, a container registry (GHCR works), and a [Phala Cloud](https://cloud.phala.com) account with the `phala` CLI (`npm i -g phala`)

```bash
git clone --recurse-submodules https://github.com/alecwaj/AI-Settlement-Oracle
cd AI-Settlement-Oracle
npm install
npm run build:contracts     # forge build + node scripts/export-abi.mjs
npm test                    # forge + vitest
```

If you cloned without submodules: `git submodule update --init --recursive`.

## 1. Local demo (anvil)

| Terminal | Command |
|---|---|
| 1 | `anvil` |
| 2 | `npm run demo:deploy` and then `npm run dev:oracle` |
| 3 | `npm run demo:seed` and then `npm run dev:demo`; open http://localhost:5173 |

`demo:deploy` uses short timings: 2-minute liveness, 5-minute evidence window, 3-minute delay, 3 max delays. It writes `deployments/local.json`, which both the oracle and the UI read.

`oracle/.env` for local work:

```bash
TEE_MODE=dev                          # no TEE locally; the UI shows a red "Dev mode" badge
ORACLE_DEV_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d   # anvil #1
LLM_MODE=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

Time controls: the UI's **⏩ +2 min / +5 min** buttons, or `npm run demo:warp -- <seconds>`.

Walkthrough script (≈3 minutes):

1. The **Markets** list shows #1 *Escalated* (NASA 2025) and #2 *Open* (crewed Moon landing).
2. In #1, point out the criteria. "Potential" biosignatures explicitly resolve NO, and the evidence includes NASA's own Sep 2025 "potential biosignature" release, staked as YES.
3. Click **⏩ +5 min**. The oracle log prints `Market 1 ready for AI resolution`, and the UI shows the round with outcome, confidence, reasoning and per-evidence assessment.
4. Open **Attestation**, then **🔍 Verify this resolution** to show the digest, signature, registration, quote and transcript checks.
5. Switch *Acting as* to the winning submitters and **Claim**.

### Optional: run the dstack code path with the simulator

```bash
npx phala simulator start                 # prints DSTACK_SIMULATOR_ENDPOINT
TEE_MODE=dstack DSTACK_SIMULATOR_ENDPOINT=<path> npm run dev:oracle
npm run demo:seed                         # re-register: the signer is now derived by dstack
```

## 2. Deploy the contract to a testnet

```bash
cd contracts
export RPC_URL=https://sepolia.base.org DEPLOYER_KEY=0x...
forge script script/Deploy.s.sol --rpc-url $RPC_URL --private-key $DEPLOYER_KEY --broadcast
```

Override the defaults with env vars: `PROPOSAL_BOND_WEI`, `MIN_EVIDENCE_STAKE_WEI`, `LIVENESS_SECONDS`, `EVIDENCE_WINDOW_SECONDS`, `DELAY_PERIOD_SECONDS`, `MAX_DELAYS`. Transfer ownership to a multisig before real use.

## 3. Deploy the oracle into a TEE (Phala Cloud)

### 3.1 Build a pinned image

CI (`.github/workflows/ci.yml`) builds and pushes `ghcr.io/<owner>/ai-settlement-oracle:{latest,<sha>}` on every push to `main`. To build by hand:

```bash
docker build -f oracle/Dockerfile -t ghcr.io/<owner>/ai-settlement-oracle:1.0.0 .
docker push ghcr.io/<owner>/ai-settlement-oracle:1.0.0
docker buildx imagetools inspect ghcr.io/<owner>/ai-settlement-oracle:1.0.0   # copy the sha256 digest
```

Edit `deploy/phala/docker-compose.yml` to reference `image: ghcr.io/<owner>/ai-settlement-oracle@sha256:<digest>`. The compose file is what the TEE measures, so a digest (rather than a mutable tag) is what makes the attestation meaningful.

### 3.2 Deploy the CVM

```bash
cp deploy/phala/.env.example deploy/phala/.env    # ANTHROPIC_API_KEY, RPC_URL, CONTRACT_ADDRESS
phala login
phala deploy -n ai-settlement-oracle -c deploy/phala/docker-compose.yml -e deploy/phala/.env --wait
phala link
phala logs        # expect: "🔐 TEE identity ready (Intel TDX) — signer 0x…"
```

Values passed with `-e` are encrypted locally to the CVM's KMS public key. Phala, the host and the node operator never see the Anthropic key.

### 3.3 Verify, fund and register the signer

```bash
curl https://<cvm-endpoint>/attestation | jq '{mode, signer, composeHash, quoteHash: .bootQuote.quoteHash}'
```

1. Paste `bootQuote.quote` into [proof.t16z.com](https://proof.t16z.com) and confirm it is a valid TDX quote.
2. Confirm `report_data` equals `keccak256("ai-settlement-oracle:signer:v1" ‖ signer)` followed by 32 zero bytes. This binds the key to the quote.
3. Confirm the quote's compose hash matches your committed `deploy/phala/docker-compose.yml`.
4. Fund the signer with gas: `cast send <signer> --value 0.05ether ...`
5. Register it:
   `cast send $CONTRACT "registerEnclaveSigner(address,bytes32,bytes32)" <signer> <composeHash> <quoteHash> --private-key $OWNER_KEY --rpc-url $RPC_URL`

The signer key is derived from the app's KMS root at path `ai-settlement-oracle/resolution-signer/v1`. It is stable across restarts of the same app, and changes if you deploy a new app or change the path. Re-register after any code change, because the new compose hash produces a new quote.

### 3.4 Point the UI at it

```bash
VITE_RPC_URL=$RPC_URL VITE_ORACLE_URL=https://<cvm-endpoint> VITE_CONTRACT_ADDRESS=$CONTRACT npm run build -w demo
```

On non-local chains, the UI uses an injected wallet such as MetaMask instead of anvil accounts.

## 4. Operating notes

- **Upgrades:** a new image means a new compose hash and a new quote. Register the new signer, then revoke the old one.
- **Failures:** if Claude refuses, truncates output or fails schema validation, the round is recorded as failed and nothing is signed. The watcher retries after 5 minutes, or you can call `POST /markets/:id/resolve`.
- **Costs:** one Claude call per AI round (Opus 5.5, adaptive thinking at `high` effort, about 20–40k input tokens with three evidence pages).
- **Evidence hashes:** `contentHash` is keccak256 of the normalized extracted text, not of raw HTML, because pages embed per-request nonces. Submitters can commit `0x0` to skip the check. The transcript records the raw-bytes hash too.
