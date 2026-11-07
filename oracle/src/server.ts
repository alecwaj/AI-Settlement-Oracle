import express from 'express';
import cors from 'cors';
import { AIResolver, type Market } from './ai-resolver.js';
import { AttestationSigner, type Resolution, type Attestation } from './attestation.js';
import { type Hex } from 'viem';

const app = express();
app.use(cors());
app.use(express.json());

// In-memory storage for demo
const markets: Map<string, Market> = new Map();
const resolutions: Map<string, Resolution> = new Map();
const attestations: Map<string, Attestation> = new Map();

// Initialize AI resolver and signer
const aiResolver = new AIResolver();

// Use a demo private key (DO NOT USE IN PRODUCTION)
const DEMO_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const signer = new AttestationSigner(DEMO_PRIVATE_KEY);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', signer: signer.getAddress() });
});

// Create a new market
app.post('/markets', (req, res) => {
  const { question, resolutionCriteria, resolutionTime } = req.body;
  
  if (!question || !resolutionCriteria || !resolutionTime) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const id = '0x' + Buffer.from(
    question + resolutionCriteria + resolutionTime + Date.now()
  ).toString('hex').slice(0, 64) as `0x${string}`;

  const market: Market = {
    id,
    question,
    resolutionCriteria,
    resolutionTime,
  };

  markets.set(id, market);
  
  res.json({
    success: true,
    market,
  });
});

// Get all markets
app.get('/markets', (_req, res) => {
  res.json({
    markets: Array.from(markets.values()),
    count: markets.size,
  });
});

// Get a specific market
app.get('/markets/:id', (req, res) => {
  const market = markets.get(req.params.id);
  if (!market) {
    return res.status(404).json({ error: 'Market not found' });
  }
  res.json({ market });
});

// Resolve a market using AI
app.post('/markets/:id/resolve', async (req, res) => {
  const market = markets.get(req.params.id);
  if (!market) {
    return res.status(404).json({ error: 'Market not found' });
  }

  if (resolutions.has(req.params.id)) {
    return res.status(400).json({ error: 'Market already resolved' });
  }

  try {
    const result = await aiResolver.resolve(market);
    
    const resolution: Resolution = {
      marketId: market.id,
      outcome: result.outcomeHash,
      timestamp: BigInt(result.timestamp),
      reasoning: result.reasoning,
    };

    resolutions.set(req.params.id, resolution);

    res.json({
      success: true,
      result,
      resolution,
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Resolution failed', 
      details: error instanceof Error ? error.message : String(error) 
    });
  }
});

// Create attestation for a resolution
app.post('/markets/:id/attest', async (req, res) => {
  const marketId = req.params.id;
  const resolution = resolutions.get(marketId);
  
  if (!resolution) {
    return res.status(404).json({ error: 'Resolution not found' });
  }

  if (attestations.has(marketId)) {
    return res.status(400).json({ error: 'Attestation already exists' });
  }

  try {
    const attestation = await signer.createAttestation(resolution);
    attestations.set(marketId, attestation);

    res.json({
      success: true,
      attestation: {
        resolution: attestation.resolution,
        signature: attestation.signature,
        signer: signer.getAddress(),
      },
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Attestation failed', 
      details: error instanceof Error ? error.message : String(error) 
    });
  }
});

// Verify an attestation
app.post('/verify', async (req, res) => {
  const { attestation, expectedSigner } = req.body;
  
  if (!attestation || !expectedSigner) {
    return res.status(400).json({ error: 'Missing attestation or expectedSigner' });
  }

  try {
    const valid = await signer.verifyAttestation(attestation, expectedSigner as Hex);
    res.json({
      valid,
      attestation,
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Verification failed', 
      details: error instanceof Error ? error.message : String(error) 
    });
  }
});

// Get attestation for a market
app.get('/markets/:id/attestation', (req, res) => {
  const attestation = attestations.get(req.params.id);
  if (!attestation) {
    return res.status(404).json({ error: 'Attestation not found' });
  }
  
  res.json({
    attestation: {
      resolution: attestation.resolution,
      signature: attestation.signature,
      signer: signer.getAddress(),
    },
  });
});

// List all attestations
app.get('/attestations', (_req, res) => {
  const allAttestations = Array.from(attestations.entries()).map(([marketId, att]) => ({
    marketId,
    resolution: att.resolution,
    signature: att.signature,
    signer: signer.getAddress(),
  }));
  
  res.json({ attestations: allAttestations });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🔮 AI Settlement Oracle running on port ${PORT}`);
  console.log(`🔑 Signer address: ${signer.getAddress()}`);
});
