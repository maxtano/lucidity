import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Check, Radio, Square } from 'lucide-react';
import { Badge, Button, Card, Notice } from './index';
import './tokens.css';
import './primitives.css';
import './DesignSystemPreview.css';

type Theme = 'light' | 'dark';
const paletteGroups = [
  { label: 'Canvas and surfaces', tokens: ['bg', 'surface', 'surface-raised', 'surface-inset', 'chrome', 'text', 'text-muted', 'text-subtle', 'border', 'border-strong'] },
  { label: 'Primary and accents', tokens: ['primary', 'primary-hover', 'on-primary', 'accent', 'accent-bg', 'accent-border', 'feature', 'feature-bg', 'feature-border', 'feature-text', 'on-feature', 'sage', 'sage-bg', 'mauve', 'mauve-bg'] },
  { label: 'Status and feedback', tokens: ['success', 'success-bg', 'success-border', 'warning', 'warning-bg', 'warning-border', 'danger', 'danger-bg', 'danger-border', 'info', 'info-bg', 'info-border'] },
  { label: 'Interaction and layering', tokens: ['overlay', 'shadow-color', 'focus', 'selection', 'selection-text', 'grid'] },
  { label: 'Fixed-dark canvas, horizon, and axis guides', tokens: ['canvas-bg', 'canvas-surface', 'canvas-text', 'canvas-muted', 'canvas-border', 'canvas-accent', 'horizon-sky', 'horizon-ground', 'horizon-mark', 'axis-x', 'axis-y', 'axis-z'] },
] as const;
const layers = ['navigation', 'chrome', 'menu', 'scrim', 'drawer', 'modal', 'toast'] as const;
const variants = ['primary', 'secondary', 'ghost', 'danger', 'feature'] as const;
const tones = ['neutral', 'info', 'success', 'warning', 'danger', 'feature'] as const;
const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const notices = {
  neutral: 'Your storyboard is saved on this device.',
  info: 'Preview a scene before assigning an aircraft.',
  success: 'The sample schedule passed its checks.',
  warning: 'An edited scene needs another review.',
  danger: 'The example connection is unavailable.',
  feature: 'Inspect the proposed changes before applying them.',
};

function Palette({ theme }: { theme: Theme }) {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    setValues(Object.fromEntries(paletteGroups.flatMap(group => group.tokens.map(token =>
      [token, style.getPropertyValue(`--ds-${token}`).trim()]))));
  }, [theme]);
  return <div className="ds-catalog-palette">
    {paletteGroups.map(group => <div key={group.label}>
      <h3>{group.label}</h3>
      <div className="ds-catalog-swatches">
        {group.tokens.map(token => <div className="ds-catalog-swatch" key={token}>
          <span className="ds-catalog-color" style={{ '--swatch': `var(--ds-${token})` } as CSSProperties} />
          <code>--ds-{token}</code><small>{values[token] || 'Reading token…'}</small>
        </div>)}
      </div>
    </div>)}
  </div>;
}

function LayerScale() {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    setValues(Object.fromEntries(layers.map(layer => [layer, style.getPropertyValue(`--layer-${layer}`).trim()])));
  }, []);
  return <Card className="ds-catalog-card ds-catalog-layers">
    <h3>Layer order</h3><p className="ds-catalog-muted">Navigation stays beneath menus, drawers, dialogs, and notifications.</p>
    <dl>{layers.map(layer => <div key={layer}><dt><code>--layer-{layer}</code></dt><dd>{values[layer] || '…'}</dd></div>)}</dl>
  </Card>;
}

