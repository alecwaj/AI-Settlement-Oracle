# AI Settlement Oracle - Working Notes

## Session: 2024-11-06 with Alec James

---

## Core Concept Confirmed

A verifiable AI oracle that:
1. Searches/aggregates from high-reliability news sources
2. Makes nuanced decisions about unclear resolution conditions
3. Produces cryptographically verifiable attestations
4. Shows clear path for improvement/refinement over time

---

## Key Requirements Added

### Information Sourcing
- Must search across highest reliability news sources
- System should be designed to improve/refine over time (explicitly stated)
- Not just price feeds — needs semantic understanding

### Nuanced Decision Making
- AI handles ambiguous/unclear resolution conditions
- Many prediction markets fail due to edge cases
- AI evaluates evidence quality, not just binary facts

### Verifiability
- News sources must be cryptographically referenced
- Decision process must be auditable
- Verdict must be provably from specific AI run

---

## Verification Method Options

| Approach | Pros | Cons | Cost | Verifiability |
|----------|------|------|------|---------------|
| **EIP-712 + Evidence Hash** | Standard, cheap, easy | Trust oracle operator | Low | Medium — proves WHAT was decided, not HOW |
| **TEE (Confidential.ai)** | Proves code ran in enclave, remote attestation | Requires external service, ~1-3% overhead | Medium | **High** — proves code + model + inputs |
| **ZKML** | Proves model inference | Very complex, slow, expensive | Very High | High — but impractical |
| **Commit-Reveal + Oracle Network** | Distributed trust | Coordination complexity | Medium | Medium — trust assumptions shift |

### TEE Deep Dive: Confidential.ai

**What it provides:**
- Intel TDX or AMD SEV-SNP confidential VMs
- Remote attestation via TEErminator
- GPU attestation during measured boot
- OpenAI-compatible API endpoint
- ~1-3% token throughput overhead

**Trust model:**
- Do NOT trust: physical host, K8s control plane, cloud operator
- DO trust: TDX hardware, measured ConfOS image, C8s policy, reviewed software

**Attestation flow:**
1. Client verifies node image, workload identity, policy via `/v1/discovery`
2. TEErminator checks Intel TDX evidence + signed route
3. GPU verification at boot (blocks node admission if failed)
4. Requests proxied through local TEErminator after verification

**For prediction markets:**
- Proves AI oracle code ran exactly as reviewed
- Proves model weights weren't tampered with
- Proves evidence fetched at specific time
- Does NOT prove AI reasoning is "correct" — just that it ran

**Cost:** API key required (email hello@confidential.ai), pay-per-use inference

**Verdict:** Best option for production-grade demo. Shows serious engineering.

### Build Scope Comparison

| Scope | Time | Complexity | Demo Impact |
|-------|------|------------|-------------|
| **Full Prediction Market** | 6-8 hrs | High (contract + UI + oracle) | High — shows end-to-end |
| **Resolution Mechanism Only** | 3-4 hrs | Medium (oracle + attestation) | Medium — core tech demo |
| **Resolution + Evidence Explorer** | 4-5 hrs | Medium-High | High — shows nuance handling |

---

## Brendan/Cosmos Context

- AI Engineer role — wants to see agentic systems
- "Ideally with AI tools" — wants evidence of AI-assisted building
- Cosmos = decentralized coordination focus
- Prediction markets = coordination mechanism

---

## News API Research

### Highly Trustworthy Sources

| Source | API | Cost | Reliability | Notes |
|--------|-----|------|-------------|-------|
| **Reuters** | Reuters API | $$$ | Very High | Gold standard, strict editorial standards |
| **Associated Press (AP)** | AP Content API | $$ | Very High | Non-profit, widely syndicated |
| **BBC** | BBC News API | $ | High | Public service broadcaster |
| **The Guardian** | Open Platform | Free tier | High | Open data, transparent |
| **NewsAPI.org** | NewsAPI | Free tier | Medium | Aggregator, mixed sources |
| **GDELT** | GDELT API | Free | Medium-High | Global events, academic project |
| **Perplexity** | Perplexity API | $$ | High | Already aggregated, with citations |

### Recommendation for Demo

**Primary: Perplexity API**
- Already aggregates from high-quality sources
- Returns citations with URLs
- Handles semantic search well
- "What happened with X?" → structured answer + sources

**Fallback: Guardian + Reuters (if free tier available)**
- Direct source verification
- No aggregator middleman
- Clear licensing

### Evidence Format

