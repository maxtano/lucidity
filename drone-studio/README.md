# Lucidity

One local workspace for drone setup, configuration, programming, motor music, and show design. Switch between **Home, Tools, Music, Drone Show, and Code** using the app selector at the top of the left sidebar. Each app has its own contextual navigation, with connection controls available throughout. This folder is self-contained and leaves the neighboring CAD work untouched.

Tools contains 18 searchable workspaces, including a real ArduPilot parameter reader/editor with explicit readback verification, guided telemetry checks, and the existing bounded motor sample. Music composes and previews tunes on the computer. Code provides a local file editor and explicitly reviewed commands; the firmware tool invokes a local esptool installation for ESP boards. The existing storyboard studio is preserved under Drone Show.

**This is not yet full Betaflight/QGroundControl/ESC Configurator parity.** Unsupported protocol adapters are marked in the interface. See [workspace mission, feature coverage, API behavior, verification and next work](docs/WORKSPACE.md).

The interface uses locally bundled Manrope and Libre Baskerville, a cool midnight/cyan/lilac palette, and grouped tool navigation. See [UX design and tooling research](docs/UX_DESIGN.md).

## Run

Use **Node 22 LTS (22.12+) or Node 24+**. With nvm, `nvm use` selects the version in `.nvmrc` (install it first if needed).

