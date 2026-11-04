import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { getTsconfig, createPathsMatcher } from 'get-tsconfig';
import { parseFile } from './parse.js';
import type { Options, Platform } from '../types.js';
import type * as t from '@babel/types';

const DEFAULT_IGNORE = ['**/node_modules/**', '**/android/**', '**/ios/**', '**/dist/**', '**/build/**', '**/.expo/**', '**/coverage/**', '**/__tests__/**', '**/*.test.*', '**/*.spec.*'];

export class Project {
  root: string;
  pkg: any;
  platform: Platform;
  private pathsMatcher: ((spec: string) => string[]) | null = null;
  private babelAliases: Record<string, string> = {};
  private babelRoots: string[] = [];
  private resolveCache = new Map<string, string | null>();
  private files?: string[];
  private textCache = new Map<string, string>();

  constructor(public opts: Options) {
    this.root = path.resolve(opts.root);
    this.platform = opts.platform;
    const pkgFile = path.join(this.root, 'package.json');
    this.pkg = fs.existsSync(pkgFile) ? JSON.parse(fs.readFileSync(pkgFile, 'utf8')) : {};
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const p = path.join(this.root, name);
      if (fs.existsSync(p)) {
        try {
          const tc = getTsconfig(this.root, name);
          if (tc) this.pathsMatcher = createPathsMatcher(tc);
        } catch {
          // `extends` target missing (e.g. node_modules not installed): read this file's own paths
          this.pathsMatcher = this.ownPathsMatcher(p);
        }
        break;
      }
    }
    this.loadBabelAliases();
  }

  private ownPathsMatcher(file: string): ((spec: string) => string[]) | null {
    try {
      const src = stripJsonComments(fs.readFileSync(file, 'utf8'));
      const co = JSON.parse(src).compilerOptions ?? {};
      const paths: Record<string, string[]> = co.paths ?? {};
      const base = path.resolve(path.dirname(file), co.baseUrl ?? '.');
      const entries = Object.entries(paths);
      if (!entries.length) return null;
      return (spec: string) => {
        const out: string[] = [];
        for (const [pat, targets] of entries) {
          const star = pat.indexOf('*');
          if (star < 0) {
            if (spec === pat) out.push(...targets.map((t) => path.resolve(base, t)));
            continue;
          }
          const pre = pat.slice(0, star);
          const suf = pat.slice(star + 1);
          if (spec.startsWith(pre) && spec.endsWith(suf) && spec.length >= pre.length + suf.length) {
            const mid = spec.slice(pre.length, spec.length - suf.length);
            out.push(...targets.map((t) => path.resolve(base, t.replace('*', mid))));
          }
        }
        return out;
      };
    } catch {
      return null;
    }
  }

  hasDep(name: string): boolean {
    const p = this.pkg;
    return Boolean(p.dependencies?.[name] || p.devDependencies?.[name] || p.peerDependencies?.[name]);
  }

  rel(file: string): string {
    return path.relative(this.root, file).split(path.sep).join('/');
  }

  read(file: string): string {
    let s = this.textCache.get(file);
    if (s === undefined) {
      s = fs.readFileSync(file, 'utf8');
      this.textCache.set(file, s);
    }
    return s;
  }

  sourceFiles(): string[] {
    if (!this.files) {
      this.files = fg
        .sync(['**/*.{ts,tsx,js,jsx}'], {
          cwd: this.root,
          ignore: [...DEFAULT_IGNORE, ...(this.opts.config?.ignore ?? [])],
          absolute: true,
          dot: false,
        })
        .filter((f) => !f.endsWith('.d.ts'))
        .sort();
    }
    return this.files;
  }

  /** Static parse of babel.config.js module-resolver options (never executed). */
  private loadBabelAliases(): void {
    for (const name of ['babel.config.js', 'babel.config.cjs', '.babelrc.js']) {
      const p = path.join(this.root, name);
      if (!fs.existsSync(p)) continue;
      try {
        const ast = parseFile(fs.readFileSync(p, 'utf8'), p);
        const visit = (n: any): void => {
          if (!n || typeof n !== 'object') return;
          if (Array.isArray(n)) return n.forEach(visit);
          if (n.type === 'ObjectProperty' && !n.computed) {
            const key = n.key.name ?? n.key.value;
            if (key === 'alias' && n.value.type === 'ObjectExpression') {
              for (const pr of n.value.properties as t.ObjectProperty[]) {
                const k = (pr.key as any).name ?? (pr.key as any).value;
                if (pr.value?.type === 'StringLiteral') this.babelAliases[k] = pr.value.value;
              }
            }
            if (key === 'root' && n.value.type === 'ArrayExpression') {
              for (const el of n.value.elements) if (el?.type === 'StringLiteral') this.babelRoots.push(el.value);
            }
          }
          for (const k of Object.keys(n)) if (k !== 'loc' && k !== 'start' && k !== 'end') visit(n[k]);
        };
        visit(ast.program);
      } catch {
        /* ignore */
      }
      break;
    }
  }

  extensions(): string[] {
    const p = this.platform;
    return [`.${p}.tsx`, `.${p}.ts`, '.native.tsx', '.native.ts', '.tsx', '.ts', `.${p}.jsx`, `.${p}.js`, '.native.jsx', '.native.js', '.jsx', '.js', '.json'];
  }

  private tryFile(base: string): string | null {
    if (/\.(tsx?|jsx?|json)$/.test(base) && fs.existsSync(base) && fs.statSync(base).isFile()) return base;
    for (const ext of this.extensions()) if (fs.existsSync(base + ext)) return base + ext;
    if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
      for (const ext of this.extensions()) {
        const f = path.join(base, 'index' + ext);
        if (fs.existsSync(f)) return f;
      }
    }
    return null;
  }

  /** Resolve an import to a project file, or null for packages / missing files. */
  resolve(fromFile: string, spec: string): string | null {
    const key = fromFile + '\0' + spec;
    if (this.resolveCache.has(key)) return this.resolveCache.get(key)!;
    let out: string | null = null;
    if (spec.startsWith('.') || spec.startsWith('/')) {
      out = this.tryFile(path.resolve(path.dirname(fromFile), spec));
    } else {
      if (this.pathsMatcher) {
        for (const cand of this.pathsMatcher(spec)) {
          out = this.tryFile(cand);
          if (out) break;
        }
      }
      if (!out) {
        for (const [alias, target] of Object.entries(this.babelAliases)) {
          if (spec === alias || spec.startsWith(alias + '/')) {
            out = this.tryFile(path.resolve(this.root, target + spec.slice(alias.length)));
            if (out) break;
          }
        }
      }
      if (!out) {
        for (const r of this.babelRoots) {
          out = this.tryFile(path.resolve(this.root, r, spec));
          if (out) break;
        }
      }
    }
    if (out && out.includes(`${path.sep}node_modules${path.sep}`)) out = null;
    this.resolveCache.set(key, out);
    return out;
  }
}

/** Strip line and block comments and trailing commas from JSONC, respecting strings. */
export function stripJsonComments(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2);
      if (i < 0) break;
      i++;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}
