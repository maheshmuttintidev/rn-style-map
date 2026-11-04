import { describe, expect, it } from 'vitest';
import { DEFAULT_SCALER, scalerFns } from '../src/resolve/scaler.js';
import { screen } from './helpers.js';

// Expected values computed by hand from @shayrn/react-native-scaler v1.2.0:
// uniform = min(W/402, H/874); scale = round(size*uniform); scaleFont clamps to [10,100]
describe('scaler formula', () => {
  it('360x800', () => {
    const f = scalerFns({ width: 360, height: 800 }, DEFAULT_SCALER);
    const u = Math.min(360 / 402, 800 / 874);
    expect(f.scale(24)).toBe(Math.round(24 * u));
    expect(f.scale(24)).toBe(21);
    expect(f.scaleFont(16)).toBe(14);
    expect(f.scaleFont(8)).toBe(10); // min clamp
    expect(f.scaleWidth(100)).toBe(90);
    expect(f.scaleHeight(100)).toBe(92);
  });
  it('390x844', () => {
    const f = scalerFns({ width: 390, height: 844 }, DEFAULT_SCALER);
    expect(f.scale(24)).toBe(Math.round(24 * Math.min(390 / 402, 844 / 874)));
    expect(f.scale(100)).toBe(97);
  });
  it('402x874 is identity', () => {
    const f = scalerFns({ width: 402, height: 874 }, DEFAULT_SCALER);
    for (const n of [1, 12, 16, 24, 48, 100]) {
      expect(f.scale(n)).toBe(n);
      expect(f.scaleFont(n < 10 ? 10 : n)).toBe(n < 10 ? 10 : n);
      expect(f.scaleHeight(n)).toBe(n);
    }
  });
  it('options: useUniform false, max', () => {
    const f = scalerFns({ width: 360, height: 800 }, DEFAULT_SCALER);
    expect(f.scale(100, { useUniform: false })).toBe(90);
    expect(f.scale(100, { max: 50 })).toBe(50);
  });
  it('configureScaler in source changes the reference', async () => {
    const r = await screen(
      `import { View } from 'react-native';
import { scale, configureScaler } from '@shayrn/react-native-scaler';
configureScaler({ referenceWidth: 360, referenceHeight: 800 });
export default function S() { return <View style={{ width: scale(100) }} />; }`,
    );
    expect(r.output).toMatch(/~w100\b/);
  });
  it('evaluated in a screen at 360x800', async () => {
    const r = await screen(
      `import { View } from 'react-native';
import { scale } from '@shayrn/react-native-scaler';
export default function S() { return <View style={{ padding: scale(24) }} />; }`,
    );
    expect(r.output).toMatch(/~p21\b/);
  });
});
