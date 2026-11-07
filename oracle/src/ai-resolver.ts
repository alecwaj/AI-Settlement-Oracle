/**
 * AI Resolver - Simulates AI-based market resolution
 * 
 * In production, this would:
 * 1. Fetch evidence from APIs (prices, news, etc.)
 * 2. Run LLM inference with deterministic seeding
 * 3. Generate reasoning and outcome
 * 
 * For demo: deterministic mock based on question hash
 */

export interface Market {
  id: `0x${string}`;
  question: string;
  resolutionCriteria: string;
  resolutionTime: number;
}

export interface ResolutionResult {
  outcome: 'YES' | 'NO' | 'INVALID';
  outcomeHash: `0x${string}`;
  confidence: number;
  reasoning: string;
  evidence: string[];
  timestamp: number;
}

// Simple deterministic hash function for demo
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export class AIResolver {
  /**
   * Resolve a market using AI (simulated for demo)
   */
  async resolve(market: Market): Promise<ResolutionResult> {
    const questionHash = hashString(market.question.toLowerCase());
    
    // Deterministic outcome based on question hash
    const outcomes: ('YES' | 'NO' | 'INVALID')[] = ['YES', 'NO', 'INVALID'];
    const outcomeIndex = questionHash % 3;
    const outcome = outcomes[outcomeIndex];
    
    // Confidence based on criteria clarity
    const confidence = this.calculateConfidence(market.resolutionCriteria);
    
    // Generate reasoning
    const reasoning = this.generateReasoning(market, outcome, confidence);
    
    // Mock evidence
    const evidence = this.gatherEvidence(market);
    
    return {
      outcome,
      outcomeHash: this.hashOutcome(outcome),
      confidence,
      reasoning,
      evidence,
      timestamp: Date.now(),
    };
  }

  private calculateConfidence(criteria: string): number {
    // Simple heuristic: longer, more specific criteria = higher confidence
    const specificityScore = Math.min(criteria.length / 100, 1);
    const hasNumbers = /\d/.test(criteria) ? 0.2 : 0;
    const hasSource = /coinbase|binance|coingecko|api/i.test(criteria) ? 0.2 : 0;
    
    return Math.min(0.5 + specificityScore * 0.3 + hasNumbers + hasSource, 0.99);
  }

  private generateReasoning(
    market: Market,
    outcome: 'YES' | 'NO' | 'INVALID',
    confidence: number
  ): string {
    const reasoningMap: Record<string, string> = {
      YES: `Based on the resolution criteria "${market.resolutionCriteria}", the evidence supports a YES outcome. The specified conditions were met at the resolution time.`,
      NO: `Based on the resolution criteria "${market.resolutionCriteria}", the evidence indicates a NO outcome. The specified conditions were not satisfied at the resolution time.`,
      INVALID: `The resolution criteria "${market.resolutionCriteria}" were ambiguous or insufficient to determine a definitive outcome. The market may need clearer specifications.`,
    };

    const baseReasoning = reasoningMap[outcome];
    return `${baseReasoning} Confidence: ${(confidence * 100).toFixed(1)}%. Resolution performed by AI Settlement Oracle v0.1.0.`;
  }

  private gatherEvidence(market: Market): string[] {
    // Mock evidence sources
    return [
      `Price data from Coinbase API (simulated)`,
      `Timestamp verification: ${new Date().toISOString()}`,
      `Criteria match analysis completed`,
    ];
  }

  private hashOutcome(outcome: string): `0x${string}` {
    // Simple hash for demo - in production use proper keccak256
    const encoder = new TextEncoder();
    const data = encoder.encode(outcome);
    const hashBytes = new Uint8Array(32);
    
    for (let i = 0; i < 32; i++) {
      hashBytes[i] = data[i % data.length] ^ (i * 7);
    }
    
    return '0x' + Array.from(hashBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('') as `0x${string}`;
  }
}
