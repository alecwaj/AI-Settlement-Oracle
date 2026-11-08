import type { Address, Eip712DomainJson, Hex, ResolutionMessageJson } from './types.ts';

export const EIP712_NAME = 'SettlementOracle';
export const EIP712_VERSION = '1';

/** Must match SettlementOracle.RESOLUTION_TYPEHASH field order exactly. */
export const RESOLUTION_TYPES = {
  Resolution: [
    { name: 'marketId', type: 'uint256' },
    { name: 'attempt', type: 'uint32' },
    { name: 'decision', type: 'uint8' },
    { name: 'confidenceBps', type: 'uint16' },
    { name: 'rulesHash', type: 'bytes32' },
    { name: 'evidenceHash', type: 'bytes32' },
    { name: 'reasoningHash', type: 'bytes32' },
    { name: 'reportHash', type: 'bytes32' },
    { name: 'timestamp', type: 'uint64' },
  ],
} as const;

export interface ResolutionMessage {
  marketId: bigint;
  attempt: number;
  decision: number;
  confidenceBps: number;
  rulesHash: Hex;
  evidenceHash: Hex;
  reasoningHash: Hex;
  reportHash: Hex;
  timestamp: bigint;
}

export function domainFor(chainId: number, verifyingContract: Address): Eip712DomainJson {
  return { name: EIP712_NAME, version: EIP712_VERSION, chainId, verifyingContract };
}

export function messageToJson(m: ResolutionMessage): ResolutionMessageJson {
  return { ...m, marketId: m.marketId.toString(), timestamp: m.timestamp.toString() };
}

export function messageFromJson(m: ResolutionMessageJson): ResolutionMessage {
  return { ...m, marketId: BigInt(m.marketId), timestamp: BigInt(m.timestamp) };
}

export function typedData(domain: Eip712DomainJson, message: ResolutionMessage) {
  return {
    domain,
    types: RESOLUTION_TYPES,
    primaryType: 'Resolution' as const,
    message,
  };
}
