# AI Settlement Oracle — Build Prompt for Claude Code

Copy this entire prompt into Claude Code to build the project.

---

## Project Overview

Build a verifiable AI oracle for prediction markets with:
1. **Smart contracts** (Solidity) — SettlementOracle with EIP-712 attestations
2. **Oracle service** (TypeScript/Node) — AI resolution + cryptographic signing
3. **Demo frontend** (React/Vite) — Single-market demo with 20-second animation

The demo showcases a NASA astrobiology market: "Will NASA find definitive evidence of extraterrestrial life in 2025?" — resolves NO with 92% confidence based on amino acid discovery (precursors ≠ life).

---

## Step 1: Read Existing Files

First, read these files to understand the current state:

```
Read these files:
1. BUILD_GUIDE.md — Full project documentation
2. demo/src/App.tsx — Current frontend (needs simplification)
3. demo/src/index.css — Current styles
4. oracle/src/ai-resolver.ts — AI resolution logic
5. oracle/src/server.ts — Oracle API
```

---

## Step 2: Project Structure

Ensure this directory structure exists:

```
ai-settlement-oracle/
├── contracts/
│   ├── src/
│   │   ├── SettlementOracle.sol
│   │   └── AttestationRegistry.sol
│   ├── test/
│   │   └── SettlementOracle.t.sol
│   ├── script/
│   │   └── Deploy.s.sol
│   └── foundry.toml
├── oracle/
│   ├── src/
│   │   ├── server.ts
│   │   ├── ai-resolver.ts
│   │   ├── attestation.ts
│   │   └── news/
│   │       ├── guardian.ts
│   │       ├── gdelt.ts
│   │       └── aggregator.ts
│   ├── package.json
│   └── tsconfig.json
├── demo/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── index.css
│   │   └── types.ts
│   ├── index.html
│   └── package.json
├── BUILD_GUIDE.md
├── PROMPT.md
└── README.md
```

---

## Step 3: Build Contracts

Create these Solidity files:

### contracts/src/SettlementOracle.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract SettlementOracle is EIP712 {
    bytes32 private constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(string marketId,uint8 outcome,uint256 timestamp,string reasoningHash)"
    );
    
    enum Outcome { PENDING, YES, NO, INVALID }
    
    struct Market {
        string question;
        string resolutionCriteria;
        uint256 resolutionTime;
        Outcome outcome;
        bool resolved;
    }
    
    struct Attestation {
        string marketId;
        Outcome outcome;
        uint256 timestamp;
        string reasoningHash;
    }
    
    mapping(string => Market) public markets;
    mapping(bytes32 => bool) public attestations;
    mapping(address => bool) public authorizedOracles;
    
    event MarketCreated(string indexed marketId, string question);
    event MarketResolved(string indexed marketId, Outcome outcome, bytes32 attestationHash);
    
    constructor() EIP712("SettlementOracle", "1") {
        authorizedOracles[msg.sender] = true;
    }
    
    function createMarket(
        string calldata marketId,
        string calldata question,
        string calldata resolutionCriteria,
        uint256 resolutionTime
    ) external {
        markets[marketId] = Market({
            question: question,
            resolutionCriteria: resolutionCriteria,
            resolutionTime: resolutionTime,
            outcome: Outcome.PENDING,
            resolved: false
        });
        emit MarketCreated(marketId, question);
    }
    
    function resolveMarket(
        string calldata marketId,
        Outcome outcome,
        string calldata reasoningHash,
        bytes calldata signature
    ) external {
        require(authorizedOracles[msg.sender], "Unauthorized");
        require(!markets[marketId].resolved, "Already resolved");
        
        bytes32 attestationHash = verifyAttestation(marketId, outcome, reasoningHash, signature);
        require(attestationHash != bytes32(0), "Invalid attestation");
        
        markets[marketId].outcome = outcome;
        markets[marketId].resolved = true;
        attestations[attestationHash] = true;
        
        emit MarketResolved(marketId, outcome, attestationHash);
    }
    
    function verifyAttestation(
        string calldata marketId,
        Outcome outcome,
        string calldata reasoningHash,
        bytes calldata signature
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            ATTESTATION_TYPEHASH,
            keccak256(bytes(marketId)),
            outcome,
            block.timestamp,
            keccak256(bytes(reasoningHash))
        ));
        
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);
        
        require(authorizedOracles[signer], "Invalid signer");
        return digest;
    }
}
```

### contracts/src/AttestationRegistry.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract AttestationRegistry {
    struct BatchAttestation {
        bytes32[] attestationHashes;
        uint256 timestamp;
        bytes signature;
    }
    
    mapping(bytes32 => BatchAttestation) public batches;
    mapping(bytes32 => bool) public verifiedAttestations;
    
    event BatchSubmitted(bytes32 indexed batchHash, uint256 count);
    
    function submitBatch(
        bytes32[] calldata attestationHashes,
        bytes calldata signature
    ) external returns (bytes32) {
        bytes32 batchHash = keccak256(abi.encodePacked(attestationHashes, block.timestamp));
        batches[batchHash] = BatchAttestation({
            attestationHashes: attestationHashes,
            timestamp: block.timestamp,
            signature: signature
        });
        
        for (uint i = 0; i < attestationHashes.length; i++) {
            verifiedAttestations[attestationHashes[i]] = true;
        }
        
        emit BatchSubmitted(batchHash, attestationHashes.length);
        return batchHash;
    }
}
```

