/**
 * End-to-end test of the oracle pipeline against a local Anvil chain: contract deployment,
 * market registration, EIP-712 signing, on-chain publication, delay/retry handling and
 * independent verification.
 *
 * News providers and the model are replaced by test doubles here so the test is deterministic
 * and needs no API keys. The production server never uses these doubles.
 *
 * Requires `anvil` on PATH (or ANVIL_BIN) and compiled contracts (`forge build`); skipped otherwise.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPublicClient, createTestClient, http, keccak256, toHex, type PublicClient } from 'viem';
import { foundry } from 'viem/chains';
import {
  buildDecisionInput,
  promptHash,
  sha256Text,
  verifyReportOffline,
  verifyReportOnChain,
  type DecisionLabel,
  type MarketSpec,
  type OracleReport,
  type ProviderStatus,
} from '@oracle/shared';
import type { Decider } from '../src/ai/decide.ts';
import { bootstrapChain, describeContractError, readMarket, type ChainContext } from '../src/chain.ts';
import { MARKETS } from '../src/markets.ts';
import { selectEvidence, type EvidenceResult } from '../src/news/aggregator.ts';
import { PipelineError, runResolution, type PipelineDeps } from '../src/pipeline.ts';
import { ReportStore } from '../src/reports.ts';

const OUT_DIR = new URL('../../contracts/out', import.meta.url).pathname;
const RETRY_DELAY = 60;

function findAnvil(): string | null {
  const bin = process.env.ANVIL_BIN ?? 'anvil';
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore' });
    return bin;
  } catch {
    return null;
  }
}

const anvilBin = findAnvil();
const haveArtifacts = existsSync(join(OUT_DIR, 'SettlementOracle.sol', 'SettlementOracle.json'));
const suite = anvilBin && haveArtifacts ? describe : describe.skip;

const spec = MARKETS[0] as MarketSpec;

/** Fixture articles (test data only). */
function fixtureEvidence(count: number): EvidenceResult {
  const status: ProviderStatus = { provider: 'guardian', ok: true, queries: [], found: count, kept: 0, errors: [], notes: [] };
  const articles = Array.from({ length: count }, (_, i) => ({
    provider: 'guardian' as const,
    outlet: 'The Guardian',
    url: `https://www.theguardian.com/science/fixture-${i + 1}`,
    title: `Fixture article ${i + 1} about NASA biosignature research`,
    publishedAt: `2025-0${i + 1}-15T12:00:00.000Z`,
    text: `Fixture text ${i + 1}. This is test data used only by the integration test. `.repeat(10),
    textSource: 'api-body' as const,
    retrievedAt: '2026-11-08T00:00:00.000Z',
  }));
  return selectEvidence(spec, [{ status, articles }], { maxEvidence: 10, maxCharsPerSource: 2000 });
}

/** Deterministic stand-in for the model, producing a correctly formed decision record. */
function stubDecider(decision: DecisionLabel, confidence: number, calls: { n: number }): Decider {
  return async ({ rulesText, evidence, asOf }) => {
    calls.n++;
    return {
      decision: {
        decision,
        confidence,
        summary: `Test verdict ${decision}.`,
        conditionAssessments: [
          { side: 'NO', condition: spec.conditions.no[0] ?? '', status: 'MET', explanation: 'test', sourceIds: ['S1'] },
        ],
        reasoningSteps: [{ finding: 'test finding', sourceIds: ['S1'] }],
        citedSourceIds: ['S1'],
        insufficiencyReason: decision === 'INSUFFICIENT_EVIDENCE' ? 'test' : null,
      },
      model: 'test-double',
      requestedModel: 'test-double',
      promptHash: promptHash(),
      inputHash: sha256Text(buildDecisionInput(rulesText, evidence, asOf)),
      adjustments: [],
    };
  };
}

