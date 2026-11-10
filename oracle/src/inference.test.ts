import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractModelPins, parseTeerminatorStatus } from './inference-attestation.js';
import { ConfidentialResolver, decisionJsonSchema } from './resolver.js';
import { loadConfig, DEFAULT_CONFIDENTIAL_MODEL } from './config.js';
import type OpenAI from 'openai';

// Sample from the TEErminator README.
const STATUS = `Local            Remote                                                 Auth   Mode       Status
127.0.0.1:8080   https://api.openai.com/v1/                             Token  None       Untrusted
127.0.0.1:14323  https://confidential-vllm-production-stack.lunal.dev/  None   attest-lb  Verified
[::1]:8080       https://api.ollama.provider.com/v1/                    Token  None       Failed

127.0.0.1:14323: measurement 6d86ee, workload api, trust deployment-class (ca-vouched), route digest 3f1c (operator-signed, revision 12)
`;

describe('parseTeerminatorStatus', () => {
  it('reads the verdict and details for the configured local address', () => {
    const s = parseTeerminatorStatus(STATUS, '127.0.0.1:14323');
    expect(s.verdict).toBe('Verified');
    expect(s.mode).toBe('attest-lb');
    expect(s.details).toMatch(/workload api/);
    expect(parseTeerminatorStatus(STATUS, '127.0.0.1:8080').verdict).toBe('Untrusted');
    expect(parseTeerminatorStatus(STATUS, '[::1]:8080').verdict).toBe('Failed');
    expect(parseTeerminatorStatus(STATUS, '127.0.0.1:9999').verdict).toBe('Unknown');
  });
});

describe('extractModelPins', () => {
  it('pulls repo, revision and weight-index hash from the live allowlist format', () => {
    const doc = JSON.parse(readFileSync(new URL('./fixtures/allowlist-inference-worker.json', import.meta.url), 'utf8'));
    const pins = extractModelPins(doc);
    expect(pins).toHaveLength(1);
    expect(pins[0].servedModelName).toBe(DEFAULT_CONFIDENTIAL_MODEL);
    expect(pins[0].revision).toBe('1bae0e1088993b9b82de08f59de5be5a34e42170');
    expect(pins[0].expectedFiles['model.safetensors.index.json']).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('decisionJsonSchema', () => {
  it('is strict-mode friendly', () => {
    const s = JSON.stringify(decisionJsonSchema());
    expect(s).not.toContain('$schema');
    expect(s).not.toContain('"minimum"');
    expect(decisionJsonSchema().additionalProperties).toBe(false);
  });
});

describe('ConfidentialResolver', () => {
  const input = { question: 'q', resolutionCriteria: 'c', resolutionTime: 0, round: 0, submissions: [] };
  const fake = (content: string, finish = 'stop') =>
    ({ chat: { completions: { create: async () => ({ id: 'cmpl-1', model: DEFAULT_CONFIDENTIAL_MODEL, choices: [{ finish_reason: finish, message: { content } }], usage: { total_tokens: 1 } }) } } }) as unknown as OpenAI;

  it('parses and validates a structured decision', async () => {
    const d = { outcome: 'NO', confidence: 0.91, reasoning: 'r', key_facts: [], evidence_assessments: [], missing_information: '' };
    const out = await new ConfidentialResolver(DEFAULT_CONFIDENTIAL_MODEL, 'http://x', 'k', fake(JSON.stringify(d))).resolve(input);
    expect(out.provider).toBe('confidential');
    expect(out.decision.outcome).toBe('NO');
  });
  it('rejects truncated, non-JSON and off-schema output (never signed)', async () => {
    await expect(new ConfidentialResolver('m', 'http://x', 'k', fake('{}', 'length')).resolve(input)).rejects.toThrow(/truncated/);
    await expect(new ConfidentialResolver('m', 'http://x', 'k', fake('nope')).resolve(input)).rejects.toThrow(/JSON/);
    await expect(new ConfidentialResolver('m', 'http://x', 'k', fake('{"outcome":"MAYBE"}')).resolve(input)).rejects.toThrow(/schema/);
  });
});

describe('inference attestation policy', () => {
  it('requires attested inference by default in a real TEE, and only confidential mode satisfies it', () => {
    expect(loadConfig({ TEE_MODE: 'dstack', DEPLOYMENT_FILE: '/x' }).requireAttestedInference).toBe(true);
    expect(() => loadConfig({ TEE_MODE: 'dstack', LLM_MODE: 'anthropic', DEPLOYMENT_FILE: '/x' })).toThrow(/no inference attestation/);
    expect(loadConfig({ TEE_MODE: 'dev', LLM_MODE: 'anthropic', DEPLOYMENT_FILE: '/x' }).requireAttestedInference).toBe(false);
  });
});
