/**
 * Runs only the sourcing and evidence steps for a market and prints what the model would see.
 * Nothing is sent to a model, signed or published; no Anthropic key or chain is needed.
 *   npm run preview-sources -- [market-slug] [--json]
 */
import { loadConfig } from '../config.ts';
import { findMarket, MARKETS } from '../markets.ts';
import { gatherEvidence } from '../news/aggregator.ts';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const slug = args.find((a) => !a.startsWith('--')) ?? MARKETS[0]?.slug;
const spec = slug ? findMarket(slug) : undefined;
if (!spec) {
  console.error(`unknown market "${slug}". Known: ${MARKETS.map((m) => m.slug).join(', ')}`);
  process.exit(2);
}
const config = loadConfig();
const result = await gatherEvidence(
  spec,
  { timeoutMs: config.httpTimeoutMs, guardianApiKey: config.guardianApiKey, log: (m) => asJson || console.log(`  ${m}`) },
  { maxEvidence: config.maxEvidence, maxCharsPerSource: config.maxCharsPerSource },
);
if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('\nProviders');
  for (const p of result.providers) {
    console.log(`  ${p.ok ? 'ok  ' : 'FAIL'} ${p.provider.padEnd(9)} found ${p.found}, usable ${p.kept}`);
    for (const e of p.errors) console.log(`         error: ${e}`);
    for (const n of p.notes) console.log(`         note: ${n}`);
  }
  console.log(`\nEvidence the model would read (${result.evidence.length})`);
  for (const e of result.evidence) {
    console.log(`  ${e.id.padEnd(4)} ${e.outlet} · ${e.publishedAt?.slice(0, 10) ?? 'undated'} · ${e.title}`);
    console.log(`       ${e.url}`);
    console.log(`       ${e.text.length} chars · sha256 ${e.contentHash}`);
  }
  if (result.evidence.length === 0) console.log('  (none: a resolution now would be INSUFFICIENT_EVIDENCE and delay the market)');
}
