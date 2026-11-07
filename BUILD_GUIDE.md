# AI Settlement Oracle — Build Guide

Complete build and deployment guide for the AI Settlement Oracle demo.

---

## Project Structure

```
ai-settlement-oracle/
├── contracts/              # Foundry project
│   ├── src/
│   │   ├── SettlementOracle.sol      # Main oracle contract
│   │   └── AttestationRegistry.sol   # Batch verification
│   ├── test/
│   │   └── SettlementOracle.t.sol    # Contract tests
│   ├── script/
│   ├── foundry.toml
│   └── README.md
├── oracle/                 # TypeScript oracle service
│   ├── src/
│   │   ├── ai-resolver.ts           # AI resolution logic
│   │   ├── attestation.ts           # EIP-712 signing
│   │   └── server.ts                # Express API
│   ├── test/
│   ├── package.json
│   └── tsconfig.json
├── demo/                   # React frontend (Vite)
│   ├── src/
│   │   ├── components/
│   │   │   ├── MarketDetail.tsx     # Market view + resolution
│   │   │   ├── MarketForm.tsx       # Create market
│   │   │   └── MarketList.tsx       # List all markets
│   │   ├── App.tsx
│   │   ├── types.ts
│   │   └── wagmi.ts
│   ├── public/
│   ├── index.html
│   └── package.json
├── shared/                 # Shared types/interfaces
├── README.md
├── NOTES.md                # Design decisions & research
├── PROMPT.md               # Original build specification
└── BUILD_GUIDE.md          # This file
```

---

## Prerequisites

- **Node.js** 18+ with npm/pnpm
- **Foundry** (forge, anvil, cast) — install via `curl -L https://foundry.paradigm.xyz | bash`
- **Git** for version control

---

## Quick Start

### 1. Clone and Install

```bash
git clone <repo-url>
cd ai-settlement-oracle

# Install root dependencies
npm install

# Install contract dependencies
cd contracts && forge install

# Install oracle dependencies
cd ../oracle && npm install

# Install demo dependencies
cd ../demo && npm install
```

### 2. Start Local Chain

```bash
cd contracts
anvil
```

Keep this terminal running. Anvil creates a local Ethereum node with test accounts.

### 3. Deploy Contracts

```bash
cd contracts
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Copy the deployed contract address for the frontend.

### 4. Start Oracle Service

```bash
cd oracle
npm run dev
```

Oracle runs on `http://localhost:3001`.

### 5. Start Demo Frontend

```bash
cd demo
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Demo Walkthrough

The demo showcases a **verifiable AI oracle** resolving prediction markets with cryptographic attestations.

### Demo Scenario: Ambiguous Market Resolution

**Market Question:** "Will Ethereum trade above $4,000 by December 31, 2024?"

**Resolution Criteria:** "Based on Coinbase daily close price. If price is exactly $4,000, resolves NO."

### Demo Flow

#### Step 1: Create Market

1. Click **"Create Market"** tab
2. Enter question and resolution criteria
3. Set resolution time (use a past date for immediate testing)
4. Submit — market appears in list

#### Step 2: View Market Detail

1. Click on market in list
2. See market details:
   - Question
   - Resolution criteria
   - Resolution time
   - Current status: **PENDING**

#### Step 3: Trigger AI Resolution

1. Click **"Resolve with AI"**
2. Oracle service processes:
   - Analyzes market question
   - Generates deterministic outcome (YES/NO/INVALID)
   - Calculates confidence score
   - Produces reasoning text
   - Gathers mock evidence
3. UI updates with:
   - **Outcome:** YES/NO/INVALID
   - **Confidence:** 75.3% (example)
   - **Reasoning:** Full AI explanation
   - **Evidence:** Simulated data sources

#### Step 4: Create Cryptographic Attestation

1. Click **"Create Attestation"**
2. Oracle signs resolution with EIP-712:
   - Structured data: marketId, outcome, timestamp, reasoning hash
   - Cryptographic signature generated
   - Signer address recorded
3. UI displays:
   - **Signer:** 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
   - **Signature:** 0x7f8d9... (truncated)
   - **Full attestation:** JSON view of signed data

#### Step 5: Verify On-Chain (Optional)

1. Copy attestation data
2. Use contract's `verifyAttestation()` function
3. Confirmation: signature valid, signer authorized

---

## Demo Features

### Visual Design

- **Dark theme** with purple/blue accents
- **Clean, minimal UI** — no visual overload
- **Card-based layout** for markets
- **Status badges:** Pending (gray), Resolved (green), Delayed (yellow)

### Key Screens

| Screen | Purpose |
|--------|---------|
| Market List | Browse all markets, filter by status |
| Market Detail | View question, trigger resolution, see results |
| Resolution View | Outcome, confidence, reasoning, evidence |
| Attestation View | Cryptographic proof of AI decision |
| Create Market | Form for new prediction markets |

### Resolution States

```
PENDING → [AI Resolve] → RESOLVED (with attestation)
   ↓
