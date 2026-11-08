import { describe, expect, it } from 'vitest';
import { themes, resolveTheme, contrastRatio, accentText } from './themes';
describe('theme safety', () => {
  it('has all ten agreed palettes with readable semantic tokens', () => {
    expect(themes).toHaveLength(10);
    for (const theme of themes) {
      expect(theme.dark.bg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.light.text).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
  it('rejects CSS injection and unknown custom tokens', () => {
    const palette = resolveTheme('midnight', 'dark', {
      bg: 'url(https://external)',
      text: '#ffffff',
      evil: '#000000',
    });
    expect(palette.bg).toBe('#18233f');
    expect(palette.text).toBe('#ffffff');
    expect(palette).not.toHaveProperty('evil');
  });
  it('keeps custom text and accent buttons readable', () => {
    const palette = resolveTheme('midnight', 'light', {
      bg: '#ffffff',
      surface: '#ffffff',
      text: '#ffffff',
      muted: '#ffffff',
      accent: '#7c202d',
    });
    expect(contrastRatio(palette.bg, palette.text)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.surface, palette.muted)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.accent, accentText(palette.accent))).toBeGreaterThanOrEqual(4.5);
  });
});
