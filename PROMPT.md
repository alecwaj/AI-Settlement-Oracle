# AI Settlement Oracle — Build Prompt for Claude Code

## Mission
Build a complete, working AI oracle system for prediction market resolution. This is a demo for Brendan McCord at Cosmos — needs to be impressive, verifiable, and show sophisticated engineering.

## Core Requirements

### 1. Smart Contracts (Solidity/Hardhat)

Create `contracts/SettlementOracle.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract SettlementOracle {
    enum ResolutionStatus { PENDING, DELAYED_FOR_EVIDENCE, RESOLVED, PAUSED_FOR_MANUAL }
    enum Outcome { NONE, YES, NO }
    
    struct Evidence {
        string source;        // "The Guardian", "GDELT"
        string url;
        string title;
        string publishedAt;
        bytes32 contentHash;
        string snippet;       // First 500 chars
        uint256 retrievedAt;
    }
    
    struct Market {
        string question;
        uint256 resolutionTime;
        address creator;
        ResolutionStatus status;
        Outcome outcome;
        uint256 confidenceThreshold;  // Configurable per market (e.g., 700 = 0.7)
        uint256 delayCount;
        uint256 delayedUntil;
        Evidence[] evidence;
        bytes attestation;
        string reasoning;
    }
    
    mapping(uint256 => Market) public markets;
    uint256 public marketCount;
    
    // EIP-712 domain separator
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(uint256 marketId,bool outcome,uint256 confidence,string reasoning,uint256 timestamp)"
    );
    
    event MarketCreated(uint256 indexed marketId, string question, uint256 resolutionTime);
    event ResolutionDelayed(uint256 indexed marketId, string reason, uint256 retryAt);
    event MarketResolved(uint256 indexed marketId, Outcome outcome, uint256 confidence);
    event MarketPaused(uint256 indexed marketId, string reason);
    
    function createMarket(
        string calldata question,
        uint256 resolutionTime,
        uint256 confidenceThreshold  // 0-1000 (0.0-1.0)
    ) external returns (uint256 marketId);
    
    function submitResolution(
        uint256 marketId,
        Outcome outcome,
        uint256 confidence,         // 0-1000
        string calldata reasoning,
        Evidence[] calldata evidence,
        bytes calldata attestation  // EIP-712 signature
    ) external;
    
    function verifyAttestation(
        uint256 marketId,
        Outcome outcome,
        uint256 confidence,
        string calldata reasoning,
        uint256 timestamp,
        bytes calldata signature
    ) external view returns (bool valid, address signer);
    
    // View functions for frontend
    function getMarket(uint256 marketId) external view returns (Market memory);
    function getEvidence(uint256 marketId) external view returns (Evidence[] memory);
}
```

Key logic:
- `submitResolution`: If confidence < threshold, increment delayCount and emit ResolutionDelayed. If delayCount >= 3, set status to PAUSED_FOR_MANUAL.
- `verifyAttestation`: EIP-712 signature verification using DOMAIN_SEPARATOR and ATTESTATION_TYPEHASH.
- Store full evidence array on-chain (gas is acceptable for demo).

### 2. Oracle Service (Node.js/TypeScript)

Create the following files in `oracle-service/src/`:

**types.ts** — Shared TypeScript interfaces matching Solidity structs.

**news/guardian.ts** — Guardian API client:
- Search articles by keywords
- Return structured Evidence format
- Handle rate limits and errors

**news/gdelt.ts** — GDELT API client:
- Query GDELT API for global events
- Parse and normalize to Evidence format

**news/aggregator.ts** — Combined fetcher:
- Query both sources
- Deduplicate by URL
- Return array of Evidence

**ai/analyzer.ts** — AI confidence analysis:
```typescript
interface AnalysisResult {
  outcome: 'YES' | 'NO' | 'DELAY';
  confidence: number;  // 0.0-1.0
  reasoning: string;
  delayReason?: string;
}

// Use OpenAI/Anthropic API
// System prompt should instruct AI to:
// 1. Evaluate evidence quality and recency
// 2. Determine if question is answerable
// 3. Return confidence score
// 4. If confidence < threshold, return DELAY with reason
```

**ai/prompts.ts** — System prompts for AI analysis.

**attestation/signer.ts** — EIP-712 signing:
- Sign attestation data using private key
- Return signature bytes

**tee/confidential.ts** — TEE wrapper (optional but include):
- If CONFIDENTIAL_API_KEY exists, proxy through TEE
- Otherwise, use standard API with EIP-712 fallback

**index.ts** — Main service:
- Poll for markets at resolutionTime
- Fetch evidence
- Run AI analysis
- Submit resolution or delay
- Handle retry scheduling

### 3. Frontend (Next.js 14 + Tailwind)

Create in `frontend/`:

**app/page.tsx** — Market list:
- Show all markets with status
- Filter by status
- Link to detail view

**app/market/[id]/page.tsx** — Market detail:
- Display question, status, resolution time
- Evidence viewer (collapsible sources)
- AI reasoning display
- Delay status with countdown if applicable
- Attestation verification button

**app/create/page.tsx** — Market creation:
- Form for question, resolution time
- Confidence threshold slider (0.5-0.95)
- Submit to create market

**components/EvidenceViewer.tsx** — Show evidence with:
- Source badges (Guardian/GDELT)
- Article links
- Content hashes
- Retrieval timestamps

**components/DelayStatus.tsx** — Show:
- Current delay count (0-3)
- Time until retry
- Reason for delay
- "Requires manual override" if paused

**components/AttestationVerifier.tsx** — Verify EIP-712 signatures on-chain.

### 4. Configuration Files

Create:
- `contracts/hardhat.config.ts`
- `oracle-service/package.json` and `tsconfig.json`
- `frontend/package.json` and `next.config.js`
- Root `README.md` with setup instructions

## Build Priorities

1. **P0:** Smart contracts compile and deploy
2. **P0:** Oracle service can fetch news and submit resolutions
3. **P0:** Frontend displays markets and evidence
4. **P1:** EIP-712 attestation working
5. **P1:** Delay mechanism with 3 retries
6. **P2:** TEE integration stub (ready for Confidential.ai)

## Testing Checklist

- Create market with 0.7 threshold
- Submit low-confidence resolution → should DELAY
- Submit high-confidence resolution → should RESOLVE
- After 3 delays → PAUSED_FOR_MANUAL
- Evidence viewer shows Guardian + GDELT sources
- Attestation verification passes

## Notes

- Use Hardhat for local development
- Use Sepolia for testnet deployment
- Mock news APIs if keys not available (but code should support real APIs)
- Include `.env.example` files
- Write clear README with architecture diagram
