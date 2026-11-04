import { normalizeColor, withAlpha } from '../resolve/color.js';
import type { TwTheme, CssVars } from './loader.js';

export interface ClassContext {
  theme: TwTheme;
  vars: CssVars;
  rem: number;
  platform: 'android' | 'ios';
  scheme: 'light' | 'dark';
  viewport: { width: number; height: number };
}

export type ClassResult = { style: Record<string, unknown> } | { ignored: true } | { unknown: true; reason?: string };

const IGNORED = /^(group|peer|transition|duration-|ease-|delay-|animate-|cursor-|select-|outline|ring|sr-only|not-sr-only|container|appearance-|will-change|touch-|resize|scroll-|snap-|filter|backdrop|blur|drop-shadow|box-|break-|whitespace-|truncate$|antialiased|subpixel|isolate|object-|bg-gradient|from-|via-|to-|placeholder-|caret-|accent-|fill-|stroke-)/;
const BREAKPOINTS: Record<string, number> = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 };
const STATE_VARIANTS = /^(hover|focus|focus-visible|focus-within|active|disabled|pressed|checked|placeholder|first|last|odd|even|visited|group-.+|peer-.+|web|aria-.+|data-.+)$/;

/** Split a class into variants and the utility, respecting brackets. */
export function splitVariants(cls: string): { variants: string[]; util: string } {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of cls) {
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === ':' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  const util = parts.pop() ?? '';
  return { variants: parts, util };
}

/** true = applies, false = does not apply in this render, null = state variant (skipped, not counted). */
export function variantApplies(v: string, ctx: ClassContext): boolean | null {
  if (v === 'dark') return ctx.scheme === 'dark';
  if (v === 'light') return ctx.scheme === 'light';
  if (v === 'ios' || v === 'android') return ctx.platform === v;
  if (v === 'native') return true;
  if (v === 'web') return false;
  if (v === 'ltr') return true;
  if (v === 'rtl') return false;
  if (v === 'portrait') return ctx.viewport.height >= ctx.viewport.width;
  if (v === 'landscape') return ctx.viewport.width > ctx.viewport.height;
  if (v in BREAKPOINTS) return ctx.viewport.width >= BREAKPOINTS[v];
  if (v.startsWith('max-') && v.slice(4) in BREAKPOINTS) return ctx.viewport.width < BREAKPOINTS[v.slice(4)];
  if (STATE_VARIANTS.test(v)) return null;
  return null;
}

