import type * as t from '@babel/types';
import type { Reason } from '../types.js';

/** A value the static evaluator could not determine. */
export class Unknown {
  constructor(
    public reason: Reason,
    public expr: string,
    public file?: string,
    public line?: number
  ) {}
}

/** A number computed by a scaler helper for the chosen viewport (marked `~`). */
export class Approx {
  constructor(
    public value: number,
    public expr: string
  ) {}
}

/** A value guarded by a condition that could not be decided; holds every branch. */
export class Cond {
  constructor(
    public options: unknown[],
    public expr: string
  ) {}
}

export type FnNode = t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression | t.ObjectMethod;

export class Closure {
  constructor(
    public node: FnNode,
    public scope: Scope,
    public file: string,
    public name?: string
  ) {}
}

export class JsxValue {
  constructor(
    public node: t.JSXElement | t.JSXFragment,
    public scope: Scope,
    public file: string
  ) {}
}

/** Something imported from a package we do not traverse (node_modules). */
export class External {
  constructor(
    public module: string,
    public name: string
  ) {}
}

export class ContextRef {
  constructor(
    public id: string,
    public name: string,
    public defaultValue: unknown,
    public file: string
  ) {}
}

export class Namespace {
  constructor(public file: string) {}
}

export class Builtin {
  constructor(
    public name: string,
    public call?: (args: unknown[], info: CallInfo) => unknown,
    public props?: Record<string, unknown>
  ) {}
}

export interface CallInfo {
  node: t.CallExpression;
  file: string;
  text: string;
  line: number;
}

type Cell = { state: 0 | 1 | 2; thunk?: () => unknown; value?: unknown };

export class Scope {
  private cells = new Map<string, Cell>();
  constructor(
    public parent: Scope | null,
    public file: string
  ) {}

  setLazy(name: string, thunk: () => unknown): void {
    this.cells.set(name, { state: 0, thunk });
  }

  set(name: string, value: unknown): void {
    this.cells.set(name, { state: 2, value });
  }

  hasOwn(name: string): boolean {
    return this.cells.has(name);
  }

  lookup(name: string): { found: boolean; value?: unknown } {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let s: Scope | null = this;
    while (s) {
      const c = s.cells.get(name);
      if (c) {
        if (c.state === 2) return { found: true, value: c.value };
        if (c.state === 1) return { found: true, value: new Unknown('RUNTIME_VALUE', name) };
        c.state = 1;
        try {
          c.value = c.thunk!();
        } finally {
          c.state = 2;
          c.thunk = undefined;
        }
        return { found: true, value: c.value };
      }
      s = s.parent;
    }
    return { found: false };
  }
}

export const isUnknown = (v: unknown): v is Unknown => v instanceof Unknown;

export function num(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (v instanceof Approx) return v.value;
  return undefined;
}

/** True when a value is fully concrete (no Unknown anywhere at the top level). */
export function isConcrete(v: unknown): boolean {
  if (v instanceof Unknown) return false;
  if (v instanceof Cond) return v.options.every(isConcrete);
  return true;
}