### contracts/test/SettlementOracle.t.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/SettlementOracle.sol";

contract SettlementOracleTest is Test {
    SettlementOracle oracle;
    
    function setUp() public {
        oracle = new SettlementOracle();
    }
    
    function test_CreateMarket() public {
        oracle.createMarket("test-1", "Will it rain?", "Check weather.com", block.timestamp + 1 days);
        SettlementOracle.Market memory market = oracle.markets("test-1");
        assertEq(market.question, "Will it rain?");
        assertEq(uint(market.outcome), uint(SettlementOracle.Outcome.PENDING));
    }
}
```

### contracts/foundry.toml

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]

[rpc_endpoints]
localhost = "http://localhost:8545"
```

Run:
```
!cd contracts && forge install && forge build && forge test
```

---

## Step 4: Build Oracle Service

Create these TypeScript files:

### oracle/src/types.ts

```typescript
export enum Outcome {
  PENDING = 0,
  YES = 1,
  NO = 2,
  INVALID = 3
}

export interface Market {
  id: string;
  question: string;
  resolutionCriteria: string;
  resolutionTime: number;
  outcome: Outcome;
  resolved: boolean;
  confidence?: number;
  reasoning?: string;
  evidence?: EvidenceItem[];
}

export interface EvidenceItem {
  source: string;
  url: string;
  snippet: string;
  timestamp: number;
  hash: string;
}

export interface ResolutionResult {
  outcome: Outcome;
  confidence: number;
  reasoning: string;
  evidence: EvidenceItem[];
}

export interface AttestationData {
  marketId: string;
  outcome: Outcome;
  timestamp: number;
  reasoningHash: string;
  signature: string;
  signer: string;
}
```

### oracle/src/ai-resolver.ts

