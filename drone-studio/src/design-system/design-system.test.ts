import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const stylesheets = readdirSync(sourceRoot, { recursive: true })
  .filter((path): path is string => typeof path === 'string' && path.endsWith('.css'))
  .map(path => ({ path, css: withoutComments(readFileSync(join(sourceRoot, path), 'utf8')) }));
const tokenCss = withoutComments(readFileSync(new URL('./tokens.css', import.meta.url), 'utf8'));

/** Resolve only the static :root token scopes; this is not a browser/CSS-cascade simulation. */
function themeTokens(theme: 'light' | 'dark') {
  const tokens = new Map<string, string>();
  for (const [, selector, body] of tokenCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = selector.split(',').map(value => value.trim());
    if (!selectors.includes(':root') && !selectors.includes(`:root[data-theme='${theme}']`)) continue;
    for (const [, key, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens.set(key, value.trim());
  }
  return tokens;
}
function resolve(name: string, tokens: Map<string, string>, seen = new Set<string>()): string {
  if (seen.has(name)) throw new Error(`Token cycle: ${[...seen, name].join(' → ')}`);
  const value = tokens.get(name);
  if (!value) throw new Error(`Undefined token: ${name}`);
  const alias = /^var\((--[\w-]+)\)$/.exec(value);
  return alias ? resolve(alias[1], tokens, new Set([...seen, name])) : value;
}
function luminance(color: string) {
  if (!/^#[\da-f]{6}$/i.test(color)) throw new Error(`Expected an opaque RGB token, received ${color}`);
  const channels = [1, 3, 5].map(offset => {
    const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}
function contrast(a: string, b: string) {
  const pair = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (pair[0] + .05) / (pair[1] + .05);
}

// These pairs describe supported semantic uses, rather than asserting specific palette hexes.
const textPairs = [
  ...['bg', 'surface', 'surface-raised', 'surface-inset', 'chrome'].flatMap(background =>
    ['text', 'text-muted', 'text-subtle'].map(foreground => [foreground, background])),
  ['accent', 'accent-bg'], ['feature-text', 'surface-inset'],
  ...['bg', 'surface', 'surface-inset', 'chrome'].flatMap(background => ['sage', 'mauve', 'accent'].map(foreground => [foreground, background])),
  ...['start', 'middle', 'end'].map(stop => ['drone-button-text', `drone-button-${stop}`]),
  ['on-primary', 'primary'], ['on-primary', 'primary-hover'], ['on-feature', 'feature'],
  ['success', 'success-bg'], ['warning', 'warning-bg'], ['danger', 'danger-bg'],
  ['info', 'info-bg'], ['feature-text', 'feature-bg'], ['sage', 'sage-bg'], ['mauve', 'mauve-bg'],
  ['selection-text', 'selection'], ['canvas-text', 'canvas-bg'], ['canvas-muted', 'canvas-bg'],
  ['horizon-mark', 'horizon-sky'], ['horizon-mark', 'horizon-ground'],
];

describe('shared design-system contracts', () => {
  it.each(['light', 'dark'] as const)('%s semantic text pairs retain at least 4.5:1 contrast', theme => {
    const tokens = themeTokens(theme);
    for (const [foreground, background] of textPairs) {
      const ratio = contrast(resolve(`--ds-${foreground}`, tokens), resolve(`--ds-${background}`, tokens));
      expect(ratio, `${theme}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(['light', 'dark'] as const)('%s focus and field boundaries remain distinguishable', theme => {
    const tokens = themeTokens(theme);
    for (const background of ['bg', 'surface', 'surface-raised', 'surface-inset']) {
      expect(contrast(resolve('--ds-focus', tokens), resolve(`--ds-${background}`, tokens)),
        `${theme}: focus on ${background}`).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(resolve('--ds-border-strong', tokens), resolve('--ds-surface-inset', tokens)),
      `${theme}: field boundary`).toBeGreaterThanOrEqual(3);
  });

  it('keeps CSS token references defined across the application', () => {
    const declarations = new Set(stylesheets.flatMap(({ css }) => [...css.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1])));
    // These two values are supplied on the corresponding rendered element, not in a CSS rule.
    const elementValues = new Set(['--cue-color', '--swatch']);
    const missing: string[] = [];
    for (const { path, css } of stylesheets) {
      for (const [, name] of css.matchAll(/var\(\s*(--[\w-]+)/g)) {
        if (!declarations.has(name) && !elementValues.has(name)) missing.push(`${path}: ${name}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('keeps UI palette literals in the shared token file', () => {
    const scattered = stylesheets.filter(({ path, css }) =>
      path !== 'design-system/tokens.css' && /#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i.test(css)).map(({ path }) => path);
    expect(scattered).toEqual([]);
  });

  it.each(['light', 'dark'] as const)('%s legacy semantic aliases resolve to the shared theme', theme => {
    const tokens = themeTokens(theme);
    for (const [oldName, canonical] of [
      ['--p-bg', '--ds-bg'], ['--p-text', '--ds-text'], ['--bg', '--ds-bg'],
      ['--panel', '--ds-surface'], ['--theme-primary', '--ds-primary'],
      ['--theme-on-primary', '--ds-on-primary'], ['--p-danger', '--ds-danger'],
    ]) expect(resolve(oldName, tokens), `${theme}: ${oldName}`).toBe(resolve(canonical, tokens));
  });
});
