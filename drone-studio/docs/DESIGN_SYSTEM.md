# Lucidity design system

Lucidity uses a compact, technical interface: clear action hierarchy, restrained corners, readable metadata, and color that explains state. The same semantic tokens support graphite dark mode and warm cream light mode. Appearance changes must not change project data, aircraft state, or command behavior.

## Source of truth

| File | Responsibility |
| --- | --- |
| [`tokens.css`](../src/design-system/tokens.css) | Palette, theme scopes, typography, spacing, dimensions, motion, layers, compatibility aliases |
| [`primitives.css`](../src/design-system/primitives.css) | Shared button, card, badge, notice, field, and focus treatments |
| [`index.tsx`](../src/design-system/index.tsx) | React `Button`, `Card`, `Badge`, and `Notice` |
| [`ThemeControl.tsx`](../src/platform/ThemeControl.tsx), [`theme.css`](../src/platform/theme.css) | Persistent bottom-left light/dark switch, system preference, and the fixed-dark 3D stage scope |
| [`DesignSystemPreview.tsx`](../src/design-system/DesignSystemPreview.tsx) | Development catalog using the shared implementation |

Open [the development catalog](http://127.0.0.1:5173/test-fixtures/design-system.html) while Vite is running. It previews colors, button variants/sizes, fields, feedback, spacing, and a sample storyboard card. Its theme switch affects that document only; it does not save an appearance preference, connect to an aircraft, or send commands. The entry renders the catalog only in development.

## Color and identity

Define UI palette literals only in `tokens.css`. Components consume `--ds-*` tokens; use `color-mix()` for derived transparency. Do not add a separate light palette inside a component or fix a contrast issue with a new arbitrary hex value.

| Role | Tokens and use |
| --- | --- |
| Surfaces | `--ds-bg`, `surface`, `surface-raised`, `surface-inset`, `chrome`: workspace, panels, hover/raised surfaces, fields, navigation |
| Text and separators | `--ds-text`, `text-muted`, `text-subtle`, `border`, `border-strong`; strong borders identify form controls |
| Primary action | `--ds-primary`, `primary-hover`, `on-primary`; retain the cool gray filled action in dark mode and deep teal action in light mode |
| Selection and emphasis | `--ds-accent`, `accent-bg`, `accent-border`; cool muted accent in dark mode, plum selection treatment in light mode |
| Feature emphasis | `--ds-feature`, `feature-bg`, `feature-border`, `feature-text`, `on-feature`; muted terracotta for a feature banner or distinct show action |
| Secondary identities | `--ds-sage` / `sage-bg` and `--ds-mauve` / `mauve-bg`; restrained complementary color |
| Status | `--ds-success`, `warning`, `danger`, `info`, each with `-bg` and `-border`; pair the foreground with its matching background |
| Interaction | `--ds-focus`, `selection`, `selection-text`, `overlay`, `shadow-color`, `grid` |

App identities are Home neutral, Tools primary/accent, Drone Show terracotta, Music smoked mauve, and Code sage. They identify destinations; they do not replace status meaning. Use text or an icon alongside every status color. A success badge describes a specific completed check, never unverified physical movement or overall flight readiness.

## 60–30–10 color balance

Apply the same hierarchy in Home, Tools, Music, Drone Show, Code, and shared dialogs:

- **60% dominant neutral:** graphite in dark mode; warm paper/ivory in light mode.
  `bg` and `surface` cover the main working area, reading surfaces and ordinary cards.
- **30% supporting neutrals:** charcoal or linen/taupe layers. Use `chrome` for
  navigation, `surface-inset` for grouped content and fields, and `surface-raised`
  for secondary controls, toolbars and hover. Separate layers without colored washes.
- **10% emphasis:** primary actions, current selections, app identity icons, narrow
  accent borders, focus, and meaningful status. Mauve, sage and terracotta remain
  complementary accents; they must not fill entire repeated card grids.

This is a composition target, not a literal pixel quota or a requirement to add
color until 10% is filled. Dense editors, warnings and authored visual data differ.
Do not weaken status or focus contrast to satisfy a percentage. Preserve the dark
3D stage and authored scene colors as the documented data exception below.

Generic pills and card backgrounds are neutral. Music retains mauve notes and a
small, glossy hardware-play action with theme-specific, contrast-checked colors.
The Show starter uses a neutral panel, a terracotta edge, and a focused action.
The development catalog demonstrates the 60/30/10 proportions beside the tokens.

## Appearance control

The persistent **bottom-left sidebar footer** owns the light/dark switch. In the
collapsed desktop rail it is a sun/moon icon with an accessible name and tooltip;
expanding the rail shows the mode label, switch track, and **Use system appearance**.
On mobile it is at the bottom of the navigation drawer. The app dropdown remains
an app selector. Switching appearance preserves the current app, connection,
unsaved drafts and creative content. Explicit preference persists across reloads;
system mode follows OS changes; other tabs receive preference updates.

## Type, spacing, and geometry

| Foundation | Contract |
| --- | --- |
| Fonts | `--font-sans`: Manrope; `--font-mono`: system monospace for time, identifiers, and measured values; `--font-editorial`: Libre Baskerville for limited editorial accents |
| Type | `--text-base`: 13px body; `--text-xs`: 11px metadata; `--text-sm`: 12px compact controls; `--text-lg`: 16px; `--text-title`: 28px |
| Rhythm | Body line height 1.6, tight labels 1.3; weights 400/500/600 |
| Spacing | `--space-1/2/3/4/5/6/8/10/12`: 4/8/12/16/20/24/32/40/48px. Use 8px within a control group, 12–16px between related fields, 24px for panel padding/sections |
| Corners | `--radius-control`: 2px; `--radius-panel`: 4px. Circles remain appropriate for actual circular diagrams and status dots |
| Borders | `--border-width`: 1px; separate surfaces before adding a shadow |
| Controls | `--control-md`: 40px default; `--control-sm`: 32px dense desktop controls; `--control-lg`: 44px large/coarse-pointer targets |
| Icons | `--icon-sm/md/lg`: 14/16/20px; icons support labels and do not substitute for accessible names |

Small SVG `viewBox` labels are diagram coordinates, not CSS font-size declarations. A numeric SVG label below 11 units can be appropriate when the diagram scales it to a readable size. Essential values must also be available as readable text or an accessible description; do not make a tiny diagram annotation the only instruction.

## Shared controls

`Button` supports `primary`, `secondary` (default), `ghost`, `danger`, and `feature`; sizes are `sm`, `md` (default), and `lg`. It defaults to `type="button"`, so form submission must be explicit. Use one primary action per decision group, secondary for alternatives, ghost for low-emphasis navigation, and danger for an action with destructive consequences.

Hover, pressed, keyboard focus, disabled, and `aria-busy` appearances are defined centrally. Disabled controls use reduced opacity and a noninteractive cursor. Explain a blocked action beside the control. **`aria-busy` does not disable activation:** the caller must prevent duplicate requests and keep cancellation available when needed. The primitive does not provide a spinner or manage asynchronous work.

```tsx
import { Badge, Button, Card, Notice } from '../design-system';

export function StoryboardSummary({ onReview }: { onReview: () => void }) {
  return (
    <Card>
      <Badge tone="feature">Storyboard</Badge>
      <h2>First motor sequence</h2>
      <Notice tone="info">Review the authored cues before assigning a drone.</Notice>
      <Button variant="primary" onClick={onReview}>Review run</Button>
    </Card>
  );
}
```

Forms use native elements with `.ds-field`, `.ds-input`, `.ds-select`, and `.ds-textarea`; there is no separate React field wrapper. Essential field boundaries use `--ds-border-strong`, including search, home-intent, and agent-composer wrappers whose inner input border is removed. Associate visible labels with controls, describe units and valid ranges, and link help/error text using `aria-describedby`. Set `aria-invalid="true"` for an invalid field and provide a textual explanation. Placeholders are supporting examples, not labels. Checkbox/radio labels should be clickable; preserve native keyboard operation.

`Badge` and `Notice` support `neutral`, `info`, `success`, `warning`, `danger`, and `feature`. A badge summarizes; a notice explains an actionable state. Callers choose `role="status"` for new nonurgent feedback or `role="alert"` for an urgent new error. Static guidance should not announce itself repeatedly. These primitives do not infer live-region behavior.

## Layout and accessibility

- **Navigation:** keep the current destination visibly selected and programmatically identified. Preserve app names when color is absent. Mobile navigation may collapse, but selected state and keyboard access must remain available.
- **Tables:** use real table headers for tabular data, align comparable values, expose units, and distinguish selection from hover. Keep dense row actions at least 32px; use horizontal scrolling or a deliberate narrow layout instead of clipping values.
- **Dialogs:** use surface, border, overlay, and dialog-shadow tokens. Name the dialog, move focus into it, contain modal focus, and return focus on close. Scrolling content must not hide a required Stop/Cancel action. `Card` supplies appearance, not dialog semantics or focus management.
- **Layers:** `--layer-navigation/chrome/menu/scrim/drawer/modal/toast` are 90/100/120/140/150/200/300. Global shell, menu, drawer, modal, and toast declarations use these tiers. Local diagram layers may use small local indices. Inspect the stacking context instead of increasing z-index to solve an isolated overlap.
- **Contrast:** target at least 4.5:1 for supported text/background pairs and 3:1 for focus indicators and essential field boundaries. `--ds-focus` uses a 2px outline with a 3px offset. Do not remove focus without an equally visible replacement. Disabled controls are intentionally subdued and are not evidence that enabled text can use the same contrast.
- **Responsive behavior:** wrap action groups and collapse columns before labels become unreadable. Coarse-pointer controls use 44px minimum targets. Keep critical hardware instructions readable at narrow widths and browser zoom.
- **Motion:** use 120/180ms transitions with the shared easing for unobtrusive state changes. Respect `prefers-reduced-motion`; remove decorative transitions and smooth scrolling. A transition must never stand in for acknowledgement, progress, or measured telemetry.

## Canvas and data exceptions

The 3D `.stage` remains a dark rendering environment in both appearances. Its chrome uses `--ds-canvas-bg/surface/text/muted/border/accent`; horizon and axis guides use the named `--ds-horizon-*` and `--ds-axis-*` tokens. Surrounding editors and dialogs still follow the selected appearance. Schematic interface artwork uses semantic theme tokens without changing its geometry.

Authored light RGB values, show palettes, imported artwork, and measured visualization colors are **data**, not UI palette definitions. Preserve those values when changing appearance. Document any additional fixed rendering palette at its boundary; do not spread canvas exceptions into normal controls.

## Compatibility and verification

The central alias boundary maps older `--p-*`, `--bg`, `--panel`, `--line`, `--muted`, `--accent`, and `--theme-*` names onto the semantic tokens. Existing class names can therefore migrate incrementally. New component styles should prefer `--ds-*`; lazy styles and body portals must inherit the same root appearance. Do not redeclare local theme palettes or depend on a second light-only correction sheet.

[`design-system.test.ts`](../src/design-system/design-system.test.ts) checks supported light/dark contrast pairs, focus and field-boundary contrast, CSS token definitions, palette centralization, and selected compatibility aliases. Run it with `npm test -- src/design-system/design-system.test.ts`; run `npm run build` after integration.

These are static token/CSS contract checks, not a browser cascade simulation or a full accessibility audit. The catalog also does not cover every application state. Review representative pages, portals, keyboard focus, narrow layouts, zoom, and both appearances in the browser. Record that evidence separately; visual validation does not establish aircraft-command or physical-flight correctness.


## Review evidence — October 16, 2026

The integration review inspected all five app areas in dark and cream appearances, disconnected parameter/firmware forms, storyboard motor preview, Run storyboard and Scene source dialogs, and dark 3D preview controls inside the light workspace. Home, library, new-storyboard dialog and navigation were checked at 320/390px. Inspected views had no document horizontal overflow; inspected Music/Run controls and dialogs had no corner above 4px. The catalog's two themes and keyboard focus were checked separately. Screenshots are in `docs/screenshots/design-system-*.png`.

The full 1,232-test suite passed with two workers, including eight new design-system contracts. Two existing heavy tests timed out in the initial concurrent default-worker run and passed in that full rerun without a timeout change. TypeScript and the production build pass. These checks cover representative states, not every interaction or a complete accessibility audit. No physical command or saved creative-content edit was performed for the visual review.

## Color balance review — October 17, 2026

Applied the 60–30–10 hierarchy to the shared palette, navigation, Music cards and
setup, and the Drone Show starter panel. Large decorative color fills are now
neutral layers; app accents identify selections and actions. Added the persistent
bottom-left appearance switch and a matching balance reference in the catalog.

Browser review covered Home, Tools, Music, Drone Show and Code in both themes,
the new-storyboard dialog, and mobile navigation at 390px and 320px. Inspected
pages had no horizontal document overflow. The switch has a 44px target, exposes
its state to assistive technology, works by keyboard, persists after reload, and
updates other open tabs. Screenshots: `docs/screenshots/color-balance-*.png`.

All 18 focused appearance, design-system and StudioHome tests pass, including
expanded contrast pairs and all three hardware-play gradient stops. TypeScript
and the production build pass. These are representative visual and contract
checks, not a complete accessibility audit. Existing creative work was preserved;
no aircraft commands were sent during this review.
