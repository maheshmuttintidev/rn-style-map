import type * as t from '@babel/types';
import { VISITOR_KEYS } from '@babel/types';
import { parseFile } from './parse.js';
import type { Project } from './project.js';
import {
  Approx,
  Builtin,
  Closure,
  Cond,
  ContextRef,
  External,
  JsxValue,
  Namespace,
  Scope,
  Unknown,
  isUnknown,
  num,
  type CallInfo,
  type FnNode,
} from './values.js';
import { DEFAULT_SCALER, scalerFns, tableScalers } from './scaler.js';
import type { Options, Reason, ScalerConfig } from '../types.js';

/** Marks objects produced by StyleSheet.create so the source can be reported. */
export const STYLESHEET = new WeakSet<object>();
/** Unknown spreads inside an object literal. */
export const SPREADS = Symbol('spreads');
/** Marks an object whose missing keys are runtime values (route props), not undefined. */
export const OPEN = Symbol('open');

/** A rendered `.map()` result: one sample rendered, repeated n times (n unknown = undefined). */
export class Repeat {
  constructor(
    public value: unknown,
    public count: number | undefined
  ) {}
}

/** Class list with dynamic parts (from clsx/cn/template literals). */
export class ClassList {
  constructor(
    public classes: string[],
    public dynamic: Unknown[]
  ) {}
}

interface Module {
  file: string;
  ast: t.File;
  code: string;
  scope: Scope;
  exports: Map<string, () => unknown>;
  stars: string[];
}

const MAX_CALL_DEPTH = 40;

function once<T>(fn: () => T): () => T {
  let done = false;
  let v: T;
  return () => {
    if (!done) {
      v = fn();
      done = true;
    }
    return v;
  };
}

export function walk(node: any, fn: (n: any, parents: any[]) => void | false, parents: any[] = []): void {
  if (!node || typeof node.type !== 'string') return;
  if (fn(node, parents) === false) return;
  const keys = (VISITOR_KEYS as any)[node.type] as string[] | undefined;
  if (!keys) return;
  parents.push(node);
  for (const k of keys) {
    const c = node[k];
    if (Array.isArray(c)) for (const x of c) walk(x, fn, parents);
    else if (c) walk(c, fn, parents);
  }
  parents.pop();
}

export function flattenStyleArray(v: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(v)) for (const x of v) flattenStyleArray(x, out);
  else out.push(v);
  return out;
}

export class Engine {
  modules = new Map<string, Module>();
  globals: Scope;
  scaler: ScalerConfig;
  callDepth = 0;
  usedTheme = false;
  usedStyleSheet = false;
  usedInline = false;
  private contextCache = new Map<string, unknown>();
  private reassignCache = new WeakMap<object, Set<string>>();
  private builtinModules: Record<string, Record<string, unknown>>;

  constructor(
    public project: Project,
    public opts: Options
  ) {
    this.globals = new Scope(null, '<globals>');
    this.scaler = { ...DEFAULT_SCALER, ...this.findConfigureScaler(), ...(opts.config?.scaler ?? {}) };
    this.builtinModules = this.makeBuiltins();
    this.setupGlobals();
  }

  // ---------- helpers ----------
  text(node: t.Node, file: string): string {
    const m = this.modules.get(file);
    const code = m?.code ?? '';
    const s = code.slice(node.start ?? 0, node.end ?? 0).replace(/\s+/g, ' ').trim();
    return s.length > 60 ? s.slice(0, 57) + '...' : s;
  }

  unknown(reason: Reason, node: t.Node, file: string): Unknown {
    return new Unknown(reason, this.text(node, file), this.project.rel(file), node.loc?.start.line ?? 0);
  }

