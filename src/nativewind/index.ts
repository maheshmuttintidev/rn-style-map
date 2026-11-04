import { ClassList } from '../resolve/evaluator.js';
import { Cond, Unknown, isUnknown } from '../resolve/values.js';
import type { RawEntry, Where } from '../resolve/normalize.js';
import type { UnresolvedEntry } from '../types.js';
import { splitVariants, utilityToStyle, variantApplies, type ClassContext } from './classes.js';

export type { ClassContext };

/** Resolve a className value to raw style entries (source `nativewind`). */
export function collectClasses(v: unknown, ctx: ClassContext, where: Where, out: Map<string, RawEntry>, unres: UnresolvedEntry[]): void {
  if (v === null || v === undefined || v === false || v === '') return;
  if (typeof v === 'string') {
    for (const cls of v.split(/\s+/).filter(Boolean)) applyClass(cls, ctx, where, out, unres);
    return;
  }
  if (v instanceof ClassList) {
    for (const cls of v.classes) applyClass(cls, ctx, where, out, unres);
    for (const u of v.dynamic) unres.push({ file: u.file ?? where.file, line: u.line ?? where.line, prop: where.prop, expr: u.expr, reason: 'DYNAMIC_CLASS' });
    return;
  }
  if (v instanceof Cond) {
    // undecided: apply every option in order (later wins), mirroring clsx handling
    for (const o of v.options) collectClasses(o, ctx, where, out, unres);
    return;
  }
  if (Array.isArray(v)) {
    v.forEach((x) => collectClasses(x, ctx, where, out, unres));
    return;
  }
  const u = isUnknown(v) ? v : new Unknown('DYNAMIC_CLASS', String(v));
  unres.push({ file: u.file ?? where.file, line: u.line ?? where.line, prop: where.prop, expr: u.expr, reason: 'DYNAMIC_CLASS' });
}

function applyClass(cls: string, ctx: ClassContext, where: Where, out: Map<string, RawEntry>, unres: UnresolvedEntry[]): void {
  const { variants, util } = splitVariants(cls);
  for (const v of variants) {
    const a = variantApplies(v, ctx);
    if (a !== true) return; // false: not active; null: state variant, recorded but not applied
  }
  const r = utilityToStyle(util, ctx);
  if ('style' in r) for (const [k, val] of Object.entries(r.style)) out.set(k, { value: val, source: 'nativewind' });
  else if ('unknown' in r) unres.push({ file: where.file, line: where.line, prop: where.prop, expr: cls, reason: 'UNKNOWN_CLASS' });
}
