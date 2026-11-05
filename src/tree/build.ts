import type * as t from '@babel/types';
import { Engine, Repeat, ClassList, OPEN } from '../resolve/evaluator.js';
import { Approx, Builtin, Closure, Cond, ContextRef, External, JsxValue, Scope, Unknown, isUnknown } from '../resolve/values.js';
import { collectStyle, expandShorthands, finalizeStyle, setRaw, type RawEntry } from '../resolve/normalize.js';
import { collectClasses, type ClassContext } from '../nativewind/index.js';
import type { MapNode, StyleEntry, UnresolvedEntry, Loc } from '../types.js';

const MAX_INLINE = 30;
const TRANSPARENT = new Set(['Fragment', 'React.Fragment', 'StrictMode', 'Suspense', 'React.Suspense']);
const INTERACTIVE = /^(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|TouchableNativeFeedback|Button|RectButton|BorderlessButton|BaseButton|Link)$/;
const LIST_RENDER = ['ListHeaderComponent', 'ListFooterComponent', 'ListEmptyComponent'];

type Out = MapNode | string;

export interface BuildResult {
  tree: MapNode;
  unresolved: UnresolvedEntry[];
  resolved: number;
  total: number;
}

export class TreeBuilder {
  private stack: object[] = [];
  private unres: UnresolvedEntry[] = [];
  private resolved = 0;
  private total = 0;

  constructor(
    private engine: Engine,
    private nw: ClassContext | null,
    private explain = false,
  ) {}

  /** Render a route file's default export (or first exported component). */
  buildRoute(file: string, routeName: string, component?: unknown): BuildResult {
    this.unres = [];
    this.resolved = 0;
    this.total = 0;
    const comp = component ?? this.engine.getExport(file, 'default');
    const rel = this.engine.project.rel(file);
    const root: MapNode = { name: routeName, loc: { file: rel, line: 1 } };
    let children: Out[] = [];
    if (comp instanceof Closure) children = this.renderComponent(comp, runtimeProps({ navigation: {}, route: { params: runtimeProps({}, 'route.params') } }, 'props'), null);
    else if (comp instanceof JsxValue) children = this.render(comp);
    root.children = children.filter((c): c is MapNode => typeof c !== 'string');
    if (root.children.length === 1 && !root.children[0].callsite) {
      // the screen component's single root becomes the tree root
      const only = root.children[0];
      return { tree: only, unresolved: this.unres, resolved: this.resolved, total: this.total };
    }
    if (root.children.length === 0 && !(comp instanceof Closure)) {
      this.unres.push({ file: rel, line: 1, prop: 'default', expr: 'default export', reason: isUnknown(comp) ? comp.reason : 'EXTERNAL_COMPONENT' });
      this.total++;
    }
    return { tree: root, unresolved: this.unres, resolved: this.resolved, total: this.total };
  }

  private renderComponent(c: Closure, props: Record<string, unknown>, callsite: Loc | null): Out[] {
    if (this.stack.includes(c.node) || this.stack.length > MAX_INLINE) return [];
    this.stack.push(c.node);
    try {
      const v = this.engine.callClosure(c, [props]);
      const out = this.render(v);
      if (callsite) for (const n of out) if (typeof n !== 'string' && !n.callsite) n.callsite = callsite;
      return out;
    } finally {
      this.stack.pop();
    }
  }

  render(v: unknown): Out[] {
    if (v === null || v === undefined || v === false || v === true || v === '') return [];
    if (typeof v === 'string') return [v];
    if (typeof v === 'number') return [String(v)];
    if (v instanceof Approx) return [String(v.value)];
    if (Array.isArray(v)) return v.flatMap((x) => this.render(x));
    if (v instanceof Cond) {
      for (const o of v.options) {
        const r = this.render(o);
        if (r.some((x) => typeof x !== 'string')) return r;
      }
      for (const o of v.options) {
        const r = this.render(o);
        if (r.length) return r;
      }
      return [];
    }
    if (v instanceof Repeat) {
      const r = this.render(v.value).filter((x): x is MapNode => typeof x !== 'string');
      for (const n of r) n.repeat = v.count ?? 0;
      return r;
    }
    if (isUnknown(v)) return [`{${v.expr}}`];
    if (v instanceof JsxValue) return this.renderJsx(v);
    if (v instanceof Closure) return [];
    return [];
  }

  private loc(node: t.Node, file: string): Loc {
    return { file: this.engine.project.rel(file), line: node.loc?.start.line ?? 0 };
  }