```bash
cd drone-studio
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. The server binds to loopback only.

For dependency updates, use npm 11+; older npm versions hit a peer-resolution bug with the current test toolchain. `npm ci` uses the supplied lockfile.

```bash
npm test
npm run build
npm run preview
npm run benchmark
```

For local review-file import checks, `node --import tsx scripts/frame-artifact-fixture.ts /tmp/lucidity-review-fixtures` writes three clearly synthetic fixtures into a new directory: a valid PNG review, a changed checksum, and invalid compressed image data with otherwise correct checksums. It never reads or changes the editor's saved show, and refuses to overwrite existing fixture files.

## Try the expert workflow

Open **Drone Show** to open a saved storyboard, create a **New storyboard**, import a separate copy, or enter **First drone test**. Storyboards are saved independently on this device; creating a new one preserves your existing shows. Audio files must be attached separately after switching storyboards.

An opened storyboard uses **Viewer 360°**, at a 1.7 m eye height and the center of the authored space. A reference stage sits 70 m north. Drag to look freely around the full horizon; with the canvas focused, the arrow keys turn your view and **Home** faces the stage. **Stage**, **Behind**, and **Sky ↑** provide quick orientation, alongside left/right views. Your position stays fixed while looking around.

**Select from view** finds active drones at the captured show frame using the camera frame, stage-relative Front/Right/Rear/Left, or Overhead, combined with lights On/Off/Either. Search the fleet or filter your current selection. **Find drones** produces a complete, historical result; **Replace selection** or **Add to selection** explicitly transfers all matching IDs to the existing inspector. Add is a union, so matching already-selected IDs stay selected. Empty Replace clears selection. This does not edit choreography or create undo history. Geometric camera inclusion is not a claim about occlusion or perceived visibility; flashing lights can change membership at another time.

Choose **Preview matches** to see thin rings around every match, including dark lights, before changing selection. Membership stays fixed to the captured query while the rings follow those drones at the current show time. The card shows both times and offers Hide/Show, Clear, Replace, and Add. **Captured result → Recall query view and time** explicitly returns to the query pose and clock. Design temporarily hides the audience markers; editing the show clears the captured target. Markers do not change light channels or enter rendered review exports.

Choose **360° study** in the viewer toolbar to explore **All around you**: 1,200 authored lights in wrapping sky ribbons and an overhead crown, across three 16-second chapters. It opens as a separate read-only, silent preview with its own playback and scrubber; your current show stays open and its music is paused. Look behind and overhead, jump between chapters, or download the editable show. The 120 BPM grid is part of the design; no soundtrack is embedded. Its generator is [scripts/immersive-example.ts](scripts/immersive-example.ts).

Open **Viewer position and lens** for Center/Rear/Left/Right audience positions, custom East/North coordinates, eye height, and field of view. In the **Venue plan** tab, drag the viewer or reference stage, or use the focused plan controls' arrow keys, to place either within ±500 m East/North. Set the stage's front-facing compass heading from 0° to 359°; its default 180° faces south toward the audience origin. Scroll over the 3D view changes its field of view. The ground, stage, audience silhouettes, and cinematic bloom give the lights a human scale; these controls do not move drones or modify the show.

Use the **Saved views** tab to save up to **12 named views per project** on this device, with names up to 48 characters. Each explicit save captures the exact viewer position, eye height, look direction, vertical field of view, and reference stage position/heading. Recall returns to that view at the current playhead; Remove deletes the bookmark. Time and appearance settings are not included. There is no viewpoint autosave or automatic recall after reopening; bookmarks are separate from the show file. Unrecognized or malformed saved-view data is preserved and reported as an error.

**Audience camera audition** rehearses a move from the current camera or a saved view to another saved view. Choose 1–30 seconds and Smooth or Linear motion, then **Prepare camera move** and **Play**. Preparation does not move the camera; its owned endpoints stay fixed until you prepare again. Scrub, pause, return to Start, or replay independently of show playback. Position, eye height, direction, and lens interpolate while the reference stage stays fixed, so both views must use the current stage layout. Dragging, arrow keys, wheel zoom, direction buttons, or other camera edits take over and clear the move. Closing the panel pauses it. Design clears it. Moves are session-local viewing controls, separate from choreography, history, and export. Frame capture pauses both clocks.

With a move prepared, **Analyze move** opens a sampled composition report. Choose the show start/end and 2–12 samples; equal show times hold the choreography while the camera moves. Run records the prepared path, current aspect, exact camera/show sample times, and geometric/light counts. Results include minimum, maximum, and sampled-mean lit lights in frame. Inspect explicitly recalls one sampled pose and seeks that Stage's show clock, clearing the camera rehearsal. Running analysis itself does not move the view. Cancellation or an invalid rerun preserves the previous report; show edits mark it stale. Counts describe geometric samples, not rendered pixels, occlusion, continuous coverage, or perceived quality.

**Compare views** samples one to four current/saved viewpoints over a scene or custom show range. Choose 2–12 equally spaced moments, including the endpoints, and compare the minimum, maximum, and sampled mean of lit drones inside each camera frame. Select a view's row for directional counts at each moment; **Inspect** restores that captured pose and seeks to the moment. The calculation runs in a cancellable worker and leaves the show untouched. These are discrete geometric samples, not continuous visibility or occlusion analysis. Comparison also works inside the separate study.

1. Open Show settings → **Open the expert study** for 800 explicitly authored, animated points. Its generator is [scripts/expert-example.ts](scripts/expert-example.ts).
2. In **Design** mode, click a light or box-select a group. Shift adds/removes IDs; the inspector also accepts ranges such as `1, 4, 10-20`.
3. Move, rotate, or scale the selection with the viewport gizmos. Enter exact ENU coordinates, colors, brightness, flash frequency, duty, and phase in the inspector.
4. Capture a key, scrub forward, and move/recolor again. Auto key writes at the playhead. Drag the diamonds on the drone’s timeline lane to retime them; select linear, smooth, or hold interpolation.
5. Open **Scene source** to inspect or directly edit point/channel data. Each application is atomic and undoable.
6. Drag scenes to reorder and their right edge to ripple trim. Beat snapping, frame precision, timeline zoom, and undo/redo are available.
7. In the scene inspector, choose transition easing, set beats, or retime the scene with independent controls for scaling keys and the incoming blend. Use Motion feedback for explicitly scoped speed estimates.
8. Return to **Viewer 360°** to experience the result from eye level. Adjust bloom/exposure and use **F** for a larger focused viewer. Import music and export editable JSON or a sampled preview CSV.

Space plays/pauses. Outside the focused Viewer 360° canvas, left/right step one 30 fps edit frame and Shift steps one second. In the viewer, arrows look in 5° steps, or 15° with Shift. Cmd/Ctrl+Z undoes; Shift+Cmd/Ctrl+Z redoes. Shift bypasses snapping during a trim/key drag. Alt+left/right moves a focused scene earlier/later. Escape cancels a timeline/transform gesture or exits the focused viewer. **Design** retains orbit/front/top cameras, selection, and transform gizmos.

Fleet size remains editable in Show settings from 1 to 100,000. Reducing the count retains edits on inactive IDs; growing it restores them. Key times are local to a scene and move with it. First/last keys extend to the scene edges. Keys outside a shortened scene remain in the document. A keyframed channel overrides its base value, so keep Auto key on when changing an animated property.

Projects autosave locally; history and imported audio do not survive reload. Browser storage is bounded, so use JSON export for larger work. The example is an artistic study with design-stage conflicts, not a flight mission.

## Documents to review

- [Lucidity platform product brief](docs/PRODUCT_BRIEF.md)
- [Expert personas, problems, and workflow research](docs/PRODUCT_DISCOVERY.md)
- [Drone Show workspace direction and scope](docs/PRODUCT.md)
- [Technical architecture and scaling plan](docs/TECHNICAL.md)
- [Existing software and research sources](docs/RESEARCH.md)
- [Historical agent tooling research](docs/AGENT_RESEARCH.md)
- [Historical agent harness design](docs/AGENT_HARNESS.md)
- [Synthetic agent editing evaluations](docs/AGENT_EVALUATIONS.md)
- [Transition and speed editing](docs/TRANSITIONS.md)
- [Iteration log and next work](docs/ITERATION_LOG.md)
- [Verification record](docs/VERIFICATION.md)

## Machine-readable show editing

```bash
npm run --silent agent -- --help
npm run --silent agent -- --tools
npm run --silent agent -- --brief "Create a 96 second cosmic show with 1200 drones"
npm run --silent agent -- --command '{"type":"set_fleet","count":1200}' --validate
npm run --silent agent -- --project show.lucid.json --expected-revision 3 \
  --commands-file operations.json
