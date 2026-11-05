import { STYLESHEET, SPREADS, Repeat, ClassList } from './evaluator.js';
import { Approx, Cond, Unknown, isUnknown, Closure, JsxValue, External, Builtin } from './values.js';
import { normalizeColor } from './color.js';
import type { StyleEntry, StyleLayer, StyleSource, UnresolvedEntry, Reason } from '../types.js';

export interface RawEntry {
  value: unknown;
  source: StyleSource;
  /** Oldest → newest (winner last). Always tracked during merge; copied to StyleEntry only with --explain. */
  layers?: StyleLayer[];
}

export interface Where {
  file: string;
  line: number;
  prop: string;
}

function toUnresolved(u: Unknown, where: Where, reason?: Reason): UnresolvedEntry {
  return { file: u.file ?? where.file, line: u.line ?? where.line, prop: where.prop, expr: u.expr, reason: reason ?? u.reason };
}

function layerOf(source: StyleSource, value: unknown, where?: Where, via?: string): StyleLayer {
  const L: StyleLayer = { source, value };
  if (where) L.loc = { file: where.file, line: where.line };
  if (via) L.via = via;
  return L;
}

/** Set/override a raw style key, appending to the layer stack. */
export function setRaw(out: Map<string, RawEntry>, key: string, value: unknown, source: StyleSource, where?: Where, via?: string): void {
  const layer = layerOf(source, value, where, via);
  const prev = out.get(key);
  const layers = prev
    ? [...(prev.layers?.length ? prev.layers : [layerOf(prev.source, prev.value)]), layer]
    : [layer];
  out.set(key, { value, source, layers });
}

/** Flatten a style prop value (RN semantics: arrays flatten, later wins, falsy ignored). */
export function collectStyle(v: unknown, where: Where, out: Map<string, RawEntry>, unres: UnresolvedEntry[], forced?: StyleSource): void {
  if (Array.isArray(v)) {
    for (const x of v) collectStyle(x, where, out, unres, forced);
    return;
  }
  if (v === null || v === undefined || v === false || v === true || v === '' || v === 0) return;
  if (isUnknown(v)) {
    unres.push(toUnresolved(v, where));
    return;
  }
  if (v instanceof Approx || typeof v === 'number' || typeof v === 'string') return;
  if (v instanceof Cond) {
    const maps = v.options.map((o) => {
      const m = new Map<string, RawEntry>();
      collectStyle(o, where, m, unres, forced);
      return m;
    });
    const keys = new Set<string>();
    maps.forEach((m) => m.forEach((_v, k) => keys.add(k)));
    for (const k of keys) {
      const prev = out.get(k);
      const opts = maps.map((m) => (m.has(k) ? m.get(k)!.value : prev?.value));
      const src = maps.find((m) => m.has(k))!.get(k)!.source;
      // Cond: treat as one layer from the winning/known source; mark via as conditional
      setRaw(out, k, condOf(opts, v.expr), src, where, 'conditional');
    }
    return;
  }
  if (v instanceof Repeat || v instanceof JsxValue || v instanceof Closure || v instanceof External || v instanceof Builtin || v instanceof ClassList) {
    if (v instanceof External || v instanceof Builtin) unres.push({ file: where.file, line: where.line, prop: where.prop, expr: v instanceof External ? v.name : v.name, reason: 'UNKNOWN_IMPORT' });
    return;
  }
  if (typeof v === 'object') {
    const source: StyleSource = forced ?? (STYLESHEET.has(v) ? 'stylesheet' : 'inline');
    for (const [k, val] of Object.entries(v)) setRaw(out, k, val, source, where);
    const sp = (v as any)[SPREADS] as Unknown[] | undefined;
    if (sp) for (const u of sp) unres.push(toUnresolved(u, where, 'SPREAD'));
  }
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Approx && b instanceof Approx) return a.value === b.value;
  return false;
}

function condOf(opts: unknown[], expr: string): unknown {
  const flat: unknown[] = [];
  for (const o of opts) {
    if (o instanceof Cond) flat.push(...o.options);
    else flat.push(o);
  }
  const uniq: unknown[] = [];
  for (const o of flat) if (!uniq.some((u) => same(u, o))) uniq.push(o);
  return uniq.length === 1 ? uniq[0] : new Cond(uniq, expr);
}

const SIDES = ['Top', 'Right', 'Bottom', 'Left'] as const;

/** Expand padding/margin shorthands into four sides using RN precedence (side > axis > all). */
export function expandShorthands(m: Map<string, RawEntry>): void {
  for (const base of ['padding', 'margin']) {
    const has = [base, base + 'Horizontal', base + 'Vertical', base + 'Start', base + 'End'].some((k) => m.has(k));
    if (!has) continue;
    const get = (k: string) => m.get(k);
    const res: Record<string, RawEntry | undefined> = {};
    for (const s of SIDES) {
      const axis = s === 'Top' || s === 'Bottom' ? 'Vertical' : 'Horizontal';
      const logical = s === 'Left' ? 'Start' : s === 'Right' ? 'End' : undefined;
      // least → most specific for explain stack
      const chain = [get(base), get(base + axis), logical ? get(base + logical) : undefined, get(base + s)].filter(Boolean) as RawEntry[];
      if (!chain.length) continue;
      const winner = chain[chain.length - 1];
      const layers: StyleLayer[] = [];
      for (const e of chain) {
        if (e.layers?.length) layers.push(...e.layers);
        else layers.push(layerOf(e.source, e.value));
      }
      res[s] = { value: winner.value, source: winner.source, layers };
    }
    // Only delete shorthand keys; side keys keep Map insertion order when updated in place.
    for (const k of [base, base + 'Horizontal', base + 'Vertical', base + 'Start', base + 'End']) m.delete(k);
    for (const s of SIDES) if (res[s]) m.set(base + s, res[s]!);
  }
}

