import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';

export interface TwTheme {
  [key: string]: any;
}

const CHILD = `
const Module = require('module');
const [cfgPath, bundled] = JSON.parse(process.argv[1]);
const stub = function () { return stub; };
stub.default = stub;
stub.withOptions = function () { return stub; };
const origLoad = Module._load;
Module._load = function (req) {
  try { return origLoad.apply(this, arguments); }
  catch (e) { if (e && e.code === 'MODULE_NOT_FOUND' && !req.startsWith('.') && !req.startsWith('/')) return req.includes('preset') ? {} : stub; throw e; }
};
let resolveConfig;
try { resolveConfig = require(require.resolve('tailwindcss/resolveConfig', { paths: [require('path').dirname(cfgPath)] })); }
catch { resolveConfig = require(bundled); }
let cfg = require(cfgPath);
cfg = cfg && cfg.default ? cfg.default : cfg;
if (cfg && Array.isArray(cfg.presets)) cfg.presets = cfg.presets.filter((p) => p && typeof p === 'object');
const full = resolveConfig(cfg || {});
const pick = {};
for (const k of Object.keys(full.theme)) { const v = full.theme[k]; if (typeof v !== 'function') pick[k] = v; }
process.stdout.write(JSON.stringify({ theme: pick, darkMode: full.darkMode }));
`;

const CONFIG_NAMES = ['tailwind.config.js', 'tailwind.config.cjs', 'tailwind.config.mjs', 'tailwind.config.ts'];

export function findTailwindConfig(root: string): string | null {
  for (const n of CONFIG_NAMES) if (existsSync(join(root, n))) return join(root, n);
  return null;
}

/**
 * Resolve the project's Tailwind theme in a child process (the config is project code, so it
 * runs isolated with a timeout). Missing packages such as `nativewind/preset` are stubbed so a
 * checkout without node_modules still works. Falls back to Tailwind's default theme.
 */
export function loadTailwindTheme(root: string): { theme: TwTheme; source: string; warning?: string } {
  const req = createRequire(import.meta.url);
  const bundled = req.resolve('tailwindcss/resolveConfig');
  const defaults = (): TwTheme => {
    const rc = req('tailwindcss/resolveConfig');
    return (rc.default ?? rc)({ content: [] }).theme;
  };
  const cfg = findTailwindConfig(root);
  if (!cfg) return { theme: defaults(), source: 'default' };
  const args = cfg.endsWith('.ts') ? ['--experimental-strip-types', '--no-warnings'] : [];
  const r = spawnSync(process.execPath, [...args, '-e', CHILD, JSON.stringify([cfg, bundled])], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status === 0 && r.stdout) {
    try {
      return { theme: JSON.parse(r.stdout).theme, source: cfg };
    } catch {
      /* fall through */
    }
  }
  const err = (r.stderr || String(r.error ?? '')).split('\n').find((l) => l.trim()) ?? 'unknown error';
  return { theme: defaults(), source: 'default', warning: `tailwind config could not be loaded (${err.trim().slice(0, 120)}); using default theme` };
}

export interface CssVars {
  light: Record<string, string>;
  dark: Record<string, string>;
}

const CSS_CANDIDATES = ['global.css', 'src/global.css', 'app/global.css', 'styles/global.css', 'src/styles/global.css'];

export function loadCssVars(root: string, extra: string[] = []): CssVars {
  const out: CssVars = { light: {}, dark: {} };
  for (const rel of [...CSS_CANDIDATES, ...extra]) {
    const f = join(root, rel);
    if (!existsSync(f)) continue;
    let ast: postcss.Root;
    try {
      ast = postcss.parse(readFileSync(f, 'utf8'));
    } catch {
      continue;
    }
    ast.walkDecls(/^--/, (d) => {
      const rule = d.parent as postcss.Rule | undefined;
      const sel = rule && 'selector' in rule ? rule.selector : '';
      let dark = /\.dark\b|\[data-theme=["']?dark/.test(sel);
      let p: postcss.Node | undefined = rule?.parent as postcss.Node | undefined;
      while (p) {
        if (p.type === 'atrule' && /prefers-color-scheme:\s*dark/.test((p as postcss.AtRule).params)) dark = true;
        p = p.parent as postcss.Node | undefined;
      }
      (dark ? out.dark : out.light)[d.prop] = d.value.trim();
    });
  }
  return out;
}
