import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@oracle/shared';
import { DecisionError, normalizeDecision } from '../src/ai/decide.ts';

const evidence = [{ id: 'S1' }, { id: 'S2' }] as EvidenceItem[];
const base = {
  decision: 'NO',
  confidence: 0.85,
  summary: ' Summary. ',
  conditionAssessments: [{ side: 'NO', condition: 'c', status: 'MET', explanation: 'e', sourceIds: ['S1', 'S9'] }],
  reasoningSteps: [{ finding: 'f', sourceIds: ['S2'] }],
  citedSourceIds: ['S1', 'S2', 'S1'],
  insufficiencyReason: '',
};

describe('normalizeDecision', () => {
  it('keeps a valid decision and records removed unknown citations', () => {
    const { decision, adjustments } = normalizeDecision(base, evidence);
    expect(decision.decision).toBe('NO');
    expect(decision.summary).toBe('Summary.');
    expect(decision.citedSourceIds).toEqual(['S1', 'S2']);
    expect(decision.conditionAssessments[0]?.sourceIds).toEqual(['S1']);
    expect(decision.insufficiencyReason).toBeNull();
    expect(adjustments).toEqual(['removed unknown source ids from conditionAssessments[0]: S9']);
  });

  it('downgrades a verdict that cites no supplied source', () => {
    const { decision, adjustments } = normalizeDecision({ ...base, citedSourceIds: ['S7'] }, evidence);
    expect(decision.decision).toBe('INSUFFICIENT_EVIDENCE');
    expect(decision.insufficiencyReason).toMatch(/cited no supplied source/);
    expect(adjustments.some((a) => a.includes('downgraded'))).toBe(true);
  });

  it('clamps out-of-range confidence', () => {
    const { decision, adjustments } = normalizeDecision({ ...base, confidence: 1.4 }, evidence);
    expect(decision.confidence).toBe(1);
    expect(adjustments[0]).toMatch(/clamped/);
  });

  it('rejects malformed output', () => {
    expect(() => normalizeDecision({ ...base, decision: 'MAYBE' }, evidence)).toThrow(DecisionError);
  });
});
