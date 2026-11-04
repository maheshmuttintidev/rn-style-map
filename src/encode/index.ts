import type { MapNode, MapResult, ProjectInfo, RouteMap, TokenTable } from '../types.js';
import { countTokens } from './tokens.js';
import { buildFontAliases, buildRefs, collapseSiblings, encodeLines, filterOnly, footer, header, limitDepth, treeDepth, type Trims } from './compact.js';

export interface RenderOpts {
  format: 'compact' | 'json' | 'md';
  depth: number;
  only?: string[];
  budget?: number;
  unresolved: boolean;
}

export interface RenderedRoute {
  route: RouteMap;
  text: string;
  tokens: number;
  trimmed: string[];
}

function view(r: RouteMap, o: RenderOpts): MapNode {
  let t: MapNode | null = r.tree;
  if (o.only?.length) t = filterOnly(t, o.only) ?? { name: '…' + r.tree.name, loc: r.tree.loc };
  return limitDepth(t, o.depth);
}

function block(r: RouteMap, tree: MapNode, p: ProjectInfo, trims: Trims, detail: boolean, notes: string[]): { text: string; tokens: number } {
  let t = tree;
  if (trims.collapse) t = collapseSiblings(t, r.file);
  if (trims.depth) t = limitDepth(t, trims.depth);
  const fonts = buildFontAliases(t);
  if (fonts.size) trims = { ...trims, fonts };
  const refs = trims.refs ? buildRefs(t, trims) : undefined;
  const body: string[] = [];
  if (r.layouts.length) body.push(`layout ${r.layouts.join(' › ')}`);
  if (fonts.size) body.push('fonts ' + [...fonts].map(([k, v]) => `${v}=${k}`).join(' '));
  if (refs?.size) for (const [k, v] of refs) body.push(`${v} = ${k}`);
  if (r.diff) body.push(`diff ${r.diff.status} vs ${r.diff.ref}`);
  body.push(...encodeLines(t, r.file, trims, refs));
  if (r.diff) for (const x of r.diff.removed) body.push(`- ${x}`);
  const f = footer(r.unresolved, detail, r.file);
  if (f) body.push(f);
  if (notes.length) body.push(`· trimmed: ${notes.join(', ')}`);
  let tok = 0;
  let text = '';
  // header contains its own token count: iterate until stable
  for (let i = 0; i < 3; i++) {
    text = [header(r, p, tok), ...body].join('\n');
    const n = countTokens(text);
    if (n === tok) break;
    tok = n;
  }
  return { text, tokens: tok };
}

/** Render one route's compact block, trimming to the budget in the plan's priority order (§4.8). */
export function renderCompact(r: RouteMap, p: ProjectInfo, o: RenderOpts): RenderedRoute {
  const tree = view(r, o);
  const trims: Trims = {};
  const notes: string[] = [];
  let out = block(r, tree, p, trims, o.unresolved, notes);
  if (!o.budget || out.tokens <= o.budget) return { route: r, text: out.text, tokens: out.tokens, trimmed: [] };
  const steps: Array<() => boolean> = [
    () => ((trims.collapse = true), notes.push('×N'), true),
    () => ((trims.defaults = true), notes.push('defaults'), true),
    () => ((trims.refs = true), notes.push('$refs'), true),
    () => ((trims.shortLoc = true), notes.push('loc'), true),
  ];
  for (const s of steps) {
    s();
    out = block(r, tree, p, trims, o.unresolved, notes);
    if (out.tokens <= o.budget) return { route: r, text: out.text, tokens: out.tokens, trimmed: notes };
  }
  // reduce depth
  const d0 = Math.min(o.depth, treeDepth(tree));
  for (let d = d0 - 1; d >= 1; d--) {
    trims.depth = d;
    const n = [...notes, `depth→${d}`];
    out = block(r, tree, p, trims, o.unresolved, n);
    if (out.tokens <= o.budget) return { route: r, text: out.text, tokens: out.tokens, trimmed: n };
  }
  // truncate text
  for (const len of [24, 12, 6]) {
    trims.text = len;
    const n = [...notes, `depth→${trims.depth ?? d0}`, `text→${len}`];
    out = block(r, tree, p, trims, o.unresolved, n);
    if (out.tokens <= o.budget) return { route: r, text: out.text, tokens: out.tokens, trimmed: n };
  }
  // last resort: summary-only footer is already on; drop footer detail
  const n = [...notes, `depth→${trims.depth ?? d0}`, `text→6`];
  out = block(r, tree, p, trims, false, n);
  if (out.tokens <= o.budget) return { route: r, text: out.text, tokens: out.tokens, trimmed: n };
  // budget smaller than the tree root: header only (the header itself is never trimmed)
  const tiny = { ...r, layouts: [], unresolved: [] };
  out = block(tiny, { name: tree.name, loc: tree.loc }, p, {}, false, ['body']);
  const text = out.text.split('\n').filter((l) => !l.startsWith(tree.name)).join('\n');
  return { route: r, text, tokens: countTokens(text), trimmed: ['body'] };
}

export function tokenTableCompact(t: TokenTable): string {
  const row = (k: string, m: Record<string, number>) => `${k}: ` + Object.entries(m).map(([v, c]) => `${v}×${c}`).join(' ');
  return ['# tokens', row('colors', t.colors), row('fonts', t.fonts), row('fontSizes', t.fontSizes), row('spacing', t.spacing), row('radii', t.radii)].join('\n');
}

export function tokenTableMd(t: TokenTable): string {
  const lines = ['## Tokens', '', '| Kind | Value | Uses |', '|---|---|---|'];
  for (const [kind, m] of Object.entries(t) as [string, Record<string, number>][]) for (const [v, c] of Object.entries(m)) lines.push(`| ${kind} | \`${v}\` | ${c} |`);
  return lines.join('\n');
}

export function stripInternal(n: MapNode): MapNode {
  const { unresolved: _u, ...rest } = n;
  void _u;
  const out: MapNode = { ...rest };
  if (n.children) out.children = n.children.map(stripInternal);
  return out;
}

export function renderAll(result: MapResult, rendered: RenderedRoute[], o: RenderOpts, extra: { tokensTable?: string; tokensMd?: string; findings?: string }): string {
  if (o.format === 'json') {
    const routes = rendered.map((x) => ({
      ...x.route,
      tree: stripInternal(view(x.route, o)),
      stats: { ...x.route.stats, tokens: x.tokens },
      unresolved: x.route.unresolved,
    }));
    return JSON.stringify({ ...result, routes }, null, 2) + '\n';
  }
  if (o.format === 'md') {
    const parts: string[] = ['# rn-style-map', ''];
    parts.push(`${result.project.router} · ${result.project.platform}·${result.project.scheme}·${result.project.viewport.width}x${result.project.viewport.height} · ${rendered.length} route(s)`, '');
    for (const x of rendered) {
      const pct = x.route.stats.total ? Math.floor((x.route.stats.resolved / x.route.stats.total) * 100) : 100;
      parts.push(`## \`${x.route.path}\``, '', `\`${x.route.file}\` — resolved ${x.route.stats.resolved}/${x.route.stats.total} (${pct}%), ~${x.tokens} tokens`, '', '```text', x.text, '```', '');
    }
    if (extra.tokensMd) parts.push(extra.tokensMd, '');
    if (extra.findings) parts.push(extra.findings, '');
    return parts.join('\n');
  }
  const parts = rendered.map((x) => x.text);
  if (extra.tokensTable) parts.push(extra.tokensTable);
  if (extra.findings) parts.push(extra.findings);
  return parts.join('\n\n') + '\n';
}
