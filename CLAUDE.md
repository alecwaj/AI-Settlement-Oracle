# AI Settlement Oracle: project context for Claude Code

MVP of ORA's "AI Settlement Oracle" design: an optimistic-oracle prediction market where twice-disputed markets are resolved by Claude running behind an Intel TDX TEE (dstack / Phala Cloud). README.md has the concept, trust model and API. BUILD_GUIDE.md has the runbook.

## Layout
- `contracts/`: Foundry. `src/SettlementOracle.sol` (single contract), `test/SettlementOracle.t.sol`, `script/Deploy.s.sol`. Deps are git submodules in `contracts/lib`.
- `oracle/`: Node 20+/TypeScript ESM (NodeNext). `tee.ts` (dstack key + quotes, dev fallback), `resolver.ts` (Claude via `@anthropic-ai/sdk` `beta.messages.parse` + Zod), `evidence.ts`, `oracle.ts` (orchestration + watcher), `server.ts` (Express).
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

## Conventions
- TypeScript strict, 2-space indent, no `any` except at viem dynamic-call boundaries.
- Model default `claude-opus-5-5`, adaptive thinking, `output_config.effort`, server-side `fallbacks: 'default'`.
