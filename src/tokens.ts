import type { MapNode, RouteMap, TokenTable } from './types.js';

const SPACING = /^(padding|margin)(Top|Bottom|Left|Right|Horizontal|Vertical|Start|End)?$|^(gap|rowGap|columnGap)$/;
const RADII = /^border(\w+)?Radius$/;

function inc(m: Record<string, number>, k: string) {
  m[k] = (m[k] ?? 0) + 1;
}

function sortMap(m: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
}

/** Project token table: distinct resolved values with use counts, sorted by count desc then value. */
export function tokenTable(routes: RouteMap[]): TokenTable {
  const t: TokenTable = { colors: {}, fonts: {}, fontSizes: {}, spacing: {}, radii: {} };
  const visit = (n: MapNode) => {
    for (const [k, e] of Object.entries(n.style ?? {})) {
      const v = e.value;
      if (v === undefined || v === null || typeof v === 'object') continue;
      const s = String(v);
      if (/colou?r$/i.test(k) && s.startsWith('#')) inc(t.colors, s);
      else if (k === 'fontFamily') inc(t.fonts, s);
      else if (k === 'fontSize' && typeof v === 'number') inc(t.fontSizes, String(v));
      else if (SPACING.test(k) && typeof v === 'number') inc(t.spacing, String(v));
      else if (RADII.test(k) && typeof v === 'number') inc(t.radii, String(v));
    }
    n.children?.forEach(visit);
  };
  routes.forEach((r) => visit(r.tree));
  return { colors: sortMap(t.colors), fonts: sortMap(t.fonts), fontSizes: sortMap(t.fontSizes), spacing: sortMap(t.spacing), radii: sortMap(t.radii) };
}
