import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze } from '../map.js';
import { nodeLine } from '../encode/compact.js';
import type { MapNode, Options, RouteMap } from '../types.js';

function git(cwd: string, args: string[], input?: Buffer): Buffer {
  return execFileSync('git', args, { cwd, input, maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'] });
}

/** Files changed between `ref` and the working tree, relative to `root`. Read-only. */
export function changedFiles(root: string, ref: string): Set<string> {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  } catch {
    throw new Error(`--diff: unknown git ref "${ref}"`);
  }
  const out = git(root, ['diff', '--name-only', '--relative', ref, '--', '.']).toString();
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard']).toString();
  return new Set((out + untracked).split('\n').map((s) => s.trim()).filter(Boolean));
}

/** Extract `ref` into a temp dir (git archive: never touches the working tree or worktree list). */
function checkoutRef(root: string, ref: string): { dir: string; root: string } {
  const top = git(root, ['rev-parse', '--show-toplevel']).toString().trim();
  const prefix = path.relative(top, root);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-style-map-'));
  const tar = git(top, ['archive', '--format=tar', ref, ...(prefix ? [prefix] : [])]);
  execFileSync('tar', ['-xf', '-', '-C', dir], { input: tar, maxBuffer: 1 << 28 });
  const oldRoot = path.join(dir, prefix);
  // reuse installed deps (tailwind config, presets) without copying
  const nm = path.join(root, 'node_modules');
  if (fs.existsSync(nm) && !fs.existsSync(path.join(oldRoot, 'node_modules'))) fs.symlinkSync(nm, path.join(oldRoot, 'node_modules'), 'junction');
  return { dir, root: oldRoot };
}

function sig(n: MapNode, file: string): string {
  const { children: _c, callsite: _cs, more: _m, ...rest } = n;
  void _c;
  void _cs;
  void _m;
  return nodeLine({ ...rest, loc: { file, line: 0 } }, file, { shortLoc: true }).replace(/\s+:0$/, '').trim();
}

function sigs(n: MapNode, file: string, out: Map<string, number>) {
  const s = sig(n, file);
  out.set(s, (out.get(s) ?? 0) + 1);
  n.children?.forEach((c) => sigs(c, file, out));
}

/** Keep changed nodes plus their ancestors (ancestors renamed `…Name`). */
function prune(n: MapNode, file: string, old: Map<string, number>): MapNode | null {
  const s = sig(n, file);
  const changed = (old.get(s) ?? 0) <= 0;
  if (!changed) old.set(s, old.get(s)! - 1);
  const kids = (n.children ?? []).map((c) => prune(c, file, old)).filter(Boolean) as MapNode[];
  if (!changed && !kids.length) return null;
  const out: MapNode = { ...n, children: kids.length ? kids : undefined };
  delete out.more;
  if (!changed) {
    out.name = '…' + n.name;
    delete out.style;
    delete out.text;
    delete out.a11y;
  }
  return out;
}

/** Node-level diff of mapped routes against `ref`. Unchanged routes are dropped. */
export function diffRoutes(current: RouteMap[], o: Options, ref: string, changed: Set<string>): RouteMap[] {
  if (!changed.size) return [];
  const co = checkoutRef(o.root, ref);
  try {
    let prev: RouteMap[] = [];
    try {
      prev = analyze({ ...o, root: co.root, entry: o.entry ? path.join(co.root, path.relative(o.root, o.entry)) : undefined }).routes;
    } catch {
      prev = [];
    }
    const byPath = new Map(prev.map((r) => [r.path, r]));
    const out: RouteMap[] = [];
    for (const r of current) {
      const p = byPath.get(r.path);
      const oldSigs = new Map<string, number>();
      if (p) sigs(p.tree, p.file, oldSigs);
      const tree = p ? prune(r.tree, r.file, oldSigs) : r.tree;
      const removed: string[] = [];
      for (const [s, c] of oldSigs) for (let i = 0; i < c; i++) removed.push(s);
      if (!tree && !removed.length) continue;
      out.push({ ...r, tree: tree ?? { name: '…' + r.tree.name, loc: r.tree.loc }, diff: { ref, status: p ? 'changed' : 'added', removed: removed.sort() } });
    }
    const cur = new Set(current.map((r) => r.path));
    for (const p of prev)
      if (!cur.has(p.path) && (!o.route?.length || true))
        out.push({ ...p, tree: { name: '…' + p.tree.name, loc: p.tree.loc }, unresolved: [], stats: { resolved: 0, total: 0, tokens: 0 }, diff: { ref, status: 'removed', removed: [] } });
    return out;
  } finally {
    fs.rmSync(co.dir, { recursive: true, force: true });
  }
}
