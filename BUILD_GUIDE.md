# Build & Deployment Guide

Runbook for the AI Settlement Oracle MVP. See the [README](README.md) for the concept, architecture and trust model.

## 0. Prerequisites

- Node.js 20+ and npm
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `anvil`, `cast`)
- A Confidential AI API key: email hello@confidential.ai or use [request access](https://confidential.ai/request-access). An Anthropic key works for the non-attested dev mode.
- [TEErminator](https://github.com/confidential-dot-ai/TEErminator/releases) if you want attested inference locally. The Docker image bundles it.
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
LLM_MODE=confidential
CONFIDENTIAL_API_KEY=...
CONFIDENTIAL_MODEL=deepseek-ai/DeepSeek-V4.1-Flash-1017
CONFIDENTIAL_BASE_URL=https://api.confidential.ai/v1   # unattested smoke test; see below for TEErminator
REQUIRE_ATTESTED_INFERENCE=false
```

Time controls: the UI's **⏩ +2 min / +5 min** buttons, or `npm run demo:warp -- <seconds>`.

Walkthrough script (≈3 minutes):

1. The **Markets** list shows #1 *Escalated* (NASA 2025) and #2 *Open* (crewed Moon landing).
2. In #1, point out the criteria. "Potential" biosignatures explicitly resolve NO, and the evidence includes NASA's own Sep 2025 "potential biosignature" release, staked as YES.
3. Click **⏩ +5 min**. The oracle log prints `Market 1 ready for AI resolution`, and the UI shows the round with outcome, confidence, reasoning and per-evidence assessment.
4. Open **Attestation**, then **🔍 Verify this resolution** to show the digest, signature, registration, quote and transcript checks.
5. Switch *Acting as* to the winning submitters and **Claim**.

### Attested inference locally (TEErminator)

Run the same verifying proxy the production image uses:

```bash
# macOS arm64 example; checksums are in the release's checksums.txt
gh release download v0.0.4 -R confidential-dot-ai/TEErminator -p 'teerminator_0.0.4_darwin_arm64.tar.gz'
tar -xzf teerminator_0.0.4_darwin_arm64.tar.gz teerminator

./teerminator remote add 127.0.0.1:8080 https://api.confidential.ai/ \
  --mode attest-lb --server-name api.confidential.ai \
  --measurements <MRTD> --rtmr 1=<RTMR1>,2=<RTMR2> --expected-rtmr3 <RTMR3> \
  --pin-policy sha256:<allowlist sha256> --tdx-tcb-status UpToDate
printf '%s' "$CONFIDENTIAL_API_KEY" | ./teerminator remote auth 127.0.0.1:8080 -
./teerminator start &
./teerminator status          # must show Verified for 127.0.0.1:8080
```

Then set `CONFIDENTIAL_BASE_URL=http://127.0.0.1:8080/v1`, `TEERMINATOR_BIN=$PWD/teerminator` and `REQUIRE_ATTESTED_INFERENCE=true` in `oracle/.env`. Use `curl localhost:3001/inference-attestation` to see the verdict, the allowlist sha256, and the pinned model revision.

The pin values (`<MRTD>` and the others) come from Confidential AI's reviewed release instructions. Their public docs don't list them.

### Optional: run the dstack code path with the simulator

```bash
npx phala simulator start                 # prints DSTACK_SIMULATOR_ENDPOINT
TEE_MODE=dstack DSTACK_SIMULATOR_ENDPOINT=<path> npm run dev:oracle
npm run demo:seed                         # re-register: the signer is now derived by dstack
```

## 2. Deploy the contract to Base Sepolia

1. Create a **fresh, test-only wallet**. Fund it with roughly 0.02 Base Sepolia ETH from any public faucet.
2. Fill in the root `.env`:

   ```bash
   cp .env.example .env
   #   RPC_URL=https://sepolia.base.org
   #   DEPLOYER_KEY=0x…        # the test-only wallet
   ```

3. Deploy:

   ```bash
   npm run build:contracts
   npm run testnet:deploy
   ```

This writes `deployments/base-sepolia.json` with the address, deploy block and parameters. Commit that file, because the README and the Vercel settings point at it.

The testnet profile uses cheap amounts (0.0005 ETH bond, 0.0001 ETH minimum stake), a 15-minute liveness window, a 5-minute evidence window and a 10-minute delay period. Edit `scripts/lib.ts` to change them. Transfer ownership to a multisig before any real use.

Alternative: `forge script script/Deploy.s.sol` takes the same parameters from env vars.

## 3. Deploy the oracle into a TEE (Phala Cloud)

### 3.1 Build a pinned image

CI (`.github/workflows/ci.yml`) builds and pushes `ghcr.io/<owner>/ai-settlement-oracle:{latest,<sha>}` on every push to `main`. To build by hand:

```bash
docker build -f oracle/Dockerfile -t ghcr.io/<owner>/ai-settlement-oracle:1.0.0 .
docker push ghcr.io/<owner>/ai-settlement-oracle:1.0.0
docker buildx imagetools inspect ghcr.io/<owner>/ai-settlement-oracle:1.0.0   # copy the sha256 digest
```

Edit `deploy/phala/docker-compose.yml` to reference `image: ghcr.io/<owner>/ai-settlement-oracle@sha256:<digest>`. The compose file is what the TEE measures, so a digest (rather than a mutable tag) is what makes the attestation meaningful.

### 3.2 Fill in the inference-enclave pins

Fill in the `REPLACE_WITH_…` values in `TEERMINATOR_REMOTE_ARGS` in `deploy/phala/docker-compose.yml` with the reviewed values for Confidential AI's current release: MRTD, RTMR1/RTMR2 and the RTMR3 seed. Also confirm the `--pin-policy` allowlist digest:

```bash
curl -s https://api.confidential.ai/allowlist -o allowlist.json && shasum -a 256 allowlist.json
jq -r '.workloads[] | .containers[]?.args.argv[]? | select(test("expected-(repository|revision)|served-model-name"))' allowlist.json | sort -u
```

The second command shows which model repository and revision that policy pins. The pins sit in the measured compose file, so anyone verifying the oracle's quote can see exactly which inference enclave policy it enforces. If the pins are missing, or TEErminator doesn't return `Verified`, the container exits before the oracle starts.

### 3.3 Deploy the CVM

```bash
cp deploy/phala/.env.example deploy/phala/.env    # CONFIDENTIAL_API_KEY, RPC_URL, CONTRACT_ADDRESS
phala login
phala deploy -n ai-settlement-oracle -c deploy/phala/docker-compose.yml -e deploy/phala/.env --wait
phala link
phala logs        # expect: "🔐 TEE identity ready (Intel TDX) — signer 0x…"
```

Values passed with `-e` are encrypted locally to the CVM's KMS public key. Phala, the host and the node operator never see the Anthropic key.

### 3.4 Verify, fund and register the signer

```bash
curl https://<cvm-endpoint>/attestation | jq '{mode, signer, composeHash, quoteHash: .bootQuote.quoteHash}'
curl https://<cvm-endpoint>/inference-attestation | jq '{attested, reason, pinnedRevision, allowlist: .publicEvidence.allowlistSha256}'
```

1. Paste `bootQuote.quote` into [proof.t16z.com](https://proof.t16z.com) and confirm it is a valid TDX quote.
2. Confirm `report_data` equals `keccak256("ai-settlement-oracle:signer:v1" ‖ signer)` followed by 32 zero bytes. This binds the key to the quote.
3. Confirm the quote's compose hash matches your committed `deploy/phala/docker-compose.yml`.
4. Fund the signer with gas: `cast send <signer> --value 0.05ether ...`
5. Register it:
   `cast send $CONTRACT "registerEnclaveSigner(address,bytes32,bytes32)" <signer> <composeHash> <quoteHash> --private-key $OWNER_KEY --rpc-url $RPC_URL`

The signer key is derived from the app's KMS root at path `ai-settlement-oracle/resolution-signer/v1`. It is stable across restarts of the same app, and changes if you deploy a new app or change the path. Re-register after any code change, because the new compose hash produces a new quote.

### 3.5 Seed the demo markets

Once the oracle is up, run:

```bash
ORACLE_URL=https://<cvm-endpoint> npm run testnet:seed
```

This does three things:

1. Registers the enclave signer from `GET /attestation`, skipping this if it's already registered with the same quote.
2. Funds the oracle signer and eight demo participant wallets from the deployer. The participant wallets are derived from `DEPLOYER_KEY`.
3. Seeds the markets:
   - **#1 NASA 2025** and **#2 JWST/K2-18b**, both escalated with staked evidence;
   - **#3**, left open for the interactive path.

The watcher resolves #1 and #2 about 5 minutes later. The script registers whatever signer the oracle reports and warns if the oracle isn't running in a real TDX enclave, so always check `GET /attestation` first.

## 4. Host the UI on Vercel

1. In Vercel, choose **Add New → Project**, import `alecwaj/AI-Settlement-Oracle`, and set **Root Directory** to `demo`. `demo/vercel.json` handles the install and build.
2. Under **Environment Variables**, set:

   | Variable | Value |
   |---|---|
   | `VITE_RPC_URL` | `https://sepolia.base.org` |
   | `VITE_ORACLE_URL` | `https://<cvm-endpoint>` (must be HTTPS; the Phala gateway URL is) |
   | `VITE_CONTRACT_ADDRESS` | from `deployments/base-sepolia.json` |
   | `VITE_DEPLOY_BLOCK` | `deployBlock` from the same file |
   | `VITE_CHAIN_NAME` | `Base Sepolia` |
   | `VITE_EXPLORER_URL` | `https://sepolia.basescan.org` |

3. Deploy. Then set `ALLOWED_ORIGINS` in the Phala compose file to your Vercel URL and redeploy the CVM. This step is optional; the default is `*`.
4. Put the Vercel URL in the README's **Live demo** line. `https://<app>.vercel.app/?market=1` deep-links straight to the NASA market.

Reviewers get read-only mode with no wallet. Verdicts are also read from contract events, so they stay visible even if the oracle is briefly offline.

## 5. Operating notes

- **Upgrades:** a new image means a new compose hash and a new quote. Register the new signer, then revoke the old one.
- **Failures:** a round is recorded as failed and nothing is signed in any of these cases: the inference enclave isn't `Verified`, the model isn't pinned, or the output is truncated, filtered or off-schema. The watcher retries after 5 minutes, or you can call `POST /markets/:id/resolve`.
- **Spend caps:** `MAX_AI_CALLS_PER_DAY` (default 50) caps all model calls from the watcher and from manual triggers, and `RESOLVE_RATE_LIMIT_PER_HOUR` limits manual triggers per IP. `GET /health` shows `aiCallsRemainingToday`.
- **Costs:** one inference call per AI round, about 20–40k input tokens with three evidence pages. DeepSeek V4.1 Flash on Confidential AI is $0.30 per 1M input tokens and $1.20 per 1M output tokens (as of 2026-11-09).
- **Confidential AI releases:** when they rotate the allowlist or measurements, TEErminator stops verifying and the oracle stops signing (fail closed). Re-review the new values, update the compose file, redeploy, and re-register the signer.
- **Evidence hashes:** `contentHash` is keccak256 of the normalized extracted text, not of raw HTML, because pages embed per-request nonces. Submitters can commit `0x0` to skip the check. The transcript records the raw-bytes hash too.
