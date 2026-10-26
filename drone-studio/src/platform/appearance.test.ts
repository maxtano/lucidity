import { describe, expect, it } from 'vitest';
import { APPEARANCE_KEY, parseAppearance, readAppearance, resolveAppearance } from './appearance';

describe('appearance preferences', () => {
  it('honors explicit choices independently of the operating system', () => {
    expect(resolveAppearance('light', true)).toBe('light');
    expect(resolveAppearance('dark', false)).toBe('dark');
  });
  it('follows either system appearance when requested', () => {
    expect(resolveAppearance('system', true)).toBe('dark');
    expect(resolveAppearance('system', false)).toBe('light');
  });
  it('defaults to system for missing or unsupported stored preferences', () => {
    for (const value of [null, '', 'automatic', 'LIGHT'])
      expect(parseAppearance(value)).toBe('system');
    expect(
      readAppearance({
        getItem: () => {
          throw new Error('Storage unavailable');
        },
      })
    ).toBe('system');
  });
  it('reads only the dedicated preference key', () => {
    expect(
      readAppearance({
        getItem: (key) => {
          expect(key).toBe(APPEARANCE_KEY);
          return 'light';
        },
      })
    ).toBe('light');
  });
});