  private findConfigureScaler(): Partial<ScalerConfig> {
    for (const f of this.project.sourceFiles()) {
      const code = this.project.read(f);
      const m = /configureScaler\(\s*\{([^}]*)\}\s*\)/.exec(code);
      if (!m) continue;
      const out: Partial<ScalerConfig> = {};
      const w = /referenceWidth\s*:\s*(\d+(?:\.\d+)?)/.exec(m[1]);
      const h = /referenceHeight\s*:\s*(\d+(?:\.\d+)?)/.exec(m[1]);
      if (w) out.referenceWidth = Number(w[1]);
      if (h) out.referenceHeight = Number(h[1]);
      return out;
    }
    return {};
  }

  private setupGlobals(): void {
    const g = this.globals;
    g.set('undefined', undefined);
    g.set('NaN', NaN);
    g.set('Infinity', Infinity);
    const pure = (f: (...a: any[]) => unknown) => (args: unknown[]) => {
      const a = args.map((x) => (x instanceof Approx ? x.value : x));
      if (a.some((x) => isUnknown(x) || x instanceof Cond)) return a.find(isUnknown) ?? new Unknown('CONDITIONAL_UNKNOWN', 'expr');
      try {
        return f(...a);
      } catch {
        return new Unknown('RUNTIME_VALUE', 'call');
      }
    };
    const mathProps: Record<string, unknown> = { PI: Math.PI };
    for (const k of ['min', 'max', 'round', 'floor', 'ceil', 'abs', 'sqrt', 'pow', 'trunc', 'sign', 'hypot']) {
      mathProps[k] = new Builtin('Math.' + k, (args) => {
        const approx = args.some((a) => a instanceof Approx);
        const r = pure((Math as any)[k])(args);
        return approx && typeof r === 'number' ? new Approx(r, 'Math.' + k) : r;
      });
    }
    mathProps.random = new Builtin('Math.random', () => new Unknown('RUNTIME_VALUE', 'Math.random()'));
    g.set('Math', new Builtin('Math', undefined, mathProps));
    g.set(
      'Object',
      new Builtin('Object', undefined, {
        keys: new Builtin('Object.keys', pure((o) => Object.keys(o))),
        values: new Builtin('Object.values', pure((o) => Object.values(o))),
        entries: new Builtin('Object.entries', pure((o) => Object.entries(o))),
        assign: new Builtin('Object.assign', (args) => this.mergeObjects(args)),
        freeze: new Builtin('Object.freeze', (args) => args[0]),
        fromEntries: new Builtin('Object.fromEntries', pure((e) => Object.fromEntries(e))),
      })
    );
    g.set('Array', new Builtin('Array', undefined, { isArray: new Builtin('Array.isArray', (a) => Array.isArray(a[0])) }));
    g.set('String', new Builtin('String', pure((x) => String(x))));
    g.set('Number', new Builtin('Number', pure((x) => Number(x))));
    g.set('Boolean', new Builtin('Boolean', (a) => (isUnknown(a[0]) ? a[0] : Boolean(a[0]))));
    g.set('parseInt', new Builtin('parseInt', pure((x, r) => parseInt(x, r))));
    g.set('parseFloat', new Builtin('parseFloat', pure((x) => parseFloat(x))));
    g.set('console', new Builtin('console', undefined, {}));
    g.set('require', new Builtin('require', (args, info) => this.requireCall(args, info)));
  }

  private mergeObjects(args: unknown[]): unknown {
    const out: any = {};
    for (const a of args) {
      if (isUnknown(a)) (out[SPREADS] ??= []).push(new Unknown('SPREAD', a.expr, a.file, a.line));
      else if (a && typeof a === 'object' && !(a instanceof Builtin)) Object.assign(out, a);
    }
    return out;
  }

  private requireCall(args: unknown[], info: CallInfo): unknown {
    const spec = args[0];
    if (typeof spec !== 'string') return new Unknown('RUNTIME_VALUE', info.text);
    const f = this.project.resolve(info.file, spec);
    if (f) return f.endsWith('.json') || /\.(png|jpe?g|gif|webp|svg|ttf|otf)$/.test(f) ? this.loadJsonOrAsset(f) : new Namespace(f);
    return this.externalModule(spec, '*');
  }

  private loadJsonOrAsset(f: string): unknown {
    if (f.endsWith('.json')) {
      try {
        return JSON.parse(this.project.read(f));
      } catch {
        return new Unknown('UNKNOWN_IMPORT', this.project.rel(f));
      }
    }
    return new External('asset', this.project.rel(f));
  }

  // ---------- builtins ----------
  private makeBuiltins(): Record<string, Record<string, unknown>> {
    const { width, height } = this.opts.viewport;
    const platform = this.opts.platform;
    const scheme = this.opts.scheme;
    const flatten = (v: unknown) => this.mergeObjects(flattenStyleArray(v).filter((x) => x && typeof x === 'object'));
    const absFill = { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 };
    const StyleSheet = new Builtin('StyleSheet', undefined, {
      create: new Builtin('StyleSheet.create', (args) => {
        const o = args[0];
        if (o && typeof o === 'object' && !isUnknown(o)) {
          this.usedStyleSheet = true;
          for (const v of Object.values(o)) if (v && typeof v === 'object') STYLESHEET.add(v as object);
        }
        return o;
      }),
      flatten: new Builtin('StyleSheet.flatten', (a) => flatten(a[0])),
      compose: new Builtin('StyleSheet.compose', (a) => [a[0], a[1]]),
      hairlineWidth: new Approx(0.5, 'StyleSheet.hairlineWidth'),
      absoluteFill: absFill,
      absoluteFillObject: absFill,
    });
    const Platform = new Builtin('Platform', undefined, {
      OS: platform,
      Version: new Unknown('RUNTIME_VALUE', 'Platform.Version'),
      isPad: false,
      isTV: false,
      select: new Builtin('Platform.select', (a) => {
        const o = a[0] as any;
        if (!o || typeof o !== 'object' || isUnknown(o)) return o;
        if (platform in o) return o[platform];
        if ('native' in o) return o.native;
        return o.default;
      }),
    });
    const dims = () => ({ width, height, fontScale: 1, scale: new Unknown('RUNTIME_VALUE', 'PixelRatio') });
    const rn: Record<string, unknown> = {
      StyleSheet,
      Platform,
      Dimensions: new Builtin('Dimensions', undefined, { get: new Builtin('Dimensions.get', dims), addEventListener: new Builtin('noop', () => ({ remove: () => undefined })) }),
      useWindowDimensions: new Builtin('useWindowDimensions', dims),
      useColorScheme: new Builtin('useColorScheme', () => scheme),
      Appearance: new Builtin('Appearance', undefined, {
        getColorScheme: new Builtin('Appearance.getColorScheme', () => scheme),
        addChangeListener: new Builtin('noop', () => ({ remove: () => undefined })),
      }),
      PixelRatio: new Builtin('PixelRatio', undefined, {
        get: new Builtin('PixelRatio.get', () => new Unknown('RUNTIME_VALUE', 'PixelRatio.get()')),
        getFontScale: new Builtin('PixelRatio.getFontScale', () => 1),
        roundToNearestPixel: new Builtin('PixelRatio.roundToNearestPixel', (a) => a[0]),
      }),
      I18nManager: new Builtin('I18nManager', undefined, { isRTL: false }),
    };
    const useState = new Builtin('useState', (a) => {
      const init = a[0] instanceof Closure ? this.callClosure(a[0], []) : a[0];
      return [init, new Builtin('setState', () => undefined)];
    });
    const react: Record<string, unknown> = {
      useMemo: new Builtin('useMemo', (a) => (a[0] instanceof Closure ? this.callClosure(a[0], []) : new Unknown('RUNTIME_VALUE', 'useMemo'))),
      useCallback: new Builtin('useCallback', (a) => a[0]),
      useState,
      useReducer: new Builtin('useReducer', (a) => [a[1], new Builtin('dispatch', () => undefined)]),
      useRef: new Builtin('useRef', (a) => ({ current: a[0] })),
      useEffect: new Builtin('useEffect', () => undefined),
      useLayoutEffect: new Builtin('useLayoutEffect', () => undefined),
      useInsertionEffect: new Builtin('useInsertionEffect', () => undefined),
      useId: new Builtin('useId', () => new Unknown('RUNTIME_VALUE', 'useId()')),
      useContext: new Builtin('useContext', (a, info) => this.useContext(a[0], info)),
      use: new Builtin('use', (a, info) => (a[0] instanceof ContextRef ? this.useContext(a[0], info) : new Unknown('RUNTIME_VALUE', info.text))),
      createContext: new Builtin('createContext', (a, info) => new ContextRef(`${info.file}:${info.node.start}`, '', a[0], info.file)),
      forwardRef: new Builtin('forwardRef', (a) => a[0]),
      memo: new Builtin('memo', (a) => a[0]),
      Fragment: new External('react', 'Fragment'),
    };
    react.default = new Builtin('React', undefined, react);
    const s = scalerFns(this.opts.viewport, this.scaler);
    const scalerMod: Record<string, unknown> = {
      getScreenWidth: new Builtin('getScreenWidth', () => width),
      getScreenHeight: new Builtin('getScreenHeight', () => height),
      screenWidth: width,
      screenHeight: height,
      configureScaler: new Builtin('configureScaler', () => undefined),
    };
    for (const [k, fn] of Object.entries(s)) {
      scalerMod[k] = new Builtin(k, (a, info) => {
        const n = num(a[0]);
        if (n === undefined) return isUnknown(a[0]) ? a[0] : new Unknown('RUNTIME_VALUE', info.text, this.project.rel(info.file), info.line);
        const o = (a[1] && typeof a[1] === 'object' && !isUnknown(a[1]) ? a[1] : {}) as any;
        const opts: any = {};
        for (const key of ['min', 'max', 'useUniform']) if (o[key] !== undefined) opts[key] = num(o[key]) ?? o[key];
        return new Approx(fn(n, opts), info.text);
      });
    }
    scalerMod.useScaler = new Builtin('useScaler', () => ({ ...scalerMod, width, height }));
    scalerMod.deviceInfo = { pixelRatio: new Unknown('RUNTIME_VALUE', 'pixelRatio'), fontScale: 1, isTablet: Math.min(width, height) >= 768, isSmallDevice: Math.min(width, height) < 350 };
    const out: Record<string, Record<string, unknown>> = {
      'react-native': rn,
      'react-native-web': rn,
      react,
      '@shayrn/react-native-scaler': scalerMod,
      nativewind: {
        useColorScheme: new Builtin('useColorScheme', () => ({ colorScheme: scheme, setColorScheme: new Builtin('noop', () => undefined), toggleColorScheme: new Builtin('noop', () => undefined) })),
        cssInterop: new Builtin('cssInterop', () => undefined),
        remapProps: new Builtin('remapProps', () => undefined),
      },
      clsx: { default: new Builtin('clsx', (a) => this.clsx(a)), clsx: new Builtin('clsx', (a) => this.clsx(a)) },
      classnames: { default: new Builtin('classnames', (a) => this.clsx(a)) },
      'tailwind-merge': { twMerge: new Builtin('twMerge', (a) => this.clsx(a)), twJoin: new Builtin('twJoin', (a) => this.clsx(a)) },
      'react-native-safe-area-context': {
        useSafeAreaInsets: new Builtin('useSafeAreaInsets', (_a, info) => new Unknown('RUNTIME_VALUE', info.text, this.project.rel(info.file), info.line)),
      },
    };
    for (const [mod, fns] of Object.entries(tableScalers(this.opts.viewport, this.opts.config))) {
      out[mod] = out[mod] ?? {};
      for (const [k, fn] of Object.entries(fns)) {
        out[mod][k] = new Builtin(k, (a, info) => {
          const n = num(a[0]);
          if (n === undefined) return new Unknown('RUNTIME_VALUE', info.text, this.project.rel(info.file), info.line);
          return new Approx(Math.round(fn(n, num(a[1])) * 100) / 100, info.text);
        });
      }
    }
    return out;
  }

  clsx(args: unknown[]): unknown {
    const classes: string[] = [];
    const dynamic: Unknown[] = [];
    const add = (v: unknown): void => {
      if (v === null || v === undefined || v === false || v === true || v === '') return;
      if (typeof v === 'string') classes.push(...v.split(/\s+/).filter(Boolean));
      else if (typeof v === 'number') classes.push(String(v));
      else if (Array.isArray(v)) v.forEach(add);
      else if (v instanceof ClassList) {
        classes.push(...v.classes);
        dynamic.push(...v.dynamic);
      } else if (v instanceof Cond) {
        // undecidable condition: keep every branch's classes (later ones win, like RN style order)
        v.options.forEach(add);
      } else if (isUnknown(v)) dynamic.push(v);
      else if (v && typeof v === 'object') {
        for (const [k, c] of Object.entries(v)) {
          if (isUnknown(c) || c instanceof Cond) classes.push(...k.split(/\s+/));
          else if (c) classes.push(...k.split(/\s+/));
        }
      }
    };
    args.forEach(add);
    return dynamic.length ? new ClassList(classes, dynamic) : classes.join(' ');
  }

  externalModule(mod: string, name: string): unknown {
    const b = this.builtinModules[mod];
    if (b) {
      if (name === '*') return new Builtin(mod, undefined, b);
      if (name in b) return b[name];
      if (name === 'default' && b.default === undefined) return new Builtin(mod, undefined, b);
    }
    return new External(mod, name === 'default' ? defaultName(mod) : name);
  }

  // ---------- modules ----------
  getModule(file: string): Module | null {
    const cached = this.modules.get(file);
    if (cached) return cached;
    if (file.endsWith('.json')) return null;
    let code: string;
    try {
      code = this.project.read(file);
    } catch {
      return null;
    }
    const ast = parseFile(code, file);
    const scope = new Scope(this.globals, file);
    const mod: Module = { file, ast, code, scope, exports: new Map(), stars: [] };
    this.modules.set(file, mod);
    for (const stmt of ast.program.body) this.hoistModuleStatement(stmt, mod);
    return mod;
  }

  private importValue(file: string, spec: string, name: string): unknown {
    const target = this.project.resolve(file, spec);
    if (!target) {
      if (/\.(png|jpe?g|gif|webp|svg|ttf|otf|css)$/.test(spec)) return new External('asset', spec);
      return this.externalModule(spec, name);
    }
    if (target.endsWith('.json') || /\.(png|jpe?g|gif|webp|ttf|otf)$/.test(target)) {
      const v = this.loadJsonOrAsset(target);
      return name === 'default' || name === '*' ? v : (v as any)?.[name];
    }
    if (name === '*') return new Namespace(target);
    return this.getExport(target, name);
  }

  getExport(file: string, name: string, seen = new Set<string>()): unknown {
    if (seen.has(file)) return new Unknown('UNKNOWN_IMPORT', name);
    seen.add(file);
    const mod = this.getModule(file);
    if (!mod) return new Unknown('UNKNOWN_IMPORT', name);
    const th = mod.exports.get(name);
    if (th) return th();
    if (name !== 'default') {
      for (const s of mod.stars) {
        const target = this.project.resolve(file, s);
        if (!target) continue;
        const m2 = this.getModule(target);
        if (!m2) continue;
        if (m2.exports.has(name) || m2.stars.length) {
          const v = this.getExport(target, name, seen);
          if (!(isUnknown(v) && v.reason === 'UNKNOWN_IMPORT' && v.expr === name)) return v;
        }
      }
    }
    return new Unknown('UNKNOWN_IMPORT', `${name} from ${this.project.rel(file)}`);
  }

  private hoistModuleStatement(stmt: t.Statement, mod: Module): void {
    const { scope, file } = mod;
    switch (stmt.type) {
      case 'ImportDeclaration': {
        if (stmt.importKind === 'type') return;
        const spec = stmt.source.value;
        for (const s of stmt.specifiers) {
          if (s.type === 'ImportSpecifier' && s.importKind === 'type') continue;
          const local = s.local.name;
          const imported = s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportNamespaceSpecifier' ? '*' : s.imported.type === 'Identifier' ? s.imported.name : s.imported.value;
          scope.setLazy(local, () => this.importValue(file, spec, imported));
        }
        return;
      }
      case 'ExportNamedDeclaration': {
        if (stmt.declaration) {
          this.hoistStatement(stmt.declaration, scope, file);
          for (const n of declaredNames(stmt.declaration)) mod.exports.set(n, () => scope.lookup(n).value);
        }
        for (const s of stmt.specifiers) {
          const exported = s.exported.type === 'Identifier' ? s.exported.name : s.exported.value;
          if (stmt.source) {
            const src = stmt.source.value;
            const local = s.type === 'ExportSpecifier' ? s.local.name : s.type === 'ExportDefaultSpecifier' ? 'default' : '*';
            mod.exports.set(exported, once(() => this.importValue(file, src, s.type === 'ExportNamespaceSpecifier' ? '*' : local)));
          } else if (s.type === 'ExportSpecifier') {
            const local = s.local.name;
            mod.exports.set(exported, () => scope.lookup(local).value);
          }
        }
        return;
      }
      case 'ExportAllDeclaration':
        mod.stars.push(stmt.source.value);
        return;
      case 'ExportDefaultDeclaration': {
        const d = stmt.declaration;
        if (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') {
          if (d.id) this.hoistStatement(d, scope, file);
          const c = d.type === 'FunctionDeclaration' ? new Closure(d, scope, file, d.id?.name ?? 'default') : new Unknown('RUNTIME_VALUE', 'class');
          mod.exports.set('default', () => c);
        } else if (d.type !== 'TSDeclareFunction') {
          mod.exports.set('default', once(() => this.eval(d as t.Expression, scope)));
        }
        return;
      }
      case 'TSExportAssignment':
        mod.exports.set('default', once(() => this.eval(stmt.expression, scope)));
        return;
      case 'ExpressionStatement': {
        // module.exports = ...
        const e = stmt.expression;
        if (e.type === 'AssignmentExpression' && e.left.type === 'MemberExpression' && e.left.object.type === 'Identifier' && e.left.object.name === 'module') {
          mod.exports.set('default', once(() => this.eval(e.right, scope)));
        }
        return;
      }
      default:
        this.hoistStatement(stmt, scope, file);
    }
  }

  /** Declare bindings for a statement lazily (const/let/var/function). */
  hoistStatement(stmt: t.Node, scope: Scope, file: string, reassigned?: Set<string>): void {
    if (stmt.type === 'VariableDeclaration') {
      for (const d of stmt.declarations) {
        const init = d.init;
        const nameHint = d.id.type === 'Identifier' ? d.id.name : undefined;
        const get = once(() => {
          if (!init) return undefined;
          const v = this.eval(init, scope);
          if (v instanceof ContextRef && nameHint && !v.name) v.name = nameHint;
          if (v instanceof Closure && nameHint && !v.name) v.name = nameHint;
          return v;
        });
        this.bindPattern(d.id, get, scope, file, stmt.kind !== 'const' ? reassigned : undefined);
      }
    } else if (stmt.type === 'FunctionDeclaration' && stmt.id) {
      scope.set(stmt.id.name, new Closure(stmt, scope, file, stmt.id.name));
    } else if (stmt.type === 'ClassDeclaration' && stmt.id) {
      scope.set(stmt.id.name, new Unknown('RUNTIME_VALUE', 'class ' + stmt.id.name));
    } else if (stmt.type === 'TSEnumDeclaration') {
      const o: Record<string, unknown> = {};
      let i = 0;
      for (const m of stmt.members) {
        const k = m.id.type === 'Identifier' ? m.id.name : m.id.value;
        const v = m.initializer ? this.eval(m.initializer, scope) : i;
        o[k] = v;
        if (typeof v === 'number') i = v + 1;
      }
      scope.set(stmt.id.name, o);
    }
  }

  bindPattern(p: t.Node, get: () => unknown, scope: Scope, file: string, reassigned?: Set<string>): void {
    switch (p.type) {
      case 'Identifier':
        if (reassigned?.has(p.name)) scope.set(p.name, new Unknown('RUNTIME_VALUE', p.name, this.project.rel(file), p.loc?.start.line));
        else scope.setLazy(p.name, get);
        return;
      case 'ObjectPattern': {
        const used: string[] = [];
        for (const prop of p.properties) {
          if (prop.type === 'RestElement') {
            this.bindPattern(prop.argument, once(() => omit(get(), used)), scope, file, reassigned);
            continue;
          }
          const key = prop.computed ? undefined : prop.key.type === 'Identifier' ? prop.key.name : prop.key.type === 'StringLiteral' ? prop.key.value : undefined;
          if (key === undefined) {
            for (const n of patternNames(prop.value)) scope.set(n, new Unknown('RUNTIME_VALUE', n));
            continue;
          }
          used.push(key);
          this.bindPattern(prop.value, once(() => this.member(get(), key, prop, file)), scope, file, reassigned);
        }
        return;
      }
      case 'ArrayPattern':
        p.elements.forEach((el, i) => {
          if (!el) return;
          if (el.type === 'RestElement') {
            this.bindPattern(el.argument, once(() => {
              const v = get();
              return Array.isArray(v) ? v.slice(i) : v;
            }), scope, file, reassigned);
          } else this.bindPattern(el, once(() => this.member(get(), i, el, file)), scope, file, reassigned);
        });
        return;
      case 'AssignmentPattern':
        this.bindPattern(p.left, once(() => {
          const v = get();
          return v === undefined ? this.eval(p.right, scope) : v;
        }), scope, file, reassigned);
        return;
      case 'RestElement':
        this.bindPattern(p.argument, get, scope, file, reassigned);
        return;
      case 'TSParameterProperty':
        this.bindPattern(p.parameter, get, scope, file, reassigned);
        return;
      default:
        return;
    }
  }

  // ---------- context ----------
  private useContext(ctx: unknown, info: CallInfo): unknown {
    if (!(ctx instanceof ContextRef)) return isUnknown(ctx) ? ctx : new Unknown('HOOK_UNSUPPORTED', info.text, this.project.rel(info.file), info.line);
    if (this.contextCache.has(ctx.id)) return this.contextCache.get(ctx.id);
    this.contextCache.set(ctx.id, ctx.defaultValue);
    const v = this.findProviderValue(ctx);
    const result = v === undefined || isUnknown(v) ? ctx.defaultValue : v;
    if (result !== undefined && !isUnknown(result)) this.usedTheme = true;
    this.contextCache.set(ctx.id, result);
    return result;
  }

  private findProviderValue(ctx: ContextRef): unknown {
    if (!ctx.name) return undefined;
    const needleA = `${ctx.name}.Provider`;
    const needleB = `<${ctx.name}`;
    for (const f of this.project.sourceFiles()) {
      const code = this.project.read(f);
      if (!code.includes(needleA) && !code.includes(needleB)) continue;
      const mod = this.getModule(f);
      if (!mod) continue;
      let found: unknown;
      walk(mod.ast.program, (n, parents) => {
        if (found !== undefined) return false;
        if (n.type !== 'JSXOpeningElement') return;
        const nm = n.name;
        const isProv = nm.type === 'JSXMemberExpression' && nm.object.type === 'JSXIdentifier' && nm.object.name === ctx.name && nm.property.name === 'Provider';
        const isDirect = nm.type === 'JSXIdentifier' && nm.name === ctx.name;
        if (!isProv && !isDirect) return;
        const attr = n.attributes.find((a: any) => a.type === 'JSXAttribute' && a.name.name === 'value');
        if (!attr || attr.value?.type !== 'JSXExpressionContainer') return;
        const fnIdx = findLastIndex(parents, (p: any) => /Function|ArrowFunction/.test(p.type) && p.body);
        let scope = mod.scope;
        if (fnIdx >= 0) {
          const fn = parents[fnIdx] as FnNode;
          scope = this.enterFunction(new Closure(fn, mod.scope, f), [new Unknown('RUNTIME_VALUE', 'props')]);
        }
        const tag = this.eval(isProv ? (nm.object as any) : (nm as any), scope, true);
        if (!(tag instanceof ContextRef) || tag.id !== ctx.id) return;
        found = this.eval(attr.value.expression, scope);
        return false;
      });
      if (found !== undefined) return found;
    }
    return undefined;
  }

  // ---------- functions ----------
  private reassignedIn(body: t.Node): Set<string> {
    let s = this.reassignCache.get(body);
    if (!s) {
      s = new Set();
      const set = s;
      walk(body, (n) => {
        if (n.type === 'AssignmentExpression' && n.left.type === 'Identifier') set.add(n.left.name);
        if (n.type === 'UpdateExpression' && n.argument.type === 'Identifier') set.add(n.argument.name);
      });
      this.reassignCache.set(body, s);
    }
    return s;
  }

  enterFunction(c: Closure, args: unknown[]): Scope {
    const scope = new Scope(c.scope, c.file);
    const fn = c.node;
    if (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'ObjectMethod' && fn.type !== 'FunctionDeclaration' && fn.id) {
      scope.set(fn.id.name, c);
    }
    fn.params.forEach((p, i) => this.bindPattern(p, p.type === 'RestElement' ? () => args.slice(i) : () => args[i], scope, c.file));
    if (fn.body.type === 'BlockStatement') {
      const re = this.reassignedIn(fn.body);
      for (const st of fn.body.body) this.hoistStatement(st, scope, c.file, re);
    }
    return scope;
  }

  callClosure(c: Closure, args: unknown[]): unknown {
    if (this.callDepth > MAX_CALL_DEPTH) return new Unknown('RUNTIME_VALUE', c.name ?? 'call');
    this.callDepth++;
    try {
      const scope = this.enterFunction(c, args);
      const body = c.node.body;
      if (body.type !== 'BlockStatement') return this.eval(body as t.Expression, scope);
      const r = this.execBlock(body.body, scope, c.file, true);
      return r.returned ? r.value : undefined;
    } finally {
      this.callDepth--;
    }
  }

  private execBlock(stmts: t.Statement[], scope: Scope, file: string, hoisted = false): { returned: boolean; value?: unknown } {
    if (!hoisted) {
      const re = new Set<string>();
      for (const st of stmts) this.hoistStatement(st, scope, file, re);
    }
    let fallback: { returned: boolean; value?: unknown } | null = null;
    for (const st of stmts) {
      if (st.type === 'ReturnStatement') return { returned: true, value: st.argument ? this.eval(st.argument, scope) : undefined };
      if (st.type === 'IfStatement') {
        const test = this.eval(st.test, scope);
        const run = (s: t.Statement | null | undefined) => {
          if (!s) return { returned: false };
          if (s.type === 'BlockStatement') return this.execBlock(s.body, new Scope(scope, file), file);
          return this.execBlock([s], new Scope(scope, file), file);
        };
        if (isUnknown(test) || test instanceof Cond || test instanceof External) {
          // Undecidable guard: prefer the main path; remember the branch in case nothing else returns.
          if (!fallback) {
            const r = run(st.consequent);
            if (r.returned) fallback = r;
            else if (st.alternate) {
              const r2 = run(st.alternate);
              if (r2.returned) fallback = r2;
            }
          }
          continue;
        }
        const r = truthy(test) ? run(st.consequent) : run(st.alternate);
        if (r.returned) return r;
        continue;
      }
      if (st.type === 'BlockStatement') {
        const r = this.execBlock(st.body, new Scope(scope, file), file);
        if (r.returned) return r;
      }
      if (st.type === 'TryStatement') {
        const r = this.execBlock(st.block.body, new Scope(scope, file), file);
        if (r.returned) return r;
      }
    }
    return fallback ?? { returned: false };
  }

  // ---------- expressions ----------
  member(obj: unknown, key: string | number, node: t.Node, file: string, optional = false): unknown {
    if (isUnknown(obj)) return new Unknown(obj.reason, this.text(node, file) || obj.expr, obj.file ?? this.project.rel(file), obj.line ?? node.loc?.start.line);
    if (obj instanceof Cond) {
      const opts = obj.options.map((o) => this.member(o, key, node, file, true));
      return collapse(opts, obj.expr);
    }
    if (obj === null || obj === undefined) return optional ? undefined : new Unknown('RUNTIME_VALUE', this.text(node, file), this.project.rel(file), node.loc?.start.line);
    if (obj instanceof Namespace) return this.getExport(obj.file, String(key));
    if (obj instanceof External) return new External(obj.module, `${obj.name}.${key}`);
    if (obj instanceof Builtin) {
      if (obj.props && key in obj.props) return obj.props[key as string];
      return new Unknown('RUNTIME_VALUE', this.text(node, file), this.project.rel(file), node.loc?.start.line);
    }
    if (obj instanceof ContextRef) return key === 'Provider' || key === 'Consumer' ? new External('react', `${obj.name}.${key}`) : undefined;
    if (obj instanceof Approx) return undefined;
    if (obj instanceof Closure || obj instanceof JsxValue) return undefined;
    if (typeof obj === 'string') return key === 'length' ? obj.length : typeof key === 'number' ? obj[key] : undefined;
    if (Array.isArray(obj)) return key === 'length' ? obj.length : (obj as any)[key];
    if (typeof obj === 'object') {
      if (Object.prototype.hasOwnProperty.call(obj, key)) return (obj as any)[key];
      const sp = (obj as any)[SPREADS] as Unknown[] | undefined;
      if (sp?.length) return new Unknown('SPREAD', this.text(node, file), this.project.rel(file), node.loc?.start.line);
      if ((obj as any)[OPEN]) return new Unknown('RUNTIME_VALUE', this.text(node, file), this.project.rel(file), node.loc?.start.line);
      return undefined;
    }
    return undefined;
  }

  eval(node: t.Node, scope: Scope, quiet = false): unknown {
    const file = scope.file;
    switch (node.type) {
      case 'NumericLiteral':
      case 'StringLiteral':
      case 'BooleanLiteral':
        return (node as any).value;
      case 'NullLiteral':
        return null;
      case 'BigIntLiteral':
        return Number(node.value);
      case 'RegExpLiteral':
        return new Unknown('RUNTIME_VALUE', 'regexp');
      case 'TemplateLiteral': {
        let s = '';
        for (let i = 0; i < node.quasis.length; i++) {
          s += node.quasis[i].value.cooked ?? node.quasis[i].value.raw;
          if (i < node.expressions.length) {
            const v = this.eval(node.expressions[i], scope);
            if (isUnknown(v)) return new Unknown(v.reason, this.text(node, file), this.project.rel(file), node.loc?.start.line);
            if (v instanceof Cond || typeof v === 'object') return new Unknown('CONDITIONAL_UNKNOWN', this.text(node, file), this.project.rel(file), node.loc?.start.line);
            s += String(v instanceof Approx ? v.value : v);
          }
        }
        return s;
      }
      case 'Identifier': {
        const r = scope.lookup(node.name);
        if (r.found) return r.value;
        return quiet ? undefined : new Unknown('RUNTIME_VALUE', node.name, this.project.rel(file), node.loc?.start.line);
      }
      case 'JSXIdentifier': {
        const r = scope.lookup(node.name);
        return r.found ? r.value : undefined;
      }
      case 'JSXMemberExpression': {
        const o = this.eval(node.object, scope, quiet);
        return this.member(o, node.property.name, node, file, true);
      }
      case 'ThisExpression':
        return new Unknown('RUNTIME_VALUE', 'this');
      case 'ParenthesizedExpression':
      case 'TSAsExpression':
      case 'TSSatisfiesExpression':
      case 'TSNonNullExpression':
      case 'TSTypeAssertion':
      case 'TypeCastExpression':
      case 'TSInstantiationExpression':
        return this.eval((node as any).expression, scope, quiet);
      case 'ArrayExpression': {
        const out: unknown[] = [];
        for (const el of node.elements) {
          if (!el) out.push(undefined);
          else if (el.type === 'SpreadElement') {
            const v = this.eval(el.argument, scope);
            if (Array.isArray(v)) out.push(...v);
            else out.push(isUnknown(v) ? new Unknown('SPREAD', this.text(el, file), this.project.rel(file), el.loc?.start.line) : v);
          } else out.push(this.eval(el, scope));
        }
        return out;
      }
      case 'ObjectExpression': {
        const o: any = {};
        for (const p of node.properties) {
          if (p.type === 'SpreadElement') {
            const v = this.eval(p.argument, scope);
            if (v instanceof Cond) {
              for (const opt of v.options) if (opt && typeof opt === 'object' && !isUnknown(opt)) for (const [k, val] of Object.entries(opt)) o[k] = k in o ? collapse([o[k], val], v.expr) : collapse([undefined, val], v.expr);
            } else if (v && typeof v === 'object' && !isUnknown(v) && !(v instanceof Builtin) && !(v instanceof External)) {
              Object.assign(o, v);
              if ((v as any)[SPREADS]) (o[SPREADS] ??= []).push(...(v as any)[SPREADS]);
            } else if (isUnknown(v) || v instanceof External || v instanceof Builtin) {
              (o[SPREADS] ??= []).push(new Unknown('SPREAD', this.text(p, file), this.project.rel(file), p.loc?.start.line));
            }
            continue;
          }
          let key: string | undefined;
          if (p.computed) {
            const k = this.eval(p.key, scope);
            if (typeof k === 'string' || typeof k === 'number') key = String(k);
          } else if (p.key.type === 'Identifier') key = p.key.name;
          else if (p.key.type === 'StringLiteral' || p.key.type === 'NumericLiteral') key = String(p.key.value);
          if (key === undefined) continue;
          if (p.type === 'ObjectMethod') o[key] = new Closure(p, scope, file, key);
          else o[key] = this.eval(p.value, scope);
        }
        return o;
      }
      case 'ArrowFunctionExpression':
      case 'FunctionExpression':
        return new Closure(node, scope, file, node.type === 'FunctionExpression' ? node.id?.name : undefined);
      case 'JSXElement':
      case 'JSXFragment':
        return new JsxValue(node, scope, file);
      case 'MemberExpression':
      case 'OptionalMemberExpression': {
        const obj = this.eval(node.object, scope, quiet);
        let key: string | number | undefined;
        if (node.computed) {
          const k = this.eval(node.property, scope);
          if (typeof k === 'string' || typeof k === 'number') key = k;
          else if (k instanceof Cond) return collapse(k.options.map((kk) => (typeof kk === 'string' || typeof kk === 'number' ? this.member(obj, kk, node, file, true) : new Unknown('RUNTIME_VALUE', this.text(node, file)))), k.expr);
          else return new Unknown(isUnknown(k) ? k.reason : 'RUNTIME_VALUE', this.text(node, file), this.project.rel(file), node.loc?.start.line);
        } else key = (node.property as t.Identifier).name ?? (node.property as any).id?.name;
        if (key === undefined) return new Unknown('RUNTIME_VALUE', this.text(node, file));
        return this.member(obj, key, node, file, node.type === 'OptionalMemberExpression' || Boolean((node as any).optional));
      }
      case 'ConditionalExpression': {
        const test = this.eval(node.test, scope);
        if (isUnknown(test) || test instanceof Cond || test instanceof External) {
          return collapse([this.eval(node.consequent, scope), this.eval(node.alternate, scope)], this.text(node.test, file));
        }
        return truthy(test) ? this.eval(node.consequent, scope) : this.eval(node.alternate, scope);
      }
      case 'LogicalExpression': {
        const l = this.eval(node.left, scope);
        const undecided = isUnknown(l) || l instanceof Cond || l instanceof External;
        if (node.operator === '&&') {
          if (undecided) return collapse([false, this.eval(node.right, scope)], this.text(node.left, file));
          return truthy(l) ? this.eval(node.right, scope) : l;
        }
        if (node.operator === '||') {
          if (undecided) {
            if (l instanceof Cond) return collapse(l.options.map((o) => (truthy(o) ? o : this.eval(node.right, scope))), l.expr);
            return new Unknown(isUnknown(l) ? l.reason : 'RUNTIME_VALUE', this.text(node, file), this.project.rel(file), node.loc?.start.line);
          }
          return truthy(l) ? l : this.eval(node.right, scope);
        }
        if (undecided) {
          if (l instanceof Cond) return collapse(l.options.map((o) => (o ?? this.eval(node.right, scope))), l.expr);
          return new Unknown(isUnknown(l) ? l.reason : 'RUNTIME_VALUE', this.text(node, file), this.project.rel(file), node.loc?.start.line);
        }
        return l ?? this.eval(node.right, scope);
      }
      case 'UnaryExpression': {
        if (node.operator === 'typeof') return new Unknown('RUNTIME_VALUE', 'typeof');
        const v = this.eval(node.argument, scope);
        if (node.operator === 'void') return undefined;
        if (isUnknown(v)) return new Unknown(v.reason, this.text(node, file), this.project.rel(file), node.loc?.start.line);
        if (v instanceof Cond) return collapse(v.options.map((o) => unary(node.operator, o)), v.expr);
        if (v instanceof Approx) {
          const r = unary(node.operator, v.value);
          return typeof r === 'number' ? new Approx(r, v.expr) : r;
        }
        return unary(node.operator, v);
      }
      case 'BinaryExpression': {
        const l = this.eval(node.left, scope);
        const r = this.eval(node.right, scope);
        return this.binary(node.operator, l, r, node, file);
      }
      case 'SequenceExpression':
        return this.eval(node.expressions[node.expressions.length - 1], scope);
      case 'AssignmentExpression':
        return this.eval(node.right, scope);
      case 'AwaitExpression':
      case 'NewExpression':
      case 'UpdateExpression':
      case 'YieldExpression':
      case 'TaggedTemplateExpression':
      case 'ClassExpression':
        return new Unknown('RUNTIME_VALUE', this.text(node, file), this.project.rel(file), node.loc?.start.line);
      case 'CallExpression':
      case 'OptionalCallExpression':
        return this.evalCall(node as t.CallExpression, scope);
      default:
        return new Unknown('RUNTIME_VALUE', this.text(node, file), this.project.rel(file), node.loc?.start.line);
    }
  }

  private binary(op: string, l: unknown, r: unknown, node: t.Node, file: string): unknown {
    if (l instanceof Cond || r instanceof Cond) {
      const ls = l instanceof Cond ? l.options : [l];
      const rs = r instanceof Cond ? r.options : [r];
      if (ls.length * rs.length > 8) return new Unknown('CONDITIONAL_UNKNOWN', this.text(node, file), this.project.rel(file), node.loc?.start.line);
      const out: unknown[] = [];
      for (const a of ls) for (const b of rs) out.push(this.binary(op, a, b, node, file));
      return collapse(out, this.text(node, file));
    }
    if (isUnknown(l) || isUnknown(r)) {
      const u = (isUnknown(l) ? l : r) as Unknown;
      return new Unknown(u.reason, this.text(node, file), this.project.rel(file), node.loc?.start.line);
    }
    const approx = l instanceof Approx || r instanceof Approx;
    const a = l instanceof Approx ? l.value : l;
    const b = r instanceof Approx ? r.value : r;
    if (typeof a === 'object' && a !== null && op !== '===' && op !== '!==' && op !== 'in') return new Unknown('RUNTIME_VALUE', this.text(node, file), this.project.rel(file), node.loc?.start.line);
    let v: unknown;
    const A = a as any;
    const B = b as any;
    switch (op) {
      case '+': v = A + B; break;
      case '-': v = A - B; break;
      case '*': v = A * B; break;
      case '/': v = A / B; break;
      case '%': v = A % B; break;
      case '**': v = A ** B; break;
      case '===': v = A === B; break;
      case '!==': v = A !== B; break;
      case '==': v = A == B; break;
      case '!=': v = A != B; break;
      case '<': v = A < B; break;
      case '<=': v = A <= B; break;
      case '>': v = A > B; break;
      case '>=': v = A >= B; break;
      case '|': v = A | B; break;
      case '&': v = A & B; break;
      case 'in': v = B && typeof B === 'object' ? A in B : false; break;
      default:
        return new Unknown('RUNTIME_VALUE', this.text(node, file));
    }
    return approx && typeof v === 'number' ? new Approx(v, this.text(node, file)) : v;
  }

  private evalCall(node: t.CallExpression, scope: Scope): unknown {
    const file = scope.file;
    const info: CallInfo = { node, file, text: this.text(node, file), line: node.loc?.start.line ?? 0 };
    const callee = node.callee;
    const evalArgs = () =>
      node.arguments.flatMap((a) => {
        if (a.type === 'SpreadElement') {
          const v = this.eval(a.argument, scope);
          return Array.isArray(v) ? v : [new Unknown('SPREAD', this.text(a, file))];
        }
        return [this.eval(a as t.Expression, scope)];
      });
    if ((callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') && !callee.computed && callee.property.type === 'Identifier') {
      const method = callee.property.name;
      const obj = this.eval(callee.object, scope);
      if (obj instanceof Namespace || obj instanceof Builtin || (obj && typeof obj === 'object' && !Array.isArray(obj) && !isUnknown(obj) && !(obj instanceof Cond) && !(obj instanceof External) && !(obj instanceof Approx) && Object.prototype.hasOwnProperty.call(obj, method))) {
        const fn = this.member(obj, method, callee, file);
        return this.apply(fn, evalArgs(), info);
      }
      if (obj instanceof External) return this.externalCall(new External(obj.module, `${obj.name}.${method}`), info);
      return this.methodCall(obj, method, evalArgs(), info);
    }
    const fn = this.eval(callee, scope);
    return this.apply(fn, evalArgs(), info);
  }

  apply(fn: unknown, args: unknown[], info: CallInfo): unknown {
    if (fn instanceof Closure) return this.callClosure(fn, args);
    if (fn instanceof Builtin && fn.call) return fn.call(args, info);
    if (fn instanceof External) return this.externalCall(fn, info);
    if (isUnknown(fn)) return new Unknown(fn.reason, info.text, this.project.rel(info.file), info.line);
    return new Unknown('RUNTIME_VALUE', info.text, this.project.rel(info.file), info.line);
  }

  private externalCall(fn: External, info: CallInfo): unknown {
    const base = fn.name.split('.').pop() ?? fn.name;
    if (/^use[A-Z]/.test(base) && /theme|style|color|colour|palette|token/i.test(base)) return new Unknown('HOOK_UNSUPPORTED', info.text, this.project.rel(info.file), info.line);
    if (fn.module === 'asset') return new Unknown('UNKNOWN_IMPORT', info.text, this.project.rel(info.file), info.line);
    return new Unknown('RUNTIME_VALUE', info.text, this.project.rel(info.file), info.line);
  }

  private methodCall(obj: unknown, method: string, args: unknown[], info: CallInfo): unknown {
    const unk = (r: Reason = 'RUNTIME_VALUE') => new Unknown(r, info.text, this.project.rel(info.file), info.line);
    const fnArg = args[0];
    if (method === 'map' && fnArg instanceof Closure) {
      if (Array.isArray(obj)) {
        if (obj.length === 0) return [];
        const first = this.callClosure(fnArg, [obj[0], 0, obj]);
        if (first instanceof JsxValue || first instanceof Cond) return new Repeat(first, obj.length);
        if (obj.length > 200) return unk();
        return [first, ...obj.slice(1).map((x, i) => this.callClosure(fnArg, [x, i + 1, obj]))];
      }
      const sample = this.callClosure(fnArg, [unk(), unk(), unk()]);
      if (sample instanceof JsxValue || sample instanceof Cond) return new Repeat(sample, undefined);
      return unk(isUnknown(obj) ? obj.reason : 'RUNTIME_VALUE');
    }
    if (isUnknown(obj)) return new Unknown(obj.reason, info.text, this.project.rel(info.file), info.line);
    if (obj instanceof Cond || obj instanceof Approx) return unk('CONDITIONAL_UNKNOWN');
    if (typeof obj === 'string') {
      const plain = args.map((a) => (a instanceof Approx ? a.value : a));
      if (plain.some((a) => isUnknown(a) || (typeof a === 'object' && a !== null))) return unk();
      const f = (String.prototype as any)[method];
      if (typeof f === 'function' && ['toUpperCase', 'toLowerCase', 'trim', 'slice', 'substring', 'startsWith', 'endsWith', 'includes', 'replace', 'replaceAll', 'split', 'padStart', 'padEnd', 'charAt', 'concat', 'indexOf', 'repeat', 'toString'].includes(method)) return f.apply(obj, plain);
      return unk();
    }
    if (typeof obj === 'number') {
      if (method === 'toFixed' || method === 'toString') return (Number.prototype as any)[method].apply(obj, args);
      return unk();
    }
    if (Array.isArray(obj)) {
      switch (method) {
        case 'join':
          return obj.some((x) => isUnknown(x)) ? unk() : obj.join(typeof args[0] === 'string' ? args[0] : ',');
        case 'concat':
          return obj.concat(...args.map((a) => (Array.isArray(a) ? a : [a])));
        case 'includes':
          return isUnknown(args[0]) ? unk() : obj.includes(args[0]);
        case 'indexOf':
          return obj.indexOf(args[0]);
        case 'slice':
          return obj.slice(num(args[0]), num(args[1]));
        case 'filter':
        case 'find':
        case 'some':
        case 'every':
        case 'findIndex': {
          if (!(fnArg instanceof Closure) || obj.length > 200) return unk();
          const res = obj.map((x, i) => this.callClosure(fnArg, [x, i, obj]));
          if (res.some((r) => isUnknown(r) || r instanceof Cond)) return unk('CONDITIONAL_UNKNOWN');
          if (method === 'filter') return obj.filter((_, i) => truthy(res[i]));
          if (method === 'find') return obj.find((_, i) => truthy(res[i]));
          if (method === 'findIndex') return obj.findIndex((_, i) => truthy(res[i]));
          if (method === 'some') return res.some(truthy);
          return res.every(truthy);
        }
        case 'flat':
          return obj.flat();
        case 'reverse':
          return [...obj].reverse();
        default:
          return unk();
      }
    }
    if (obj instanceof Closure) {
      if (method === 'call') return this.callClosure(obj, args.slice(1));
      if (method === 'apply') return this.callClosure(obj, Array.isArray(args[1]) ? args[1] : []);
      if (method === 'bind') return obj;
    }
    return unk();
  }
}

