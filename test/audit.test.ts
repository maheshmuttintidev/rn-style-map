import { describe, expect, it } from 'vitest';
import { screen } from './helpers.js';

const rn = `import { View, Text, Pressable, Image } from 'react-native';\n`;
const ids = (r: Awaited<ReturnType<typeof screen>>, sev?: string) =>
  (r.result.findings ?? []).filter((f) => !sev || f.severity === sev).map((f) => f.ruleId);

describe('audit rules', () => {
  it('1.4.3 contrast fail / pass / unknown', async () => {
    const fail = await screen(rn + `export default function X() { return <View style={{ backgroundColor: '#FFFFFF' }}><Text style={{ color: '#BBBBBB', fontSize: 14 }}>hi</Text></View>; }`, { audit: true });
    expect(ids(fail, 'error')).toContain('wcag-1.4.3');
    const pass = await screen(rn + `export default function X() { return <View style={{ backgroundColor: '#FFFFFF' }}><Text style={{ color: '#000000', fontSize: 14 }}>hi</Text></View>; }`, { audit: true });
    expect(ids(pass)).not.toContain('wcag-1.4.3');
    const unk = await screen(rn + `export default function X() { return <View><Image source={{ uri: 'x' }} style={{ position: 'absolute' }} /><Text style={{ color: '#BBBBBB' }}>hi</Text></View>; }`, { audit: true });
    expect(ids(unk, 'error')).not.toContain('wcag-1.4.3');
  });
  it('2.5.8 target size and a11y label', async () => {
    const r = await screen(rn + `export default function X() { return <Pressable style={{ width: 20, height: 20 }} />; }`, { audit: true });
    expect(ids(r, 'error')).toContain('wcag-2.5.8');
    expect(ids(r)).toContain('a11y-label');
    const ok = await screen(rn + `export default function X() { return <Pressable accessibilityLabel="Go" accessibilityRole="button" style={{ width: 48, height: 48 }} />; }`, { audit: true });
    expect(ids(ok)).not.toContain('wcag-2.5.8');
    expect(ids(ok)).not.toContain('a11y-label');
  });
  it('font scaling disabled is flagged', async () => {
    const r = await screen(rn + `export default function X() { return <Text allowFontScaling={false}>a</Text>; }`, { audit: true });
    expect(ids(r)).toContain('type-font-scaling');
  });
  it('config can turn a rule off', async () => {
    const r = await screen(rn + `export default function X() { return <Pressable style={{ width: 20, height: 20 }} />; }`, {
      audit: true,
      config: { audit: { severity: { 'wcag-2.5.8': 'off' } } },
    });
    expect(ids(r)).not.toContain('wcag-2.5.8');
  });
});