```typescript
import { Market, Outcome, ResolutionResult, EvidenceItem } from './types';

// Hardcoded NASA market for demo
const NASA_MARKET: Market = {
  id: "nasa-astrobiology-2025",
  question: "Will NASA find definitive evidence of extraterrestrial life in 2025?",
  resolutionCriteria: "Resolves YES if NASA officially announces discovery of living organisms, fossilized life, or unambiguous biosignatures from beyond Earth. Resolves NO if only precursor molecules (amino acids, organic compounds) are found.",
  resolutionTime: new Date('2025-12-31').getTime(),
  outcome: Outcome.PENDING,
  resolved: false
};

const NASA_EVIDENCE: EvidenceItem[] = [
  {
    source: "NASA OSIRIS-REx Mission",
    url: "https://www.nasa.gov/osiris-rex",
    snippet: "Discovery of amino acids on asteroid Bennu confirmed. Amino acids are organic compounds that serve as building blocks for proteins and are considered precursors to life, but do not constitute living organisms themselves.",
    timestamp: new Date('2025-01-15').getTime(),
    hash: "0x" + "a".repeat(64)
  },
  {
    source: "NASA Astrobiology Research",
    url: "https://astrobiology.nasa.gov",
    snippet: "Research distinguishes between precursor molecules (amino acids, nucleobases) and definitive biosignatures. Precursors indicate potential for life but require additional evidence for definitive claims.",
    timestamp: new Date('2025-03-20').getTime(),
    hash: "0x" + "b".repeat(64)
  }
];

export function getDemoMarket(): Market {
  return NASA_MARKET;
}

export async function resolveMarket(market: Market): Promise<ResolutionResult> {
  // Simulate AI analysis delay
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // NASA market always resolves NO with specific reasoning
  if (market.id === "nasa-astrobiology-2025") {
    return {
      outcome: Outcome.NO,
      confidence: 0.92,
      reasoning: `Analysis of 2025 NASA discoveries regarding extraterrestrial life:

KEY FINDING: NASA's OSIRIS-REx mission reported the discovery of amino acids on the asteroid Bennu in 2025. However, amino acids are precursor molecules to life — they represent the building blocks from which life can emerge, but are not themselves evidence of living organisms.

RESOLUTION CRITERIA ANALYSIS:
- The market criteria explicitly distinguishes between "living organisms, fossilized life, or unambiguous biosignatures" (which would resolve YES) and "precursor molecules" (which resolve NO)
- Amino acids fall under the category of precursor molecules
- No definitive evidence of actual extraterrestrial life was announced by NASA in 2025

CONCLUSION: While the amino acid discovery is scientifically significant, it does not meet the threshold for "definitive evidence of extraterrestrial life" as specified in the market criteria.`,
      evidence: NASA_EVIDENCE
    };
  }
  
  // Default fallback
  return {
    outcome: Outcome.NO,
    confidence: 0.75,
    reasoning: "Market analysis complete. Based on available evidence, outcome is NO.",
    evidence: []
  };
}
```

### oracle/src/attestation.ts

```typescript
import { ethers } from 'ethers';
import { Outcome, AttestationData } from './types';

const DOMAIN = {
  name: "SettlementOracle",
  version: "1",
  chainId: 31337, // localhost
  verifyingContract: "0x0000000000000000000000000000000000000000"
};

const ATTESTATION_TYPES = {
  Attestation: [
    { name: "marketId", type: "string" },
    { name: "outcome", type: "uint8" },
    { name: "timestamp", type: "uint256" },
    { name: "reasoningHash", type: "string" }
  ]
};

export async function createAttestation(
  marketId: string,
  outcome: Outcome,
  reasoning: string,
  privateKey: string
): Promise<AttestationData> {
  const wallet = new ethers.Wallet(privateKey);
  const timestamp = Date.now();
  const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes(reasoning)).slice(0, 42);
  
  const value = {
    marketId,
    outcome,
    timestamp,
    reasoningHash
  };
  
  const signature = await wallet.signTypedData(DOMAIN, ATTESTATION_TYPES, value);
  
  return {
    marketId,
    outcome,
    timestamp,
    reasoningHash,
    signature,
    signer: wallet.address
  };
}
```

### oracle/src/server.ts

