import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { run } from '../src/index.js';
import { FIXTURES, opts } from './helpers.js';

const root = mkdtempSync(join(tmpdir(), 'rnsm-diff-'));
const git = (...a: string[]) => execFileSync('git', a, { cwd: root, stdio: 'pipe' }).toString();
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('--diff', () => {
  cpSync(join(FIXTURES, 'themed'), root, { recursive: true });
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
  const f = join(root, 'src/app/settings.tsx');
  writeFileSync(f, readFileSync(f, 'utf8').replace('fontSize: 14, color: ink.accent', 'fontSize: 18, color: ink.accent'));

  it('shows only changed routes, with changed nodes and removed lines', async () => {
    const { result, output } = await run(opts(root, { diff: 'HEAD' }));
    expect(result.routes.map((r) => r.path)).toEqual(['/settings']);
    expect(result.routes[0].diff).toMatchObject({ ref: 'HEAD', status: 'changed' });
    expect(output).toMatch(/diff changed vs HEAD/);
    expect(output).toMatch(/"Sign out" 18/);
    expect(output).toMatch(/^- .*"Sign out" 14/m);
    expect(output).not.toMatch(/"Settings" w700/);
  });

  it('leaves the working tree untouched', () => {
    expect(git('status', '--porcelain').trim()).toBe('M src/app/settings.tsx');
  });
});
