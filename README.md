# AI Settlement Oracle

A verifiable AI oracle for prediction markets. For each market it:

1. **Reads the settlement conditions.** The market's rules (question, YES/NO conditions, notes, evidence window, accepted sources, search queries) are stored on-chain, and every decision commits to their hash.
2. **Sources evidence from trusted outlets.** It queries The Guardian, GDELT (limited to Reuters, AP, BBC, NPR, NASA, Nature and Science) and nasa.gov, keeps only trusted domains inside the evidence window, and hashes the exact text it will show the model.
3. **Decides.** Claude applies the rules to those sources and returns YES, NO or INSUFFICIENT_EVIDENCE, with a confidence score, a per-condition assessment and reasoning that cites source ids. **There is no stored or default answer.** If the evidence is thin, or confidence is below the market's threshold, the market is delayed and the oracle automatically looks again when the on-chain delay ends. After three delays it pauses for a manual decision by the contract owner.
4. **Signs and publishes.** The oracle signs an EIP-712 attestation binding the decision to the rules hash, the evidence hash, the decision-logic hash and the full report hash. It then posts the decision logic, every source (URL + SHA-256) and the signature to the `SettlementOracle` contract, which rejects anything that does not match.
5. **Lets anyone verify.** The demo's **Verify independently** button works in the browser without trusting the oracle service. It recomputes every hash, rebuilds the exact model input, recovers the signer, and compares the result with the events the contract emitted. `npm run verify` does the same from the command line.

The demo market is *"Will NASA find definitive evidence of extraterrestrial life in 2025?"* Its outcome comes from whatever the sources say at run time.

## Architecture

```
 demo/ (React + Vite)                 oracle/ (Node + Express)                    contracts/ (Foundry)
┌──────────────────────┐  HTTP/SSE  ┌─────────────────────────────────────┐  tx   ┌──────────────────────────┐
│ market + conditions  │──────────▶ │ 1 rules     read spec, check chain  │──────▶│ SettlementOracle         │
│ live pipeline view   │ ◀───────── │ 2 sourcing  Guardian · GDELT · NASA │       │  • rules stored on-chain │
│ decision + sources   │            │ 3 evidence  filter, hash (sha256)   │       │  • verifies EIP-712 sig  │
│ verify in browser ───┼──── RPC ──▶│ 4 decision  Claude, structured JSON │       │  • recomputes evidence & │
└──────────────────────┘            │ 5 attest    EIP-712 signature       │       │    reasoning hashes      │
          ▲                         │ 6 publish   submitResolution()      │       │  • delay ×3 → pause      │
          └── shared/ (hashing, EIP-712 types, prompt, verifier) ───────┘       │  • emits logic + sources │
                                                                                 └──────────────────────────┘
```

`shared/` holds everything that both the oracle and an independent verifier must agree on: canonical JSON, the hash definitions, the EIP-712 types, the prompt and input builder, and the verifier itself.

## What the signature commits to

| Field | Meaning | Checked by |
|---|---|---|
| `rulesHash` | keccak256 of the market's canonical rules document | contract (must equal stored rules) |
| `evidenceHash` | keccak256 over `(keccak256(url), sha256(text))` for each source | contract (recomputed from posted sources) |
| `reasoningHash` | keccak256 of the decision logic (canonical JSON: verdict, conditions, reasoning, citations, served model, prompt hash, input hash, oracle adjustments) | contract (recomputed from posted logic) |
| `reportHash` | keccak256 of the full report body | verifier |
| `decision`, `confidenceBps` | verdict and confidence | contract (delay/settle rule) |
| `attempt`, `timestamp` | replay protection and decision time | contract |

## Quick start

Prerequisites: Node 20+, [Foundry](https://getfoundry.sh) (`forge`, `anvil`), an Anthropic API key, and optionally a free [Guardian API key](https://open-platform.theguardian.com/access/).

```bash
git clone --recurse-submodules <repo-url> && cd AI-Settlement-Oracle
npm install
(cd contracts && forge build)

anvil                                   # terminal 1: local chain
cp oracle/.env.example oracle/.env      # set ANTHROPIC_API_KEY (and GUARDIAN_API_KEY)
npm run oracle                          # terminal 2: deploys the contract, registers the market
npm run demo                            # terminal 3: http://localhost:5173
```

If you cloned without `--recurse-submodules`, run `git submodule update --init --recursive`.

**No API keys yet?** You can still check what the oracle would find. `npm run preview-sources` (or the **Preview sources** button in the demo) runs only the sourcing step with the Guardian's public test key. Nothing is sent to a model, signed or posted.

See **[BUILD_GUIDE.md](BUILD_GUIDE.md)** for the full walkthrough, configuration and deployment.

## Tests

```bash
cd contracts && forge test      # 23 tests: settle, delay, pause, manual override, tampering, replay, signer checks
npm test                        # shared (10): hashing, prompt escaping, verifier tamper detection
                                # oracle: parsing, evidence selection, decision validation, and an end-to-end
                                # pipeline test against a local Anvil chain (needs anvil + forge build)
```

CI (`.github/workflows/ci.yml`) runs all of the above, checks the generated ABI is current, and builds the demo.

The end-to-end test swaps the news providers and the model for deterministic test doubles. The running service never uses them.

## API

| Endpoint | Description |
|---|---|
| `GET /health` | Model, chain and key status |
| `GET /config` | Chain id, contract, RPC URL for browser verification |
| `GET /markets` | Market rules, on-chain state, past reports |
| `POST /markets/:slug/resolve` | Start a resolution (returns `runId`; 503 without an Anthropic key) |
| `POST /markets/:slug/preview-sources` | Run only sourcing and evidence selection: no model, no signature, no transaction |
| `GET /runs/:id/events` | Live pipeline events (Server-Sent Events) |
| `GET /reports/:id` | Full signed report (JSON) |
| `GET /reports/:id/verify` | Server-side run of the same verifier |

## Limits and trust assumptions

- **The verification proves integrity, not correctness.** It proves which rules, sources and logic produced a decision, and that an authorized key signed it. It does not prove the model reasoned well. Anyone can read the posted logic and sources and judge that.
- **The oracle operator is trusted to run the code as published.** Running the oracle inside a TEE (see `NOTES.md`) would extend the proof to the code and model. That is not implemented.
- **The news integrations have not yet been run against the live APIs.** They were built from the providers' documented formats in an environment that could not reach them. Run `npm run preview-sources` first and check each provider's status.
- **Coverage depends on the sources.** GDELT's DOC API may not return results for dates far in the past, and some outlets block automated fetches or paywall text. Every provider error is recorded in the report rather than hidden.
- **On-chain storage.** Decision logic and source URLs live in event logs. Full source text lives in the signed report, and its hashes are on-chain.

## Repository layout

```
contracts/   SettlementOracle.sol, tests, deploy script (Foundry; deps as git submodules)
shared/      hashing, EIP-712 types, prompt + input builder, verifier, generated ABI
oracle/      Express service: news providers, Claude decision, chain bootstrap, pipeline, reports
demo/        React single-page demo
scripts/     export-abi.mjs (regenerates shared/src/abi.ts after `forge build`)
```

`PROMPT.md`, `claude-prompt.md`, `CLAUDE_CODE_GUIDE.md` and `NOTES.md` are the original planning documents and are kept for reference. The code above supersedes their implementation details: in particular, the demo no longer has a hardcoded outcome.

## License

MIT
