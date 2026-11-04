import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURES } from './helpers.js';

const CLI = resolve(__dirname, '../dist/cli.js');
const cli = (...a: string[]) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8' });

describe.skipIf(!existsSync(CLI))('cli exit codes (built dist)', () => {
  const root = join(FIXTURES, 'expo-nativewind');
  it('0 on a normal map', () => {
    const r = cli('--root', root);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^# \//);
  });
  it('2 on config error (no such route)', () => {
    expect(cli('--root', root, '--route', '/nope').status).toBe(2);
  });
  it('2 on a bad flag value', () => {
    expect(cli('--root', root, '--format', 'xml').status).toBe(2);
  });
  it('--audit: 1 with error findings, 0 with --exit-zero', () => {
    const base = join(FIXTURES, 'bare-stylesheet');
    const a = cli('--root', base, '--audit');
    const errors = /(\d+) error/.exec(a.stdout)?.[1];
    expect(a.status).toBe(errors && errors !== '0' ? 1 : 0);
    expect(cli('--root', base, '--audit', '--strict', '--exit-zero').status).toBe(0);
  });
  it('--strict fails on warnings', () => {
    const r = cli('--root', root, '--audit', '--strict');
    if (/\b[1-9]\d* warn/.test(r.stdout)) expect(r.status).toBe(1);
  });
});
