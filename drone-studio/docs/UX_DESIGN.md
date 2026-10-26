# Lucidity interface direction

The code-backed [design system](DESIGN_SYSTEM.md) is the current authority for colors, controls, geometry, focus, and appearance. Its tokens replace the older page-specific palettes described in the historical design notes below. The preserved primary is complemented by muted terracotta, sage, and smoky mauve; light mode uses warm cream and ivory.

Visual system implemented October 14, 2026; app navigation and enterprise visual refinement revised October 15; daylight appearance and copy discipline added October 16. This is the visual and interaction companion to [WORKSPACE.md](WORKSPACE.md), which remains the source for product scope and device support.

## Intent

Lucidity should feel like a precise, professional workspace that understands hardware. Someone connecting their first drone should see a clear next step. Someone who knows exactly which parameter they need should be able to go straight to it. Both should stay in the same workspace, with the same connection context and access to the agent.

The visual direction is graphite, steel, and restrained lilac: serious, quiet, and clearly structured. Manrope handles the interface. Libre Baskerville adds character to selected headlines. Corners never exceed 4px; most controls use 2px. Fine borders, original grain and grid textures, and a deliberate type hierarchy carry the identity. Decoration never stands in for aircraft data.

## What the existing tools taught us

The research combined official documentation with a visual review of the web interfaces. These are design interpretations, not claims that Lucidity already implements every referenced protocol or workflow.