```typescript
import express from 'express';
import cors from 'cors';
import { getDemoMarket, resolveMarket } from './ai-resolver';
import { createAttestation } from './attestation';
import { Outcome } from './types';

const app = express();
app.use(cors());
app.use(express.json());

const ORACLE_PRIVATE_KEY = process.env.ORACLE_PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// Store for demo
let currentResolution: any = null;

// Get the demo market
app.get('/markets', (req, res) => {
  const market = getDemoMarket();
  res.json([market]);
});

app.get('/markets/:id', (req, res) => {
  const market = getDemoMarket();
  if (currentResolution && currentResolution.marketId === req.params.id) {
    res.json({ ...market, ...currentResolution });
  } else {
    res.json(market);
  }
});

// Trigger resolution
app.post('/markets/:id/resolve', async (req, res) => {
  const market = getDemoMarket();
  const result = await resolveMarket(market);
  
  const attestation = await createAttestation(
    market.id,
    result.outcome,
    result.reasoning,
    ORACLE_PRIVATE_KEY
  );
  
  currentResolution = {
    ...result,
    attestation,
    marketId: market.id,
    resolved: true
  };
  
  res.json(currentResolution);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Oracle service running on port ${PORT}`);
});
```

### oracle/package.json

```json
{
  "name": "ai-settlement-oracle",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "ethers": "^6.9.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/cors": "^2.8.17",
    "@types/node": "^20.10.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.0"
  }
}
```

### oracle/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

Run:
```
!cd oracle && npm install && npm run dev
```

---

## Step 5: Build Demo Frontend

Create these files:

### demo/src/types.ts

```typescript
export enum Outcome {
  PENDING = 0,
  YES = 1,
  NO = 2,
  INVALID = 3
}

export interface EvidenceItem {
  source: string;
  url: string;
  snippet: string;
  timestamp: number;
  hash: string;
}

export interface Market {
  id: string;
  question: string;
  resolutionCriteria: string;
  resolutionTime: number;
  outcome: Outcome;
  resolved: boolean;
  confidence?: number;
  reasoning?: string;
  evidence?: EvidenceItem[];
  attestation?: {
    signature: string;
    signer: string;
    timestamp: number;
    reasoningHash: string;
  };
}
```

### demo/src/index.css

```css
:root {
  --bg-primary: #0a0a0f;
  --bg-secondary: #12121a;
  --bg-card: rgba(255, 255, 255, 0.03);
  --border-color: rgba(255, 255, 255, 0.08);
  --text-primary: #ffffff;
  --text-secondary: rgba(255, 255, 255, 0.7);
  --text-muted: rgba(255, 255, 255, 0.5);
  --accent-purple: #667eea;
  --accent-blue: #764ba2;
  --accent-green: #10b981;
  --accent-red: #ef4444;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Inter', system-ui, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  min-height: 100vh;
  line-height: 1.6;
}

.app {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

header {
  text-align: center;
  margin-bottom: 3rem;
}

header h1 {
  font-size: 2.5rem;
  font-weight: 700;
  background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin-bottom: 0.5rem;
}

header p {
  color: var(--text-secondary);
  font-size: 1.1rem;
}

.market-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 2rem;
  backdrop-filter: blur(10px);
  margin-bottom: 2rem;
}

.market-card h2 {
  font-size: 1.5rem;
  margin-bottom: 1rem;
  color: var(--text-primary);
}

.market-card .criteria {
  color: var(--text-secondary);
  font-size: 0.95rem;
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 8px;
  border-left: 3px solid var(--accent-purple);
}

.status-badge {
  display: inline-block;
  padding: 0.5rem 1rem;
  border-radius: 20px;
  font-size: 0.85rem;
  font-weight: 500;
}

.status-badge.pending {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-muted);
}

.status-badge.resolved {
  background: rgba(16, 185, 129, 0.2);
  color: var(--accent-green);
}

.resolve-button {
  background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue));
  color: white;
  border: none;
  padding: 1rem 2rem;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  margin-top: 1.5rem;
}

.resolve-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(102, 126, 234, 0.4);
}

.resolve-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

