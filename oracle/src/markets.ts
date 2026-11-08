import type { MarketSpec } from '@oracle/shared';

/**
 * Markets this oracle settles. Each spec's canonical JSON (see rulesTextFor) is registered
 * on-chain at startup, and every signed decision commits to its hash.
 */
export const MARKETS: MarketSpec[] = [
  {
    slug: 'nasa-extraterrestrial-life-2025',
    question: 'Will NASA find definitive evidence of extraterrestrial life in 2025?',
    resolutionTime: '2026-01-01T00:00:00Z',
    confidenceThreshold: 0.7,
    conditions: {
      yes: [
        'Between 1 January 2025 and 31 December 2025 (UTC), NASA officially announced the discovery of extraterrestrial life: living organisms, fossilised life, or a biosignature that NASA itself presents as confirmed, unambiguous evidence of life beyond Earth.',
      ],
      no: [
        'NASA made no such announcement between 1 January 2025 and 31 December 2025 (UTC).',
        'The findings NASA announced in 2025 are limited to precursor molecules (such as amino acids, nucleobases or other organic compounds), habitability indicators, or potential or possible biosignatures that NASA does not present as confirmed evidence of life.',
      ],
      notes: [
        '"Definitive" means NASA presents the finding as confirmed evidence of life, not as a candidate that requires further study or confirmation.',
        'Findings by other agencies or independent researchers count only if NASA officially endorsed them as definitive evidence of life during 2025.',
        'Media characterisations (for example "the clearest sign of life yet") do not by themselves meet the YES condition; what NASA stated is decisive.',
      ],
    },
    evidence: {
      window: { from: '2025-01-01T00:00:00Z', to: '2026-01-31T23:59:59Z' },
      acceptedSources:
        'Official NASA communications, and reporting by established news organisations (The Guardian, Reuters, Associated Press, BBC, NPR) or peer-reviewed journals (Nature, Science).',
      providers: ['guardian', 'gdelt', 'nasa'],
      searchQueries: [
        'NASA extraterrestrial life',
        'NASA biosignature',
        'NASA evidence of life Mars',
        'NASA life beyond Earth',
        'NASA asteroid sample organic molecules',
      ],
    },
  },
];

export function findMarket(slug: string): MarketSpec | undefined {
  return MARKETS.find((m) => m.slug === slug);
}
