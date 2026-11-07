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
│   │   ├── App.tsx                  # Single-page demo
│   │   ├── index.css                # Styles + animations
│   │   ├── main.tsx
│   │   └── types.ts
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

### 2. Start Oracle Service

```bash
cd oracle
npm run dev
```

Oracle runs on `http://localhost:3001`. The demo market (NASA astrobiology) is pre-loaded.

### 3. Start Demo Frontend

```bash
cd demo
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Demo Walkthrough

The demo showcases a **verifiable AI oracle** resolving a single thought-provoking prediction market with a 20-second animated visualization.

### Demo Market: NASA Astrobiology

**Question:** "Will NASA find definitive evidence of extraterrestrial life in 2025?"

**Resolution Criteria:** 
> Resolves YES if NASA officially announces discovery of living organisms, fossilized life, or unambiguous biosignatures from beyond Earth. Resolves NO if only precursor molecules (amino acids, organic compounds) are found, as these indicate potential for life but are not life itself.

### Demo Flow

#### Step 1: View the Market

- Single market card displayed on page load
- Shows question and resolution criteria
- Status: "Pending Resolution"

#### Step 2: Trigger Resolution

Click **"Resolve with Verifiable AI"** button.

#### Step 3: Watch the Processing Animation (20 seconds)

Visual network representation of the oracle operating:

**Network Nodes (left to right):**
- **News Sources** (3 nodes) — Guardian, GDELT, other APIs
- **Analysis Nodes** (2 nodes) — Evidence evaluation, semantic analysis
- **Verification Node** — Cryptographic hashing
- **Oracle Node** — Final determination

**Animation Sequence:**
1. News source nodes light up sequentially
2. Connection lines pulse with data flow
3. Data packets travel through the network
4. Analysis nodes activate
5. Verification badges appear:
   - ✓ Sources Verified
   - ✓ Evidence Hashed
   - ✓ Attestation Signed
6. Progress bar fills
7. Phase text updates:
   - "Querying news sources..."
   - "Analyzing evidence quality..."
   - "Evaluating semantic criteria..."
   - "Computing confidence score..."
   - "Generating cryptographic attestation..."

#### Step 4: View the Result

**Outcome:** NO
**Confidence:** 92%

**Reasoning displayed:**
> Analysis of 2025 NASA discoveries regarding extraterrestrial life:
> 
> **KEY FINDING:** NASA's OSIRIS-REx mission reported the discovery of amino acids on the asteroid Bennu in 2025. However, amino acids are precursor molecules to life — they represent the building blocks from which life can emerge, but are not themselves evidence of living organisms.
> 
> **RESOLUTION CRITERIA ANALYSIS:**
> - The market criteria explicitly distinguishes between "living organisms, fossilized life, or unambiguous biosignatures" (which would resolve YES) and "precursor molecules" (which resolve NO)
> - Amino acids fall under the category of precursor molecules
> - No definitive evidence of actual extraterrestrial life was announced by NASA in 2025
> 
> **CONCLUSION:** While the amino acid discovery is scientifically significant, it does not meet the threshold for "definitive evidence of extraterrestrial life" as specified in the market criteria.

#### Step 5: View Cryptographic Verification

Click **"View Cryptographic Verification"** to expand:

**Attestation Details:**
- Signer Address
- Signature (truncated)
- Outcome Hash
- Timestamp

**Information Sanctity:**
- **Cryptographic Binding:** The attestation cryptographically binds the market ID, outcome, and reasoning to a specific timestamp and signer
- **Non-Repudiation:** The EIP-712 signature proves the oracle operator made this specific determination at this specific time
- **Verifiable Execution:** Anyone can verify this attestation on-chain using the smart contract's `verifyAttestation()` function
- **Evidence Integrity:** While this demo uses simulated evidence, production deployments hash and timestamp all source material

**Evidence Sources (Simulated):**
- NASA OSIRIS-REx Mission Results (2025)
- NASA Astrobiology Research Papers
- Scientific Literature on precursor molecules
- Market Criteria Analysis

---

## Demo Features

### Visual Design

- **Dark theme** with purple/blue gradients (#667eea to #764ba2)
- **Glass-morphism** cards with backdrop blur
- **Animated SVG network** showing data flow
- **Pulsing nodes** and gradient connection lines
- **Clean, minimal UI** — single market, focused flow

### Animation Details

| Element | Description |
|---------|-------------|
| Nodes | Circles that light up (blue → green) when activated |
| Connections | Gradient lines that pulse with data flow |
| Data Packets | Small circles that travel along connections |
| Progress Bar | Linear gradient fill with glow effect |
| Badges | Status pills that turn green when verified |

### Technical Implementation

- **20-second fixed duration** — ensures visual completeness
- **Phase synchronization** — text updates match visual progress
- **Deterministic outcome** — same market always resolves NO with 92% confidence
- **EIP-712 attestation** — generated automatically after resolution

---

## What the Demo Shows

### 1. Long-Tail Prediction Markets
- Complex, ambiguous questions requiring nuanced analysis
- Semantic understanding of resolution criteria
- Distinction between related concepts (precursors vs. life itself)

### 2. Verifiable AI Decisions
- Every resolution produces a cryptographic attestation
- EIP-712 structured data signing
- On-chain verifiable
- Transparent reasoning

### 3. Visual Trust Building
- Users see the oracle "working" — not a black box
- Network visualization shows data sources and processing
- Verification badges create confidence

### 4. Information Sanctity
- Cryptographic binding of decision to evidence
- Non-repudiable attestations
- Clear explanation of verification properties

---

## Production Enhancements

### Real News Sources

Replace mock evidence with actual APIs:

```typescript
// oracle/src/news/guardian.ts
// oracle/src/news/gdelt.ts
// oracle/src/news/aggregator.ts
```

**Guardian API:** Free tier, high reliability  
**GDELT API:** Free, global event coverage  
**Perplexity API:** Aggregated sources with citations

### TEE Integration

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

**Local:**
```bash
cd contracts
anvil
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

