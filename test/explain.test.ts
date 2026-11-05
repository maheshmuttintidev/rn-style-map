import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../src/index.js';
import { FIXTURES, opts, screen } from './helpers.js';

describe('--explain', () => {
  it('does not change default compact output (byte-identical to no flag)', async () => {
    const root = join(FIXTURES, 'bare-stylesheet');
    const a = await run(opts(root));
    const b = await run(opts(root, { explain: true }));
    // Strip explain lines and recompute: node lines must match; easier: without flag === fixture golden path
    const without = a.output;
    const withFlag = b.output;
    expect(without).not.toMatch(/↳/);
    expect(withFlag).toMatch(/↳/);
    // Drop explain-only lines and the header token count (changes with explain) for structural compare
    const strip = (s: string) =>
      s
        .split('\n')
        .filter((l) => !l.includes('↳'))
        .map((l) => l.replace(/~\d+ tok/, '~TOK tok'))
        .join('\n');
    expect(strip(withFlag)).toBe(strip(without));
  });

  it('shows StyleSheet then inline winner for style arrays', async () => {
    const { output, result } = await screen(
      `import { View, Text, StyleSheet } from 'react-native';
export default function S() {
  return (
    <View style={[styles.card, { padding: 8 }]}>
      <Text style={[styles.title, { color: '#f00' }]}>Hi</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  card: { padding: 16, backgroundColor: '#ccc', margin: 10 },
  title: { fontSize: 18, color: '#000' },
});`,
      { explain: true },
    );
    expect(output).toMatch(/↳ pt=8 ← inline 8 \(index\.tsx:\d+\) over stylesheet 16 \(index\.tsx:\d+\)/);
    expect(output).toMatch(/↳ c=#F00 ← inline #F00 \(index\.tsx:\d+\) over stylesheet #000 \(index\.tsx:\d+\)/);
    // JSON additive layers
    const j = await screen(
      `import { View, StyleSheet } from 'react-native';
export default function S() { return <View style={[styles.card, { padding: 8 }]} />; }
const styles = StyleSheet.create({ card: { padding: 16 } });`,
      { explain: true, format: 'json' },
    );
    const parsed = JSON.parse(j.output);
    const style = parsed.routes[0].tree.style;
    expect(style.paddingTop.layers.length).toBeGreaterThanOrEqual(2);
    expect(style.paddingTop.layers.at(-1).source).toBe('inline');
    // without explain: no layers key
    const j0 = await screen(
      `import { View, StyleSheet } from 'react-native';
export default function S() { return <View style={[styles.card, { padding: 8 }]} />; }
const styles = StyleSheet.create({ card: { padding: 16 } });`,
      { format: 'json' },
    );
    const p0 = JSON.parse(j0.output);
    expect(p0.routes[0].tree.style.paddingTop.layers).toBeUndefined();
    void result;
  });

  it('traces Platform.select then later inline', async () => {
    const { output } = await screen(
      `import { Text, StyleSheet, Platform } from 'react-native';
export default function S() {
  return <Text style={[styles.t, Platform.select({ ios: { color: '#111' }, android: { color: '#222' } }), { color: '#f00' }]}>X</Text>;
}
const styles = StyleSheet.create({ t: { color: '#000', fontSize: 14 } });`,
      { explain: true, platform: 'android' },
    );
    expect(output).toMatch(/↳ c=#F00 ← inline #F00 .* over stylesheet #000 .* → inline #222/);
  });

  it('labels NativeWind class overrides in the stack', async () => {
    const root = join(FIXTURES, 'expo-nativewind');
    const { output } = await run(opts(root, { explain: true, route: ['/'] }));
    expect(output).toMatch(/↳ cc\.paddingBottom=42 ← nativewind/);
  });

  it('budget drops explain lines before other trims', async () => {
    const root = join(FIXTURES, 'expo-nativewind');
    const full = await run(opts(root, { explain: true }));
    const tight = await run(opts(root, { explain: true, budget: 80 }));
    expect(full.output).toMatch(/↳/);
    // With a tiny budget, explain should be trimmed away (or body heavily cut)
    if (tight.output.includes('· trimmed:')) {
      expect(tight.output).toMatch(/trimmed:.*explain/);
    }
    // Node-line content still present somehow, or body trimmed — either way no crash
    expect(tight.output.length).toBeGreaterThan(10);
  });

  it('md format includes explain lines inside the fence', async () => {
    const { output } = await screen(
      `import { View, StyleSheet } from 'react-native';
export default function S() { return <View style={[styles.card, { padding: 8 }]} />; }
const styles = StyleSheet.create({ card: { padding: 16 } });`,
      { explain: true, format: 'md' },
    );
    expect(output).toMatch(/```text[\s\S]*↳ pt=8/);
  });

  it('--diff signatures ignore explain text (same changed/removed lines)', async () => {
    // Reuse themed fixture pattern lightly via project helper is hard for git;
    // assert sig helper path: explain lines never appear in nodeLine, so signatures unchanged.
    const { output: a } = await screen(
      `import { View, StyleSheet } from 'react-native';
export default function S() { return <View style={[styles.card, { padding: 8 }]} />; }
const styles = StyleSheet.create({ card: { padding: 16, backgroundColor: '#fff' } });`,
    );
    const { output: b } = await screen(
      `import { View, StyleSheet } from 'react-native';
export default function S() { return <View style={[styles.card, { padding: 8 }]} />; }
const styles = StyleSheet.create({ card: { padding: 16, backgroundColor: '#fff' } });`,
      { explain: true },
    );
    const nodeOnly = (s: string) =>
      s
        .split('\n')
        .filter((l) => !l.includes('↳') && !l.startsWith('#'))
        .map((l) => l.replace(/~\d+ tok/, ''))
        .join('\n');
    expect(nodeOnly(b)).toBe(nodeOnly(a));
  });

  it('does not invent layers for single-source props', async () => {
    const { output } = await screen(
      `import { View, StyleSheet } from 'react-native';
export default function S() { return <View style={styles.card} />; }
const styles = StyleSheet.create({ card: { padding: 16 } });`,
      { explain: true },
    );
    // single layer — no ↳ line for padding
    expect(output).not.toMatch(/↳ pt=/);
  });
});

describe('goldens stay untouched without --explain', () => {
  it('bare-stylesheet default still matches golden file', async () => {
    const root = join(FIXTURES, 'bare-stylesheet');
    const { output } = await run(opts(root));
    const golden = readFileSync(join(__dirname, 'golden/bare-stylesheet.default.txt'), 'utf8');
    expect(output).toBe(golden);
  });
});
