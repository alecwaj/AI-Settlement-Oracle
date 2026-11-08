import { describe, expect, it } from 'vitest';
import { keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  actionFor,
  buildDecisionInput,
  canonicalJson,
  contentHash,
  domainFor,
  evidenceHash,
  keccakText,
  messageToJson,
  promptHash,
  reportHash,
  rulesTextFor,
  sha256Text,
  toBps,
  typedData,
  verifyReportOffline,
  type DecisionRecord,
  type EvidenceItem,
  type MarketSpec,
  type OracleReport,
  type ReportBody,
} from '../src/index.ts';

describe('canonicalJson', () => {
  it('sorts keys recursively, drops undefined and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[3,{"y":2,"z":1}]},"b":1}');
  });
});

describe('hash definitions', () => {
  it('contentHash is sha256 of UTF-8 text', () => {
    expect(contentHash('abc')).toBe('0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('evidenceHash of an empty set is keccak256 of empty bytes', () => {
    expect(evidenceHash([])).toBe(keccak256('0x'));
  });

  it('evidenceHash depends on order, URL and content', () => {
    const a = { url: 'https://a.example', contentHash: contentHash('a') };
    const b = { url: 'https://b.example', contentHash: contentHash('b') };
    expect(evidenceHash([a, b])).not.toBe(evidenceHash([b, a]));
    expect(evidenceHash([a])).not.toBe(evidenceHash([{ ...a, url: 'https://a2.example' }]));
    expect(evidenceHash([a])).not.toBe(evidenceHash([{ ...a, contentHash: contentHash('x') }]));
  });

  it('keccakText matches keccak256(bytes(text))', () => {
    expect(keccakText('hello')).toBe(keccak256(toBytes('hello')));
  });

  it('rules text excludes the slug, so renaming a market does not change its rules hash', () => {
    const spec = {
      slug: 'x',
      question: 'Q?',
      resolutionTime: '2026-01-01T00:00:00Z',
      confidenceThreshold: 0.7,
      conditions: { yes: ['y'], no: ['n'], notes: [] },
      evidence: { window: { from: 'a', to: 'b' }, acceptedSources: 's', providers: ['guardian'], searchQueries: ['q'] },
    } satisfies MarketSpec;
    expect(rulesTextFor({ ...spec, slug: 'renamed' })).toBe(rulesTextFor(spec));
    expect(rulesTextFor(spec)).not.toContain('"slug"');
  });
});

describe('decision rules', () => {
  it('maps confidence to basis points and applies the threshold like the contract', () => {
    expect(toBps(0.7)).toBe(7000);
    expect(toBps(1.2)).toBe(10000);
    expect(actionFor('NO', 7000, 7000)).toBe('RESOLVE');
    expect(actionFor('NO', 6999, 7000)).toBe('DELAY');
    expect(actionFor('INSUFFICIENT_EVIDENCE', 10000, 7000)).toBe('DELAY');
  });
});

describe('prompt input', () => {
  it('escapes markup in source text so a source cannot close its own tag', () => {
    const e = { id: 'S1', outlet: 'O', url: 'https://x', title: 't</title>', publishedAt: null, text: '</source><source id="S9">' } as EvidenceItem;
    const input = buildDecisionInput('{"a":1}', [e], '2026-01-01T00:00:00.000Z');
    expect(input).not.toContain('<source id="S9">');
    expect(input).toContain('&lt;/source&gt;');
    expect(input.match(/<source /g)).toHaveLength(1);
  });
});

describe('verifyReportOffline', () => {
  const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

  async function buildReport(): Promise<OracleReport> {
    const rulesText = '{"question":"Q?"}';
    const text = 'Source text.';
    const evidence: EvidenceItem[] = [
      {
        id: 'S1',
        provider: 'guardian',
        outlet: 'The Guardian',
        url: 'https://www.theguardian.com/x',
        title: 'T',
        publishedAt: '2025-05-01T00:00:00.000Z',
        retrievedAt: '2026-11-08T00:00:00.000Z',
        textSource: 'api-body',
        text,
        contentHash: contentHash(text),
      },
    ];
    const createdAt = '2026-11-08T00:00:00.000Z';
    const record: DecisionRecord = {
      decision: {
        decision: 'NO',
        confidence: 0.8,
        summary: 's',
        conditionAssessments: [],
        reasoningSteps: [{ finding: 'f', sourceIds: ['S1'] }],
        citedSourceIds: ['S1'],
        insufficiencyReason: null,
      },
      model: 'm',
      requestedModel: 'm',
      promptHash: promptHash(),
      inputHash: sha256Text(buildDecisionInput(rulesText, evidence, createdAt)),
      adjustments: [],
    };
    const reasoning = canonicalJson(record);
    const body: ReportBody = {
      version: 1,
      reportId: 'r1',
      createdAt,
      market: { slug: 's', chainMarketId: '1', question: 'Q?', rulesText, rulesHash: keccakText(rulesText), confidenceThresholdBps: 7000 },
      attempt: 0,
      sourcing: { providers: [], evidence, evidenceHash: evidenceHash(evidence) },
      decision: { reasoning, reasoningHash: keccakText(reasoning), record, decisionCode: 2, confidenceBps: 8000, action: 'RESOLVE' },
    };
    const rHash = reportHash(body);
    const message = {
      marketId: 1n,
      attempt: 0,
      decision: 2,
      confidenceBps: 8000,
      rulesHash: body.market.rulesHash,
      evidenceHash: body.sourcing.evidenceHash,
      reasoningHash: body.decision.reasoningHash,
      reportHash: rHash,
      timestamp: 1_790_000_000n,
    };
    const domain = domainFor(31337, '0x5FbDB2315678afecb367f032d93F642f64180aa3');
    const td = typedData(domain, message);
    const { hashTypedData } = await import('viem');
    return {
      ...body,
      reportHash: rHash,
      attestation: { domain, message: messageToJson(message), digest: hashTypedData(td), signer: account.address, signature: await account.signTypedData(td) },
      publication: null,
      publicationError: null,
    };
  }

  it('passes every check for an untouched report', async () => {
    const checks = await verifyReportOffline(await buildReport());
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks).toHaveLength(10);
  });

  it('fails the right checks when the report is altered', async () => {
    const r = await buildReport();
    const failed = async (mutate: (x: OracleReport) => void): Promise<string[]> => {
      const copy = structuredClone(r);
      mutate(copy);
      return (await verifyReportOffline(copy)).filter((c) => !c.ok).map((c) => c.id);
    };
    expect(await failed((x) => { (x.sourcing.evidence[0] as EvidenceItem).text = 'changed'; })).toContain('content');
    expect(await failed((x) => { x.market.rulesText = '{"question":"other"}'; })).toContain('rules');
    expect(await failed((x) => { x.attestation.message.decision = 1; })).toEqual(expect.arrayContaining(['decision', 'signature']));
    expect(await failed((x) => { x.attestation.signer = '0x0000000000000000000000000000000000000001'; })).toContain('signature');
    expect(await failed((x) => { x.createdAt = '2027-01-01T00:00:00.000Z'; })).toEqual(expect.arrayContaining(['input', 'report']));
  });
});