suite('oracle pipeline on a local chain', () => {
  let anvil: ChildProcess;
  let rpcUrl: string;
  let dataDir: string;
  let chain: ChainContext;
  let reports: ReportStore;
  let client: PublicClient;
  const events: string[] = [];

  const deps = (decider: Decider, evidence: EvidenceResult): PipelineDeps => ({
    chain,
    decider,
    reports,
    gather: async () => structuredClone(evidence),
  });

  /**
   * Moves the chain clock forward without mining, as happens in real use when no transactions
   * arrive during a delay: the latest block keeps its old timestamp, only the next block is later.
   */
  const advance = async (seconds: number): Promise<void> => {
    const test = createTestClient({ chain: foundry, mode: 'anvil', transport: http(rpcUrl) });
    await test.increaseTime({ seconds });
  };

  async function verifyAll(report: OracleReport): Promise<void> {
    const checks = [...(await verifyReportOffline(report)), ...(await verifyReportOnChain(client, report))];
    const failed = checks.filter((c) => !c.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  }

  beforeAll(async () => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    rpcUrl = `http://127.0.0.1:${port}`;
    anvil = spawn(anvilBin as string, ['--port', String(port), '--silent'], { stdio: 'ignore' });
    client = createPublicClient({ transport: http(rpcUrl) }) as PublicClient;
    for (let i = 0; i < 50; i++) {
      try {
        await client.getChainId();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    dataDir = mkdtempSync(join(tmpdir(), 'oracle-test-'));
    reports = new ReportStore(dataDir);
    chain = await bootstrapChain({
      rpcUrl,
      deployerKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      oracleKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      contractAddress: undefined,
      retryDelaySeconds: RETRY_DELAY,
      dataDir,
      contractsOutDir: OUT_DIR,
      markets: MARKETS,
      log: (m) => events.push(m),
    });
  }, 30_000);

  afterAll(() => {
    anvil?.kill();
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it('deploys, registers the market and reuses the deployment on restart', async () => {
    expect(events.some((e) => e.startsWith('Deployed SettlementOracle'))).toBe(true);
    const id = chain.marketIds.get(spec.slug);
    expect(id).toBe(1n);
    const again = await bootstrapChain({
      rpcUrl,
      deployerKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      oracleKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      contractAddress: undefined,
      retryDelaySeconds: RETRY_DELAY,
      dataDir,
      contractsOutDir: OUT_DIR,
      markets: MARKETS,
      log: () => undefined,
    });
    expect(again.contract).toBe(chain.contract);
    expect(again.marketIds.get(spec.slug)).toBe(1n);
  });

  it('delays without calling the model when no evidence is retrieved', async () => {
    const calls = { n: 0 };
    const empty = selectEvidence(spec, [], { maxEvidence: 10, maxCharsPerSource: 2000 });
    const report = await runResolution(deps(stubDecider('NO', 0.9, calls), empty), spec, () => undefined);
    expect(calls.n).toBe(0);
    expect(report.decision.record.decision.decision).toBe('INSUFFICIENT_EVIDENCE');
    expect(report.decision.action).toBe('DELAY');
    expect(report.publication?.marketStatusAfter).toBe('DELAYED');
    await verifyAll(report);
  });

  it('refuses to retry before the delay elapses', async () => {
    const calls = { n: 0 };
    await expect(runResolution(deps(stubDecider('NO', 0.9, calls), fixtureEvidence(3)), spec, () => undefined)).rejects.toThrow(
      PipelineError,
    );
    expect(calls.n).toBe(0);
  });

  it('delays a below-threshold verdict and publishes its logic and sources', async () => {
    await advance(RETRY_DELAY + 1);
    const calls = { n: 0 };
    const steps: string[] = [];
    const report = await runResolution(deps(stubDecider('NO', 0.55, calls), fixtureEvidence(3)), spec, (e) =>
      steps.push(`${e.step}:${e.status}`),
    );
    expect(calls.n).toBe(1);
    expect(report.attempt).toBe(1);
    expect(report.decision.confidenceBps).toBe(5500);
    expect(report.decision.action).toBe('DELAY');
    expect(report.publication?.marketStatusAfter).toBe('DELAYED');
    expect(steps).toContain('publication:done');
    await verifyAll(report);
    const m = await readMarket(chain, 1n);
    expect(m.delayCount).toBe(2);
  });

  it('settles a confident verdict, and the report verifies independently', async () => {
    await advance(RETRY_DELAY + 1);
    const calls = { n: 0 };
    const report = await runResolution(deps(stubDecider('NO', 0.9, calls), fixtureEvidence(4)), spec, () => undefined);
    expect(report.publication?.marketStatusAfter).toBe('RESOLVED');
    await verifyAll(report);
    const m = await readMarket(chain, 1n);
    expect(m.status).toBe('RESOLVED');
    expect(m.outcome).toBe('NO');
    expect(reports.get(report.reportId)).toBeDefined();
  });

  it('detects tampering with a published report', async () => {
    const [latest] = reports.list(spec.slug, chain.contract);
    const original = latest as OracleReport;

    const editedSource = structuredClone(original);
    (editedSource.sourcing.evidence[0] as { text: string }).text += ' edited';
    const c1 = await verifyReportOffline(editedSource);
    expect(c1.find((c) => c.id === 'content')?.ok).toBe(false);

    const editedLogic = structuredClone(original);
    editedLogic.decision.reasoning = editedLogic.decision.reasoning.replace('"NO"', '"YES"');
    const c2 = await verifyReportOffline(editedLogic);
    expect(c2.find((c) => c.id === 'reasoning')?.ok).toBe(false);
    const c3 = await verifyReportOnChain(client, editedLogic);
    expect(c3.find((c) => c.id === 'onchain-decision')?.ok).toBe(false);
  });

  it('reports contract rejections by their custom error name', async () => {
    const zero = keccak256(toHex('x'));
    const err = await chain.publicClient
      .simulateContract({
        address: chain.contract,
        abi: (await import('@oracle/shared')).settlementOracleAbi,
        functionName: 'submitResolution',
        args: [
          { marketId: 99n, attempt: 0, decision: 2, confidenceBps: 9000, rulesHash: zero, evidenceHash: zero, reasoningHash: zero, reportHash: zero, timestamp: 0n },
          '',
          [],
          '0x',
        ],
        account: chain.deployer.account,
      })
      .then(() => null)
      .catch((e: unknown) => e);
    expect(describeContractError(err)).toBe('contract rejected the resolution: MarketNotFound()');
  });

  it('rejects resolutions once the market is settled', async () => {
    await expect(
      runResolution(deps(stubDecider('YES', 0.99, { n: 0 }), fixtureEvidence(2)), spec, () => undefined),
    ).rejects.toThrow(/RESOLVED/);
  });
});
