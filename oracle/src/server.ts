import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { isHex, type Hex } from 'viem';
import { loadConfig } from './config.js';
import { TeeIdentity } from './tee.js';
import { AnthropicResolver, MockResolver } from './resolver.js';
import { SettlementOracleService, canonicalJson } from './oracle.js';
import { fetchEvidence } from './evidence.js';

const cfg = loadConfig();
const tee = await TeeIdentity.init(cfg);
const resolver = cfg.llmMode === 'mock' ? new MockResolver() : new AnthropicResolver(cfg.model, cfg.effort);
if (cfg.llmMode === 'mock') console.warn('⚠️  LLM_MODE=mock — decisions are NOT made by a real model.');
const service = new SettlementOracleService(cfg, tee, resolver);

const app = express();
app.use(cors());
app.use(express.json({ limit: '64kb' }));

// BigInt-safe JSON responses
function send(res: Response, body: unknown, status = 200): void {
  res.status(status).type('application/json').send(canonicalJson(body));
}

function parseMarketId(req: Request, res: Response): bigint | null {
  const raw = String(req.params.id ?? '');
  if (!/^\d+$/.test(raw)) {
    send(res, { error: 'market id must be a positive integer' }, 400);
    return null;
  }
  return BigInt(raw);
}

app.get('/health', (_req, res) => {
  send(res, {
    status: 'ok',
    signer: tee.info.signer,
    teeMode: tee.info.mode,
    inTee: tee.info.inTee,
    llm: cfg.llmMode === 'mock' ? 'mock' : cfg.model,
    contract: cfg.contractAddress ?? null,
    autoSubmit: cfg.autoSubmit,
  });
});

/** Everything a third party needs to verify that the signer key lives in this enclave. */
app.get('/attestation', (_req, res) => {
  send(res, { ...tee.info, llm: { provider: cfg.llmMode, model: cfg.model, effort: cfg.effort } });
});

app.get('/markets/:id/resolutions', (req, res) => {
  const id = parseMarketId(req, res);
  if (id === null) return;
  send(res, { marketId: id.toString(), resolutions: service.getRecords(id.toString()) });
});

app.post('/markets/:id/resolve', async (req, res) => {
  const id = parseMarketId(req, res);
  if (id === null) return;
  try {
    const record = await service.resolveMarket(id);
    send(res, { success: record.status !== 'failed', resolution: record });
  } catch (err) {
    send(res, { success: false, error: err instanceof Error ? err.message : String(err) }, 409);
  }
});

app.get('/transcripts/:hash', (req, res) => {
  const hash = req.params.hash;
  if (!isHex(hash) || hash.length !== 66) return send(res, { error: 'expected a 32-byte hex hash' }, 400);
  const transcript = service.getTranscript(hash as Hex);
  if (!transcript) return send(res, { error: 'transcript not found' }, 404);
  res.type('application/json').send(transcript); // exact bytes that were hashed
});

/** Convenience for evidence submitters: fetch a URL the same way the oracle will and return its keccak256. */
app.post('/evidence/hash', async (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url : '';
  const ev = await fetchEvidence(url, undefined, { allowPrivateHosts: cfg.allowPrivateEvidenceHosts });
  send(res, { url, ok: ev.ok, status: ev.status, error: ev.error, contentHash: ev.contentHash, preview: ev.text.slice(0, 400) });
});

app.listen(cfg.port, () => {
  console.log(`🔮 AI Settlement Oracle listening on :${cfg.port}`);
  console.log(`   signer ${tee.info.signer} | TEE ${tee.info.mode} | LLM ${cfg.llmMode === 'mock' ? 'mock' : cfg.model}`);
  console.log(`   contract ${cfg.contractAddress ?? '(not configured — set CONTRACT_ADDRESS)'}`);
  service.startWatcher();
});
