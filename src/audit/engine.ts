import { alphaOf, contrast, deltaE, over } from '../resolve/color.js';
import type { Finding, MapNode, Options, RouteMap, StyleEntry } from '../types.js';

type Sev = Finding['severity'];

export const RULES: Record<string, { severity: Sev; url: string; title: string }> = {
  'wcag-1.4.3': { severity: 'error', url: 'https://www.w3.org/TR/WCAG22/#contrast-minimum', title: 'Text contrast' },
  'wcag-1.4.11': { severity: 'warn', url: 'https://www.w3.org/TR/WCAG22/#non-text-contrast', title: 'Non-text contrast' },
  'wcag-2.5.8': { severity: 'error', url: 'https://www.w3.org/TR/WCAG22/#target-size-minimum', title: 'Target size (minimum)' },
  'hig-target-44': { severity: 'warn', url: 'https://developer.apple.com/design/human-interface-guidelines/accessibility', title: 'iOS target 44pt' },
  'md-target-48': { severity: 'warn', url: 'https://m3.material.io/foundations/designing/structure', title: 'Android target 48dp' },
  'a11y-label': { severity: 'warn', url: 'https://reactnative.dev/docs/accessibility#accessibilitylabel', title: 'Accessible label' },
  'a11y-role': { severity: 'warn', url: 'https://reactnative.dev/docs/accessibility#accessibilityrole', title: 'Accessible role' },
  'ds-font-count': { severity: 'warn', url: 'https://m3.material.io/styles/typography/type-scale-tokens', title: 'Font family/size count' },
  'ds-color-count': { severity: 'warn', url: 'https://m3.material.io/styles/color/system/overview', title: 'Colour count' },
  'ds-near-dup-color': { severity: 'info', url: 'https://www.w3.org/TR/css-color-4/', title: 'Near-duplicate colours' },
  'ds-spacing-grid': { severity: 'info', url: 'https://m3.material.io/foundations/layout/understanding-layout/spacing', title: 'Spacing grid' },
  'type-min-size': { severity: 'warn', url: 'https://developer.apple.com/design/human-interface-guidelines/typography', title: 'Minimum font size' },
  'type-font-scaling': { severity: 'warn', url: 'https://www.w3.org/TR/WCAG22/#resize-text', title: 'Font scaling' },
};

const TEXT = new Set(['Text', 'TextInput', 'Animated.Text']);
const OPAQUE_UNKNOWN_BG = /^(Image|ImageBackground|LinearGradient|BlurView|Video|Animated\.Image|ExpoImage)$/;
const SPACING = /^(padding|margin)(Top|Bottom|Left|Right|Horizontal|Vertical|Start|End)?$|^(gap|rowGap|columnGap)$/;

function num(e?: StyleEntry): number | undefined {
  return e && typeof e.value === 'number' ? e.value : undefined;
}
function str(e?: StyleEntry): string | undefined {
  return e && typeof e.value === 'string' ? e.value : undefined;
}
const isHex = (s?: string): s is string => !!s && /^#[0-9A-F]{6}([0-9A-F]{2})?$/.test(s);

interface Ctx {
  route: string;
  push(f: Omit<Finding, 'severity' | 'url'> & { severity?: Sev }): void;
}

/** Background behind a node: composite resolved ancestor backgrounds top-down. null = unknown. */
function backgroundOf(stack: MapNode[], scheme: Options['scheme']): string | null {
  let layers: string[] = [];
  for (let i = stack.length - 1; i >= 0; i--) {
    const n = stack[i];
    if (OPAQUE_UNKNOWN_BG.test(n.name)) return null;
    const e = n.style?.backgroundColor;
    if (!e) continue;
    const v = str(e);
    if (e.alt || !isHex(v)) return null;
    layers.push(v);
    if (alphaOf(v) >= 1) break;
  }
  if (!layers.length) return null;
  // if fully transparent chain without an opaque base, assume the platform window background
  let base = layers[layers.length - 1];
  if (alphaOf(base) < 1) base = over(base, scheme === 'dark' ? '#000000' : '#FFFFFF');
  for (let i = layers.length - 2; i >= 0; i--) base = over(layers[i], base);
  layers = [];
  return base;
}

function sideSize(s: Record<string, StyleEntry>, axis: 'w' | 'h'): number | undefined {
  const dim = num(axis === 'w' ? s.width ?? s.minWidth : s.height ?? s.minHeight);
  if (dim === undefined) return undefined;
  const a = axis === 'w' ? ['Left', 'Right', 'Horizontal'] : ['Top', 'Bottom', 'Vertical'];
  void a;
  return dim; // width/height in RN include padding (border-box)
}

function hasText(n: MapNode): boolean {
  if (n.text) return true;
  return (n.children ?? []).some(hasText);
}

