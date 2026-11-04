import { describe, expect, it } from 'vitest';
import { contrast, deltaE, normalizeColor, over, shortHex } from '../src/resolve/color.js';

describe('color', () => {
  it('normalizes', () => {
    expect(normalizeColor('red')).toBe('#FF0000');
    expect(normalizeColor('#fff')).toBe('#FFFFFF');
    expect(normalizeColor('rgba(0,0,0,0.5)')).toMatch(/^#00000080$/i);
    expect(normalizeColor('not-a-color')).toBeNull();
  });
  it('contrast', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1);
  });
  it('alpha compositing', () => {
    expect(over('#00000080', '#FFFFFF').toUpperCase()).toMatch(/^#(7F|80){3}$/);
  });
  it('deltaE and shortHex', () => {
    expect(deltaE('#FFFFFF', '#FFFFFF')).toBe(0);
    expect(deltaE('#FFFFFF', '#FEFEFE')).toBeLessThan(2);
    expect(shortHex('#FFFFFF')).toBe('#FFF');
    expect(shortHex('#123456')).toBe('#123456');
  });
});
