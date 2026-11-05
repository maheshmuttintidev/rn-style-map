import { basename } from 'node:path';
import { shortHex } from '../resolve/color.js';
import type { MapNode, RouteMap, StyleEntry, ProjectInfo, UnresolvedEntry, Loc } from '../types.js';

export interface Trims {
  collapse?: boolean;
  defaults?: boolean;
  refs?: boolean;
  shortLoc?: boolean;
  depth?: number;
  text?: number;
  /** font family aliases (F1=…) for families repeated ≥3 times */
  fonts?: Map<string, string>;
  /** When false, suppress --explain lines (budget trim step). Default: show when encodeLines(explain=true). */
  explain?: boolean;
}

export interface CompactOpts {
  unresolvedDetail: boolean;
  trims?: Trims;
  tokens?: number;
}

const ABBR: Record<string, string> = {
  width: 'w', height: 'h', minWidth: 'minw', maxWidth: 'maxw', minHeight: 'minh', maxHeight: 'maxh',
  borderRadius: 'r', borderTopLeftRadius: 'rtl', borderTopRightRadius: 'rtr', borderBottomLeftRadius: 'rbl', borderBottomRightRadius: 'rbr',
  gap: 'gap', rowGap: 'rgap', columnGap: 'cgap', flex: 'flex', flexGrow: 'grow', flexShrink: 'shrink', flexBasis: 'basis',
  top: 't', left: 'l', right: 'rt', bottom: 'b', opacity: 'o', zIndex: 'z', letterSpacing: 'ls', aspectRatio: 'ar', elevation: 'el',
  marginTop: 'mt', marginBottom: 'mb', marginLeft: 'ml', marginRight: 'mr', paddingTop: 'pt', paddingBottom: 'pb', paddingLeft: 'pl', paddingRight: 'pr',
  borderWidth: 'bd', borderTopWidth: 'bdt', borderBottomWidth: 'bdb', borderLeftWidth: 'bdl', borderRightWidth: 'bdr', borderColor: 'bdc', borderTopColor: 'bdtc', borderBottomColor: 'bdbc', borderLeftColor: 'bdlc', borderRightColor: 'bdrc',
  backgroundColor: 'bg', color: 'c', fontSize: 'fs', lineHeight: 'lh', fontWeight: 'fw', fontFamily: 'ff', tintColor: 'tint', size: 'size',
  placeholderTextColor: 'ph', shadowColor: 'shc', shadowOpacity: 'sho', shadowRadius: 'shr', shadowOffset: 'sho', textAlign: 'ta',
  padding: 'p', paddingHorizontal: 'px', paddingVertical: 'py', margin: 'm', marginHorizontal: 'mx', marginVertical: 'my',
};

const DEFAULTS: Record<string, unknown> = {
  flexDirection: 'column', position: 'relative', opacity: 1, alignItems: 'stretch', fontWeight: 400, borderWidth: 0, flexShrink: 0, flexGrow: 0,
  overflow: 'visible', textAlign: 'auto', fontStyle: 'normal', display: 'flex', zIndex: 0, elevation: 0, justifyContent: 'flex-start',
  marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0, borderRadius: 0,
  letterSpacing: 0, textDecorationLine: 'none', textTransform: 'none', flexWrap: 'nowrap', alignSelf: 'auto',
};

const ALIGN_SHORT: Record<string, string> = { 'flex-start': 'start', 'flex-end': 'end', center: 'center', 'space-between': 'between', 'space-around': 'around', 'space-evenly': 'evenly', stretch: 'stretch', baseline: 'baseline' };