const COLOR_KEY = /colou?r$/i;
const WEIGHTS: Record<string, number> = { normal: 400, bold: 700, thin: 100, ultralight: 200, light: 300, regular: 400, medium: 500, semibold: 600, heavy: 800, black: 900 };

type Leaf = { ok: true; value: unknown; approx: boolean; expr?: string } | { ok: false; u: Unknown; reason: Reason };

function leaf(key: string, v: unknown): Leaf {
  if (isUnknown(v)) return { ok: false, u: v, reason: v.reason };
  if (v instanceof Approx) return { ok: true, value: Math.round(v.value * 100) / 100, approx: true, expr: v.expr };
  if (v instanceof External || v instanceof Builtin || v instanceof Closure) return { ok: false, u: new Unknown('UNKNOWN_IMPORT', v instanceof External ? v.name : 'value'), reason: 'UNKNOWN_IMPORT' };
  if (v === undefined) return { ok: true, value: null, approx: false };
  if (typeof v === 'number') {
    if (key === 'fontWeight') return { ok: true, value: v, approx: false };
    return { ok: true, value: Math.round(v * 100) / 100, approx: false };
  }
  if (typeof v === 'string') {
    if (COLOR_KEY.test(key)) {
      const c = normalizeColor(v);
      return { ok: true, value: c ?? v, approx: false };
    }
    if (key === 'fontWeight') return { ok: true, value: /^\d+$/.test(v) ? Number(v) : WEIGHTS[v] ?? v, approx: false };
    return { ok: true, value: v, approx: false };
  }
  if (typeof v === 'boolean' || v === null) return { ok: true, value: v, approx: false };
  if (typeof v === 'object') {
    // shadowOffset, transform, etc: must be fully concrete
    let approx = false;
    let bad: Unknown | null = null;
    const conv = (x: unknown): unknown => {
      if (isUnknown(x)) {
        bad ??= x;
        return null;
      }
      if (x instanceof Approx) {
        approx = true;
        return Math.round(x.value * 100) / 100;
      }
      if (x instanceof Cond) {
        bad ??= new Unknown('CONDITIONAL_UNKNOWN', x.expr);
        return null;
      }
      if (Array.isArray(x)) return x.map(conv);
      if (x && typeof x === 'object') {
        if (x instanceof External || x instanceof Builtin || x instanceof Closure || x instanceof JsxValue) {
          bad ??= new Unknown('RUNTIME_VALUE', 'value');
          return null;
        }
        return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, conv(y)]));
      }
      return x;
    };
    const value = conv(v);
    if (bad) return { ok: false, u: bad, reason: (bad as Unknown).reason };
    return { ok: true, value, approx };
  }
  return { ok: false, u: new Unknown('RUNTIME_VALUE', String(v)), reason: 'RUNTIME_VALUE' };
}

function finalizeLayers(raw: RawEntry, key: string): StyleLayer[] | undefined {
  if (!raw.layers?.length) return undefined;
  const out: StyleLayer[] = [];
  for (const L of raw.layers) {
    const l = leaf(key, L.value);
    if (!l.ok) {
      // Keep an honest marker for untraceable layer values rather than inventing a number
      out.push({ ...L, value: `{unresolved}` });
      continue;
    }
    out.push({ ...L, value: l.value });
  }
  return out;
}

/** Turn merged raw entries into normalised StyleEntries; unresolvable values go to `unres`. */
export function finalizeStyle(m: Map<string, RawEntry>, where: Where, unres: UnresolvedEntry[], prefix = '', explain = false): Record<string, StyleEntry> {
  const out: Record<string, StyleEntry> = {};
  for (const [k, raw] of m) {
    const key = prefix + k;
    const w = { ...where, prop: key };
    if (raw.value instanceof Cond) {
      const leaves = raw.value.options.map((o) => leaf(k, o));
      const bad = leaves.find((l) => !l.ok) as Extract<Leaf, { ok: false }> | undefined;
      if (bad) {
        unres.push(toUnresolved(bad.u, w, bad.reason === 'RUNTIME_VALUE' ? 'CONDITIONAL_UNKNOWN' : bad.reason));
        continue;
      }
      const vals = leaves.map((l) => (l as any).value);
      const e: StyleEntry = { value: vals[0], source: raw.source, alt: vals };
      if (leaves.some((l) => (l as any).approx)) e.approx = true;
      if (explain) {
        const layers = finalizeLayers(raw, k);
        if (layers?.length) e.layers = layers;
      }
      out[key] = e;
      continue;
    }
    const l = leaf(k, raw.value);
    if (!l.ok) {
      unres.push(toUnresolved(l.u, w, l.reason));
      continue;
    }
    if (l.value === null && raw.value === undefined) continue;
    const e: StyleEntry = { value: l.value, source: raw.source };
    if (l.approx) {
      e.approx = true;
      if (l.expr) e.expr = l.expr;
    }
    if (explain) {
      const layers = finalizeLayers(raw, k);
      if (layers?.length) e.layers = layers;
    }
    out[key] = e;
  }
  return out;
}