function themeGet(theme: TwTheme, key: string, name: string): unknown {
  const t = theme[key];
  if (!t || typeof t !== 'object') return undefined;
  if (name in t) return t[name];
  // nested colours: red-500 -> colors.red.500 ; DEFAULT
  const parts = name.split('-');
  for (let i = parts.length - 1; i > 0; i--) {
    const head = parts.slice(0, i).join('-');
    const tail = parts.slice(i).join('-');
    const sub = t[head];
    if (sub && typeof sub === 'object') {
      const r = themeGet({ x: sub }, 'x', tail);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}

function themeDefault(theme: TwTheme, key: string, name: string): unknown {
  const v = themeGet(theme, key, name);
  if (v && typeof v === 'object' && !Array.isArray(v) && 'DEFAULT' in (v as any)) return (v as any).DEFAULT;
  return v;
}

function resolveVars(s: string, ctx: ClassContext, depth = 0): string | null {
  if (!s.includes('var(')) return s;
  if (depth > 5) return null;
  let failed = false;
  const out = s.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g, (_m, name: string, fb?: string) => {
    const v = (ctx.scheme === 'dark' ? ctx.vars.dark[name] : undefined) ?? ctx.vars.light[name] ?? fb;
    if (v === undefined) {
      failed = true;
      return '';
    }
    return v;
  });
  if (failed) return null;
  return resolveVars(out, ctx, depth + 1);
}

/** CSS length -> RN number (px), or string for %/auto. undefined when not a length. */
export function length(raw: unknown, ctx: ClassContext, fontSize?: number): number | string | undefined {
  if (typeof raw === 'number') return raw;
  if (typeof raw !== 'string') return undefined;
  const s0 = resolveVars(raw.trim(), ctx);
  if (s0 === null) return undefined;
  const s = s0.trim();
  if (s === '0') return 0;
  if (s === 'auto' || /%$/.test(s)) return s;
  let m = /^(-?\d*\.?\d+)(px|rem|em|vw|vh)?$/.exec(s);
  if (!m) return undefined;
  const n = Number(m[1]);
  switch (m[2]) {
    case undefined:
    case 'px':
      return n;
    case 'rem':
      return round(n * ctx.rem);
    case 'em':
      return round(n * (fontSize ?? ctx.rem));
    case 'vw':
      return round((n / 100) * ctx.viewport.width);
    case 'vh':
      return round((n / 100) * ctx.viewport.height);
  }
  m = null;
  return undefined;
}

const round = (n: number) => Math.round(n * 100) / 100;

function color(raw: unknown, ctx: ClassContext, alpha?: number): string | undefined {
  if (raw && typeof raw === 'object' && 'DEFAULT' in (raw as any)) raw = (raw as any).DEFAULT;
  if (typeof raw !== 'string') return undefined;
  let s = resolveVars(raw, ctx);
  if (s === null) return undefined;
  s = s.replace(/<alpha-value>/g, alpha !== undefined ? String(alpha) : '1');
  // bare channel lists from css vars: "255 0 0" -> rgb(255 0 0)
  if (/^\d+\s+\d+%?\s+\d+%?$/.test(s.trim())) s = `rgb(${s.trim()})`;
  const c = normalizeColor(s);
  if (!c) return undefined;
  return alpha !== undefined && !raw.includes('<alpha-value>') ? withAlpha(c, alpha) : c;
}

function arbitrary(v: string): string | null {
  const m = /^\[(.+)\]$/.exec(v);
  return m ? m[1].replace(/_/g, ' ') : null;
}

const SIDES: Record<string, string[]> = {
  '': [''],
  x: ['Horizontal'],
  y: ['Vertical'],
  t: ['Top'],
  r: ['Right'],
  b: ['Bottom'],
  l: ['Left'],
  s: ['Start'],
  e: ['End'],
};

const SIMPLE: Record<string, Record<string, unknown>> = {
  flex: { display: 'flex' },
  hidden: { display: 'none' },
  'flex-row': { flexDirection: 'row' },
  'flex-col': { flexDirection: 'column' },
  'flex-row-reverse': { flexDirection: 'row-reverse' },
  'flex-col-reverse': { flexDirection: 'column-reverse' },
  'flex-wrap': { flexWrap: 'wrap' },
  'flex-wrap-reverse': { flexWrap: 'wrap-reverse' },
  'flex-nowrap': { flexWrap: 'nowrap' },
  'flex-1': { flex: 1 },
  'flex-auto': { flexGrow: 1, flexShrink: 1, flexBasis: 'auto' },
  'flex-initial': { flexGrow: 0, flexShrink: 1, flexBasis: 'auto' },
  'flex-none': { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
  grow: { flexGrow: 1 },
  'grow-0': { flexGrow: 0 },
  'flex-grow': { flexGrow: 1 },
  'flex-grow-0': { flexGrow: 0 },
  shrink: { flexShrink: 1 },
  'shrink-0': { flexShrink: 0 },
  'flex-shrink': { flexShrink: 1 },
  'flex-shrink-0': { flexShrink: 0 },
  absolute: { position: 'absolute' },
  relative: { position: 'relative' },
  static: { position: 'static' },
  'overflow-hidden': { overflow: 'hidden' },
  'overflow-visible': { overflow: 'visible' },
  'overflow-scroll': { overflow: 'scroll' },
  underline: { textDecorationLine: 'underline' },
  'line-through': { textDecorationLine: 'line-through' },
  'no-underline': { textDecorationLine: 'none' },
  uppercase: { textTransform: 'uppercase' },
  lowercase: { textTransform: 'lowercase' },
  capitalize: { textTransform: 'capitalize' },
  'normal-case': { textTransform: 'none' },
  italic: { fontStyle: 'italic' },
  'not-italic': { fontStyle: 'normal' },
  'text-left': { textAlign: 'left' },
  'text-center': { textAlign: 'center' },
  'text-right': { textAlign: 'right' },
  'text-justify': { textAlign: 'justify' },
  'text-start': { textAlign: 'left' },
  'text-end': { textAlign: 'right' },
  'align-top': { verticalAlign: 'top' },
  'align-middle': { verticalAlign: 'middle' },
  'align-bottom': { verticalAlign: 'bottom' },
  'border-solid': { borderStyle: 'solid' },
  'border-dashed': { borderStyle: 'dashed' },
  'border-dotted': { borderStyle: 'dotted' },
  'aspect-square': { aspectRatio: 1 },
  'aspect-video': { aspectRatio: 16 / 9 },
  'aspect-auto': {},
  'inset-0': { top: 0, right: 0, bottom: 0, left: 0 },
  'backface-hidden': { backfaceVisibility: 'hidden' },
  'pointer-events-none': { pointerEvents: 'none' },
  'pointer-events-auto': { pointerEvents: 'auto' },
  'pointer-events-box-none': { pointerEvents: 'box-none' },
  visible: {},
  invisible: { opacity: 0 },
};

const ALIGN: Record<string, string> = { start: 'flex-start', end: 'flex-end', center: 'center', baseline: 'baseline', stretch: 'stretch', between: 'space-between', around: 'space-around', evenly: 'space-evenly', auto: 'auto' };

/** Map one class (without variants) to an RN style object. */
export function utilityToStyle(util0: string, ctx: ClassContext): ClassResult {
  let util = util0.replace(/^!/, '').replace(/!$/, '');
  if (!util) return { ignored: true };
  if (SIMPLE[util]) return { style: { ...SIMPLE[util] } };
  if (IGNORED.test(util)) return { ignored: true };
  let neg = false;
  if (util.startsWith('-')) {
    neg = true;
    util = util.slice(1);
  }
  const T = ctx.theme;
  const sign = (v: number | string | undefined) => (neg && typeof v === 'number' ? -v : neg && typeof v === 'string' && v !== 'auto' ? `-${v}` : v);
  const lenFrom = (key: string, name: string) => {
    const a = arbitrary(name);
    if (a !== null) return length(a, ctx);
    const v = themeGet(T, key, name);
    return v === undefined ? undefined : length(v, ctx);
  };
  const ok = (style: Record<string, unknown>): ClassResult => ({ style });
  const unknown: ClassResult = { unknown: true };

  // alignment
  let m = /^(items|justify|self|content|justify-items|justify-self|place-content)-(.+)$/.exec(util);
  if (m && ALIGN[m[2]]) {
    const prop = { items: 'alignItems', justify: 'justifyContent', self: 'alignSelf', content: 'alignContent' }[m[1]];
    return prop ? ok({ [prop]: ALIGN[m[2]] }) : { ignored: true };
  }

  // padding / margin
  m = /^([pm])([xytrblse]?)-(.+)$/.exec(util);
  if (m) {
    const base = m[1] === 'p' ? 'padding' : 'margin';
    const v = m[3] === 'auto' ? 'auto' : lenFrom(base, m[3]) ?? lenFrom('spacing', m[3]);
    if (v === undefined) return unknown;
    const out: Record<string, unknown> = {};
    for (const s of SIDES[m[2]]) out[base + s] = sign(v);
    return ok(out);
  }

  // gap
  m = /^gap(-[xy])?-(.+)$/.exec(util);
  if (m) {
    const v = lenFrom('gap', m[2]) ?? lenFrom('spacing', m[2]);
    if (v === undefined) return unknown;
    return ok({ [m[1] === '-x' ? 'columnGap' : m[1] === '-y' ? 'rowGap' : 'gap']: v });
  }

  // sizing
  m = /^(w|h|min-w|max-w|min-h|max-h|size|basis)-(.+)$/.exec(util);
  if (m) {
    const key = { w: 'width', h: 'height', 'min-w': 'minWidth', 'max-w': 'maxWidth', 'min-h': 'minHeight', 'max-h': 'maxHeight', size: 'size', basis: 'flexBasis' }[m[1]]!;
    let v: number | string | undefined;
    if (m[2] === 'screen') v = key.toLowerCase().includes('width') ? ctx.viewport.width : ctx.viewport.height;
    else if (m[2] === 'full') v = '100%';
    else if (m[2] === 'auto') v = 'auto';
    else if (/^\d+\/\d+$/.test(m[2])) {
      const [a, b] = m[2].split('/').map(Number);
      v = `${round((a / b) * 100)}%`;
    } else v = lenFrom(key === 'size' ? 'width' : key, m[2]) ?? lenFrom('spacing', m[2]);
    if (v === undefined) return unknown;
    if (key === 'size') return ok({ width: v, height: v });
    return ok({ [key]: v });
  }

  // inset / position
  m = /^(inset|inset-x|inset-y|top|right|bottom|left|start|end)-(.+)$/.exec(util);
  if (m) {
    let v: number | string | undefined;
    if (m[2] === 'full') v = '100%';
    else if (/^\d+\/\d+$/.test(m[2])) {
      const [a, b] = m[2].split('/').map(Number);
      v = `${round((a / b) * 100)}%`;
    } else v = lenFrom('inset', m[2]) ?? lenFrom('spacing', m[2]);
    if (v === undefined) return unknown;
    v = sign(v);
    const props = m[1] === 'inset' ? ['top', 'right', 'bottom', 'left'] : m[1] === 'inset-x' ? ['left', 'right'] : m[1] === 'inset-y' ? ['top', 'bottom'] : [m[1]];
    return ok(Object.fromEntries(props.map((p) => [p, v])));
  }

  // z / opacity / flex-n / order / aspect
  m = /^(z|opacity|flex|order|aspect|elevation)-(.+)$/.exec(util);
  if (m) {
    const a = arbitrary(m[2]);
    const keyMap: Record<string, [string, string]> = { z: ['zIndex', 'zIndex'], opacity: ['opacity', 'opacity'], flex: ['flex', 'flex'], order: ['order', 'order'], aspect: ['aspectRatio', 'aspectRatio'], elevation: ['elevation', 'elevation'] };
    const [themeKey, prop] = keyMap[m[1]];
    let raw: unknown = a ?? themeGet(T, themeKey, m[2]);
    if (raw === undefined && /^\d+$/.test(m[2])) raw = m[1] === 'opacity' ? Number(m[2]) / 100 : m[2];
    if (typeof raw === 'string' && /^\d+\s*\/\s*\d+$/.test(raw)) {
      const [x, y] = raw.split('/').map(Number);
      raw = x / y;
    }
    if (raw === undefined) return unknown;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isNaN(n)) return m[1] === 'flex' ? { unknown: true } : unknown;
    return ok({ [prop]: neg ? -n : round(n) });
  }

  // rounded
  m = /^rounded(?:-(t|r|b|l|tl|tr|br|bl|s|e|ss|se|es|ee))?(?:-(.+))?$/.exec(util);
  if (m) {
    const name = m[2] ?? 'DEFAULT';
    const a = arbitrary(name);
    const v = name === 'full' ? 9999 : a !== null ? length(a, ctx) : length(themeGet(T, 'borderRadius', name), ctx);
    if (v === undefined) return unknown;
    const corners: Record<string, string[]> = {
      '': ['borderRadius'],
      t: ['borderTopLeftRadius', 'borderTopRightRadius'],
      r: ['borderTopRightRadius', 'borderBottomRightRadius'],
      b: ['borderBottomLeftRadius', 'borderBottomRightRadius'],
      l: ['borderTopLeftRadius', 'borderBottomLeftRadius'],
      tl: ['borderTopLeftRadius'],
      tr: ['borderTopRightRadius'],
      br: ['borderBottomRightRadius'],
      bl: ['borderBottomLeftRadius'],
      s: ['borderTopLeftRadius', 'borderBottomLeftRadius'],
      e: ['borderTopRightRadius', 'borderBottomRightRadius'],
    };
    return ok(Object.fromEntries((corners[m[1] ?? ''] ?? ['borderRadius']).map((p) => [p, v])));
  }

  // border width / colour
  m = /^border(?:-([xytrblse]))?(?:-(.+))?$/.exec(util);
  if (m) {
    const side = m[1];
    const name = m[2];
    const sideProps: Record<string, string[]> = {
      '': ['borderWidth'],
      x: ['borderLeftWidth', 'borderRightWidth'],
      y: ['borderTopWidth', 'borderBottomWidth'],
      t: ['borderTopWidth'],
      r: ['borderRightWidth'],
      b: ['borderBottomWidth'],
      l: ['borderLeftWidth'],
      s: ['borderStartWidth'],
      e: ['borderEndWidth'],
    };
    const props = sideProps[side ?? ''];
    if (name === undefined || /^\d+$/.test(name) || /^\[\d/.test(name)) {
      const a = name ? arbitrary(name) : null;
      const v = a !== null ? length(a, ctx) : length(themeGet(T, 'borderWidth', name ?? 'DEFAULT'), ctx) ?? (name ? Number(name) : 1);
      if (v === undefined) return unknown;
      return ok(Object.fromEntries(props.map((p) => [p, v])));
    }
    const c = colorUtil(name, 'borderColor', ctx);
    if (c) {
      const cp = side ? props.map((p) => p.replace('Width', 'Color')) : ['borderColor'];
      return ok(Object.fromEntries(cp.map((p) => [p, c])));
    }
    return unknown;
  }

  // text: size / colour
  m = /^text-(.+)$/.exec(util);
  if (m) {
    const [name, lh] = splitModifier(m[1]);
    const a = arbitrary(name);
    if (a !== null) {
      const l = length(a, ctx);
      if (typeof l === 'number') return ok({ fontSize: l });
      const c = color(a, ctx);
      return c ? ok({ color: c }) : unknown;
    }
    const fs = themeGet(T, 'fontSize', name);
    if (fs !== undefined) {
      const [size, extra] = Array.isArray(fs) ? fs : [fs, undefined];
      const fontSize = length(size, ctx);
      if (typeof fontSize !== 'number') return unknown;
      const out: Record<string, unknown> = { fontSize };
      const lineRaw = lh !== undefined ? themeGet(T, 'lineHeight', lh) ?? lh : typeof extra === 'string' ? extra : extra?.lineHeight;
      if (lineRaw !== undefined) {
        const l = lineHeight(lineRaw, fontSize, ctx);
        if (l !== undefined) out.lineHeight = l;
      }
      if (extra && typeof extra === 'object') {
        if (extra.fontWeight) out.fontWeight = String(extra.fontWeight);
        if (extra.letterSpacing) {
          const ls = length(extra.letterSpacing, ctx, fontSize);
          if (typeof ls === 'number') out.letterSpacing = ls;
        }
      }
      return ok(out);
    }
    const c = colorUtil(m[1], 'textColor', ctx);
    return c ? ok({ color: c }) : unknown;
  }

  // backgrounds and other colour utilities
  m = /^(bg|tint|shadow|decoration|divide|placeholder)-(.+)$/.exec(util);
  if (m) {
    const prop = { bg: 'backgroundColor', tint: 'tintColor', shadow: 'shadowColor', decoration: 'textDecorationColor', divide: '', placeholder: '' }[m[1]]!;
    const themeKey = { bg: 'backgroundColor', tint: 'colors', shadow: 'boxShadowColor', decoration: 'textDecorationColor', divide: 'divideColor', placeholder: 'placeholderColor' }[m[1]]!;
    if (m[1] === 'shadow' && (themeGet(T, 'boxShadow', m[2]) !== undefined)) return ok({ shadow: m[2] });
    if (!prop) return { ignored: true };
    const c = colorUtil(m[2], themeKey, ctx);
    return c ? ok({ [prop]: c }) : unknown;
  }
  if (util === 'shadow') return ok({ shadow: 'DEFAULT' });

  // font weight / family
  m = /^font-(.+)$/.exec(util);
  if (m) {
    const a = arbitrary(m[1]);
    if (a !== null) return /^\d+$/.test(a) ? ok({ fontWeight: a }) : ok({ fontFamily: a.replace(/['"]/g, '') });
    const w = themeGet(T, 'fontWeight', m[1]);
    if (w !== undefined) return ok({ fontWeight: String(w) });
    const f = themeGet(T, 'fontFamily', m[1]);
    if (f !== undefined) {
      const fam = Array.isArray(f) ? (Array.isArray(f[0]) ? f[0][0] : f[0]) : f;
      return ok({ fontFamily: String(fam).split(',')[0].replace(/['"]/g, '').trim() });
    }
    return unknown;
  }

  m = /^leading-(.+)$/.exec(util);
  if (m) {
    const a = arbitrary(m[1]);
    const l = lineHeight(a ?? themeGet(T, 'lineHeight', m[1]), undefined, ctx);
    return l === undefined ? unknown : ok({ lineHeight: l });
  }
  m = /^tracking-(.+)$/.exec(util);
  if (m) {
    const a = arbitrary(m[1]);
    const l = length(a ?? themeGet(T, 'letterSpacing', m[1]), ctx);
    return typeof l === 'number' ? ok({ letterSpacing: neg ? -l : l }) : unknown;
  }

  m = /^(rotate|scale|translate-x|translate-y|skew-x|skew-y)-(.+)$/.exec(util);
  if (m) return { ignored: true };

  return unknown;
}

function splitModifier(s: string): [string, string | undefined] {
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    const rest = s.slice(end + 1);
    return [s.slice(0, end + 1), rest.startsWith('/') ? rest.slice(1) : undefined];
  }
  const i = s.lastIndexOf('/');
  return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : [s, undefined];
}

function colorUtil(name0: string, themeKey: string, ctx: ClassContext): string | undefined {
  const [name, mod] = splitModifier(name0);
  let alpha: number | undefined;
  if (mod !== undefined) {
    const a = arbitrary(mod);
    alpha = a !== null ? Number(a) : Number(ctx.theme.opacity?.[mod] ?? Number(mod) / 100);
    if (Number.isNaN(alpha)) return undefined;
  }
  const a = arbitrary(name);
  if (a !== null) return color(a, ctx, alpha);
  const raw = themeDefault(ctx.theme, themeKey, name) ?? themeDefault(ctx.theme, 'colors', name);
  if (raw === undefined) return undefined;
  return color(raw, ctx, alpha);
}

function lineHeight(raw: unknown, fontSize: number | undefined, ctx: ClassContext): number | undefined {
  if (typeof raw === 'number') return fontSize ? round(raw * fontSize) : undefined;
  if (typeof raw !== 'string') return undefined;
  if (/^\d*\.?\d+$/.test(raw.trim())) {
    // unitless multiplier: needs the font size
    return fontSize ? round(Number(raw) * fontSize) : round(Number(raw) * ctx.rem);
  }
  const l = length(raw, ctx, fontSize);
  return typeof l === 'number' ? l : undefined;
}
