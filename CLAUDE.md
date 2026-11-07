# AI Settlement Oracle — Project Context

## Overview
A verifiable AI oracle for prediction market resolution using TEE (Confidential.ai), The Guardian + GDELT news sources, with configurable confidence thresholds and delayed resolution for ambiguous cases.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     SMART CONTRACT (Solidity)                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Market    │  │  Evidence   │  │   Resolution Status   │  │
│  │   Struct    │  │   Array     │  │  PENDING/DELAYED/OK   │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ↑
                              │ EIP-712 attestation + evidence
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     ORACLE SERVICE (Node.js/TS)                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Guardian  │  │    GDELT    │  │   AI Analysis         │  │
│  │    API      │  │    API      │  │  Confidence Scoring   │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│                              ↓                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Confidential.ai TEE (Optional)                │   │
│  │     Remote attestation + measured execution              │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↑
                              │ WebSocket/HTTP
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     FRONTEND (Next.js/React)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Market    │  │  Evidence   │  │   Delay Status        │  │
│  │   Creator   │  │   Explorer  │  │  Countdown + Reason     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Smart Contract | Solidity 0.8.x, Hardhat |
| Oracle Service | Node.js, TypeScript, ethers.js |
| News Sources | The Guardian API, GDELT API |
| AI Analysis | OpenAI/Anthropic API (verifiable via TEE) |
| Verification | Confidential.ai TEE (optional), EIP-712 |
| Frontend | Next.js 14, Tailwind, wagmi/viem |

## Key Design Decisions

### Confidence Thresholds
- Configurable per market (default: 0.7)
- AI returns confidence 0.0-1.0
- Below threshold → DELAYED_FOR_EVIDENCE status

### Delay Mechanism
- Max 3 automatic retries
- After 3 delays → PAUSED_FOR_MANUAL (requires manual override)
- Rationale: Resolution falls to parent company, their actions determine liability

### Evidence Format
```typescript
interface Evidence {
  source: string;        // "The Guardian", "GDELT"
  url: string;           // Direct article URL
  title: string;
  publishedAt: string;   // ISO timestamp
  hash: string;          // SHA256 of content
  snippet: string;       // First 500 chars (if available)
  retrievedAt: string;   // When oracle fetched
}
```

### TEE Integration
- Optional but included
- Use Confidential.ai for attestation
- Fallback: EIP-712 signature without TEE

### News Source Priority
1. The Guardian API (primary)
2. GDELT (secondary, broader coverage)
3. Combined analysis for confidence scoring

## File Structure

```
ai-settlement-oracle/
├── contracts/
│   ├── SettlementOracle.sol      # Main oracle contract
│   ├── EvidenceVerifier.sol      # EIP-712 verification
│   └── interfaces/
├── oracle-service/
│   ├── src/
│   │   ├── index.ts              # Entry point
│   │   ├── news/
│   │   │   ├── guardian.ts       # Guardian API client
│   │   │   ├── gdelt.ts          # GDELT API client
│   │   │   └── aggregator.ts     # Combined fetch + dedupe
│   │   ├── ai/
│   │   │   ├── analyzer.ts       # AI confidence analysis
│   │   │   └── prompts.ts        # System prompts
│   │   ├── tee/
│   │   │   └── confidential.ts   # TEE attestation wrapper
│   │   ├── attestation/
│   │   │   └── signer.ts         # EIP-712 signing
│   │   └── types.ts              # Shared types
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── app/
│   │   ├── page.tsx              # Market list
│   │   ├── market/[id]/page.tsx  # Market detail + evidence
│   │   └── create/page.tsx       # Market creation
│   ├── components/
│   │   ├── EvidenceViewer.tsx
│   │   ├── DelayStatus.tsx
│   │   └── AttestationVerifier.tsx
│   └── package.json
└── README.md
```

## Environment Variables

```bash
# Oracle Service
GUARDIAN_API_KEY=...
GDELT_API_KEY=...
OPENAI_API_KEY=...           # Or ANTHROPIC_API_KEY
CONFIDENTIAL_API_KEY=...     # Optional TEE
PRIVATE_KEY=...              # For EIP-712 signing
RPC_URL=...                  # e.g., Sepolia or local

# Frontend
NEXT_PUBLIC_CONTRACT_ADDRESS=...
NEXT_PUBLIC_RPC_URL=...
```

## Commands

```bash
# Contracts
npm run compile
npm run test
npm run deploy:sepolia

# Oracle Service
npm run build
npm run start
npm run dev          # Watch mode

# Frontend
npm run dev          # localhost:3000
npm run build
```

## Code Standards

- TypeScript strict mode
- 2-space indentation
- Explicit return types on public functions
- Error handling with typed errors
- No `any` types
- Comments for complex logic

## Testing Strategy

- Unit tests for contract functions
- Integration tests for oracle service
- Mock news API responses
- Test delay/retry logic
- Verify EIP-712 signatures