  private renderJsx(j: JsxValue): Out[] {
    const { node, scope, file } = j;
    const childVals = this.childValues(node.children, scope, file);
    if (node.type === 'JSXFragment') return this.render(childVals);
    const open = node.openingElement;
    const tagText = jsxName(open.name);
    const props = this.props(open.attributes, scope, file);
    if (childVals.length) props.children = childVals.length === 1 ? childVals[0] : childVals;
    const intrinsic = open.name.type === 'JSXIdentifier' && /^[a-z]/.test(open.name.name);
    const tag = intrinsic ? undefined : this.engine.eval(open.name, scope, true);
    const callsite = this.loc(node, file);

    if (tag instanceof Closure) return this.renderComponent(tag, props, callsite);
    if (tag instanceof JsxValue) return this.render(tag);
    if (TRANSPARENT.has(tagText) || (tag instanceof External && (tag.name === 'Fragment' || /\.(Provider|Consumer)$/.test(tag.name)))) {
      if (tag instanceof External && tag.name.endsWith('.Consumer') && props.children instanceof Closure) return this.render(this.engine.callClosure(props.children, [undefined]));
      return this.render(props.children);
    }
    if (tag instanceof ContextRef) return this.render(props.children);
    const name = tag instanceof External ? (tag.module === 'react-native' || tag.module === 'react-native-web' ? tag.name : tagText) : tagText;
    return [this.host(name, props, node, file)];
  }

  private host(name: string, props: Record<string, unknown>, node: t.JSXElement, file: string): MapNode {
    const loc = this.loc(node, file);
    const n: MapNode = { name, loc };
    const unres: UnresolvedEntry[] = [];
    const style: Record<string, StyleEntry> = {};
    const where = (prop: string) => ({ file: loc.file, line: loc.line, prop });
    for (const [styleProp, classProp, prefix] of [
      ['style', 'className', ''],
      ['contentContainerStyle', 'contentContainerClassName', 'cc.'],
    ] as const) {
      const m = new Map<string, RawEntry>();
      if (classProp in props) {
        if (this.nw) collectClasses(props[classProp], this.nw, where(classProp), m, unres);
        else unres.push({ ...where(classProp), expr: typeof props[classProp] === 'string' ? (props[classProp] as string) : classProp, reason: 'UNKNOWN_CLASS' });
      }
      if (styleProp in props) collectStyle(props[styleProp], where(styleProp), m, unres);
      expandShorthands(m);
      Object.assign(style, finalizeStyle(m, where(styleProp), unres, prefix, this.explain));
    }
    // colour/size props on icons, inputs, indicators
    const pm = new Map<string, RawEntry>();
    for (const k of ['color', 'tintColor', 'placeholderTextColor', 'size', 'selectionColor', 'trackColor', 'thumbColor']) {
      if (!(k in props)) continue;
      const v = props[k];
      if (k === 'size' && typeof v === 'string' && !/^\d/.test(v)) continue;
      if (v && typeof v === 'object' && !(v instanceof Approx) && !isUnknown(v) && !(v instanceof Cond)) continue;
      const key = k === 'color' && 'color' in style ? 'color' : k;
      if (this.explain && style[key]?.layers?.length) {
        pm.set(key, { value: v, source: 'prop', layers: [...style[key].layers!, { source: 'prop', value: v, loc: { file: loc.file, line: loc.line } }] });
      } else if (this.explain && style[key]) {
        pm.set(key, { value: v, source: 'prop', layers: [{ source: style[key].source, value: style[key].value }, { source: 'prop', value: v, loc: { file: loc.file, line: loc.line } }] });
      } else {
        setRaw(pm, key, v, 'prop', where('props'));
      }
    }
    Object.assign(style, finalizeStyle(pm, where('props'), unres, '', this.explain));
    if (Object.keys(style).length) n.style = style;
    this.total += Object.keys(style).length + unres.length;
    this.resolved += Object.keys(style).length;
    this.unres.push(...unres);
    if (unres.length) n.unresolved = unres;

    // a11y
    const a11y: NonNullable<MapNode['a11y']> = {};
    const role = props.accessibilityRole ?? props.role;
    if (typeof role === 'string') a11y.role = role;
    const label = props.accessibilityLabel ?? props['aria-label'];
    if (typeof label === 'string') a11y.label = label;
    else if (label !== undefined && label !== null) a11y.label = isUnknown(label) ? `{${label.expr}}` : '{…}';
    const interactive = INTERACTIVE.test(name.split('.').pop() ?? name) || 'onPress' in props || 'onLongPress' in props;
    if (interactive && !(props.accessible === false)) a11y.interactive = true;
    const hs = props.hitSlop;
    if (typeof hs === 'number') a11y.hitSlop = hs;
    else if (hs instanceof Approx) a11y.hitSlop = hs.value;
    else if (hs && typeof hs === 'object' && !isUnknown(hs) && !(hs instanceof Cond)) {
      const vals = ['top', 'bottom', 'left', 'right'].map((k) => (hs as any)[k]).map((x) => (x instanceof Approx ? x.value : x));
      if (vals.every((x) => typeof x === 'number')) a11y.hitSlop = Math.min(...(vals as number[]));
    }
    if (props.allowFontScaling === false) a11y.allowFontScaling = false;
    const mfm = props.maxFontSizeMultiplier;
    if (typeof mfm === 'number') a11y.maxFontSizeMultiplier = mfm;
    if (Object.keys(a11y).length) n.a11y = a11y;

    // children
    const kids: Out[] = this.render(props.children);
    if (typeof props.title === 'string' && name === 'Button') kids.unshift(props.title);
    if (props.placeholder !== undefined && /TextInput$/.test(name)) {
      const ph = props.placeholder;
      if (typeof ph === 'string') n.text = ph;
    }
    // list render props
    const data = props.data ?? props.sections;
    const count = Array.isArray(data) ? data.length : 0;
    for (const k of LIST_RENDER) {
      const v = props[k];
      if (v instanceof Closure) kids.push(...this.renderComponent(v, {}, loc));
      else if (v instanceof JsxValue) kids.push(...this.render(v));
    }
    for (const k of ['renderItem', 'renderSectionHeader']) {
      const fn = props[k];
      if (!(fn instanceof Closure)) continue;
      const sample = Array.isArray(data) && data.length ? data[0] : new Unknown('RUNTIME_VALUE', 'item');
      const r = this.stack.includes(fn.node) ? undefined : this.engine.callClosure(fn, [{ item: sample, index: 0, section: sample, separators: {} }]);
      const nodes = this.render(r).filter((x): x is MapNode => typeof x !== 'string');
      for (const c of nodes) if (k === 'renderItem') c.repeat = count;
      kids.push(...nodes);
    }
    const texts = kids.filter((x): x is string => typeof x === 'string');
    const nodes = kids.filter((x): x is MapNode => typeof x !== 'string');
    if (texts.length) {
      const txt = texts.join('').replace(/\s+/g, ' ').trim();
      if (txt) n.text = n.text && !/TextInput$/.test(name) ? n.text + txt : n.text ?? txt;
    }
    if (nodes.length) n.children = nodes;
    return n;
  }

