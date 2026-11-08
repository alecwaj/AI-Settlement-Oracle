/**
 * Verifies a signed oracle report file independently of the oracle service.
 *   npm run verify -- path/to/report.json [--rpc http://127.0.0.1:8545]
 */
import { readFileSync } from 'node:fs';
import { createPublicClient, http, type PublicClient } from 'viem';
import { verifyReportOffline, verifyReportOnChain, type OracleReport } from '@oracle/shared';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const rpcIdx = args.indexOf('--rpc');
const rpc = rpcIdx >= 0 ? args[rpcIdx + 1] : process.env.RPC_URL;
if (!file) {
  console.error('usage: npm run verify -- <report.json> [--rpc <url>]');
  process.exit(2);
}
const report = JSON.parse(readFileSync(file, 'utf8')) as OracleReport;
const checks = await verifyReportOffline(report);
if (rpc) {
  const client = createPublicClient({ transport: http(rpc) }) as PublicClient;
  checks.push(...(await verifyReportOnChain(client, report)));
} else {
  console.log('(no --rpc given: skipping on-chain checks)');
}
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label.padEnd(42)} ${c.detail}`);
const ok = checks.every((c) => c.ok);
console.log(ok ? '\nReport verified.' : '\nVerification FAILED.');
process.exit(ok ? 0 : 1);