| Reference                                                                                                                    | Useful pattern                                                                                                                                                                     | Lucidity decision                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [QGroundControl UI overview](https://docs.qgroundcontrol.com/master/en/qgc-user-guide/getting_started/ui_overview.html)      | A persistent toolbar maintains vehicle context while the main views change. Setup uses a checklist; configuration depends on firmware.                                             | Keep connection status in the shared sidebar footer. Separate broad purposes into five destinations, then expose detailed tools inside Tools. Always show current integration support.                    |
| [Betaflight App](https://betaflight.com/docs/wiki/app)                                                                       | Named subsystems give experienced operators direct access to configuration. The documented tabs span ports, power, tuning, receivers, modes, motors, OSD, lighting, logs, and CLI. | Preserve comprehensive coverage, searchable by task and parameter prefix. Group the navigation into Connect & update, Configure, Test & tune, and Extend & inspect. Do not force every task through chat. |
| [Betaflight firmware flasher](https://betaflight.com/docs/wiki/app/firmware-flasher-tab)                                     | Board selection, firmware preparation, backup, flashing, and reconfiguration are distinct concerns.                                                                                | Present ESP flashing as identify board → choose image → review and flash. Show pending targets explicitly. Keep file preparation separate from writing to the device.                                     |
| [ESC Configurator](https://esc-configurator.com/) and its [source repository](https://github.com/stylesuxx/esc-configurator) | Connection controls remain visible. Its melody editor offers preset selection, editing, saving, and computer playback separately from ESC operations.                              | Music has a library, an editable sequence, a score derived from the notes, computer preview, and export. Motor playback remains visibly unavailable until its adapter exists.                             |
| [Espressif ESP Launchpad](https://espressif.github.io/esp-launchpad/)                                                        | The entry screen distinguishes Quick Start, DIY, and Console, with connection as an explicit step.                                                                                 | Offer a guided path for the first connection alongside direct parameter and code workspaces. Explain physical steps in plain language without hiding technical controls.                                  |

The October 15 refinement also uses [Hex](https://hex.tech/) as a visual reference: its fine grid, textured surfaces, typographic contrast, and restrained framing informed this interpretation. Lucidity retains its own dark palette, Manrope / Libre Baskerville pairing, artwork, and navigation. No Hex assets were copied.

These sources inform structure and interaction. The Lucidity artwork and interface are original; this pass does not vendor configurator source code.

## Navigation and page responsibilities

Home, Tools, Music, Drone Show, and Code are separate apps in one workspace. A compact selector at the top of the left sidebar switches apps; there is no permanent row of global tabs or separate device-status bar. The active app owns the navigation below the selector. The canvas uses the full desktop height.

| App        | Sidebar content                                                                |
| ---------- | ------------------------------------------------------------------------------ |
| Home       | Overview, browse apps, agent entry, and setup shortcuts                        |
| Tools      | All tools and the four groups of configuration sections                        |
| Music      | Melody composer, starter motifs, and saved tunes                               |
| Drone Show | Storyboards, the current project, scenes, design checks, audio, and show tools |
| Code       | Editor, terminal, and workspace files                                          |

The sidebar replaces each app's former nested navigation panel. Connection state, aircraft selection, and the workspace agent control sit at its bottom. Collapsing it leaves a 64-pixel rail with the app selector, expand control, connection access, and agent toggle. The collapse preference is saved locally when storage is available.

- **Home:** explain the workspace, connect a drone, describe a task, or enter one of the four work areas. The prompt field prepares a request in the agent for the user to send. It does not silently transmit a request or execute a device operation.
- **Tools:** 18 tool areas arranged into four task groups. Search matches capabilities as well as names. Group filters and the available-integrations filter help narrow the catalog. Tool detail screens retain feature scope and firmware labels. A feature-scope list describes coverage; it is not a checklist of completed operations.
- **Music:** create and edit a startup melody. The score represents the current pitches and durations, including rests. Changing the notes changes the score. Browser playback and motor playback have different, explicit labels.
- **Drone Show:** open real saved storyboards, create or import a storyboard, preview motion, and enter the existing bench workflow. Decorative formation artwork is marked as a study and does not pretend to depict a saved show.
- **Code:** edit workspace files and review local commands. Code, filenames, parameter keys, checksums, and terminal output use monospace. The editor and terminal remain practical work surfaces.

The workspace agent is available from every app, with its toggle and keyboard shortcut in the sidebar footer. It opens by default on wide desktops in Home, Tools, Music, and Code. Drone Show starts with more canvas space and keeps its creative assistant inside the editor. The workspace agent can still be opened there; each app remembers whether its panel was open during the session. Opening a prepared request focuses the composer. Closing the panel returns focus to its toggle. Local guidance and a configured AI provider are labeled separately.

## Visual system

| Role           | Value     | Use                                   |
| -------------- | --------- | ------------------------------------- |
| Canvas         | `#111315` | Main workspace                        |
| Surface        | `#191C1F` | Cards and panels                      |
| Raised surface | `#23272B` | Hover and selected surfaces           |
| Border         | `#343A40` | Quiet structural divisions            |
| Primary text   | `#E8E9E8` | Titles, labels, values                |
| Secondary text | `#ABB2B9` | Explanations and supporting text      |
| Tertiary text  | `#939DA6` | Metadata and secondary navigation     |
| Steel blue     | `#B3CDD2` | Primary actions and hardware controls |
| Lilac          | `#C6BFD4` | Agent and music identity              |
| Success        | `#89D9B8` | Actual positive device state          |
| Warning        | `#E6BC81` | Attention or a condition to review    |
| Error          | `#F1A89F` | Errors and stop actions               |

The shell color tokens live in `src/platform/platform.css`. Shared radius and texture tokens live on `:root` in `src/styles.css`, so lazy studio panels and dialogs portaled outside the shell use the same geometry. Warm errors, warnings, and actual positive device state retain distinct colors. Primary workspace actions use a pale neutral fill; subdued blue, lilac, and green identify app context.

### Daylight appearance

The app selector contains **Appearance → Light / Dark / System**. System is the initial preference. An explicit choice is remembered locally, follows the user between app views and responsive layouts, and synchronizes across open tabs. The system option responds to operating-system appearance changes. Storage restrictions fall back to a session choice. Appearance changes do not reset editors, reconnect devices, or send hardware commands.

Light mode uses a warm paper canvas (`#F8F5EE`), ivory panels (`#FFFDF8`), and cream inset surfaces (`#F3EEE5`). Warm plum ink, taupe dividers, and smoky plum selections replace the cool gray and blue wash. The existing deep blue primary action stays recognizable, with terracotta, sage, and mauve as complementary colors. This is a warm off-white workspace, informed by the [Hex reference](https://hex.tech/), with faint grid artwork and no grain over working surfaces. Manrope and the existing 2px/4px corner system remain consistent. The phone Home hides the decorative drone study to give the prompt and controls more space. The show renderer retains its authored scene colors and dark preview overlays; its editor and hardware panels follow the selected theme.

| Light role | Color | Measured contrast |
| --- | --- | --- |
| Main text on ivory | `#312B33` on `#FFFDF8` | 13.56:1 |
| Supporting text on sidebar | `#51494F` on `#F3EEE5` | 7.52:1 |
| Supporting text on ivory | `#51494F` on `#FFFDF8` | 8.55:1 |
| Selected labels | `#59425B` on `#EEE4EE` | 7.20:1 |
| Primary action | White on `#174F63` | 8.99:1 |
| Field boundary on cream | `#8E7F74` on `#F3EEE5` | 3.34:1 |

These are palette measurements, informed by W3C guidance for [enhanced text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html) and [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). They are not an app-wide accessibility certification or a physical sunlight test. Critical hardware instructions and form labels use 12–13px type; main actions are at least 40px high, and mobile navigation is 44px high. Dense timeline metadata and decorative diagram annotations remain smaller.

`src/design-system/tokens.css` is the palette source of truth; its light block owns this cream appearance. `src/platform/theme.css` imports the shared tokens and primitives, styles the appearance control, and scopes the fixed dark 3D preview. The browser theme color reads `--ds-bg`. The former `light-surfaces.css` override bridge is retired. `workspace-refinement.css` owns shared type and spacing refinements. New components should use semantic `--ds-*` tokens; existing `--p-*` and studio aliases resolve to the same system. Avoid separate hardcoded palettes or broad light-only selector overrides. Keep input border width/style separate from theme colors so borderless fields remain borderless.

### Copy discipline

- Use one title per screen and one descriptive label per action. Avoid slogans, uppercase promotional eyebrows, and subtitles that restate the title or adjacent control.
- Home is Workspace, Ask Lucidity, and Apps. App cards carry one short description. Tools, Music, and Code use their names as headings.
- Keep feature coverage in **Capabilities**, integration coverage in **Supported integrations**, the workspace path in **Workspace folder**, and setup help in an appropriate disclosure. Expert detail stays reachable without filling the initial view.
- Keep observed device state, unavailable operations, consequences of a write, meaningful errors, and physical prerequisites visible. Do not remove these just to make a screen shorter.
- Empty states name what is missing. Explain the next action once; do not repeat it in the header, card body, and footer.

### Corners, surfaces, and texture

- `--radius-control: 2px` for buttons, fields, navigation items, and compact icons. `--radius-panel: 4px` is the maximum for cards, menus, dialogs, and larger panels. Existing 0–3px details may stay smaller. Do not reintroduce pill buttons, large circular avatars, or soft card corners. Circles in aircraft illustrations, diagrams, and real visualizations describe geometry rather than container styling.
- Use flat graphite fills and one-pixel dividers to establish hierarchy. Reserve shadows for floating menus and dialogs; avoid glows, lifted cards, and decorative gradients on working surfaces. Hover feedback changes fill and border, without moving the target.
- The original local `public/textures/grain.svg` supplies a static, low-opacity grain tile. CSS grid patterns frame the aircraft study, workspace illustrations, and motor diagrams. Textures sit in backgrounds, never on interactive overlays or over data-table text. Dense fields and editors stay clear.
- Keep the app selector and contextual sidebar compact. Home and agent copy should describe the task, context, and next step; avoid promotional slogans in the operational interface.

### Typography

Manrope is the primary font, including buttons, labels, navigation, and body copy. Use regular or medium weight for reading, semibold for emphasis, and heavier weight sparingly. Libre Baskerville italic is an accent for large, expressive headings; it never carries parameter values, operating instructions, or dense controls. System monospace identifies exact technical information.

Both font families are bundled under `public/fonts`, with their SIL Open Font Licenses and a source/checksum manifest. Font loading uses local WOFF2 subsets and `font-display: swap`. No Google Fonts request is needed at runtime.

### Artwork and motion

The Lucidity mark uses an eight-direction star around a diamond. The home illustration is an original SVG quadcopter study with a fine rectangular grid and engineering annotations. Workspace cards share a coordinated family of chip, waveform, light-formation, and code motifs. The SVGs remain sharp at different screen sizes and add no image download dependency.

The drone study is decorative and independent of telemetry. The melody score is a real visualization of editable tune data. Neither produces invented connection states, sensor readings, progress, or success indicators.

Movement is limited to necessary activity indicators. Hover feedback changes color and border without lifting cards; the decorative aircraft and textures are static. Reduced-motion preferences remove animation and transitions.

## Interaction rules

1. **One obvious next step.** Setup explains who acts: the user plugs in the radio, Lucidity checks the link, and the user reviews the readings.
2. **Technical depth stays reachable.** Raw parameters and terminal access remain available alongside the agent.
3. **Show state in words.** Color supports a label; it does not carry connection, availability, or execution state alone.
4. **Do not disguise unsupported operations.** Planned integrations have explicit labels, hollow markers, and a description of what remains to be connected.
5. **Keep hardware reviews concrete.** Existing motor checks, parameter readback, and firmware review requirements remain part of the corresponding action flow.
6. **Preserve context.** Connection context stays in the shell. Switching back to Tools restores its last section; Music, Code, and Drone Show stay mounted so unsaved melodies, code drafts, terminal input, and show editing state survive switching. Audio pauses when its app becomes inactive. Hardware forms retain their existing reset behavior.
7. **Keyboard access matters.** The selector uses real links, focuses the current app on open, and supports Tab, arrow keys, Home/End, and Escape. Escape restores its trigger; clicking outside dismisses it. Visible focus, named controls, a skip-to-workspace link, and `Cmd/Ctrl+J` remain available. Mobile navigation traps focus while open, makes the canvas inert, and restores focus to its opener when dismissed. Choosing a section closes the drawer and focuses the workspace. Show shortcuts do not intercept navigation keys.

## Responsive behavior

Above 760 pixels, a 224-pixel sidebar contains app identity and independently scrolling local navigation; its footer stays reachable. The main workspace and agent scroll independently. At 1180 pixels and below, the agent overlays the workspace. On phones, a 58-pixel row contains the navigation opener, app selector, and agent toggle; local navigation opens in a drawer. Container queries adapt content to the actual remaining canvas width, including when the agent is open. Data tables keep their own horizontal scroll.

The app should stay readable with the agent open, after loading the lazy Drone Show editor, and when navigating back from any workspace. The workspace agent uses distinct `dock-*` classes so studio-specific assistant styles cannot change it after lazy loading.

## Verification boundary

The daylight revision checks all five app surfaces, disconnected parameter and firmware forms, the saved motor storyboard, its run dialog, and the 3D preview chrome. Responsive checks covered Home and Tools at 390 pixels, parameters at 320 pixels, and desktop views at 1280 pixels, with no document-level horizontal overflow in those checks. Appearance persists after reload, synchronizes between tabs, follows System, and survives desktop/mobile remounts. App-menu arrows and Escape focus restoration were checked. The four focused appearance tests and the production build pass. Proof images are in `artifacts/daylight-design/`. Physical sunlight, device playback, flashing, and motor operation are outside this visual verification.

The enterprise refinement checks all five apps, disconnected parameter/firmware/motor surfaces, the Show editor and source dialog, app selectors, and 320/390/1280/1800-pixel layouts. Computed-style audits find no UI corner above 4px in the inspected views, including the portaled Show dialog. The production build passes. This is a presentation change; no hardware command or saved creative-content edit is part of its review.

The navigation revision checks app selection, remembered sections and drafts, collapsed rails, modal layering, keyboard focus, and 320/390/820/1280/1800-pixel layouts. The broader design pass exercises browser navigation, prompt handoff and focus, catalog filters, melody editing and score changes, the disconnected setup/parameter/firmware states, and responsive layouts. It does not connect a flight controller, change parameters, flash a board, or spin a motor. Those capabilities retain their existing implementation and verification requirements described in WORKSPACE.md.