function walk(n: MapNode, stack: MapNode[], ctx: Ctx, o: Options, acc: Acc) {
  const s = n.style ?? {};
  const a = n.a11y ?? {};
  const loc = { file: n.loc.file, line: n.loc.line, node: n.name };
  const isText = TEXT.has(n.name);
  const cfg = o.config?.audit ?? {};

  for (const [k, e] of Object.entries(s)) {
    const v = str(e);
    if (/colou?r$/i.test(k) && isHex(v)) acc.colors.add(v.slice(0, 7));
    if (k === 'fontFamily' && v) acc.fonts.add(v);
    if (k === 'fontSize' && num(e) !== undefined) acc.sizes.add(num(e)!);
    if (SPACING.test(k) && typeof e.value === 'number' && !e.approx && e.value !== 0) {
      const g = cfg.spacingGrid ?? 4;
      if (Math.abs(e.value) % g !== 0) acc.offGrid.push({ ...loc, msg: `${k} ${e.value} is not a multiple of ${g}` });
    }
  }

  // text contrast
  if (isText && (n.text || hasText(n))) {
    const fg = str(s.color);
    const size = num(s.fontSize) ?? 14;
    const weight = Number(str(s.fontWeight) ?? num(s.fontWeight) ?? 400);
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const bg = backgroundOf(stack.concat(n), o.scheme);
    if (!s.color) {
      // inherited / platform default colour: cannot be sure
      if (bg) ctx.push({ ruleId: 'wcag-1.4.3', severity: 'unknown', message: `text colour not set (platform default); bg ${bg}`, ...loc });
    } else if (!isHex(fg) || s.color.alt || !bg) {
      ctx.push({ ruleId: 'wcag-1.4.3', severity: 'unknown', message: `contrast unknown (${!isHex(fg) || s.color.alt ? 'colour' : 'background'} not resolved)`, ...loc });
    } else {
      const c = contrast(over(fg, bg), bg);
      if (c < need) ctx.push({ ruleId: 'wcag-1.4.3', message: `contrast ${c.toFixed(2)}:1 < ${need}:1 (${fg} on ${bg}${large ? ', large' : ''})`, ...loc });
    }
    const fs = num(s.fontSize);
    if (fs !== undefined && fs < (cfg.minFontSize ?? 12)) ctx.push({ ruleId: 'type-min-size', message: `fontSize ${fs} < ${cfg.minFontSize ?? 12}`, ...loc });
    if (a.allowFontScaling === false) ctx.push({ ruleId: 'type-font-scaling', message: 'allowFontScaling={false} blocks text resizing', ...loc });
    else if (a.maxFontSizeMultiplier !== undefined && a.maxFontSizeMultiplier > 0 && a.maxFontSizeMultiplier < 1.5)
      ctx.push({ ruleId: 'type-font-scaling', message: `maxFontSizeMultiplier ${a.maxFontSizeMultiplier} < 1.5`, ...loc });
  }

  // non-text contrast: borders and icon colours
  const ntc: Array<[string, string | undefined, StyleEntry | undefined]> = [];
  const bw = num(s.borderWidth) ?? 0;
  if (bw > 0 && s.borderColor) ntc.push(['border', str(s.borderColor), s.borderColor]);
  if (!isText && s.color?.source === 'prop') ntc.push(['icon', str(s.color), s.color]);
  for (const [what, col, e] of ntc) {
    const bg = backgroundOf(what === 'border' ? stack : stack.concat(n), o.scheme);
    if (!isHex(col) || e?.alt || !bg) {
      ctx.push({ ruleId: 'wcag-1.4.11', severity: 'unknown', message: `${what} contrast unknown`, ...loc });
      continue;
    }
    const c = contrast(over(col, bg), bg);
    if (c < 3) ctx.push({ ruleId: 'wcag-1.4.11', message: `${what} contrast ${c.toFixed(2)}:1 < 3:1 (${col} on ${bg})`, ...loc });
  }

  // interactive checks
  if (a.interactive) {
    const w = sideSize(s, 'w');
    const h = sideSize(s, 'h');
    const hs = a.hitSlop ?? 0;
    if (w === undefined || h === undefined) {
      if (!hasText(n)) ctx.push({ ruleId: 'wcag-2.5.8', severity: 'unknown', message: 'target size unknown (no fixed width/height)', ...loc });
    } else {
      const tw = w + 2 * hs;
      const th = h + 2 * hs;
      const sz = `${Math.round(tw)}×${Math.round(th)}`;
      if (tw < 24 || th < 24) ctx.push({ ruleId: 'wcag-2.5.8', message: `target ${sz} < 24×24`, ...loc });
      if (o.platform === 'ios' && (tw < 44 || th < 44)) ctx.push({ ruleId: 'hig-target-44', message: `target ${sz} < 44×44pt`, ...loc });
      if (o.platform === 'android' && (tw < 48 || th < 48)) ctx.push({ ruleId: 'md-target-48', message: `target ${sz} < 48×48dp`, ...loc });
    }
    if (!a.label && !hasText(n)) ctx.push({ ruleId: 'a11y-label', message: 'interactive element without text has no accessibilityLabel', ...loc });
    if (!a.role) ctx.push({ ruleId: 'a11y-role', message: 'interactive element has no accessibilityRole/role', ...loc });
  } else if (/^(Image|ExpoImage)$/.test(n.name) && !a.label) {
    ctx.push({ ruleId: 'a11y-label', severity: 'info', message: 'Image has no accessibilityLabel (fine if decorative)', ...loc });
  }

  for (const c of n.children ?? []) walk(c, stack.concat(n), ctx, o, acc);
}

