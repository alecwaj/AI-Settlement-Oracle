import { concat, encodeAbiParameters, keccak256, sha256, toBytes, type Hex } from 'viem';
import type { DecisionLabel, OracleAction, ReportBody } from './types.ts';

/**
 * Deterministic JSON: object keys sorted, no whitespace. Used for every hashed document so that
 * anyone can reproduce the hash from the published data.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** SHA-256 of UTF-8 text, as stored per evidence item (matches `sha256(bytes(text))` in Solidity). */
export function contentHash(text: string): Hex {
  return sha256(toBytes(text));
}

export function sha256Text(text: string): Hex {
  return sha256(toBytes(text));
}

/** keccak256 of UTF-8 text (matches `keccak256(bytes(text))` in Solidity). */
export function keccakText(text: string): Hex {
  return keccak256(toBytes(text));
}

/** Mirrors SettlementOracle.computeEvidenceHash. */
export function evidenceHash(sources: ReadonlyArray<{ url: string; contentHash: Hex }>): Hex {
  const leaves = sources.map((s) =>
    keccak256(
      encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [keccakText(s.url), s.contentHash]),
    ),
  );
  return keccak256(leaves.length === 0 ? '0x' : concat(leaves));
}

/** keccak256 of the canonical report body (everything except the attestation and publication). */
export function reportHash(body: ReportBody): Hex {
  const { version, reportId, createdAt, market, attempt, sourcing, decision } = body;
  return keccakText(canonicalJson({ version, reportId, createdAt, market, attempt, sourcing, decision }));
}

export const DECISION_CODE: Record<DecisionLabel, number> = {
  INSUFFICIENT_EVIDENCE: 0,
  YES: 1,
  NO: 2,
};

export function toBps(confidence: number): number {
  return Math.max(0, Math.min(10_000, Math.round(confidence * 10_000)));
}

/** Mirrors the contract: insufficient evidence or confidence below threshold delays the market. */
export function actionFor(decision: DecisionLabel, confidenceBps: number, thresholdBps: number): OracleAction {
  return decision === 'INSUFFICIENT_EVIDENCE' || confidenceBps < thresholdBps ? 'DELAY' : 'RESOLVE';
}
