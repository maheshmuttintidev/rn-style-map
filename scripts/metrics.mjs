#!/usr/bin/env node
// Resolution + token metrics for one or more project roots.
// Usage: node scripts/metrics.mjs [--gate] [--min 90] [--max-tokens 1500] [--json] <root>...
// Tokens are counted with gpt-tokenizer o200k_base on the default compact output.
import { performance } from 'node:perf_hooks';
import { run } from '../dist/index.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => (args.includes(n) ? Number(args[args.indexOf(n) + 1]) : d);
const roots = args.filter((a, i) => !a.startsWith('--') && !['--min', '--max-tokens'].includes(args[i - 1]));
const min = val('--min', 90);
const maxTok = val('--max-tokens', 1500);
const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const i = (s.length - 1) * p;
  return Math.round(s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i)));
};
let fail = false;
const all = [];
for (const root of roots) {
  const t0 = performance.now();
  const res = await run({ root, depth: 6, platform: 'android', scheme: 'light', viewport: { width: 360, height: 800 }, format: 'compact', unresolved: false });
  const ms = Math.round(performance.now() - t0);
  const routes = res.result.routes;
  const resolved = routes.reduce((a, r) => a + r.stats.resolved, 0);
  const total = routes.reduce((a, r) => a + r.stats.total, 0);
  const toks = routes.map((r) => r.stats.tokens);
  const reasons = {};
  for (const r of routes) for (const u of r.unresolved) reasons[u.reason] = (reasons[u.reason] ?? 0) + 1;
  const pct = total ? (resolved / total) * 100 : 100;
  const m = { root, routes: routes.length, resolved, total, pct: Math.round(pct * 10) / 10, tokMax: Math.max(0, ...toks), tokMedian: q(toks, 0.5), tokP90: q(toks, 0.9), ms, reasons, worst: routes.map((r) => ({ path: r.path, pct: r.stats.total ? Math.round((r.stats.resolved / r.stats.total) * 1000) / 10 : 100, tokens: r.stats.tokens })) };
  all.push(m);
  if (pct < min || m.tokMax > maxTok) fail = true;
}
if (flag('--json')) process.stdout.write(JSON.stringify(all, null, 2) + '\n');
else
  for (const m of all)
    console.log(`${m.root}: ${m.routes} routes, resolved ${m.resolved}/${m.total} (${m.pct}%), tokens(o200k) max ${m.tokMax} median ${m.tokMedian} p90 ${m.tokP90}, ${m.ms} ms, reasons ${JSON.stringify(m.reasons)}`);
if (flag('--gate') && fail) {
  console.error(`metrics gate failed (min ${min}% resolved, max ${maxTok} tokens/route)`);
  process.exit(1);
}