```typescript
interface Evidence {
  source: string;           // "Reuters", "AP", etc.
  url: string;              // Direct article URL
  title: string;            // Article headline
  publishedAt: string;      // ISO timestamp
  hash: string;             // SHA256 of article content
  retrievedAt: string;      // When oracle fetched it
}
```

---

## Trust Breakdown Analysis

### Where Trust Breaks Down in Each Model

| Layer | What We Trust | What Could Go Wrong |
|-------|---------------|---------------------|
| **Evidence** | News sources unmanipulated | Source compromised, fake news, selective quoting |
| **Fetch** | Oracle fetched at claimed time | Oracle lied about timestamp, cached old data |
| **AI Model** | Model weights not tampered | Weights modified to bias outcomes |
| **AI Execution** | Code ran as reviewed | Code modified at runtime |
| **Attestation** | Private key secure | Key stolen, unauthorized signatures |
| **Contract** | Code matches deployment | Proxy upgrade, bug exploit |

### TEE Fixes

| Problem | TEE Solution |
|---------|--------------|
| Model tampering | Measured boot — model weights hashed, verified |
| Code tampering | VM image attestation — exact code verified |
| Timestamp lying | Evidence fetched inside TEE, timestamp signed |
| Runtime manipulation | Hardware isolation — host cannot inspect/modify |

### What's Still Trusted (Even with TEE)

| Assumption | Why Necessary |
|------------|---------------|
| Intel/AMD didn't backdoor TEE | Hardware trust anchor |
| AI reasoning is sound | Semantic correctness, not cryptographic |
| News sources are accurate | Epistemology, not cryptography |
| Private key generation was clean | Key ceremony trust |

**Verdict:** TEE moves trust from "cloud operator + oracle operator" to "hardware vendor + AI reasoning quality." This is a meaningful improvement.

---

## Ambiguity Handling: Delayed Resolution

### Smart Contract Design

```solidity
enum ResolutionStatus {
    PENDING,
    DELAYED_FOR_EVIDENCE,  // New: awaiting more info
    RESOLVED,
    DISPUTED
}

struct Market {
    string question;
    uint256 resolutionTime;
    ResolutionStatus status;
    bytes32 outcome;           // Set only if RESOLVED
    bytes attestation;         // Full attestation data
    string reasoning;          // AI reasoning (human readable)
    Evidence[] evidence;       // Source material
    uint256 delayedUntil;      // If DELAYED_FOR_EVIDENCE
}
```

### AI Oracle Behavior

```typescript
interface ResolutionDecision {
    outcome: "YES" | "NO" | "DELAY";
    confidence: number;       // 0.0 - 1.0
    reasoning: string;
    evidence: Evidence[];
    delayReason?: string;     // If DELAY
    requeryAt?: number;       // Timestamp to re-check
}

// AI returns DELAY if:
// - confidence < THRESHOLD (e.g., 0.7)
// - Evidence is contradictory
// - Event hasn't fully played out
// - Insufficient recent sources
```

### Flow

```
Create Market
      ↓
Resolution Time Reached
      ↓
AI Fetches Evidence
      ↓
  ├─ High confidence → RESOLVE → Attestation
  │
  └─ Low confidence → DELAY → Smart contract status = DELAYED_FOR_EVIDENCE
            ↓
    After delay period, re-query
            ↓
  ├─ Now confident → RESOLVE
  │
  └─ Still unclear → DELAY again (max retries?)
```

### UI Design

- Show "Awaiting more evidence" status
- Display why delay occurred (e.g., "Only 2 sources found, need 5")
- Countdown to re-query
- Allow manual trigger after delay

---

## Build Plan: Resolution Mechanism + Evidence Explorer

### Phase 1: Smart Contract (45 min)
- SettlementOracle with DELAYED_FOR_EVIDENCE status
- Evidence struct with hash verification
- EIP-712 attestation verification
- Events for indexing

### Phase 2: Oracle Service (60 min)
- Perplexity API integration for news fetch
- AI analysis with confidence scoring
- Delay logic for low confidence
- TEErminator proxy setup (optional but impressive)
- EIP-712 signing

### Phase 3: Evidence Explorer UI (60 min)
- Market creation form
- Evidence viewer (sources, reasoning, confidence)
- Delay status with countdown
- Attestation verification
- Dark theme, clean design

### Phase 4: Integration (30 min)
- End-to-end flow
- Demo script
- README with architecture

**Total: ~4 hours with Claude Code**

---

## Open Questions

1. TEE integration: MVP without, then add TEErminator proxy?
2. Dispute mechanism: Explicitly out of scope per Alec
3. Max delay retries: 3? Infinite?
4. Confidence threshold: 0.7? Configurable?

