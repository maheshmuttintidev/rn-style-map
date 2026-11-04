import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import { run } from '../src/index.js';
import { countTokens } from '../src/encode/tokens.js';
import { FIXTURES, opts } from './helpers.js';

const NAMES = ['expo-nativewind', 'bare-stylesheet', 'themed'];
const VARIANTS = {
  default: {},
  'ios-dark-390x844': { platform: 'ios', scheme: 'dark', viewport: { width: 390, height: 844 } },
} as const;
const GOLDEN = join(__dirname, 'golden');
const schema = JSON.parse(readFileSync(join(__dirname, '../schema/v1.json'), 'utf8'));
const validate = new Ajv({ strict: false }).compile(schema);

describe.each(NAMES)('fixture %s', (name) => {
  const root = join(FIXTURES, name);

  it.each(Object.entries(VARIANTS))('golden %s', async (v, extra) => {
    const { output } = await run(opts(root, extra as never));
    const f = join(GOLDEN, `${name}.${v}.txt`);
    if (process.env.UPDATE_GOLDEN || !existsSync(f)) {
      mkdirSync(GOLDEN, { recursive: true });
      writeFileSync(f, output);
    }
    expect(output).toBe(readFileSync(f, 'utf8'));
  });

  it('≥90% of style props resolved', async () => {
    const { result } = await run(opts(root));
    const r = result.routes.reduce((a, x) => a + x.stats.resolved, 0);
    const t = result.routes.reduce((a, x) => a + x.stats.total, 0);
    expect(r / t).toBeGreaterThanOrEqual(0.9);
  });

  it('json validates against schema/v1.json (with tokens + audit)', async () => {
    const { output } = await run(opts(root, { format: 'json', tokens: true, audit: true }));
    const ok = validate(JSON.parse(output));
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it('is deterministic', async () => {
    const a = await run(opts(root, { tokens: true, audit: true, format: 'md' }));
    const b = await run(opts(root, { tokens: true, audit: true, format: 'md' }));
    expect(a.output).toBe(b.output);
  });

  it.each([80, 120, 200])('--budget %i is never exceeded', async (budget) => {
    const { output } = await run(opts(root, { budget }));
    for (const block of output.split(/\n(?=# )/)) expect(countTokens(block.trim())).toBeLessThanOrEqual(budget);
  });
});
