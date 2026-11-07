# AI Settlement Oracle

A verifiable AI system for prediction market resolution using cryptographic attestations.

## Overview

This project demonstrates a decentralized AI oracle that resolves prediction markets with cryptographic proofs. It combines:

- **Smart Contracts**: EIP-712 attestations for verifiable AI resolutions (Foundry/Solidity)
- **AI Oracle**: TypeScript service that simulates AI resolution with deterministic outcomes
- **Demo UI**: React frontend for creating markets and viewing attestations

## Project Structure

```
ai-settlement-oracle/
├── contracts/          # Foundry project
│   ├── src/
│   │   ├── SettlementOracle.sol      # Main oracle contract
│   │   └── AttestationRegistry.sol   # Batch verification
│   ├── test/
│   │   └── SettlementOracle.t.sol    # Contract tests
│   └── script/
├── oracle/             # TypeScript oracle service
│   └── src/
│       ├── ai-resolver.ts           # AI resolution logic
│       ├── attestation.ts           # EIP-712 signing
│       └── server.ts                # Express API
├── demo/               # React frontend (Vite)
│   └── src/
│       ├── components/
│       │   ├── MarketDetail.tsx     # Market view + resolution
│       │   ├── MarketForm.tsx       # Create market
│       │   └── MarketList.tsx       # List all markets
│       ├── App.tsx
│       └── types.ts
├── README.md
├── BUILD_GUIDE.md      # Complete setup & demo guide
├── NOTES.md            # Design decisions & research
└── PROMPT.md           # Original build specification
```

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Demo UI   │────▶│  AI Oracle   │────▶│  Smart Contract │
│   (React)   │     │  (Node.js)   │     │  (Solidity)     │
└─────────────┘     └──────────────┘     └─────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ Attestation  │
                    │ (EIP-712)    │
                    └──────────────┘
```

## Quick Start

See **[BUILD_GUIDE.md](BUILD_GUIDE.md)** for complete setup and demo walkthrough.

```bash
# 1. Install dependencies
npm install
cd contracts && forge install
cd ../oracle && npm install
cd ../demo && npm install

# 2. Start local chain
cd contracts && anvil

# 3. Start oracle service
cd oracle && npm run dev

# 4. Start demo UI
cd demo && npm run dev
```

Open http://localhost:5173 to see the demo.

## Key Features

### 1. EIP-712 Attestations
All AI resolutions are signed using EIP-712 structured data, making them:
- Human-readable in wallets
- Verifiable on-chain
- Non-repudiable

### 2. Deterministic AI Resolution
The oracle simulates AI resolution with deterministic outcomes based on market parameters. In production, this would integrate with actual LLM APIs and news sources (The Guardian, GDELT).

### 3. Smart Contract Verification
The `SettlementOracle` contract verifies:
- Signer authorization
- Signature validity
- Resolution timing
- Double-resolution prevention

### 4. Delay Mechanism (Planned)
For ambiguous markets:
- AI returns confidence score (0.0-1.0)
- Below threshold → DELAYED_FOR_EVIDENCE
- Automatic retry after delay period
- Max 3 retries before PAUSED_FOR_MANUAL

## Demo Flow

1. **Create Market** — Set question, criteria, resolution time
2. **View Market** — See pending status
3. **Resolve with AI** — Trigger AI analysis
4. **See Results** — Outcome, confidence, reasoning, evidence
5. **Create Attestation** — Cryptographic signature of resolution
6. **Verify On-Chain** — Confirm attestation validity

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/markets` | GET | List all markets |
| `/markets` | POST | Create new market |
| `/markets/:id/resolve` | POST | AI resolve market |
| `/markets/:id/attest` | POST | Create attestation |
| `/verify` | POST | Verify attestation |

## Smart Contract Functions

```solidity
// Create a new prediction market
function createMarket(string question, string criteria, uint256 resolutionTime) returns (bytes32)

// Resolve with AI attestation
function resolveWithAttestation(bytes32 marketId, bytes32 outcome, string reasoning, bytes signature)

// Verify an attestation
function verifyAttestation(bytes32 marketId, bytes32 expectedOutcome) returns (bool)
```

## Testing

```bash
# Contract tests
cd contracts && forge test

# Oracle tests
cd oracle && npm test
```

## Built With

- **Solidity** + **Foundry** - Smart contracts and testing
- **Viem** - Ethereum interactions
- **Express** - Oracle API
- **React** + **Vite** - Demo UI
- **RainbowKit** - Wallet connection

## Documentation

- **[BUILD_GUIDE.md](BUILD_GUIDE.md)** — Complete setup, deployment, and demo walkthrough
- **[NOTES.md](NOTES.md)** — Design decisions, research on TEEs, news APIs, trust models
- **[PROMPT.md](PROMPT.md)** — Original build specification

## Future Enhancements

- [ ] Real news API integration (Guardian, GDELT)
- [ ] Delay/retry mechanism (3 automatic retries)
- [ ] TEE integration (Confidential.ai)
- [ ] Evidence explorer UI
- [ ] Testnet deployment
- [ ] Dispute mechanism

## License

MIT
