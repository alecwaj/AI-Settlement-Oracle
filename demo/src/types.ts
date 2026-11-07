export interface Market {
  id: string
  question: string
  resolutionCriteria: string
  resolutionTime: number
  resolved?: boolean
  outcome?: string
}

export interface Resolution {
  marketId: string
  outcome: string
  timestamp: string
  reasoning: string
}

export interface Attestation {
  resolution: Resolution
  signature: string
  signer: string
}

export interface ResolutionResult {
  outcome: 'YES' | 'NO' | 'INVALID'
  outcomeHash: string
  confidence: number
  reasoning: string
  evidence: string[]
  timestamp: number
}