```

The CLI outputs JSON (or CSV with `--csv`), does not alter input files, and returns a nonzero exit code with a JSON error on failure. [Tool contract](docs/agent-tools.json). Human and agent edits share atomic commands for arbitrary points, light channels, and keyframes; validation protects document integrity rather than restricting geometry to presets. The CLI `--brief` remains a limited template interpreter. The built-in AI assistant and its browser/server endpoints have been removed. The provider adapter, CLI, and synthetic evaluation harness remain dormant relative to the app for reproducible development checks; a model call is possible only by explicitly running a live CLI evaluation.

## Current boundaries

This is a working **design and simulation MVP** with a guided **Test on drone** bench workflow: open the built-in one-drone sample, connect and assign an aircraft, review, run, and record your observation. No export is needed for this direct connection. The local Node service connects one selected Mac USB serial radio at 115200 baud, receives MAVLink 1/2 telemetry, and explicitly requests reporting streams and aircraft version information. The dedicated motor sample is fixed to one motor-test sequence at 5% for one second, gated to an identified disarmed ArduCopter 4.7.1 quad with confirmed props-off checks. It has a best-effort stop, cooldown, and no automatic retry or reconnect replay. Hardware state stays outside creative projects. Follow [the short props-off bench test](docs/LUCIDITY_ONE_BENCH_TEST.md). The service is available through Vite dev/preview, not a static-only deployment.

The local service also implements a guarded one-aircraft mission upload, readback, launch and LAND workflow. Its latest scope and simulator evidence are documented in the [mission launch gate](docs/MISSION_LAUNCH_GATE.md); the physical quad has not flown a Lucidity mission. The explicit motor-test command does briefly enable motor output inside the firmware; it is not a flight mission or proof of flight readiness. Its ACK proves acceptance, not rotation or stopping; the operator records those separately. The optional two-foot hover animation sends no hardware commands. JSON/CSV exports remain creative handoff artifacts, not aircraft missions. Direct point motion, cuts, and transitions can collide. Animated motion review is sampled and explicitly incomplete; 2 Hz CSV can miss fast light changes. Separation review is sampled and limited to 2,000 drones; all bundles remain `flightReady: false`. This first hardware link is not fleet dispatch or flight qualification. Signed frames are shown as unverified; signed-link requests are disabled. The app has no built-in model request path.

Viewer 360° is a desktop camera experience. Local bookmarks retain camera and reference-stage preferences, but they are not portable venue assets or exported camera tracks. VR/headsets, spatial audio, camera/video export, and calibrated photometric simulation are not implemented.

The 100,000-drone objective is split into visual preview now and a documented path toward distributed planning, independent validation, and operator-controlled execution. Actual six-figure flight capability has not been demonstrated.

## Layout

```text
src/platform/     App shell, tool catalogue, parameters UI, music, code
src/core/         Project, commands, formation engine, review, export, tests
src/components/   Editable 3D stage, drone inspector, keyframe timeline, source editor
src/audio/        Shared audio clock, demo synthesis, uploaded soundtracks
src/agent/        Retained internal evaluation harness and synthetic fixtures
scripts/          Agent CLI and generation benchmark
docs/             Product, architecture, research, feedback, tool contract
```

The project uses React, TypeScript, Three.js, Zod, Vite, and Vitest. Fonts are bundled locally; the app makes no model requests and has no analytics.
