# AI Settlement Oracle — Project Context

Verifiable AI oracle for prediction-market settlement. Pipeline: read the market's settlement
rules → source evidence from trusted outlets (The Guardian, GDELT limited to trusted domains,
nasa.gov) → Claude decides YES / NO / INSUFFICIENT_EVIDENCE → EIP-712 attestation → post the
decision logic, sources and signature to `SettlementOracle` → anyone can verify.

**Core rule: no stored or default outcomes.** Every verdict must come from the model applied to
the sources retrieved in that run. With no evidence, the result is INSUFFICIENT_EVIDENCE (delay),
never a guess. Test doubles for providers and the model are allowed only in tests.

## Layout

| Path | What |
|---|---|
| `contracts/` | Foundry. `src/SettlementOracle.sol`, `test/`, `script/Deploy.s.sol`. Deps are git submodules in `lib/`. |
| `shared/` | Canonical JSON, hash definitions, EIP-712 types, prompt + input builder, verifier, generated ABI. Used by oracle and demo. |
| `oracle/` | Express service (`src/server.ts`), pipeline (`src/pipeline.ts`), providers (`src/news/`), Claude call (`src/ai/decide.ts`), chain bootstrap (`src/chain.ts`), market specs (`src/markets.ts`). |
| `demo/` | React + Vite single page; live pipeline over SSE; in-browser verification. |
| `scripts/export-abi.mjs` | Regenerates `shared/src/abi.ts` after `forge build`. |

## Key invariants (keep TS and Solidity in sync)

- `rulesHash = keccak256(rulesText)`, where `rulesText = canonicalJson(spec minus slug)` and is stored on-chain.
- `contentHash = sha256(text the model read)`.
- `evidenceHash = keccak256(concat(keccak256(abi.encode(keccak256(url), contentHash))))`.
- `reasoning = canonicalJson(DecisionRecord)`; `reasoningHash = keccak256(reasoning)`.
- EIP-712 `Resolution(uint256 marketId,uint32 attempt,uint8 decision,uint16 confidenceBps,bytes32 rulesHash,bytes32 evidenceHash,bytes32 reasoningHash,bytes32 reportHash,uint64 timestamp)`, domain `SettlementOracle` / `1`.
- Decision codes: 0 insufficient, 1 YES, 2 NO. Delay when code 0 or `confidenceBps < threshold`; pause after 3 delays.
- Changing `SYSTEM_PROMPT`, `DECISION_SCHEMA` or `buildDecisionInput` changes `promptHash` / `inputHash` semantics; old reports then fail the "prompt template" check by design.

## Commands

```bash
cd contracts && forge build && forge test
node scripts/export-abi.mjs          # after contract changes
anvil                                # local chain
npm run oracle                       # needs ANTHROPIC_API_KEY in oracle/.env
npm run demo
npm test --workspace=oracle          # includes Anvil integration test
npm run typecheck
```

## Code standards

TypeScript strict, 2-space indent, no `any`, typed errors, explicit handling of provider failures
(record them in the report; never hide them). Model: `claude-opus-5-5` by default via
`ANTHROPIC_MODEL`.
