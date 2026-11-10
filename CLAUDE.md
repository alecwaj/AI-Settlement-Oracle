# AI Settlement Oracle: project context for Claude Code

MVP of ORA's "AI Settlement Oracle" design: an optimistic-oracle prediction market where twice-disputed markets are resolved by an AI arbiter. Verifiability comes from TEEs (chosen over opML/zkML as the most achievable route today). The oracle runs in an Intel TDX CVM (dstack / Phala Cloud). Inference runs in Confidential AI's TDX + confidential-GPU enclaves (default model `deepseek-ai/DeepSeek-V4.1-Flash-1017`), reached through the TEErminator verifying proxy. README.md has the concept, trust model and API. BUILD_GUIDE.md has the runbook.

## Layout
- `contracts/`: Foundry. `src/SettlementOracle.sol` (single contract), `test/SettlementOracle.t.sol`, `script/Deploy.s.sol`. Deps are git submodules in `contracts/lib`.
- `oracle/`: Node 20+/TypeScript ESM (NodeNext). `tee.ts` (dstack key + quotes, dev fallback), `inference-attestation.ts` (TEErminator verdict + allowlist model pins), `resolver.ts` (ConfidentialResolver via `openai` SDK + strict json_schema; AnthropicResolver; MockResolver), `evidence.ts`, `oracle.ts` (orchestration + watcher), `server.ts` (Express).
- `demo/`: Vite + React + viem (no wagmi).
- `scripts/`: local demo (`demo-deploy`, `demo-seed`, `warp`, `export-abi.mjs`).
- `deploy/phala/docker-compose.yml`: TEE deployment. `oracle/Dockerfile` uses the repo root as build context.

## Commands
- `npm run build:contracts`: forge build + regenerate `oracle/src/abi.ts` and `demo/src/abi.ts`. Run this after **any** contract change.
- `npm test`: forge test + vitest.
- `npm run typecheck -w oracle`, `npm run build -w demo`.
- Local demo: `anvil`, `npm run demo:deploy`, `npm run dev:oracle`, `npm run demo:seed`, `npm run dev:demo`.

## Invariants: keep these in sync
- EIP-712 `Resolution` type: `RESOLUTION_TYPEHASH` in the contract == `RESOLUTION_TYPES` in `oracle/src/oracle.ts`. The oracle cross-checks against `resolutionDigest()` and fails loudly on drift.
- Rolling `submissionsHash`: `submitEvidence` in Solidity == `rollSubmissionsHash` in `oracle.ts`.
- Outcome enum `None=0, YES=1, NO=2, INVALID=3`; Status enum `Open, Proposed, Escalated, Resolved, PausedForManual`.
- Never sign a mock decision inside a real TEE (`config.ts` enforces this). Never sign on refusal, truncation or schema failure.
- In a real TEE `REQUIRE_ATTESTED_INFERENCE` defaults on: no signature unless TEErminator says `Verified` and the model is pinned in the attested allowlist. Keep it fail-closed.
- Always check live model IDs via `GET https://api.confidential.ai/v1/models`. The docs have lagged the live IDs before.

## Conventions
- TypeScript strict, 2-space indent, no `any` except at viem dynamic-call boundaries.
- Default arbiter: Confidential AI `deepseek-ai/DeepSeek-V4.1-Flash-1017`. Optional Anthropic mode uses `claude-opus-5-5`, adaptive thinking, `output_config.effort`, `fallbacks: 'default'`.
