import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeControl } from './ThemeControl';

afterEach(() => vi.unstubAllGlobals());
describe('persistent appearance control accessibility', () => {
  it.each(['light', 'dark'] as const)('exposes a named switch with the correct %s state', theme => {
    vi.stubGlobal('window', { localStorage: { getItem: () => theme }, matchMedia: () => ({ matches: false }) });
    const html = renderToStaticMarkup(<ThemeControl />);
    expect(html).toContain('role="switch" aria-label="Dark mode"');
    expect(html).toContain(`aria-checked="${theme === 'dark'}"`);
    expect(html).toContain(`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
    expect(html).toContain('Use system appearance');
  });
  it('reflects system dark mode without requiring a saved explicit preference', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => null }, matchMedia: () => ({ matches: true }) });
    const html = renderToStaticMarkup(<ThemeControl />);
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('Following system');
  });
});
