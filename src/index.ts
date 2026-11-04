import { analyze } from './map.js';
import { renderAll, renderCompact, tokenTableCompact, tokenTableMd, type RenderOpts } from './encode/index.js';
import { tokenTable } from './tokens.js';
import { audit as runAudit, findingsCompact, findingsMd } from './audit/engine.js';
import { changedFiles, diffRoutes } from './diff/git.js';
import type { MapResult, Options, RouteMap } from './types.js';

export type * from './types.js';
export { countTokens } from './encode/tokens.js';
export { tokenTable } from './tokens.js';

export interface RunOptions extends Options, Omit<RenderOpts, 'depth' | 'only'> {
  tokens?: boolean;
  audit?: boolean;
  diff?: string;
}

export interface RunResult {
  result: MapResult;
  output: string;
  warnings: string[];
}

const DEFAULTS: Options = { root: '.', depth: 6, platform: 'android', scheme: 'light', viewport: { width: 360, height: 800 } };

/** Map routes to resolved style trees (library API). */
export function map(opts: Partial<Options> & { root: string }): MapResult {
  const a = analyze({ ...DEFAULTS, ...opts });
  return { version: 1, project: a.project, routes: a.routes };
}

/** Project token table. */
export function tokens(opts: Partial<Options> & { root: string }) {
  return tokenTable(map(opts).routes);
}

/** Run audit rules over the mapped routes. */
export function audit(opts: Partial<Options> & { root: string }) {
  const o = { ...DEFAULTS, ...opts };
  return runAudit(map(o).routes, o);
}

/** Full CLI pipeline: map → (diff) → (audit/tokens) → encode with budget. */
export async function run(o: RunOptions): Promise<RunResult> {
  let routes: RouteMap[];
  let a;
  if (o.diff) {
    const files = changedFiles(o.root, o.diff);
    a = analyze(o);
    routes = diffRoutes(a.routes, o, o.diff, files);
  } else {
    a = analyze(o);
    routes = a.routes;
  }
  routes.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  const result: MapResult = { version: 1, project: a.project, routes };
  const ro: RenderOpts = { format: o.format, depth: o.depth, only: o.only, budget: o.budget, unresolved: o.unresolved };
  const extra: { tokensTable?: string; tokensMd?: string; findings?: string } = {};
  if (o.tokens) {
    result.tokens = tokenTable(routes);
    extra.tokensTable = tokenTableCompact(result.tokens);
    extra.tokensMd = tokenTableMd(result.tokens);
  }
  if (o.audit) {
    result.findings = runAudit(routes, o);
    extra.findings = o.format === 'md' ? findingsMd(result.findings) : findingsCompact(result.findings);
  }
  const rendered = routes.map((r) => renderCompact(r, a.project, ro));
  rendered.forEach((x) => (x.route.stats.tokens = x.tokens));
  let output: string;
  if (o.audit && !o.tokens && o.format === 'compact') output = (extra.findings ?? '') + '\n';
  else output = renderAll(result, rendered, ro, extra);
  return { result, output, warnings: a.warnings };
}
