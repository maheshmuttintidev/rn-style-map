import { describe, expect, it } from 'vitest';
import { screen } from './helpers.js';

const rn = `import { View, Text, StyleSheet, Platform } from 'react-native';\n`;

describe('evaluator', () => {
  it('StyleSheet.create, arrays, falsy entries', async () => {
    const r = await screen(rn + `
const s = StyleSheet.create({ a: { padding: 8 }, b: { backgroundColor: 'red' } });
export default function X() { const on = false; return <View style={[s.a, on && s.b, null]} />; }`);
    expect(r.output).toMatch(/View p8\s/);
    expect(r.output).not.toMatch(/#F00/);
  });
  it('Platform.select and Platform.OS', async () => {
    const src = rn + `
export default function X() { return <View style={{ margin: Platform.select({ ios: 1, android: 2 }), padding: Platform.OS === 'ios' ? 3 : 4 }} />; }`;
    expect((await screen(src)).output).toMatch(/p4 m2|m2 p4/);
    const ios = (await screen(src, { platform: 'ios' })).output;
    expect(ios).toMatch(/\bm1\b/);
    expect(ios).toMatch(/\bp3\b/);
  });
  it('rest params, spreads of known objects, template literals', async () => {
    const r = await screen(rn + `
const base = { padding: 2 };
function pick(...xs: number[]) { return xs[1]; }
export default function X() { return <Text style={{ ...base, margin: pick(1, 5) }}>{\`n\${1 + 1}\`}</Text>; }`);
    expect(r.output).toMatch(/"n2"/);
    expect(r.output).toMatch(/\bm5\b/);
    expect(r.output).toMatch(/\bp2\b/);
  });
  it('runtime values are reported as unresolved, never guessed', async () => {
    const r = await screen(rn + `
export default function X({ w }: { w: number }) { return <View style={{ width: w, padding: 4 }} />; }`, { unresolved: true });
    expect(r.result.routes[0].stats).toMatchObject({ resolved: 4, total: 5 });
    expect(r.output).toMatch(/width=w/);
  });
  it('local components are inlined with callsite', async () => {
    const r = await screen(rn + `
function Box() { return <View style={{ padding: 3 }} />; }
export default function X() { return <View><Box /></View>; }`);
    expect(r.output).toMatch(/View p3 .*←/);
  });
  it('.map() becomes ×N', async () => {
    const r = await screen(rn + `
export default function X() { return <View>{['a','b','c'].map((k) => <Text key={k}>{k}</Text>)}</View>; }`);
    expect(r.output).toMatch(/Text×3/);
  });
  it('scheme-keyed theme via useColorScheme', async () => {
    const src = `import { View, useColorScheme } from 'react-native';
const C = { light: { bg: '#FFFFFF' }, dark: { bg: '#000000' } };
export default function X() { const s = useColorScheme(); return <View style={{ backgroundColor: C[s ?? 'light'].bg }} />; }`;
    expect((await screen(src)).output).toMatch(/bg#FFF\b/);
    expect((await screen(src, { scheme: 'dark' })).output).toMatch(/bg#000\b/);
  });

  it('Dimensions.get and useWindowDimensions resolve from --viewport', async () => {
    const src = `import { View, Dimensions, useWindowDimensions } from 'react-native';
export default function X() {
  const { width } = useWindowDimensions();
  return <View style={{ padding: Dimensions.get('window').width * 0.05, width: width / 2 }} />;
}`;
    const def = await screen(src);
    expect(def.output).toMatch(/\bp18\b/);
    expect(def.output).toMatch(/\bw180\b/);
    expect(def.result.routes[0].stats).toMatchObject({ resolved: 5, total: 5 });
    const wide = await screen(src, { viewport: { width: 400, height: 800 } });
    expect(wide.output).toMatch(/\bp20\b/);
    expect(wide.output).toMatch(/\bw200\b/);
  });
});
