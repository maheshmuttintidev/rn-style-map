import { existsSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type * as t from '@babel/types';
import type { Project } from '../resolve/project.js';
import type { Engine } from '../resolve/evaluator.js';
import { walk } from '../resolve/evaluator.js';
import type { Platform } from '../types.js';

export interface DiscoveredRoute {
  /** Public path, groups removed: `/login`, `/item/[id]`. */
  path: string;
  /** Path with groups kept, used for --route matching: `/(auth)/login`. */
  fullPath: string;
  file: string;
  layouts: string[];
  component?: unknown;
}

const EXT = /\.(tsx|ts|jsx|js)$/;

export function discoverExpoRouter(project: Project, platform: Platform): DiscoveredRoute[] | null {
  const root = project.opts.root;
  const appDir = ['app', 'src/app'].map((d) => join(root, d)).find((d) => existsSync(d) && statSync(d).isDirectory());
  if (!appDir) return null;
  const other = platform === 'ios' ? 'android' : 'ios';
  const routes: DiscoveredRoute[] = [];
  const visit = (dir: string, layouts: string[]) => {
    const entries = readdirSync(dir).sort();
    const layout = entries.find((e) => /^_layout\.(tsx|ts|jsx|js)$/.test(e) || new RegExp(`^_layout\\.${platform}\\.(tsx|ts|jsx|js)$`).test(e));
    const here = layout ? [...layouts, pickPlatform(dir, '_layout', entries, platform) ?? join(dir, layout)] : layouts;
    const seen = new Set<string>();
    for (const e of entries) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) {
        if (e === 'node_modules' || e.startsWith('.')) continue;
        visit(full, here);
        continue;
      }
      if (!EXT.test(e) || /\.d\.ts$/.test(e)) continue;
      if (/\+(api|html)\./.test(e) || e.startsWith('_') || /\.(test|spec)\./.test(e)) continue;
      const base = e.replace(EXT, '').replace(/\.(ios|android|native|web)$/, '');
      if (new RegExp(`\\.(${other}|web)\\.(tsx|ts|jsx|js)$`).test(e)) continue;
      if (seen.has(base)) continue;
      seen.add(base);
      const file = pickPlatform(dir, base, entries, platform) ?? full;
      const relParts = relative(appDir, join(dir, base)).split(sep);
      const fullPath = '/' + relParts.filter((p) => p !== 'index').join('/');
      const path = '/' + relParts.filter((p) => p !== 'index' && !/^\(.*\)$/.test(p)).join('/');
      routes.push({ path, fullPath, file, layouts: here.map((l) => project.rel(l)) });
    }
  };
  visit(appDir, []);
  return routes.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
}

function pickPlatform(dir: string, base: string, entries: string[], platform: Platform): string | null {
  for (const pre of [`.${platform}`, '.native', '']) {
    for (const ext of ['.tsx', '.ts', '.jsx', '.js']) if (entries.includes(base + pre + ext)) return join(dir, base + pre + ext);
  }
  return null;
}

/** React Navigation: `<X.Screen name component>` for X = createXNavigator(), plus the static `screens: {}` API. */
export function discoverReactNavigation(project: Project, engine: Engine): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];
  for (const file of project.sourceFiles()) {
    const code = project.read(file);
    if (!/create\w*Navigator\s*\(/.test(code)) continue;
    const mod = engine.getModule(file);
    if (!mod) continue;
    const navs = new Set<string>();
    walk(mod.ast.program, (n: any) => {
      if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init?.type === 'CallExpression') {
        const callee = n.init.callee;
        if (callee.type === 'Identifier' && /^create\w*Navigator$/.test(callee.name)) {
          navs.add(n.id.name);
          const arg = n.init.arguments[0];
          if (arg?.type === 'ObjectExpression') {
            const screens = arg.properties.find((p: any) => p.type === 'ObjectProperty' && keyName(p.key) === 'screens');
            if (screens?.value.type === 'ObjectExpression') {
              for (const p of screens.value.properties) {
                if (p.type !== 'ObjectProperty') continue;
                const name = keyName(p.key);
                if (!name) continue;
                let compNode = p.value;
                if (compNode.type === 'ObjectExpression') compNode = compNode.properties.find((q: any) => keyName(q.key) === 'screen')?.value;
                if (compNode) routes.push(screenRoute(project, engine, file, mod.scope, name, compNode));
              }
            }
          }
        }
      }
    });
    if (!navs.size) continue;
    walk(mod.ast.program, (n: any) => {
      if (n.type !== 'JSXOpeningElement' || n.name.type !== 'JSXMemberExpression') return;
      if (n.name.object.type !== 'JSXIdentifier' || !navs.has(n.name.object.name) || n.name.property.name !== 'Screen') return;
      let name: string | undefined;
      let comp: t.Node | undefined;
      for (const a of n.attributes) {
        if (a.type !== 'JSXAttribute' || a.name.type !== 'JSXIdentifier') continue;
        if (a.name.name === 'name' && a.value?.type === 'StringLiteral') name = a.value.value;
        if (a.name.name === 'name' && a.value?.type === 'JSXExpressionContainer' && a.value.expression.type === 'StringLiteral') name = a.value.expression.value;
        if (a.name.name === 'component' && a.value?.type === 'JSXExpressionContainer') comp = a.value.expression;
      }
      if (name && comp) routes.push(screenRoute(project, engine, file, mod.scope, name, comp));
    });
  }
  const seen = new Set<string>();
  return routes.filter((r) => (seen.has(r.path) ? false : (seen.add(r.path), true))).sort((a, b) => a.path.localeCompare(b.path));
}

function keyName(k: any): string | undefined {
  return k?.type === 'Identifier' ? k.name : k?.type === 'StringLiteral' ? k.value : undefined;
}

function screenRoute(project: Project, engine: Engine, navFile: string, scope: any, name: string, compNode: t.Node): DiscoveredRoute {
  const component = engine.eval(compNode, scope, true);
  let file = navFile;
  const c = component as any;
  if (c && typeof c === 'object' && typeof c.file === 'string' && c.node) file = c.file;
  return { path: '/' + name, fullPath: '/' + name, file, layouts: [project.rel(navFile)], component };
}

export function discoverEntry(project: Project, entry: string): DiscoveredRoute[] {
  const file = isAbsolute(entry) ? entry : resolve(project.root, entry);
  const base = entry.replace(EXT, '').split(/[\\/]/).pop() ?? entry;
  return [{ path: '/' + base, fullPath: '/' + base, file, layouts: [] }];
}

/** Glob match for --route: `*` = one segment part, `**` = anything. Matches path or group path. */
export function routeMatches(r: DiscoveredRoute, patterns: string[] | undefined): boolean {
  if (!patterns?.length) return true;
  return patterns.some((p) => {
    const norm = p.startsWith('/') ? p : '/' + p;
    const re = new RegExp(
      '^' +
        norm
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*/g, '\u0000')
          .replace(/\*/g, '[^/]*')
    // eslint-disable-next-line no-control-regex -- NUL is the separator we inserted
          .replace(/\u0000/g, '.*') +
        '/?$'
    );
    return re.test(r.path) || re.test(r.fullPath);
  });
}
