/** Fast-forward local anvil time. Usage: npm run demo:warp -- <seconds> (default 300) */
import { publicClient, warp } from './lib.js';

const seconds = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 300);
await warp(seconds);
const b = await publicClient.getBlock();
console.log(`⏩ advanced ${seconds}s — chain time is now ${new Date(Number(b.timestamp) * 1000).toISOString()}`);