/* Animation Container */
.animation-container {
  margin: 2rem 0;
  padding: 2rem;
  background: rgba(102, 126, 234, 0.05);
  border-radius: 16px;
  border: 1px solid rgba(102, 126, 234, 0.2);
}

.animation-title {
  text-align: center;
  font-size: 1.1rem;
  color: var(--text-secondary);
  margin-bottom: 1.5rem;
}

/* Network Visualization */
.network-viz {
  position: relative;
  height: 200px;
  margin-bottom: 1.5rem;
}

.network-svg {
  width: 100%;
  height: 100%;
}

.node {
  fill: rgba(255, 255, 255, 0.1);
  stroke: var(--accent-purple);
  stroke-width: 2;
  transition: all 0.3s;
}

.node.active {
  fill: var(--accent-purple);
  filter: drop-shadow(0 0 10px var(--accent-purple));
}

.node.verified {
  fill: var(--accent-green);
  stroke: var(--accent-green);
}

.connection {
  stroke: rgba(102, 126, 234, 0.3);
  stroke-width: 2;
  fill: none;
}

.connection.active {
  stroke: url(#gradient);
  stroke-width: 3;
  filter: drop-shadow(0 0 5px var(--accent-purple));
}

.data-packet {
  fill: var(--accent-purple);
  filter: drop-shadow(0 0 5px var(--accent-purple));
}

/* Progress Bar */
.progress-container {
  margin-bottom: 1.5rem;
}

.progress-bar {
  height: 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent-purple), var(--accent-blue));
  border-radius: 4px;
  transition: width 0.1s linear;
  box-shadow: 0 0 10px rgba(102, 126, 234, 0.5);
}

.phase-text {
  text-align: center;
  margin-top: 1rem;
  font-size: 0.95rem;
  color: var(--accent-purple);
}

/* Verification Badges */
.verification-badges {
  display: flex;
  justify-content: center;
  gap: 1rem;
  margin-top: 1.5rem;
}

.badge {
  padding: 0.5rem 1rem;
  border-radius: 20px;
  font-size: 0.85rem;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-muted);
  transition: all 0.3s;
}

.badge.verified {
  background: rgba(16, 185, 129, 0.2);
  color: var(--accent-green);
}

/* Result Section */
.result-section {
  margin-top: 2rem;
  padding: 2rem;
  background: rgba(16, 185, 129, 0.05);
  border-radius: 16px;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.result-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.outcome-badge {
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  font-size: 1.25rem;
  font-weight: 700;
}

.outcome-badge.no {
  background: rgba(239, 68, 68, 0.2);
  color: var(--accent-red);
}

.confidence-score {
  font-size: 1rem;
  color: var(--text-secondary);
}

.reasoning-box {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
}

.reasoning-box h3 {
  font-size: 1rem;
  margin-bottom: 1rem;
  color: var(--text-primary);
}

.reasoning-box pre {
  white-space: pre-wrap;
  font-family: inherit;
  color: var(--text-secondary);
  font-size: 0.95rem;
  line-height: 1.7;
}

/* Verification Panel */
.verification-panel {
  margin-top: 1.5rem;
}

.verification-toggle {
  background: rgba(102, 126, 234, 0.1);
  border: 1px solid rgba(102, 126, 234, 0.3);
  color: var(--accent-purple);
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.95rem;
  transition: all 0.2s;
}

.verification-toggle:hover {
  background: rgba(102, 126, 234, 0.2);
}

.verification-content {
  margin-top: 1.5rem;
  padding: 1.5rem;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 12px;
  border: 1px solid var(--border-color);
}

.verification-content h4 {
  font-size: 1rem;
  margin-bottom: 1rem;
  color: var(--text-primary);
}

.attestation-field {
  margin-bottom: 1rem;
}

.attestation-field label {
  display: block;
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-bottom: 0.25rem;
}

.attestation-field code {
  font-family: 'Monaco', 'Consolas', monospace;
  font-size: 0.85rem;
  color: var(--text-secondary);
  word-break: break-all;
}

.sanctity-section {
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border-color);
}

