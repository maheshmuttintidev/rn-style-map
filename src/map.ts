import path from 'node:path';
import { Project } from './resolve/project.js';
import { Engine } from './resolve/evaluator.js';
import { TreeBuilder } from './tree/build.js';
import { loadCssVars, loadTailwindTheme, findTailwindConfig } from './nativewind/loader.js';
import type { ClassContext } from './nativewind/classes.js';
import { discoverEntry, discoverExpoRouter, discoverReactNavigation, routeMatches, type DiscoveredRoute } from './discover/index.js';
import type { Options, ProjectInfo, RouteMap, StyleSource, MapNode } from './types.js';

export interface Analysis {
  project: ProjectInfo;
  routes: RouteMap[];
  warnings: string[];
}

export function analyze(opts: Options, onlyFiles?: Set<string>): Analysis {
  const project = new Project(opts);
  const engine = new Engine(project, opts);
  const warnings: string[] = [];
  let nw: ClassContext | null = null;
  const usesNw = project.hasDep('nativewind') || !!findTailwindConfig(project.root);
  if (usesNw) {
    const tw = loadTailwindTheme(project.root);
    if (tw.warning) warnings.push(tw.warning);
    nw = {
      theme: tw.theme,
      vars: loadCssVars(project.root, opts.config?.css),
      rem: opts.config?.rem ?? 14,
      platform: opts.platform,
      scheme: opts.scheme,
      viewport: opts.viewport,
    };
  }
  let router: ProjectInfo['router'];
  let found: DiscoveredRoute[] = [];
  if (opts.entry) {
    router = 'entry';
    found = discoverEntry(project, opts.entry);
  } else {
    const expo = project.hasDep('expo-router') || !project.pkg.dependencies ? discoverExpoRouter(project, opts.platform) : null;
    if (expo && expo.length) {
      router = 'expo-router';
      found = expo;
    } else {
      router = 'react-navigation';
      found = discoverReactNavigation(project, engine);
      if (!found.length) throw new ConfigError('No routes found: no expo-router app/ directory and no React Navigation screens. Use --entry <file>.');
    }
  }
  const selected = found.filter((r) => routeMatches(r, opts.route)).filter((r) => !onlyFiles || onlyFiles.has(project.rel(r.file)));
  if (opts.route?.length && !selected.length && !onlyFiles) throw new ConfigError(`No route matches ${opts.route.join(', ')}. Known: ${found.map((r) => r.path).join(', ')}`);
  const builder = new TreeBuilder(engine, nw);
  const routes: RouteMap[] = [];
  for (const r of selected) {
    const b = builder.buildRoute(r.file, path.basename(r.file).replace(/\.\w+$/, ''), r.component);
    // nested navigators (a screen whose component only renders X.Navigator) are not screens
    if (router === 'react-navigation' && /\.Navigator$/.test(b.tree.name)) continue;
    routes.push({
      path: r.path,
      file: project.rel(r.file),
      layouts: r.layouts,
      tree: b.tree,
      stats: { resolved: b.resolved, total: b.total, tokens: 0 },
      unresolved: b.unresolved,
    });
  }
  const styling: StyleSource[] = [];
  const srcs = new Set<string>();
  const visit = (n: MapNode) => {
    for (const e of Object.values(n.style ?? {})) srcs.add(e.source);
    n.children?.forEach(visit);
  };
  routes.forEach((r) => visit(r.tree));
  for (const s of ['stylesheet', 'inline', 'theme', 'nativewind'] as const) if (srcs.has(s) || (s === 'nativewind' && nw)) styling.push(s);
  return {
    project: { router, platform: opts.platform, scheme: opts.scheme, viewport: opts.viewport, styling },
    routes,
    warnings,
  };
}

export class ConfigError extends Error {}
