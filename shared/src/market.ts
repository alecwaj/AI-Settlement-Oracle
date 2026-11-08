import { canonicalJson, keccakText } from './hashing.ts';
import type { Hex, MarketSpec } from './types.ts';

/** Canonical settlement-rules document for a market. This exact string is stored on-chain. */
export function rulesTextFor(spec: MarketSpec): string {
  const { question, resolutionTime, confidenceThreshold, conditions, evidence } = spec;
  return canonicalJson({ question, resolutionTime, confidenceThreshold, conditions, evidence });
}

export function rulesHashFor(spec: MarketSpec): Hex {
  return keccakText(rulesTextFor(spec));
}