function defaultName(mod: string): string {
  const last = mod.split('/').pop() ?? mod;
  return last.replace(/(^|[-_])(\w)/g, (_m, _a, c: string) => c.toUpperCase());
}

export function truthy(v: unknown): boolean {
  if (v instanceof Approx) return v.value !== 0;
  return Boolean(v);
}

function unary(op: string, v: unknown): unknown {
  const a = v as any;
  switch (op) {
    case '!': return !truthy(v);
    case '-': return -a;
    case '+': return +a;
    case '~': return ~a;
    default: return new Unknown('RUNTIME_VALUE', op);
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Approx && b instanceof Approx) return a.value === b.value;
  return false;
}

/** Build a Cond, collapsing identical branches. */
export function collapse(options: unknown[], expr: string): unknown {
  const flat: unknown[] = [];
  for (const o of options) {
    if (o instanceof Cond) flat.push(...o.options);
    else flat.push(o);
  }
  const uniq: unknown[] = [];
  for (const o of flat) if (!uniq.some((u) => sameValue(u, o))) uniq.push(o);
  if (uniq.length === 1) return uniq[0];
  return new Cond(uniq, expr);
}

function omit(v: unknown, keys: string[]): unknown {
  if (!v || typeof v !== 'object' || isUnknown(v) || Array.isArray(v) || v instanceof Builtin) return v;
  const out: any = {};
  for (const [k, val] of Object.entries(v)) if (!keys.includes(k)) out[k] = val;
  if ((v as any)[SPREADS]) out[SPREADS] = (v as any)[SPREADS];
  return out;
}

function findLastIndex<T>(a: T[], f: (x: T) => boolean): number {
  for (let i = a.length - 1; i >= 0; i--) if (f(a[i])) return i;
  return -1;
}

export function declaredNames(n: t.Node): string[] {
  if (n.type === 'VariableDeclaration') return n.declarations.flatMap((d) => patternNames(d.id));
  if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration' || n.type === 'TSEnumDeclaration') && n.id) return [n.id.name];
  return [];
}

export function patternNames(p: t.Node): string[] {
  switch (p.type) {
    case 'Identifier': return [p.name];
    case 'ObjectPattern': return p.properties.flatMap((x) => (x.type === 'RestElement' ? patternNames(x.argument) : patternNames(x.value)));
    case 'ArrayPattern': return p.elements.flatMap((e) => (e ? patternNames(e) : []));
    case 'AssignmentPattern': return patternNames(p.left);
    case 'RestElement': return patternNames(p.argument);
    default: return [];
  }
}
