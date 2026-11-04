import { parse, formatHex, formatHex8, wcagContrast, differenceCiede2000, type Color } from 'culori';

const cache = new Map<string, string | null>();

/** Normalise any CSS/RN colour string to #RRGGBB or #RRGGBBAA (upper case). Null when not a colour. */
export function normalizeColor(input: string): string | null {
  const key = input.trim();
  if (cache.has(key)) return cache.get(key)!;
  let out: string | null = null;
  if (key === 'transparent') out = '#00000000';
  else {
    const c = parse(key);
    if (c) out = (c.alpha !== undefined && c.alpha < 1 ? formatHex8(c) : formatHex(c)).toUpperCase();
  }
  cache.set(key, out);
  return out;
}

export function withAlpha(hex: string, alpha: number): string {
  const c = parse(hex);
  if (!c) return hex;
  c.alpha = alpha * (c.alpha ?? 1);
  return (c.alpha < 1 ? formatHex8(c) : formatHex(c)).toUpperCase();
}

export function alphaOf(hex: string): number {
  const c = parse(hex);
  return c?.alpha ?? 1;
}

/** Composite a (possibly translucent) colour over an opaque background. */
export function over(fg: string, bg: string): string {
  const f = parse(fg) as any;
  const b = parse(bg) as any;
  if (!f || !b) return fg;
  const fr = toRgb(f);
  const br = toRgb(b);
  const a = f.alpha ?? 1;
  const mix = { mode: 'rgb', r: fr.r * a + br.r * (1 - a), g: fr.g * a + br.g * (1 - a), b: fr.b * a + br.b * (1 - a) } as Color;
  return formatHex(mix).toUpperCase();
}

function toRgb(c: any): { r: number; g: number; b: number } {
  const hex = formatHex(c) ?? '#000000';
  return { r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 };
}

export function contrast(a: string, b: string): number {
  return wcagContrast(a, b);
}

const de = differenceCiede2000();
export function deltaE(a: string, b: string): number {
  return de(a, b);
}

/** Shortest hex for compact output: #RRGGBB -> #RGB when possible. */
export function shortHex(hex: string): string {
  const m = /^#([0-9A-F])\1([0-9A-F])\2([0-9A-F])\3$/i.exec(hex);
  if (m) return `#${m[1]}${m[2]}${m[3]}`;
  const m8 = /^#([0-9A-F])\1([0-9A-F])\2([0-9A-F])\3([0-9A-F])\4$/i.exec(hex);
  if (m8) return `#${m8[1]}${m8[2]}${m8[3]}${m8[4]}`;
  return hex;
}