DELAYED_FOR_EVIDENCE → [Retry] → RESOLVED or PAUSED
```

---

## What the Demo Shows

### 1. Verifiable AI Decisions
- Every resolution produces a cryptographic attestation
- EIP-712 structured data signing
- On-chain verifiable

### 2. Confidence Scoring
- AI returns confidence 0.0-1.0
- Below threshold → delayed for more evidence
- Transparent reasoning shown to users

### 3. Evidence Chain
- Mock evidence sources (Coinbase API, timestamps)
- In production: The Guardian, GDELT news APIs
- Each source hashed and timestamped

### 4. Delay Mechanism
- Ambiguous markets don't get forced resolutions
- Automatic retry with countdown
- Manual override after max retries

---

## Production Enhancements

### News Sources (To Implement)

Replace mock evidence with real APIs:

```typescript
// oracle/src/news/guardian.ts
// oracle/src/news/gdelt.ts
// oracle/src/news/aggregator.ts
```

**Guardian API:** Free tier, high reliability
**GDELT API:** Free, global event coverage
**Perplexity API:** Aggregated sources with citations

### TEE Integration (Optional)

For maximum verifiability, run AI inside a TEE:

```typescript
// oracle/src/tee/confidential.ts
// Proxy requests through Confidential.ai
// Remote attestation proves code integrity
```

**Benefits:**
- Proves AI model weights weren't tampered
- Proves code ran exactly as reviewed
- Hardware-isolated execution

### Smart Contract Deployment

**Testnet (Sepolia):**
```bash
forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC --broadcast --private-key $PRIVATE_KEY
```

**Mainnet:**
- Use same deploy script
- Verify on Etherscan
- Set up oracle signer address

---

## Environment Variables

Create `.env` files:

### Oracle Service (`oracle/.env`)
```bash
# Required
ORACLE_PRIVATE_KEY=0x...  # For EIP-712 signing
RPC_URL=http://localhost:8545

# Optional (for real news sources)
GUARDIAN_API_KEY=...
GDELT_API_KEY=...
OPENAI_API_KEY=...        # For AI analysis
CONFIDENTIAL_API_KEY=...  # For TEE mode
```

### Frontend (`demo/.env`)
```bash
VITE_CONTRACT_ADDRESS=0x...  # Deployed SettlementOracle
VITE_RPC_URL=http://localhost:8545
VITE_ORACLE_API=http://localhost:3001
```

---

## Testing

### Contract Tests
```bash
cd contracts
forge test
```

### Oracle Tests
```bash
cd oracle
npm test
```

### Manual Test Script

1. Start anvil
2. Deploy contracts
3. Start oracle
4. Start demo
5. Create market
6. Resolve market
7. Verify attestation

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Failed to fetch markets" | Ensure oracle is running on port 3001 |
| "Contract not found" | Deploy contracts and update .env |
| "Signature invalid" | Check oracle private key matches contract |
| CORS errors | Oracle has `cors()` enabled — check ports |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     FRONTEND (React + Vite)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Market    │  │  Resolution │  │   Attestation         │  │
│  │   List      │  │  Trigger    │  │   Display             │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP/WebSocket
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     ORACLE SERVICE (Node.js)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   AI        │  │  Evidence   │  │   EIP-712               │  │
│  │   Resolver  │  │  Fetcher    │  │   Signing               │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ JSON-RPC
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     SMART CONTRACT (Solidity)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Market    │  │  Resolution │  │   Attestation           │  │
│  │   Storage   │  │  Logic      │  │   Verification          │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Next Steps

1. **Add real news APIs** — Guardian, GDELT integration
2. **Implement delay/retry logic** — 3 automatic retries
3. **Add TEE support** — Confidential.ai integration
4. **Deploy to testnet** — Sepolia for public demo
5. **Build evidence explorer** — Show source articles

---

## Resources

- **Foundry Docs:** https://book.getfoundry.sh/
- **Viem Docs:** https://viem.sh/
- **EIP-712:** https://eips.ethereum.org/EIPS/eip-712
- **Confidential.ai:** https://confidential.ai/

---

Built for Cosmos — demonstrating verifiable AI oracles for prediction markets.