**Testnet (Sepolia):**
```bash
forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC --broadcast --private-key $PRIVATE_KEY
```

---

## Environment Variables

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
VITE_ORACLE_API=http://localhost:3001
```

---

## Testing

### Contract Tests
```bash
cd contracts
forge test
```

### Manual Test Script

1. Start oracle: `cd oracle && npm run dev`
2. Start demo: `cd demo && npm run dev`
3. Open browser to `http://localhost:5173`
4. Click "Resolve with Verifiable AI"
5. Watch 20-second animation
6. Verify outcome is NO with 92% confidence
7. Expand verification panel
8. Check attestation details

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Failed to fetch" | Ensure oracle is running on port 3001 |
| Animation not smooth | Reduce browser zoom or close other tabs |
| Result not showing | Check browser console for API errors |
| CORS errors | Oracle has `cors()` enabled — check ports |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     FRONTEND (React + Vite)                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Single Page Demo                                       │   │
│  │  • Market Card (static)                                │   │
│  │  • Animated Network Visualization (SVG)                  │   │
│  │  • Result Display                                      │   │
│  │  • Verification Panel (collapsible)                     │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     ORACLE SERVICE (Node.js)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   AI        │  │  Evidence   │  │   EIP-712               │  │
│  │   Resolver  │  │  (mock)     │  │   Signing               │  │
│  │             │  │             │  │                         │  │
│  │  • NASA     │  │  • Sources  │  │  • Attestation          │  │
│  │    specific │  │  • Hashes │  │    generation           │  │
│  │  • 92% conf │  │  • Snippets│  │  • Signature            │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Next Steps

1. **Add real news APIs** — Guardian, GDELT integration
2. **Add TEE support** — Confidential.ai integration
3. **Deploy to testnet** — Sepolia for public demo
4. **Add more demo markets** — Toggle between examples
5. **Evidence explorer** — Show actual source articles

---

## Resources

- **Foundry Docs:** https://book.getfoundry.sh/
- **Viem Docs:** https://viem.sh/
- **EIP-712:** https://eips.ethereum.org/EIPS/eip-712
- **Confidential.ai:** https://confidential.ai/

---

Built for Cosmos — demonstrating verifiable AI oracles for prediction markets.