export function DesignSystemPreview() {
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  const [name, setName] = useState('First drone storyboard');
  const [channel, setChannel] = useState('Motor A');
  const [checked, setChecked] = useState(false);
  const focusInput = useRef<HTMLInputElement>(null);
  // This standalone fixture changes only its own document. It never saves a preference.
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return <main className="ds-catalog">
    <header className="ds-catalog-header">
      <div><span className="ds-catalog-eyebrow">LUCIDITY / DESIGN SYSTEM</span><h1>Interface reference</h1><p>Shared colors, controls, and compact layouts. Development preview only.</p></div>
      <div className="ds-catalog-theme" role="group" aria-label="Preview theme">
        <Button variant={theme === 'light' ? 'primary' : 'secondary'} size="sm" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>Light</Button>
        <Button variant={theme === 'dark' ? 'primary' : 'secondary'} size="sm" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>Dark</Button>
      </div>
    </header>
    <nav className="ds-catalog-nav" aria-label="Design system sections">
      <a href="#colors">Colors</a><a href="#controls">Controls</a><a href="#feedback">Feedback</a><a href="#foundations">Foundations</a><a href="#example">Example</a>
    </nav>

    <section id="colors" className="ds-catalog-section" aria-labelledby="colors-heading">
      <div className="ds-catalog-section-title"><h2 id="colors-heading">Colors</h2><p>Neutrals, terracotta, sage, mauve, and semantic states. Values reflect the selected theme.</p></div>
      <div className="ds-color-balance" aria-label="Target color balance: 60 percent neutral base, 30 percent supporting surfaces, 10 percent accents">
        <div><strong>60%</strong><span>Neutral base</span></div>
        <div><strong>30%</strong><span>Supporting layers</span></div>
        <div><strong>10%</strong><span>Accent</span></div>
      </div>
      <p className="ds-catalog-help">A visual hierarchy, not a pixel quota. Keep large areas neutral; use accent for actions, selection and meaningful state.</p>
      <Palette theme={theme} />
    </section>

    <section id="controls" className="ds-catalog-section" aria-labelledby="controls-heading">
      <div className="ds-catalog-section-title"><h2 id="controls-heading">Controls</h2><p>One action hierarchy, consistent sizes, and restrained corners.</p></div>
      <div className="ds-catalog-two-column">
        <Card className="ds-catalog-card">
          <h3>Buttons</h3>
          <div className="ds-catalog-button-table" role="table" aria-label="Button variants">
            <div className="ds-catalog-button-row ds-catalog-table-heading" role="row"><span role="columnheader">Variant</span><span role="columnheader">Enabled</span><span role="columnheader">Disabled</span></div>
            {variants.map(variant => <div className="ds-catalog-button-row" role="row" key={variant}>
              <code role="cell">{variant}</code>
              <span role="cell"><Button variant={variant} size="md">{label(variant)}</Button></span>
              <span role="cell"><Button variant={variant} size="md" disabled>{label(variant)}</Button></span>
            </div>)}
          </div>
          <div className="ds-catalog-sizes" aria-label="Button sizes">
            <Button variant="secondary" size="sm">Small</Button><Button variant="secondary" size="md">Medium</Button><Button variant="secondary" size="lg">Large <ArrowRight size={14} /></Button>
          </div>
          <p className="ds-catalog-help">Tab through the examples to inspect keyboard focus. Disabled controls do not receive focus.</p>
        </Card>
        <Card className="ds-catalog-card">
          <h3>Form fields</h3>
          <div className="ds-catalog-form">
            <label htmlFor="catalog-name">Storyboard name<input ref={focusInput} id="catalog-name" className="ds-input" value={name} onChange={event => setName(event.target.value)} /></label>
            <label htmlFor="catalog-channel">Motor channel<select id="catalog-channel" className="ds-select" value={channel} onChange={event => setChannel(event.target.value)}>{['Motor A', 'Motor B', 'Motor C', 'Motor D'].map(motor => <option key={motor}>{motor}</option>)}</select></label>
            <label htmlFor="catalog-disabled">Disabled field<input id="catalog-disabled" className="ds-input" value="No aircraft assigned" disabled readOnly /></label>
            <label className="ds-catalog-checkbox"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} /> Example selection</label>
            <Button variant="ghost" size="sm" onClick={() => focusInput.current?.focus()}>Focus the name field <ArrowRight size={13} /></Button>
          </div>
        </Card>
      </div>
    </section>

    <section id="feedback" className="ds-catalog-section" aria-labelledby="feedback-heading">
      <div className="ds-catalog-section-title"><h2 id="feedback-heading">Feedback</h2><p>Color supports the label. Every state remains readable without color.</p></div>
      <div className="ds-catalog-badges" aria-label="Badge tones">{tones.map(tone => <Badge tone={tone} key={tone}>{label(tone)}</Badge>)}</div>
      <div className="ds-catalog-notices">{tones.map(tone => <Notice tone={tone} key={tone}><strong>{label(tone)}</strong><span>{notices[tone]}</span></Notice>)}</div>
    </section>

    <section id="foundations" className="ds-catalog-section" aria-labelledby="foundations-heading">
      <div className="ds-catalog-section-title"><h2 id="foundations-heading">Foundations</h2><p>Compact spacing, two corner sizes, and clear text hierarchy.</p></div>
      <div className="ds-catalog-foundations">
        <Card className="ds-catalog-card ds-catalog-type"><h3>Typography</h3><p className="ds-catalog-type-title">Make the next action clear.</p><p>Body text explains what happens and what to do next.</p><p className="ds-catalog-muted">Muted text adds supporting context.</p><p className="ds-catalog-subtle">Subtle text labels optional metadata.</p><code>Motor A · 00:03.000 · 5%</code><small>Sans: <code>--font-sans</code> · Mono: <code>--font-mono</code></small></Card>
        <Card className="ds-catalog-card"><h3>Corners and borders</h3><div className="ds-catalog-corners"><div className="ds-catalog-corner ds-catalog-corner-2"><Square size={18} /><strong>2 px</strong><small>Small controls</small></div><div className="ds-catalog-corner ds-catalog-corner-4"><Square size={18} /><strong>4 px</strong><small>Cards and panels</small></div></div><p className="ds-catalog-help">Border and strong-border tokens separate surfaces without heavy shadows.</p></Card>
        <Card className="ds-catalog-card"><h3>Spacing</h3><div className="ds-catalog-spacing">{[4, 8, 12, 16, 24, 32].map(space => <div key={space}><code>{space}px</code><span style={{ width: space }} /></div>)}</div><p className="ds-catalog-help">Use the compact scale consistently between controls, groups, and sections.</p></Card>
      </div>
      <LayerScale />
    </section>

    <section id="example" className="ds-catalog-section" aria-labelledby="example-heading">
      <div className="ds-catalog-section-title"><h2 id="example-heading">In context</h2><p>Example only. This page never connects to an aircraft or sends commands.</p></div>
      <Card className="ds-catalog-example">
        <div className="ds-catalog-example-heading"><span className="ds-catalog-example-icon"><Radio size={19} /></span><div><span className="ds-catalog-eyebrow">STORYBOARD / ONE DRONE</span><h3>{name || 'Untitled storyboard'}</h3><p>4 scenes · 24 seconds · props-off motor cues</p></div><Badge tone="neutral">Example</Badge></div>
        <Notice tone="info"><Check size={15} /><span>Preview the timeline, assign your drone, then review the run.</span></Notice>
        <div className="ds-catalog-example-actions"><Button variant="secondary" size="sm">Preview storyboard</Button><Button variant="primary" size="sm" disabled>Run storyboard <ArrowRight size={13} /></Button><small>Run is disabled in this catalog.</small></div>
      </Card>
    </section>
    <footer className="ds-catalog-footer">Lucidity interface reference · tokens and primitives are shared with the application.</footer>
  </main>;
}

const root = document.getElementById('root');
if (root) {
  if (import.meta.env.DEV) createRoot(root).render(<DesignSystemPreview />);
  else root.textContent = 'The design system catalog is available in development only.';
}