function fmt(v: unknown): string {
  if (typeof v === 'string') return /^#[0-9A-F]{6,8}$/i.test(v) ? shortHex(v) : v.includes(' ') ? JSON.stringify(v) : v;
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  if (v === null || v === undefined) return '∅';
  return JSON.stringify(v).replace(/"/g, '');
}

function val(e: StyleEntry): string {
  const vs = e.alt ?? [e.value];
  return vs.map(fmt).join('|');
}

function kv(key: string, e: StyleEntry): string {
  const k = ABBR[key] ?? key;
  const v = val(e);
  return `${e.approx ? '~' : ''}${k}${/^(#|-?\d)/.test(v) ? '' : ':'}${v}`;
}

function sameEntry(a?: StyleEntry, b?: StyleEntry): boolean {
  return !!a && !!b && val(a) === val(b) && !!a.approx === !!b.approx;
}

/** Encode a node's style map into the compact prop list. */
export function styleProps(style: Record<string, StyleEntry> | undefined, isText: boolean, trims: Trims = {}): string[] {
  if (!style) return [];
  const s: Record<string, StyleEntry> = {};
  for (const [k, e] of Object.entries(style)) {
    if (trims.defaults && !e.alt && k in DEFAULTS && DEFAULTS[k] === e.value) continue;
    s[k] = e;
  }
  const out: string[] = [];
  const used = new Set<string>();
  const take = (...keys: string[]) => keys.forEach((k) => used.add(k));
  for (const pre of ['', 'cc.']) {
    const g = (k: string) => s[pre + k];
    const P = (x: string) => pre + x;
    // padding / margin boxes
    for (const [base, ab] of [['padding', 'p'], ['margin', 'm']] as const) {
      const T = g(base + 'Top'), R = g(base + 'Right'), B = g(base + 'Bottom'), L = g(base + 'Left');
      if (T && R && B && L && sameEntry(T, R) && sameEntry(T, B) && sameEntry(T, L)) {
        out.push(pre + (T.approx ? '~' : '') + ab + val(T));
        take(P(base + 'Top'), P(base + 'Right'), P(base + 'Bottom'), P(base + 'Left'));
        continue;
      }
      if (T && B && sameEntry(T, B)) {
        out.push(pre + (T.approx ? '~' : '') + ab + 'y' + val(T));
        take(P(base + 'Top'), P(base + 'Bottom'));
      }
      if (L && R && sameEntry(L, R)) {
        out.push(pre + (L.approx ? '~' : '') + ab + 'x' + val(L));
        take(P(base + 'Left'), P(base + 'Right'));
      }
    }
    // border width + colour
    const bw = g('borderWidth'), bc = g('borderColor');
    if (bw && bc) {
      out.push(pre + (bw.approx ? '~' : '') + 'bd' + val(bw) + val(bc));
      take(P('borderWidth'), P('borderColor'));
    }
    // alignment
    const ai = g('alignItems'), jc = g('justifyContent');
    if (ai && jc && !ai.alt && !jc.alt && ai.value === 'center' && jc.value === 'center') {
      out.push(pre + 'center');
      take(P('alignItems'), P('justifyContent'));
    }
    if (ai && !used.has(P('alignItems'))) {
      out.push(pre + 'ai-' + (ai.alt ?? [ai.value]).map((x) => ALIGN_SHORT[String(x)] ?? x).join('|'));
      take(P('alignItems'));
    }
    if (jc && !used.has(P('justifyContent'))) {
      out.push(pre + 'jc-' + (jc.alt ?? [jc.value]).map((x) => ALIGN_SHORT[String(x)] ?? x).join('|'));
      take(P('justifyContent'));
    }
    const fd = g('flexDirection');
    if (fd && !fd.alt) {
      out.push(pre + (fd.value === 'row' ? 'row' : fd.value === 'column' ? 'col' : String(fd.value)));
      take(P('flexDirection'));
    }
    const pos = g('position');
    if (pos && !pos.alt && pos.value === 'absolute') {
      out.push(pre + 'abs');
      take(P('position'));
    }
    const ov = g('overflow');
    if (ov && !ov.alt && ov.value === 'hidden') {
      out.push(pre + 'clip');
      take(P('overflow'));
    }
    const bg = g('backgroundColor');
    if (bg) {
      out.push(pre + kv('backgroundColor', bg));
      take(P('backgroundColor'));
    }
  }
  // font: Family-Weight Size/LineHeight #color
  const ff = s.fontFamily, fw = s.fontWeight, fs = s.fontSize, lh = s.lineHeight, c = s.color;
  if (ff || fw || fs || lh || (c && isText)) {
    let font = '';
    if (ff) font = (trims.fonts?.get(val(ff)) ?? val(ff)) + (fw ? '-' + val(fw) : '');
    else if (fw) font = 'w' + val(fw);
    const size = fs ? (fs.approx ? '~' : '') + val(fs) : '';
    const line = lh ? '/' + (lh.approx ? '~' : '') + val(lh) : '';
    const parts = [font, size || line ? size + line : ''].filter(Boolean);
    if (c && isText) {
      parts.push(val(c));
      take('color');
    }
    if (parts.length) out.push(parts.join(' '));
    take('fontFamily', 'fontWeight', 'fontSize', 'lineHeight');
  }
  // shadow group
  const sc = s.shadowColor;
  if (sc) {
    const so = s.shadowOpacity, sr = s.shadowRadius, off = s.shadowOffset;
    const offv = off && off.value && typeof off.value === 'object' ? `${fmt((off.value as any).width)}/${fmt((off.value as any).height)}` : '';
    out.push(`shadow(${[val(sc), so ? val(so) : '', sr ? 'r' + val(sr) : '', offv].filter(Boolean).join(',')})`);
    take('shadowColor', 'shadowOpacity', 'shadowRadius', 'shadowOffset');
  }
  for (const [k, e] of Object.entries(s)) {
    if (used.has(k)) continue;
    const pre = k.startsWith('cc.') ? 'cc.' : '';
    const key = pre ? k.slice(3) : k;
    if (key === 'flex' && !e.alt && e.value === 1) {
      out.push(pre + 'flex1');
      continue;
    }
    out.push(pre + kv(key, e));
  }
  return out;
}

export function locStr(loc: Loc, routeFile: string, short: boolean): string {
  if (loc.file === routeFile) return short ? `:${loc.line}` : `${basename(loc.file)}:${loc.line}`;
  return short ? `${basename(loc.file)}:${loc.line}` : `${loc.file}:${loc.line}`;
}

const TEXTY = /(^|\.)(Text|TextInput|Button|Link)$|Text$/;

function unresolvedProps(n: MapNode): string[] {
  if (!n.unresolved?.length) return [];
  const keys = [...new Set(n.unresolved.map((u) => u.prop))];
  return keys.map((k) => {
    const pre = k.startsWith('cc.') ? 'cc.' : '';
    const key = pre ? k.slice(3) : k;
    return `${pre}${ABBR[key] ?? key}?`;
  });
}

export function nodeLine(n: MapNode, routeFile: string, trims: Trims, refs?: Map<string, string>): string {
  const parts: string[] = [n.name + (n.repeat !== undefined ? `×${n.repeat || '?'}` : '')];
  if (n.text !== undefined) {
    let txt = n.text;
    const max = trims.text ?? 48;
    if (txt.length > max) txt = txt.slice(0, Math.max(1, max - 1)) + '…';
    parts.push(JSON.stringify(txt));
  }
  let props = styleProps(n.style, TEXTY.test(n.name), trims);
  if (refs && props.length >= 3) {
    const key = props.join(' ');
    const ref = refs.get(key);
    if (ref) props = [ref];
  }
  parts.push(...props, ...unresolvedProps(n));
  if (n.a11y) {
    const a = n.a11y;
    if (a.role || a.label) parts.push(`a11y:${a.role ?? ''}${a.label !== undefined ? JSON.stringify(a.label) : ''}`);
    else if (a.interactive) parts.push('a11y:—');
    if (a.hitSlop) parts.push(`hs${a.hitSlop}`);
    if (a.allowFontScaling === false) parts.push('noFontScale');
    if (a.maxFontSizeMultiplier !== undefined) parts.push(`maxFS${a.maxFontSizeMultiplier}`);
  }
  if (n.more) parts.push(`…+${n.more}`);
  // inlined component nodes: the callsite carries the route context, so the component file is shown by basename
  const own = n.callsite && n.loc.file !== routeFile ? `${basename(n.loc.file).replace(/\.[jt]sx?$/, "")}:${n.loc.line}` : locStr(n.loc, routeFile, !!trims.shortLoc);
  let line = parts.join(' ') + '  ' + own;
  // callsites in the route file (named in the header) are always line-only
  if (n.callsite) line += ' ← ' + locStr(n.callsite, routeFile, true);
  return line;
}

export function header(r: RouteMap, p: ProjectInfo, tokens: number): string {
  const pct = r.stats.total ? Math.floor((r.stats.resolved / r.stats.total) * 100) : 100;
  return `# ${r.path}  ${r.file}  ${p.platform}·${p.scheme}·${p.viewport.width}x${p.viewport.height}  resolved ${r.stats.resolved}/${r.stats.total} (${pct}%)  ~${tokens} tok`;
}

export function footer(unres: UnresolvedEntry[], detail: boolean, routeFile: string): string | null {
  if (!unres.length) return null;
  if (detail) {
    return `? ${unres.length} unresolved: ` + unres.map((u) => `${u.file === routeFile ? basename(u.file) : u.file}:${u.line} ${u.prop}=${u.expr} (${u.reason})`).join('; ');
  }
  const h = new Map<string, number>();
  for (const u of unres) h.set(u.reason, (h.get(u.reason) ?? 0) + 1);
  return `? ${unres.length} unresolved: ` + [...h].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k}×${v}`).join(' ') + ' (--unresolved for details)';
}

/** Collapse consecutive identical siblings into one node with ×N. */
export function collapseSiblings(n: MapNode, routeFile: string): MapNode {
  if (!n.children) return n;
  const kids = n.children.map((c) => collapseSiblings(c, routeFile));
  const out: MapNode[] = [];
  const sig = (c: MapNode) => JSON.stringify([c.name, c.text, c.style, c.a11y, c.children?.length]) + subtreeSig(c);
  for (const c of kids) {
    const prev = out[out.length - 1];
    if (prev && sig(prev) === sig(c)) {
      prev.repeat = (prev.repeat ?? 1) + (c.repeat ?? 1);
      continue;
    }
    out.push({ ...c });
  }
  return { ...n, children: out };
}

function subtreeSig(n: MapNode): string {
  return (n.children ?? []).map((c) => JSON.stringify([c.name, c.text, c.style]) + subtreeSig(c)).join(',');
}

export function limitDepth(n: MapNode, depth: number, level = 1): MapNode {
  if (!n.children) return n;
  if (level >= depth) return { ...n, children: undefined, more: countAll(n.children) };
  return { ...n, children: n.children.map((c) => limitDepth(c, depth, level + 1)) };
}

function countAll(ns: MapNode[]): number {
  return ns.reduce((a, c) => a + 1 + countAll(c.children ?? []), 0);
}

export function treeDepth(n: MapNode): number {
  return 1 + Math.max(0, ...(n.children ?? []).map(treeDepth));
}

/** --only: keep matching nodes and their ancestors (ancestors shown as `…Name`). */
export function filterOnly(n: MapNode, names: string[]): MapNode | null {
  const match = names.some((x) => n.name === x || n.name.endsWith('.' + x));
  const kids = (n.children ?? []).map((c) => filterOnly(c, names)).filter((c): c is MapNode => !!c);
  if (match) return { ...n, children: kids.length ? kids : undefined };
  if (!kids.length) return null;
  return { name: '…' + n.name, loc: n.loc, callsite: n.callsite, children: kids };
}

function fmtLayerValue(v: unknown): string {
  if (typeof v === 'string') return /^#[0-9A-F]{6,8}$/i.test(v) ? shortHex(v) : v.includes(' ') ? JSON.stringify(v) : v;
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  if (v === null || v === undefined) return '∅';
  if (v === '{unresolved}') return '?';
  return JSON.stringify(v).replace(/"/g, '');
}

function locLabel(loc: { file: string; line: number } | undefined, routeFile: string): string {
  if (!loc) return '';
  const f = loc.file === routeFile ? basename(loc.file) : loc.file;
  return `${f}:${loc.line}`;
}

/** One explain line per overridden prop (2+ layers). Never mutates nodeLine / diff signatures. */
export function explainLines(style: Record<string, StyleEntry> | undefined, routeFile: string): string[] {
  if (!style) return [];
  const out: string[] = [];
  for (const [key, e] of Object.entries(style)) {
    const layers = e.layers;
    if (!layers || layers.length < 2) continue;
    const abbr = ABBR[key] ?? key;
    const parts = layers.map((L, i) => {
      const won = i === layers.length - 1;
      const via = L.via ? ` ${L.via}` : '';
      const loc = locLabel(L.loc, routeFile);
      const bit = `${L.source}${via} ${fmtLayerValue(L.value)}${loc ? ` (${loc})` : ''}`;
      return won ? bit : bit;
    });
    const winner = parts[parts.length - 1];
    const over = parts.slice(0, -1);
    out.push(`↳ ${abbr}=${fmtLayerValue(e.value)} ← ${winner} over ${over.join(' → ')}`);
  }
  return out;
}

export function encodeLines(tree: MapNode, routeFile: string, trims: Trims, refs?: Map<string, string>, explain = false): string[] {
  const lines: string[] = [];
  const visit = (n: MapNode, d: number) => {
    lines.push('  '.repeat(d) + nodeLine(n, routeFile, trims, refs));
    if (explain) {
      for (const x of explainLines(n.style, routeFile)) lines.push('  '.repeat(d) + '  ' + x);
    }
    for (const c of n.children ?? []) visit(c, d + 1);
  };
  visit(tree, 0);
  return lines;
}

/** Find style prop sets used 2+ times (≥3 props) for `$sN` refs. */
export function buildRefs(tree: MapNode, trims: Trims): Map<string, string> {
  const counts = new Map<string, number>();
  const visit = (n: MapNode) => {
    const props = styleProps(n.style, TEXTY.test(n.name), trims);
    if (props.length >= 3) {
      const k = props.join(' ');
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    (n.children ?? []).forEach(visit);
  };
  visit(tree);
  const refs = new Map<string, string>();
  let i = 1;
  for (const [k, c] of counts) if (c >= 2) refs.set(k, `$s${i++}`);
  return refs;
}

/** Alias font families used 3+ times (and long enough to be worth it) to F1, F2, … */
export function buildFontAliases(tree: MapNode): Map<string, string> {
  const counts = new Map<string, number>();
  const visit = (n: MapNode) => {
    const ff = n.style?.fontFamily;
    if (ff) counts.set(val(ff), (counts.get(val(ff)) ?? 0) + 1);
    (n.children ?? []).forEach(visit);
  };
  visit(tree);
  const out = new Map<string, string>();
  let i = 1;
  for (const [k, c] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) if (c >= 3 && k.length > 8) out.set(k, `F${i++}`);
  return out;
}