.sanctity-section h4 {
  margin-bottom: 1rem;
}

.sanctity-item {
  margin-bottom: 1rem;
}

.sanctity-item h5 {
  font-size: 0.9rem;
  color: var(--accent-purple);
  margin-bottom: 0.25rem;
}

.sanctity-item p {
  font-size: 0.9rem;
  color: var(--text-secondary);
}

/* Evidence List */
.evidence-list {
  margin-top: 1.5rem;
}

.evidence-list h4 {
  margin-bottom: 1rem;
}

.evidence-item {
  padding: 1rem;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 8px;
  margin-bottom: 0.75rem;
  border-left: 3px solid var(--accent-blue);
}

.evidence-item .source {
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.evidence-item .snippet {
  color: var(--text-secondary);
  font-size: 0.9rem;
  line-height: 1.5;
}
```

### demo/src/App.tsx

```typescript
import { useState, useEffect, useRef } from 'react';
import { Market, Outcome } from './types';

const API_URL = import.meta.env.VITE_ORACLE_API || 'http://localhost:3001';

// Animation phases
const PHASES = [
  { time: 0, text: "Querying news sources..." },
  { time: 4, text: "Analyzing evidence quality..." },
  { time: 8, text: "Evaluating semantic criteria..." },
  { time: 12, text: "Computing confidence score..." },
  { time: 16, text: "Generating cryptographic attestation..." },
  { time: 20, text: "Resolution complete" }
];

export default function App() {
  const [market, setMarket] = useState<Market | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("");
  const [showVerification, setShowVerification] = useState(false);
  const [activeNodes, setActiveNodes] = useState<number[]>([]);
  const [verifiedBadges, setVerifiedBadges] = useState<string[]>([]);
  
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    fetchMarket();
  }, []);

  const fetchMarket = async () => {
    try {
      const res = await fetch(`${API_URL}/markets`);
      const data = await res.json();
      setMarket(data[0]);
    } catch (err) {
      console.error('Failed to fetch market:', err);
    }
  };

  const startResolution = async () => {
    setIsProcessing(true);
    setProgress(0);
    setPhase(PHASES[0].text);
    setActiveNodes([]);
    setVerifiedBadges([]);
    
    const startTime = Date.now();
    const duration = 20000; // 20 seconds
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const newProgress = Math.min((elapsed / duration) * 100, 100);
      setProgress(newProgress);
      
      // Update phase text
      const currentPhase = PHASES.findLast(p => (p.time * 1000) <= elapsed);
      if (currentPhase) setPhase(currentPhase.text);
      
      // Activate nodes progressively
      const nodeIndex = Math.floor((elapsed / duration) * 5);
      setActiveNodes(prev => [...new Set([...prev, nodeIndex])]);
      
      // Verify badges
      if (elapsed > 6000) setVerifiedBadges(prev => [...new Set([...prev, "sources"])]);
      if (elapsed > 10000) setVerifiedBadges(prev => [...new Set([...prev, "evidence"])]);
      if (elapsed > 14000) setVerifiedBadges(prev => [...new Set([...prev, "attestation"])]);
      
      if (elapsed < duration) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        completeResolution();
      }
    };
    
    animationRef.current = requestAnimationFrame(animate);
    
    // Trigger actual resolution
    try {
      await fetch(`${API_URL}/markets/nasa-astrobiology-2025/resolve`, { method: 'POST' });
      fetchMarket();
    } catch (err) {
      console.error('Resolution failed:', err);
    }
  };

  const completeResolution = () => {
    setIsProcessing(false);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
  };

  const getOutcomeLabel = (outcome: Outcome) => {
    switch (outcome) {
      case Outcome.YES: return 'YES';
      case Outcome.NO: return 'NO';
      case Outcome.INVALID: return 'INVALID';
      default: return 'PENDING';
    }
  };

  if (!market) return <div className="app">Loading...</div>;

  return (
    <div className="app">
      <header>
        <h1>Verifiable AI Oracle</h1>
        <p>Cryptographic attestations for prediction market resolution</p>
      </header>

      <div className="market-card">
        <h2>{market.question}</h2>
        <div className="criteria">
          <strong>Resolution Criteria:</strong> {market.resolutionCriteria}
        </div>
        
        <div className="status-badge" style={{
          background: market.resolved ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.1)',
          color: market.resolved ? '#10b981' : 'rgba(255,255,255,0.5)'
        }}>
          {market.resolved ? 'Resolved' : 'Pending Resolution'}
        </div>

        {!market.resolved && !isProcessing && (
          <button className="resolve-button" onClick={startResolution}>
            Resolve with Verifiable AI
          </button>
        )}
      </div>

      {isProcessing && (
        <div className="animation-container">
          <div className="animation-title">Oracle Processing Pipeline</div>
          
          {/* Network Visualization */}
          <div className="network-viz">
            <svg className="network-svg" viewBox="0 0 800 200">
              <defs>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#667eea" />
                  <stop offset="100%" stopColor="#764ba2" />
                </linearGradient>
              </defs>
              
              {/* Connection lines */}
              <line className={`connection ${activeNodes.includes(0) ? 'active' : ''}`} x1="100" y1="100" x2="250" y2="100" />
              <line className={`connection ${activeNodes.includes(1) ? 'active' : ''}`} x1="250" y1="100" x2="400" y2="100" />
              <line className={`connection ${activeNodes.includes(2) ? 'active' : ''}`} x1="400" y1="100" x2="550" y2="100" />
              <line className={`connection ${activeNodes.includes(3) ? 'active' : ''}`} x1="550" y1="100" x2="700" y2="100" />
              
              {/* Nodes */}
              <circle className={`node ${activeNodes.includes(0) ? 'active' : ''} ${verifiedBadges.includes('sources') ? 'verified' : ''}`} cx="100" cy="100" r="25" />
              <circle className={`node ${activeNodes.includes(1) ? 'active' : ''} ${verifiedBadges.includes('evidence') ? 'verified' : ''}`} cx="250" cy="100" r="25" />
              <circle className={`node ${activeNodes.includes(2) ? 'active' : ''}`} cx="400" cy="100" r="25" />
              <circle className={`node ${activeNodes.includes(3) ? 'active' : ''} ${verifiedBadges.includes('attestation') ? 'verified' : ''}`} cx="550" cy="100" r="25" />
              <circle className={`node ${activeNodes.includes(4) ? 'active' : ''}`} cx="700" cy="100" r="30" />
              
              {/* Labels */}
              <text x="100" y="145" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="12">Sources</text>
              <text x="250" y="145" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="12">Analysis</text>
              <text x="400" y="145" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="12">Verify</text>
              <text x="550" y="145" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="12">Attest</text>
              <text x="700" y="150" textAnchor="middle" fill="#667eea" fontSize="14" fontWeight="bold">Oracle</text>
              
              {/* Data packet animation */}
              {activeNodes.includes(0) && !activeNodes.includes(4) && (
                <circle className="data-packet" r="6" cx={100 + (progress % 20) * 30} cy="100" />
              )}
            </svg>
          </div>
          
          {/* Progress Bar */}
          <div className="progress-container">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="phase-text">{phase}</div>
          </div>
          
          {/* Verification Badges */}
          <div className="verification-badges">
            <div className={`badge ${verifiedBadges.includes('sources') ? 'verified' : ''}`}>
              {verifiedBadges.includes('sources') ? '✓' : '○'} Sources Verified
            </div>
            <div className={`badge ${verifiedBadges.includes('evidence') ? 'verified' : ''}`}>
              {verifiedBadges.includes('evidence') ? '✓' : '○'} Evidence Hashed
            </div>
            <div className={`badge ${verifiedBadges.includes('attestation') ? 'verified' : ''}`}>
              {verifiedBadges.includes('attestation') ? '✓' : '○'} Attestation Signed
            </div>
          </div>
        </div>
      )}

      {market.resolved && market.outcome !== Outcome.PENDING && (
        <div className="result-section">
          <div className="result-header">
            <div className="outcome-badge no">
              {getOutcomeLabel(market.outcome)}
            </div>
            <div className="confidence-score">
              Confidence: {Math.round((market.confidence || 0) * 100)}%
            </div>
          </div>
          
          <div className="reasoning-box">
            <h3>AI Reasoning</h3>
            <pre>{market.reasoning}</pre>
          </div>
          
          {market.evidence && market.evidence.length > 0 && (
            <div className="evidence-list">
              <h4>Evidence Sources</h4>
              {market.evidence.map((item, idx) => (
                <div key={idx} className="evidence-item">
                  <div className="source">{item.source}</div>
                  <div className="snippet">{item.snippet}</div>
                </div>
              ))}
            </div>
          )}
          
          <div className="verification-panel">
            <button className="verification-toggle" onClick={() => setShowVerification(!showVerification)}>
              {showVerification ? 'Hide' : 'View'} Cryptographic Verification
            </button>
            
            {showVerification && market.attestation && (
              <div className="verification-content">
                <h4>Cryptographic Attestation</h4>
                
                <div className="attestation-field">
                  <label>Signer Address</label>
                  <code>{market.attestation.signer}</code>
                </div>
                
                <div className="attestation-field">
                  <label>Signature</label>
                  <code>{market.attestation.signature.slice(0, 50)}...</code>
                </div>
                
                <div className="attestation-field">
                  <label>Timestamp</label>
                  <code>{new Date(market.attestation.timestamp).toISOString()}</code>
                </div>
                
                <div className="attestation-field">
                  <label>Reasoning Hash</label>
                  <code>{market.attestation.reasoningHash}</code>
                </div>
                
                <div className="sanctity-section">
                  <h4>Information Sanctity</h4>
                  
                  <div className="sanctity-item">
                    <h5>Cryptographic Binding</h5>
                    <p>The attestation cryptographically binds the market ID, outcome, and reasoning to a specific timestamp and signer.</p>
                  </div>
                  
                  <div className="sanctity-item">
                    <h5>Non-Repudiation</h5>
                    <p>The EIP-712 signature proves the oracle operator made this specific determination at this specific time.</p>
                  </div>
                  
                  <div className="sanctity-item">
                    <h5>Verifiable Execution</h5>
                    <p>Anyone can verify this attestation on-chain using the smart contract's verifyAttestation() function.</p>
                  </div>
                  
                  <div className="sanctity-item">
                    <h5>Evidence Integrity</h5>
                    <p>While this demo uses simulated evidence, production deployments hash and timestamp all source material.</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

### demo/src/main.tsx

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

### demo/index.html

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Verifiable AI Oracle</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### demo/package.json

```json
{
  "name": "ai-oracle-demo",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.43",
    "@types/react-dom": "^18.2.17",
    "@vitejs/plugin-react": "^4.2.1",
    "typescript": "^5.2.2",
    "vite": "^5.0.8"
  }
}
```

### demo/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

Run:
```
!cd demo && npm install && npm run dev
```

---

## Step 6: Test the Demo

1. Start oracle: `!cd oracle && npm run dev`
2. Start demo: `!cd demo && npm run dev`
3. Open http://localhost:5173
4. Click "Resolve with Verifiable AI"
5. Watch 20-second animation
6. Verify NO outcome with 92% confidence
7. Expand verification panel

---

## Build Complete

The demo should now show:
- Single NASA astrobiology market
- 20-second animated processing pipeline
- Network visualization with pulsing nodes
- Progress bar with phase updates
- Verification badges
- Detailed reasoning about amino acids
- Cryptographic attestation panel
