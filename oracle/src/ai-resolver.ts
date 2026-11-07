/**
 * AI Resolver - Simulates AI-based market resolution
 * 
 * Demo: NASA astrobiology market with specific reasoning
 */

export interface Market {
  id: `0x${string}` | string;
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
   * 
   * For the NASA astrobiology demo market, returns specific reasoning
   * about amino acids vs. definitive life evidence
   */
  async resolve(market: Market): Promise<ResolutionResult> {
    const isDemoMarket = market.id === 'demo-nasa-astrobiology-2025' || 
                         market.question.toLowerCase().includes('nasa') &&
                         market.question.toLowerCase().includes('extraterrestrial');

    if (isDemoMarket) {
      return this.resolveNASAAstrobiology(market);
    }

    // Generic resolution for other markets
    const questionHash = hashString(market.question.toLowerCase());
    const outcomes: ('YES' | 'NO' | 'INVALID')[] = ['YES', 'NO', 'INVALID'];
    const outcomeIndex = questionHash % 3;
    const outcome = outcomes[outcomeIndex];
    const confidence = this.calculateConfidence(market.resolutionCriteria);

    return {
      outcome,
      outcomeHash: this.hashOutcome(outcome),
      confidence,
      reasoning: this.generateReasoning(market, outcome, confidence),
      evidence: this.gatherEvidence(market),
      timestamp: Date.now(),
    };
  }

  private resolveNASAAstrobiology(market: Market): ResolutionResult {
    // Specific reasoning for the NASA astrobiology market
    const reasoning = `Analysis of 2025 NASA discoveries regarding extraterrestrial life:

KEY FINDING: NASA's OSIRIS-REx mission reported the discovery of amino acids on the asteroid Bennu in 2025. However, amino acids are precursor molecules to life — they represent the building blocks from which life can emerge, but are not themselves evidence of living organisms.

RESOLUTION CRITERIA ANALYSIS:
- The market criteria explicitly distinguishes between "living organisms, fossilized life, or unambiguous biosignatures" (which would resolve YES) and "precursor molecules" (which resolve NO)
- Amino acids fall under the category of precursor molecules
- No definitive evidence of actual extraterrestrial life was announced by NASA in 2025

CONFIDENCE ASSESSMENT: High confidence (92%) due to clear distinction between precursor molecules and life itself in both the scientific literature and market criteria.

CONCLUSION: While the amino acid discovery is scientifically significant, it does not meet the threshold for "definitive evidence of extraterrestrial life" as specified in the market criteria.`;

    return {
      outcome: 'NO',
      outcomeHash: this.hashOutcome('NO'),
      confidence: 0.92,
      reasoning: reasoning.trim(),
      evidence: [
        'NASA OSIRIS-REx Mission Results (2025) — Amino acids detected on asteroid Bennu',
        'NASA Astrobiology Research Papers — Distinction between precursor molecules and biosignatures',
        'Scientific Literature — Amino acids as building blocks, not evidence of life itself',
        'Market Criteria Analysis — Explicit exclusion of precursor molecules from YES resolution',
      ],
      timestamp: Date.now(),
    };
  }

  private calculateConfidence(criteria: string): number {
    // Simple heuristic: longer, more specific criteria = higher confidence
    const specificityScore = Math.min(criteria.length / 100, 1);
    const hasNumbers = /\d/.test(criteria) ? 0.2 : 0;
    const hasSource = /coinbase|binance|coingecko|api|nasa|scientific/i.test(criteria) ? 0.2 : 0;
    
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
    return [
      `News aggregation from verified sources`,
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