interface Acc {
  colors: Set<string>;
  fonts: Set<string>;
  sizes: Set<number>;
  offGrid: Array<{ file: string; line: number; node: string; msg: string }>;
}

/** Run all audit rules. Deterministic; unknown inputs yield `unknown`, never pass/fail. */
export function audit(routes: RouteMap[], o: Options): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  const sevCfg = o.config?.audit?.severity ?? {};
  const cfg = o.config?.audit ?? {};
  const push = (route: string) => (f: Omit<Finding, 'severity' | 'url'> & { severity?: Sev }) => {
    const r = RULES[f.ruleId];
    const configured = sevCfg[f.ruleId];
    if (configured === 'off') return;
    let severity = f.severity ?? r.severity;
    if (configured && severity !== 'unknown' && f.severity === undefined) severity = configured;
    const key = `${f.ruleId}|${f.file}|${f.line}|${f.node}|${f.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ruleId: f.ruleId, severity, message: f.message, file: f.file, line: f.line, node: f.node, route, url: r.url });
  };
  const acc: Acc = { colors: new Set(), fonts: new Set(), sizes: new Set(), offGrid: [] };
  for (const r of routes) walk(r.tree, [], { route: r.path, push: push(r.path) }, o, acc);
  const g = push('*');
  for (const x of acc.offGrid) g({ ruleId: 'ds-spacing-grid', message: x.msg, file: x.file, line: x.line, node: x.node });
  const maxFam = cfg.maxFontFamilies ?? 3;
  const maxSz = cfg.maxFontSizes ?? 8;
  const maxCol = cfg.maxColors ?? 12;
  if (acc.fonts.size > maxFam) g({ ruleId: 'ds-font-count', message: `${acc.fonts.size} font families > ${maxFam}` });
  if (acc.sizes.size > maxSz) g({ ruleId: 'ds-font-count', message: `${acc.sizes.size} font sizes > ${maxSz}` });
  if (acc.colors.size > maxCol) g({ ruleId: 'ds-color-count', message: `${acc.colors.size} distinct colours > ${maxCol}` });
  const cols = [...acc.colors].sort();
  const thr = cfg.nearDuplicateDeltaE ?? 3;
  for (let i = 0; i < cols.length; i++)
    for (let j = i + 1; j < cols.length; j++) {
      const d = deltaE(cols[i], cols[j]);
      if (d > 0 && d < thr) g({ ruleId: 'ds-near-dup-color', message: `${cols[i]} ≈ ${cols[j]} (ΔE ${d.toFixed(2)})` });
    }
  const rank: Record<Sev, number> = { error: 0, warn: 1, info: 2, unknown: 3 };
  return out.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      a.ruleId.localeCompare(b.ruleId) ||
      (a.file ?? '').localeCompare(b.file ?? '') ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.message.localeCompare(b.message),
  );
}

function summary(f: Finding[]): string {
  const c = { error: 0, warn: 0, info: 0, unknown: 0 };
  f.forEach((x) => c[x.severity]++);
  return `${c.error} error, ${c.warn} warn, ${c.info} info, ${c.unknown} unknown`;
}

/** Compact report: one line per finding; unknowns summarised by rule to save tokens. */
export function findingsCompact(f: Finding[]): string {
  const lines = [`# audit  ${summary(f)}`];
  const unk = new Map<string, number>();
  for (const x of f) {
    if (x.severity === 'unknown') {
      unk.set(x.ruleId, (unk.get(x.ruleId) ?? 0) + 1);
      continue;
    }
    const where = x.file ? `  ${x.file}:${x.line}` : '';
    lines.push(`${x.severity} ${x.ruleId} ${x.node ? x.node + ' ' : ''}${x.message}${where}`);
  }
  if (unk.size) lines.push('unknown: ' + [...unk].map(([k, v]) => `${k}×${v}`).join(' '));
  const ids = [...new Set(f.map((x) => x.ruleId))].sort();
  if (ids.length) lines.push('refs: ' + ids.map((i) => `${i} ${RULES[i].url}`).join(' · '));
  return lines.join('\n');
}

export function findingsMd(f: Finding[]): string {
  const lines = ['## Audit', '', summary(f), '', '| Severity | Rule | Node | Message | Location |', '|---|---|---|---|---|'];
  for (const x of f) lines.push(`| ${x.severity} | [${x.ruleId}](${x.url}) | ${x.node ?? ''} | ${x.message.replace(/\|/g, '\\|')} | ${x.file ? `\`${x.file}:${x.line}\`` : ''} |`);
  return lines.join('\n');
}
