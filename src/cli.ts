import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, Option } from 'commander';
import { run, type RunOptions } from './index.js';

const pkgVersion: string = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
).version;

function parseViewport(s: string): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/i.exec(s);
  if (!m) throw new Error(`Bad --viewport "${s}" (expected WxH, e.g. 360x800)`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

function list(s: string, prev: string[] = []): string[] {
  return prev.concat(s.split(',').map((x) => x.trim()).filter(Boolean));
}

export async function main(argv: string[]): Promise<number> {
  const program = new Command();
  program
    .name('rn-style-map')
    .description('Offline, low-token map of resolved React Native styles per route, for AI agents and CI.')
    .version(pkgVersion)
    .option('--route <glob>', 'route path(s), e.g. /login, "/(tabs)/*" (repeatable, comma-separated)', list)
    .option('--entry <file>', 'map a single component file instead of discovering routes')
    .option('--depth <n>', 'max tree depth', '6')
    .option('--only <names>', 'keep only these component names (ancestors kept as …)', list)
    .option('--tokens', 'print the project token table with use counts')
    .addOption(new Option('--format <fmt>', 'output format').choices(['compact', 'json', 'md']).default('compact'))
    .option('--budget <n>', 'token cap per route (o200k); trims by priority')
    .option('--diff <ref>', 'only routes/nodes changed vs a git ref')
    .addOption(new Option('--platform <p>', 'platform').choices(['android', 'ios']).default('android'))
    .addOption(new Option('--scheme <s>', 'colour scheme').choices(['light', 'dark']).default('light'))
    .option('--viewport <WxH>', 'window size in dp for scaler helpers', '360x800')
    .option('--unresolved', 'list unresolved props with reason codes')
    .option('--explain', 'show which style layer won for each overridden prop')
    .option('--why', 'alias for --explain')
    .option('--audit', 'run the audit engine; exit 1 on error findings')
    .option('--strict', 'with --audit: warnings also fail')
    .option('--exit-zero', 'with --audit: report only, always exit 0')
    .option('--root <dir>', 'project root (default: current directory)')
    .option('--config <file>', 'config file (default: <root>/rn-style-map.config.json)')
    .option('-o, --out <file>', 'write output to a file instead of stdout')
    .exitOverride();
  try {
    program.parse(argv);
  } catch (e: any) {
    if (e?.code === 'commander.helpDisplayed' || e?.code === 'commander.version') return 0;
    return 2;
  }
  const o = program.opts();
  try {
    const root = path.resolve(o.root ?? process.cwd());
    const cfgFile = o.config ? path.resolve(o.config) : path.join(root, 'rn-style-map.config.json');
    let config = undefined;
    if (fs.existsSync(cfgFile)) config = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    else if (o.config) throw new Error(`Config not found: ${cfgFile}`);
    const depth = Number(o.depth);
    if (!Number.isInteger(depth) || depth < 1) throw new Error(`Bad --depth "${o.depth}"`);
    const budget = o.budget === undefined ? undefined : Number(o.budget);
    if (budget !== undefined && (!Number.isFinite(budget) || budget < 50)) throw new Error(`Bad --budget "${o.budget}" (min 50)`);
    const ro: RunOptions = {
      root,
      route: o.route,
      entry: o.entry ? path.resolve(root, o.entry) : undefined,
      depth,
      only: o.only,
      platform: o.platform,
      scheme: o.scheme,
      viewport: parseViewport(o.viewport),
      config,
      format: o.format,
      budget,
      unresolved: Boolean(o.unresolved),
      explain: Boolean(o.explain || o.why),
      tokens: Boolean(o.tokens),
      audit: Boolean(o.audit),
      diff: o.diff,
    };
    const res = await run(ro);
    for (const w of res.warnings) process.stderr.write(`rn-style-map: warning: ${w}\n`);
    if (o.out) fs.writeFileSync(o.out, res.output);
    else process.stdout.write(res.output);
    if (!o.audit || o.exitZero) return 0;
    const f = res.result.findings ?? [];
    if (f.some((x) => x.severity === 'error')) return 1;
    if (o.strict && f.some((x) => x.severity === 'warn')) return 1;
    return 0;
  } catch (e: any) {
    process.stderr.write(`rn-style-map: ${e?.message ?? e}\n`);
    if (process.env.RN_STYLE_MAP_DEBUG) process.stderr.write(String(e?.stack) + '\n');
    return 2;
  }
}

main(process.argv).then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.exitCode = 2;
  },
);
