import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { run, type RunOptions } from '../src/index.js';

export const FIXTURES = resolve(__dirname, '../fixtures');

export const DEFAULTS = {
  depth: 6,
  platform: 'android' as const,
  scheme: 'light' as const,
  viewport: { width: 360, height: 800 },
  format: 'compact' as const,
  unresolved: false,
};

export function opts(root: string, extra: Partial<RunOptions> = {}): RunOptions {
  return { root, ...DEFAULTS, ...extra } as RunOptions;
}

/** Write a tiny expo-router project to a temp dir. Returns root and cleanup. */
export function project(files: Record<string, string>): { root: string; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'rnsm-test-'));
  const all: Record<string, string> = {
    'package.json': JSON.stringify({ name: 't', dependencies: { 'expo-router': '6.0.0', 'react-native': '0.81.0' } }),
    ...files,
  };
  for (const [p, c] of Object.entries(all)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

export async function screen(body: string, extra: Partial<RunOptions> = {}, more: Record<string, string> = {}) {
  const p = project({ 'app/index.tsx': body, ...more });
  try {
    return await run(opts(p.root, extra));
  } finally {
    p.done();
  }
}
