import { describe, expect, it } from 'vitest';
import { splitVariants, utilityToStyle, variantApplies, type ClassContext } from '../src/nativewind/classes.js';
import { loadCssVars, loadTailwindTheme } from '../src/nativewind/loader.js';
import { FIXTURES } from './helpers.js';
import { join } from 'node:path';

const root = join(FIXTURES, 'expo-nativewind');
const ctx = (o: Partial<ClassContext> = {}): ClassContext => ({
  theme: loadTailwindTheme(root).theme,
  vars: loadCssVars(root),
  rem: 14,
  platform: 'android',
  scheme: 'light',
  viewport: { width: 360, height: 800 },
  ...o,
});
const style = (u: string, c = ctx()) => {
  const r = utilityToStyle(u, c);
  return 'style' in r ? r.style : r;
};

describe('nativewind classes', () => {
  it('spacing uses rem 14', () => {
    expect(style('p-4')).toEqual({ padding: 14 });
    expect(style('mt-2')).toEqual({ marginTop: 7 });
  });
  it('arbitrary values', () => {
    expect(style('w-[37px]')).toEqual({ width: 37 });
  });
  it('custom theme colours', () => {
    const s = style('bg-brand') as Record<string, unknown>;
    expect(typeof s.backgroundColor).toBe('string');
  });
  it('variants', () => {
    expect(splitVariants('dark:ios:bg-black')).toEqual({ variants: ['dark', 'ios'], util: 'bg-black' });
    expect(variantApplies('dark', ctx({ scheme: 'dark' }))).toBe(true);
    expect(variantApplies('dark', ctx())).toBe(false);
    expect(variantApplies('ios', ctx())).toBe(false);
    expect(variantApplies('android', ctx())).toBe(true);
  });
  it('unknown class is reported, not guessed', () => {
    expect(utilityToStyle('definitely-not-a-class', ctx())).toHaveProperty('unknown', true);
  });
});