  private props(attrs: (t.JSXAttribute | t.JSXSpreadAttribute)[], scope: Scope, file: string): Record<string, unknown> {
    const props: Record<string, unknown> = {};
    for (const a of attrs) {
      if (a.type === 'JSXSpreadAttribute') {
        const v = this.engine.eval(a.argument, scope);
        if (v && typeof v === 'object' && !isUnknown(v) && !(v instanceof Cond) && !(v instanceof External) && !(v instanceof Builtin) && !Array.isArray(v)) Object.assign(props, v);
        continue;
      }
      const name = a.name.type === 'JSXIdentifier' ? a.name.name : `${a.name.namespace.name}:${a.name.name.name}`;
      const val = a.value;
      if (!val) props[name] = true;
      else if (val.type === 'StringLiteral') props[name] = val.value;
      else if (val.type === 'JSXExpressionContainer') {
        if (val.expression.type === 'JSXEmptyExpression') continue;
        if (name.startsWith('on') && /^on[A-Z]/.test(name)) {
          props[name] = true; // handlers are never evaluated
          continue;
        }
        props[name] = this.engine.eval(val.expression, scope);
      } else props[name] = new JsxValue(val as t.JSXElement, scope, file);
    }
    return props;
  }

  private childValues(children: t.JSXElement['children'], scope: Scope, file: string): unknown[] {
    const out: unknown[] = [];
    for (const c of children) {
      if (c.type === 'JSXText') {
        const s = jsxText(c.value);
        if (s) out.push(s);
      } else if (c.type === 'JSXExpressionContainer') {
        if (c.expression.type === 'JSXEmptyExpression') continue;
        out.push(this.engine.eval(c.expression, scope));
      } else if (c.type === 'JSXElement' || c.type === 'JSXFragment') out.push(new JsxValue(c, scope, file));
      else if (c.type === 'JSXSpreadChild') out.push(this.engine.eval(c.expression, scope));
    }
    return out;
  }
}

function jsxName(n: t.JSXOpeningElement['name']): string {
  if (n.type === 'JSXIdentifier') return n.name;
  if (n.type === 'JSXNamespacedName') return `${n.namespace.name}:${n.name.name}`;
  return `${jsxName(n.object as any)}.${n.property.name}`;
}

/** JSX whitespace rules: trim lines, drop empty ones, join with a space. */
function jsxText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  const parts: string[] = [];
  lines.forEach((l, i) => {
    let s = l.replace(/\t/g, ' ');
    if (i !== 0) s = s.replace(/^\s+/, '');
    if (i !== lines.length - 1) s = s.replace(/\s+$/, '');
    if (s) parts.push(s);
  });
  return parts.join(' ');
}

export { ClassList };

/** Route-level props: anything not provided is a runtime value, never silently undefined. */
function runtimeProps<T extends object>(base: T, _prefix: string): T {
  Object.defineProperty(base, OPEN, { value: true, enumerable: false });
  return base;
}
