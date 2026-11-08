import Anthropic from '@anthropic-ai/sdk';
import {
  buildDecisionInput,
  DECISION_SCHEMA,
  promptHash,
  sha256Text,
  SYSTEM_PROMPT,
  type DecisionRecord,
  type EvidenceItem,
  type ModelDecision,
} from '@oracle/shared';
import { z } from 'zod';
import type { Effort } from '../config.ts';

export class DecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecisionError';
  }
}

const ModelDecisionSchema = z.object({
  decision: z.enum(['YES', 'NO', 'INSUFFICIENT_EVIDENCE']),
  confidence: z.number(),
  summary: z.string(),
  conditionAssessments: z.array(
    z.object({
      side: z.enum(['YES', 'NO']),
      condition: z.string(),
      status: z.enum(['MET', 'NOT_MET', 'UNCLEAR']),
      explanation: z.string(),
      sourceIds: z.array(z.string()),
    }),
  ),
  reasoningSteps: z.array(z.object({ finding: z.string(), sourceIds: z.array(z.string()) })),
  citedSourceIds: z.array(z.string()),
  insufficiencyReason: z.string(),
});

export interface DecisionInput {
  rulesText: string;
  evidence: EvidenceItem[];
  asOf: string;
}

/** Anything that can turn rules + evidence into a decision record. */
export type Decider = (input: DecisionInput) => Promise<DecisionRecord>;

/**
 * Applies oracle-side integrity rules to raw model output. Every change is recorded in
 * `adjustments`, which is part of the signed decision logic.
 */
export function normalizeDecision(raw: unknown, evidence: EvidenceItem[]): { decision: ModelDecision; adjustments: string[] } {
  const parsed = ModelDecisionSchema.safeParse(raw);
  if (!parsed.success) throw new DecisionError(`model output failed validation: ${parsed.error.message}`);
  const d = parsed.data;
  const adjustments: string[] = [];
  const known = new Set(evidence.map((e) => e.id));

  const keepKnown = (ids: string[], where: string): string[] => {
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) adjustments.push(`removed unknown source ids from ${where}: ${unknown.join(', ')}`);
    return [...new Set(ids.filter((id) => known.has(id)))];
  };

  let confidence = d.confidence;
  if (!(confidence >= 0 && confidence <= 1)) {
    const clamped = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
    adjustments.push(`confidence ${confidence} clamped to ${clamped}`);
    confidence = clamped;
  }

  const decision: ModelDecision = {
    decision: d.decision,
    confidence,
    summary: d.summary.trim(),
    conditionAssessments: d.conditionAssessments.map((c, i) => ({
      ...c,
      sourceIds: keepKnown(c.sourceIds, `conditionAssessments[${i}]`),
    })),
    reasoningSteps: d.reasoningSteps.map((s, i) => ({ ...s, sourceIds: keepKnown(s.sourceIds, `reasoningSteps[${i}]`) })),
    citedSourceIds: keepKnown(d.citedSourceIds, 'citedSourceIds'),
    insufficiencyReason: d.insufficiencyReason.trim() === '' ? null : d.insufficiencyReason.trim(),
  };

  // A settlement must rest on at least one published source.
  if (decision.decision !== 'INSUFFICIENT_EVIDENCE' && decision.citedSourceIds.length === 0) {
    adjustments.push(`model answered ${decision.decision} without citing any supplied source; downgraded to INSUFFICIENT_EVIDENCE`);
    decision.insufficiencyReason = `The model's ${decision.decision} verdict cited no supplied source.`;
    decision.decision = 'INSUFFICIENT_EVIDENCE';
  }
  if (decision.decision === 'INSUFFICIENT_EVIDENCE' && !decision.insufficiencyReason) {
    decision.insufficiencyReason = 'The model did not state what evidence is missing.';
    adjustments.push('added missing insufficiencyReason');
  }
  return { decision, adjustments };
}

export interface ClaudeDeciderOptions {
  apiKey: string;
  model: string;
  effort: Effort;
  fallbacks: 'default' | 'off';
}

/** Production decider: one Claude call with structured output, validated and normalized. */
export function claudeDecider(opts: ClaudeDeciderOptions): Decider {
  const client = new Anthropic({ apiKey: opts.apiKey });
  return async ({ rulesText, evidence, asOf }) => {
    const input = buildDecisionInput(rulesText, evidence, asOf);
    let message: Anthropic.Beta.BetaMessage;
    try {
      const stream = client.beta.messages.stream({
        model: opts.model,
        max_tokens: 32000,
        thinking: { type: 'adaptive' },
        output_config: { effort: opts.effort, format: { type: 'json_schema', schema: DECISION_SCHEMA } },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: input }],
        // Server-side refusal fallback: if the model declines, the API reruns on a fallback model.
        // The model that actually answered is recorded in the decision record.
        ...(opts.fallbacks === 'default'
          ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
          : {}),
      });
      message = await stream.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new DecisionError('Anthropic API key was rejected');
      if (err instanceof Anthropic.RateLimitError) throw new DecisionError('Anthropic API rate limit hit; retry later');
      if (err instanceof Anthropic.APIError) throw new DecisionError(`Anthropic API error ${err.status ?? ''}: ${err.message}`);
      throw new DecisionError(`could not reach the Anthropic API: ${(err as Error).message}`);
    }

    if (message.stop_reason === 'refusal') {
      throw new DecisionError(`model declined to answer (${message.stop_details?.category ?? 'no category'})`);
    }
    if (message.stop_reason === 'max_tokens') throw new DecisionError('model output was cut off at max_tokens');

    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new DecisionError('model did not return valid JSON');
    }
    const { decision, adjustments } = normalizeDecision(raw, evidence);
    return {
      decision,
      model: message.model,
      requestedModel: opts.model,
      promptHash: promptHash(),
      inputHash: sha256Text(input),
      adjustments,
    };
  };
}
