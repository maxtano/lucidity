# Drone Studio iteration log

## October 16, 2026 — one shared design system across the workspace

Kept the existing primary and consolidated UI colors into `src/design-system/tokens.css`: graphite dark surfaces, coordinated warm cream/ivory light surfaces, muted terracotta for the First drone test banner and Show identity, sage and smoky mauve secondary identities, and separate semantic status colors. The compact beginner banner stays text-only with its visible Open storyboard action. The cream light block was coordinated with the concurrent UI chat; its requested primary values remain unchanged.

Added reusable Button/Card/Badge/Notice primitives and field classes, plus shared typography, spacing, 2px control / 4px panel corners, 40px standard / 32px dense / 44px coarse-pointer control sizes, borders, focus, motion, and global layer tokens. All application CSS palette literals now live in the token file; older class names resolve through central aliases. Removed overlapping light correction styles. Migrated component SVG presentation colors while preserving authored light RGB values and data. The 3D stage and measured horizon retain an explicit fixed-dark scope in either appearance. Browser review corrected waveform contrast, selected metadata, field wrapper boundaries, focus suppression, primary actions, status dots, and stage overlay readability.

The development-only `/test-fixtures/design-system.html` catalog exposes both themes, every color role, controls and states, fields, feedback, and geometry. It uses the shared primitives and never connects to hardware or saves appearance preferences. Rules and adoption guidance are in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).

**Evidence:** full suite **1,232 tests in 73 files passed** with `--maxWorkers=2`; the first default-parallel run during concurrent builds had two 5-second timeouts in unchanged heavy core cases (100,000-ID selection and immersive bundle export). No timeout was relaxed; both passed in the full rerun. Eight new design-system contracts check supported text contrast >=4.5:1, focus/field boundaries >=3:1, defined tokens, legacy alias resolution, and CSS palette centralization. TypeScript and production build pass. Browser review covered Home, Tools, Music, Drone Show and Code in dark and cream appearances; disconnected parameter/firmware forms, app selector/keyboard focus, motor cue preview, Run storyboard and Scene source portals, and fixed-dark preview controls. Home/library/new-storyboard dialog and mobile navigation were inspected at 320/390px; inspected views had no document horizontal overflow. Music and Run-dialog computed corner checks found no control/dialog corner above 4px. Final browser warnings/errors: none. Proof: `docs/screenshots/design-system-*.png`; the coordinated cream pass also saved `artifacts/cream-design/`.

**Boundary:** this is a presentation and design-contract pass, not a full accessibility audit or physical-flight check. Existing projects and creative content remain intact; no radio connection, parameter write, motor command, firmware operation, or live-model call was performed. Installed Node 23.3.0 remains outside the declared engine range. New components should consume these tokens/primitives; future visual changes should update the catalog and inspect the actual screen rather than add another palette. The next operator milestone is still the authored First drone test storyboard's props-off run.

## October 16, 2026 — authored storyboard to props-off execution; simpler home pages

Corrected the standalone test workflow after operator feedback. **First drone test** is now an ordinary saved one-drone storyboard with four editable scenes and explicit motor cues. The compact default library banner opens or creates that storyboard; New storyboard also offers the motor-sequence template. Removed the separate platform Home launcher. The library now starts with **Your storyboards**, New/Import, a text-only beginner banner and saved cards. Removed the banner illustration. Workspace Home has a simple heading, retained action buttons and compact grid artwork. Existing saved projects and neighboring assets are preserved.

The scene inspector edits motor identity and pulse offset through shared commands. Duration edits, reorder and retime affect preview and execution. The editor timeline and motor preview use the same compiled plan as Run storyboard. The client submits a captured project and reviewed plan identity; the server independently validates that snapshot before execution. Status records source project ID/name/revision, scene names and actual schedule. Changed sources require fresh assignment/checks; source changes, save failure or view cleanup cancel the owned lease. No fixed fallback schedule remains. Fixed 5%/one-second pulses, minimum spacing, post-pulse heartbeat checks, cooldowns, Stop and disconnect handling remain. Moving or multi-drone flight designs cannot be converted to motor commands.

Motor cues survive local saving and v4 portable bundle round trips; ordinary designs retain v3 export. Import remains inert. Agent proposal impact now includes motor cue edits. No export is needed for a direct storyboard run. See [LUCIDITY_ONE_BENCH_TEST.md](LUCIDITY_ONE_BENCH_TEST.md).

**Evidence:** 213 focused checks and the full suite of **1,215 tests in 70 files** passed; TypeScript and production build passed. The actual service/fake-serial test proves changing first-scene duration to eight seconds moves commands to 3/11/17/23 seconds, with total duration 26 seconds; a one-pulse six-second storyboard also completes. Browser verification used the full App with an isolated in-memory library and intercepted synthetic aircraft APIs: created the starter, changed duration, previewed B at 11 seconds, assigned the mock, completed the 26-second authored run with all four confirmations, and cancelled a second run at 7.8 seconds leaving B/C/D unrun. The library retained the edited 26-second storyboard. Screenshots: `docs/screenshots/storyboard-motor-mock-completed.png`, `docs/screenshots/storyboard-motor-editor.png`, and `docs/screenshots/storyboards-compact-home.png`. In the actual local library, created the saved 24-second **First drone test** through its banner; both pre-existing storyboards remain present.

**Limits:** synthetic tests are not a new physical or live-model evaluation. The previously successful fixed-sequence run remains operator-reported; the new authored-storyboard route still needs the operator’s physical observation. No real connection, telemetry request, parameter change, motor command, arming or flight was sent during this work. Installed Node 23.3.0 is outside the package’s declared engine range. Next step: open the saved **First drone test**, preview it, then perform the operator-controlled props-off run and record the result.

## October 16, 2026 — first physical bench show passed on operator observation

After the browser fetch-binding fix, the operator reported: “great it all worked just fine.” In the context of the requested 24-second A → B → C → D props-off rehearsal, record the complete live bench-show checkpoint as **operator-reported passed**: the user started the sequence and reported its expected behavior. This is physical operator feedback, distinct from the earlier synthetic browser and automated checks; no independent visual observation or new telemetry capture was made by the assistant for this confirmation.

The demonstrated workflow is connection and telemetry → physical aircraft assignment → explicit checks → one Start → four timed motor-test pulses → completion. It requires no export or mission upload. This confirms the bounded bench rehearsal, not autonomous trajectory execution or flight readiness. The next hardware milestone remains operational emergency-stop and failsafe verification before progressing to flight. No additional commands or settings changes were sent in response to this report.

## October 16, 2026 — fix browser fetch binding on bench-show Start

The operator's live connection now reports matching bidirectional telemetry, firmware 4.7.1 and a disarmed heartbeat, but pressing Start produced `Failed to execute 'fetch' on 'Window': Illegal invocation`. The bench-show client stored native `fetch` and invoked it as a client method, supplying the wrong receiver. Bound the default transport to `globalThis`, fixing Start, lease renewals and Stop together. No schedule, throttle, timeout or hardware gate changed.

Added a regression using the default transport with a receiver-sensitive fetch implementation: it failed with the exact error before the fix, then passed through Start → renewal → Stop. The isolated browser fixture now exercises native browser fetch against an in-memory data URL with the caller's receiver before producing mock responses; it never forwards API requests to hardware. This closes the gap left by the previous arrow-function mocks. All 54 focused client/scheduler/UI tests and the production build pass. No real motor command was sent by the assistant during this repair; the operator's retry and observed movement remain the next check.

Browser evidence: the updated fixture completed all four cues at 24.0 seconds without console warnings/errors; a second run stopped at 4.7 seconds with B/C/D unrun. Screenshots: `docs/screenshots/bench-show-fetch-fix-mock.png` and `docs/screenshots/bench-show-fetch-fix-ready.png`. Reopened the actual test panel with the new code and unchecked physical confirmations. Its heartbeat is now stale; a fresh powered-aircraft heartbeat and successful telemetry request are required before the operator retries.

## October 16, 2026 — one-start, one-drone props-off bench show

The operator confirmed all individual motors work and requested a complete timed software run. Added a fixed **24-second bench show** accessible from Home → **One-drone bench show**, using the existing aircraft connection and motor-test controller. After explicit connection, telemetry, aircraft assignment and physical checks, one Start schedules A/B/C/D at 3/9/15/21 seconds, each at 5% for one second. The diagram shows service-reported timing and individual command outcomes; physical movement remains a separate operator observation. No export is needed. Individual diagnostics and the future flight simulation are collapsed beneath the rehearsal. See [LUCIDITY_ONE_BENCH_TEST.md](LUCIDITY_ONE_BENCH_TEST.md) for the short walkthrough.

The server owns the immutable schedule. Each cue requires the existing aircraft/firmware/heartbeat checks, accepted command acknowledgement, a post-pulse disarmed heartbeat, and cooldown before advancing. A 2.5-second browser lease ends future cues if the view closes, becomes hidden, loses contact or stops renewing. Stop clears the schedule before a bounded best-effort stop request; link replacement never sends a command to a different aircraft. Late ticks, clock changes, missing/rejected acknowledgements, unexpected arming and stale telemetry fail without retries or catch-up. Manual motor tests, parameter exchanges and telemetry-rate requests cannot overlap the run. A persistent footer Stop control remains available while the panel scrolls.

**Evidence:** all **1,167 tests in 68 files** pass, including 39 scheduler tests, six client lifecycle tests, strict route validation, actual service/decoder/fake-serial command-frame checks and UI rendering tests. TypeScript and the production build pass. Validation used the installed Node 23.3.0 runtime, outside the package's declared supported Node range; supported-runtime qualification remains outstanding.

**Browser verification uses synthetic hardware only:** connected the isolated fixture, requested mock telemetry, assigned Drone 1, completed the entire 24-second sequence with four reported cue confirmations, and verified cancellation after A leaves B/C/D unrun. Also verified the persistent footer Stop button cancels a new mock run. Confirmed the Home shortcut opens the real, disconnected test screen; all physical checks remain unchecked and Start is disabled. Screenshots: `docs/screenshots/bench-show-live-ready.png` and `docs/screenshots/bench-show-mock-cancelled.png`. A development-server restart temporarily interrupted the fixture tab; the fresh fixture and live page loaded successfully after recovery.

**Limits and next step:** no physical radio connection or aircraft command was sent during implementation. The ground USB radio was not detected at handoff; the operator was asked to connect it, close QGroundControl and confirm props-off readiness. The next step is the operator's first complete live bench-show run and observation that all four pulses finish and stop. This is a fixed sequence of motor tests, not storyboard trajectory execution, mission upload, takeoff, hover or flight qualification. Emergency-stop/failsafe verification and actual flight remain outstanding. User-authored shows and neighboring CAD assets were preserved.

## October 15, 2026 — restrained enterprise visual system

Replaced the rounded blue/lilac surface treatment with graphite panels, fine dividers, subdued app accents, and static grain/grid textures. Shared global tokens limit panels and dialogs to 4px corners and use 2px for most controls. Applied the geometry through the five-app shell, mobile drawer, configuration tools, Show editor, lazy panels, and portaled dialogs. Simplified the agent ornament, removed floating-card motion and decorative surface gradients in the app shell, and made Home/agent copy more direct. Manrope, Libre Baskerville accents, app selection, contextual navigation, and existing device behavior remain intact.

The visual reference was [Hex](https://hex.tech/); all Lucidity textures and illustrations remain original. See [UX_DESIGN.md](UX_DESIGN.md) for the palette and rules that keep future screens consistent.

Validation: production build passes. Browser review covers Home, Tools, parameter and firmware views, motor workbench, Music, Code, Show library/editor, and the source dialog. Tested 320px, 390px, 1280px, and 1800px layouts; inspected views have no horizontal page overflow or computed corner radius above 4px. Mobile drawer focus/escape and the app selector remain usable. No hardware operation, provider request, terminal job, or saved show/tune/code edit was performed. Screenshots are in `artifacts/enterprise-design/`.

## October 15, 2026 — app selector and contextual side navigation

Replaced the persistent global tab row and device bar with a shared left sidebar. Home, Tools, Music, Drone Show, and Code now switch through a compact app selector with app-specific colors, icons, and descriptions. Local navigation is supplied by the active app through a shared React portal: configuration groups, melody motifs and saved tunes, files and terminal, or the show project and scene browser. This removes the nested sidebars and the embedded Show library's duplicate header. Connection details and the agent toggle remain in the sidebar footer.

The sidebar collapses to a 64-pixel rail and remembers that layout preference. Tools returns to its last section when selected again. Music, code, and show state survive app switching; Code's terminal has its own sidebar entry. Agent visibility is remembered per app during the session, with Drone Show initially leaving the canvas open. At phone widths the app selector remains in a compact row and local navigation opens as a focus-contained drawer. Escape restores the opening control, section selection focuses the workspace, and modals layer above the shell. Show playback shortcuts no longer intercept keys in app navigation.

Validation: all 1,110 tests across 65 files pass. Browser checks cover remembered configuration routes, melody and terminal drafts, the resumed show editor, keyboard app selection and dismissal, collapse/expand, mobile focus, and disconnected configuration screens. No hardware commands, firmware flashes, or terminal jobs were executed during this navigation revision.

## October 14, 2026 — cool visual system and workspace UX

Implemented the requested Manrope / Libre Baskerville direction across the workspace and studio: midnight-blue surfaces, ice-cyan actions, lilac agent/music accents, an original SVG drone study, coordinated workspace artwork, and a revised brand mark. Both fonts now ship locally as WOFF2 subsets with their OFL licenses and source/checksum manifest. No font CDN request is required at runtime.

Home now accepts a plain-language task and prepares it in the agent with keyboard focus. Tools groups all 18 areas into four task categories, supports group and availability filters, and uses a grouped selector on phones. Setup explains user/agent responsibilities, ESP flashing presents three named stages, and Music visualizes the actual edited pitches and durations. Drone Show keeps real storyboard data and labels decorative formation artwork as a study. Separate agent CSS names prevent lazy studio styles from changing the workspace composer. Added skip navigation, agent keyboard toggle, narrow-screen Escape/focus return, and reduced-motion support.

Research and design rationale: [UX_DESIGN.md](UX_DESIGN.md), with official QGroundControl, Betaflight, ESC Configurator, and Espressif sources. Current integration boundaries remain in [WORKSPACE.md](WORKSPACE.md).

Validation: all 1,110 tests across 65 files pass; production build passes. Browser checks cover 320px, 390px, 820px, 1280px, and 1800px layouts, task handoff/focus, tool filters, melody score edits, and disconnected setup/parameter/firmware views. No horizontal page overflow in those checks; no browser errors or warnings in the current review. Core text/action token pairs exceed 4.5:1 contrast. No hardware connection, parameter write, flash, motor command, or terminal execution was performed in this design pass.

## October 12, 2026 — user returns to the one-drone Lucidity sample

User requested running the one-drone test now instead of continuing switch identification. Opened the existing Lucidity tab: its bench sample is already open and assigned to system1/component1 on the ground ESP32 connection. Aircraft heartbeat/telemetry are stale; the last reported disarmed state and RC-not-found warning are historical, not current evidence. Selected **Motor A, 5%, one second** in the UI only. All three physical review checks remain unchecked and Run is disabled pending fresh heartbeat/review. No motor command, telemetry request, connection change or parameter write was sent. Screenshot: `docs/screenshots/one-drone-sample-ready-awaiting-heartbeat.png`.

**Next:** user reconnects aircraft power with props removed, transmitter on, and waits for live disarmed telemetry; then completes the physical checks and deliberately runs the existing sample. Expected A response is front-right/counterclockwise and automatic stop. This is the already implemented bench command path; no storyboard-to-flight adapter or upload capability was added. Emergency-stop and failsafe verification remain outstanding before flight.

## October 12, 2026 — corrected motor directions reported verified

After the approved ESC 2 reversal, the operator reports **A counterclockwise, B clockwise, C counterclockwise, D clockwise**. This matches the expected BetaFlightX test-order direction pattern when viewed from above. Direction verification is now passed on operator observation; A's front-right position was confirmed previously. No additional settings changes or motor commands were made by the assistant.

**Operator follow-up:** when asked whether B/C/D ran at rear-right/rear-left/front-left and each motor stopped automatically after one second, the user replied “yeah i think it all looks good.” Record the motor-order/direction/stop checkpoint as operator-reported complete, with that qualified confirmation; no independent physical observation is available.

**Next:** identify the Zorro switch assigned to channel 6, then verify the configured `RC6_OPTION=31` emergency-stop input while disarmed before any motor-running stop test. Asked for the physical switch label and advised keeping battery disconnected/props removed while identifying it. Emergency-stop operation, failsafes, flight readiness and mission execution remain unfinished. No additional hardware commands or app changes in this checkpoint.

## October 12, 2026 — frame type readback and motor-order checkpoint

The user's QGroundControl screenshot shows **FRAME_TYPE = X** in both the parameter row and editor. The separate “Default: 12” label is firmware metadata, not the displayed current selection. Advised Cancel without changing the setting.

Checked the official Copter 4.7.1 Quad X matrix and motor-order documentation. Expected test selections, viewed from above with nose forward: **A front-right / Motor1 / counterclockwise; B rear-right / Motor4 / clockwise; C rear-left / Motor2 / counterclockwise; D front-left / Motor3 / clockwise**. These are expected positions/directions, not verified wiring or observed motion. All four starting/stopping remains operator-confirmed from the previous step.

**Complete observed map under X:** operator reports A rear-right/clockwise, B front-left/clockwise, C front-right/clockwise, D rear-left/counterclockwise, all viewed from above. Given the reported Motor1–Motor4 output assignments, these physical positions match **BetaFlightX (`FRAME_TYPE=12`)**. Exact Copter 4.7.1 `AP_MotorsMatrix.cpp` defines this order, and the SpeedyBeeF405Mini `hwdef.dat` explicitly defaults to 12 for standard ESCs. The front-right motor's reported clockwise rotation is a separate mismatch: BetaFlightX expects it counterclockwise. Frame type changes do not physically reverse motor rotation.

**Correction reported completed:** user replied “done” to the `FRAME_TYPE=12 / BetaFlightX` save/reboot/readback instructions. On the following user-operated 5%/one-second test, **A now runs front-right, still clockwise**. This confirms the new A location on operator observation; B/C/D still require verification after the change. Their expected positions are B rear-right (old A), C rear-left (old D), D front-left (old B). No output function or protocol changes, firmware replacement, or normal arming were requested.

**Direction correction pending — user chose software, no soldering:** A/front-right must be counterclockwise from above, and has now been reported clockwise twice. Advised disconnecting the flight battery. Official ArduPilot passthrough documentation supports BLHeli_S and web ESC Configurator on firmware 4.5+, with variable connection reliability. Plan: direct USB/QGroundControl readback of `SERVO_BLH_AUTO`, `SERVO_BLH_RVMASK` and `SERVO_DSHOT_ESC` before enabling passthrough or writing a targeted direction change. Front-right is Motor2/output2 under BetaFlightX despite the test label A. Verify actual ESC settings/identity before writing; preserve other motors' settings. Chrome browser automation was unavailable when attempting to prepare the official configurator; no serial permission or connection occurred. No soldering operation, ESC write, reversal-mask change, pulse, or other aircraft command has been performed by the assistant. Do not change servo reversal or frame type to correct this single motor's rotation.

**USB/ESC setup readback:** user reported `SERVO_BLH_AUTO=Disabled (0)`, `SERVO_BLH_RVMASK=0`, `SERVO_DSHOT_ESC=None`. Next instruction is enabling only AUTO=1 with flight battery disconnected, saving, fully rebooting over USB and checking readback; also verify `SERVO_BLH_PORT=0` for USB. AUTO enable/readback is not yet confirmed. Then close QGC/Lucidity serial ownership, use ESC Configurator in Chrome over direct FC USB, briefly power ESCs with the flight battery (props removed), and read the four ESC configurations before any direction write. Do not flash firmware, enable 3D/bidirectional mode, or assume a direction setting named Normal necessarily means counterclockwise.

**Configurator screenshot:** user confirmed PORT displays Console (enum 0), the correct direct-USB console. Their next screenshot shows an active flight-controller connection in ESC Configurator, with its general Settings popup open; no per-ESC configuration is visible yet. Attempting to inspect that existing in-app-browser tab was rejected by automatic approval review because explicit permission for this external website's USB access had not been established. No browser interaction, ESC read/write or motor command occurred. Asked permission for access to the existing tab/controller connection to read settings only, with manual operation offered as an alternative. Do not retry access through another surface or protocol while this approval remains unresolved.

**Read-only access approved and completed:** user explicitly approved using the existing ESC Configurator tab/controller USB connection to read settings only. The same tab successfully read ESCs 1–4 and logged “Done reading ESCs.” All four identify as **J-H-40 / BLHeli_S 16.7**, with **Motor Direction = Normal**. ESC 2 corresponds to the observed front-right/output2 under the reported BetaFlightX configuration. Proposed correction is **ESC 2 only: Normal → Reversed**, pending separate write approval. Normal is a configuration label, not a physical clockwise/counterclockwise guarantee. No settings were edited/written, firmware flashed, or motors started. The FC's displayed MSP compatibility string ARDU 3.3.1 is not a new firmware readback; actual telemetry previously identified ArduCopter 4.7.1. Screenshot: `docs/screenshots/esc-read-before-direction.png`.

**Approved direction write and readback completed:** user explicitly approved saving and verifying the proposed change. Changed only ESC 2 Motor Direction from Normal to Reversed, then used Write Settings. The visible log reported “Updating ESC 2 - finished” and “No changes - not updating” for ESCs 1, 3 and 4. A fresh Read Settings completed for all four at 18:31:51 local time: directions **Normal / Reversed / Normal / Normal**, all still J-H-40 / BLHeli_S 16.7. Compared every displayed select, checkbox and slider against the pre-edit baseline: the only difference is ESC 2 direction (enum 1→2); all other values match. Screenshot: `docs/screenshots/esc2-reversed-readback.png`. Disconnected ESC Configurator and verified “Closed port.” No firmware flash, motor command or arming was performed. Stored direction is verified; physical rotation after the change is not yet observed.

**Next:** operator disconnects flight battery and direct FC USB, then returns to the wireless Lucidity setup. Recheck A at the existing user-operated 5%/one-second pulse: expected front-right/counterclockwise from above, then automatic stop. Verify B/C/D positions/directions/stops after the frame change too. Emergency stop, failsafes and flight setup remain unfinished.

## October 12, 2026 — motor response reported restored after joint repair

The user reports fixing a joint and that the previously non-spinning motors are now working. Together with the earlier B/D observations, all four test selections now have operator-reported motor response. The joint location and repair were not independently inspected; no stronger electrical diagnosis is inferred.

- The proposed 10% follow-up is no longer needed for the reported no-spin issue. Lucidity remains at its existing 5%, one-second, single-motor pulse; no app, firmware or parameter changes and no aircraft commands were made by the assistant.
- **Operator confirmed all four selected motors spun and stopped automatically after the one-second pulse.** The props-off motor-response check is now passed on user observation. Physical motor order, direction, emergency stop, failsafes and flight readiness remain unverified.
- Updated the short bench guide to reflect the repaired/current result. Documentation-only change; no code tests or build required.

**Next:** verify configured frame type and physical motor order/direction with props removed. Do not resume the obsolete A/C no-spin diagnosis or raise power based on the earlier result. Mission upload/readback and flight execution remain separate, unfinished work.

## October 12, 2026 — first reported motor rotation; A/C unresolved

- User confirmed `MOT_PWM_TYPE` now displays **DShot300** and `SERVO1_FUNCTION` through `SERVO4_FUNCTION` display **Motor1–Motor4** (the enum labels for 33–36). These are operator readbacks; the assistant has not independently fetched the parameters.
- Following user-operated Lucidity bench pulses, the user reports **B and D spin normally; A and C do not**. For A, the user clarified **only an audible buzz**, no visible twitch, and confirmed that with battery disconnected it turns freely by hand and is cool. C's mechanical/temperature check is pending. This supersedes the earlier all-motors-no-motion report, but does not establish all outputs, physical motor order, rotation direction or flight readiness.
- Official ArduPilot motor-range guidance notes differing ESC starting thresholds. The fixed 5% pulse could be below A/C's thresholds; wiring, configuration or ESC/motor faults remain possible. A–D are test-order labels, so no output-group or physical-corner diagnosis is inferred from the letters alone.
- Asked for C's power-off free-rotation/coolness check and advised keeping flight battery disconnected. No pulse, parameter write, arming or flight command was sent by the assistant. The app remains fixed at 5% for one second, with no automatic increase or retry.

**Next:** resolve C's mechanical check. If both non-spinning motors are free and cool, prepare an explicitly selected, bounded 10%/one-second single-motor follow-up with the same guards; do not silently change the existing sample or increase all four. If a motor binds, heats, or still only buzzes at the reviewed follow-up, stop powered retries and inspect its output/wiring/ESC path.

## October 12, 2026 — initial motor-output setup diagnosis

User clarified that the motors have never spun and no calibration/setup baseline is established. They confirmed **SpeedyBee BLS 35A Mini** and **Zorro radio bars respond in QGroundControl**. This proves RC input reaches the FC; it does not prove output mapping/protocol or completed radio calibration.

- Checked official SpeedyBee specifications and Copter 4.7.1 source: this ESC supports DShot300/600; DShot does not require throttle-range ESC calibration. MOT_PWM_TYPE values are 5/6 respectively; no current value assumed. Output assignment, protocol overrides, interlock/E-stop state and actual spin threshold remain unknown. Five percent no-motion cannot be attributed to any one cause yet.
- Released the live Lucidity serial connection via its Disconnect control and verified Disconnected, then opened QGroundControl, which connected to the aircraft. QGC native controls lacked useful AX data and coordinate action returned AXError.notImplemented. Asked the user to read **Vehicle Setup → Parameters → MOT_PWM_TYPE**, without changing it.
- No parameter writes, calibration sequence, motor test, arming, or flight commands performed in this diagnostic turn. User was instructed to keep props removed and disconnect flight battery while checking setup. QGC subsequently showed live connection/battery, so actual power-down is not confirmed. Do not assume physical readiness for a pulse.

**Update:** user read MOT_PWM_TYPE as Normal (PWM). Recommended changing only MOT_PWM_TYPE to DShot300 (5), with flight battery disconnected and FC powered directly by USB, then fully rebooting and reading back the value. This is a supported protocol for the confirmed ESC, not proof that PWM alone caused the no-motion result. No parameter write or reboot has been performed or confirmed by the assistant.

**Next:** confirm the user’s protocol readback, inspect output assignments and E-stop/interlock, then conduct one supervised props-off motor test only after physical readiness. Do not skip straight to a show or full-throttle ESC calibration.

## October 12, 2026 — Home, saved storyboards, and a guided props-off sample

User requested a cohesive first-test workflow and a Home page with new storyboards. The feature-iteration automation remains paused.

- **Home** is now the startup view: saved storyboard cards, New storyboard, Import storyboard, and a prominent First drone test. New documents start with one drone and one editable ten-second scene. Creating, opening, importing, or opening the expert example preserves other documents. Existing current-project autosave migrates into a separate validated local library. Startup recovers newer library revisions after interrupted legacy writes; corrupt storage or quota errors surface without silently replacing the library. Home keeps the editor mounted to retain current private proposals and editor state. Audio playback and file imports now fence late asynchronous completions so Home, pause, seeks and project switches cannot revive old playback or replace a newer soundtrack. Soundtracks must be attached separately when opening a different storyboard.
- **Test on drone** now has an explicit sample → connect/assign → review → run → result path. A fixed 5%, one-second, one-motor command uses MAV_CMD_DO_MOTOR_TEST 209; A–D denote test order, not verified physical corners. Stable Copter 4.7.1, one identified quad, fresh unsigned disarmed heartbeat, current-link bidirectional telemetry evidence, three operator checks and cooldown are required. Reconnection resets assignment/checks; there is no automatic retry or replay. Start/stop serialization stalls fence further starts until reconnect. Best-effort stop remains available for an owned test; stop ACKs do not prove physical stop. No flight modes, takeoff, mission, persistent parameter writes or general command endpoint were added.
- Firmware itself briefly enables outputs and temporarily changes relevant failsafe settings in RAM during its motor-test implementation, then restores saved values; the app does not claim the test remains internally disarmed. Props must remain removed. A controller ACK is shown separately from the operator's physical observation.
- An optional private up/hover/down animation uses the existing evaluator at 0/4/9/13 seconds and 0/0.6096/0.6096/0 m. It sends no hardware commands and does not alter the open storyboard. This is still not autonomous-flight execution or upload.
- **Browser evidence:** created and named “My first one-drone show”; reopened the original Prismatic study (10 drones, two scenes, 48 seconds); reloaded and verified both persisted. Home opens the real bench modal through the same application. Synthetic fixture (all fetches intercepted, no serial fallback) exercised receive-only 0 TX, telemetry request, assignment, three checks, accepted mock pulse, cooldown, no-movement observation, and reconnect invalidation. Optional simulation played through and stopped at 13.0 / 13 seconds. Screenshots: `docs/screenshots/lucidity-home.png` and `lucidity-bench-no-movement.png`.
- **Actual hardware observation during this work:** the live service showed an accepted motor-test result and “starting motor test” / “finished motor test” status text, then disarmed/Stabilize telemetry (~24.57 V). The user confirmed they ran the sample and **no motor moved**. Recorded No movement in the UI; this is **not a physical motor-test pass**. The aircraft also reported “PreArm: RC not found”; user confirmed transmitter off or not linked. Asked them to power/link the transmitter with throttle down and remain disarmed. No inference that RC status alone caused the lack of motion. The 5% threshold may be too low; official ArduPilot guidance describes a 10% follow-up, but this turn did not increase power or run another physical pulse. User previously confirmed no unusual heat or smell after the beeping; exact beep cause remains unconfirmed.
- **Validation:** final 1,071 tests across 60 files, strict TypeScript and production build passed. Nine additional audio tests cover pending playback cancellation and out-of-order imports; browser confirmed Home pauses playback and reopening stays paused. Controller coverage includes 69 deterministic tests; no live model/provider evaluation. Existing production chunk-size advisory remains. Localhost preview is running. No publishing, neighboring CAD changes, mission upload or flight.

**Next:** verify the transmitter link and E-stop state, then diagnose the no-motion bench result with the operator present. A deliberate, reviewed 10% one-second preset is a possible next bounded change after those checks; never ramp automatically. Mission adapter/upload/readback and controlled flight are separate, unfinished milestones. Physical observation currently lives only in the open bench UI; this log preserves the reported no-motion result.

## October 12, 2026 — first physical aircraft telemetry test passed

The user supplied the commissioned hardware configuration and explicitly requested physical integration. Reviewed the existing studio/evaluator/export/agent server first: there was no aircraft connection or mission executor to reuse. Presented an incremental plan and preserved all creative projects. The earlier automatic feature-iteration schedule remains paused.

- Added a separate **Physical drone** workspace and local Vite dev/preview service. Explicit Mac USB enumeration normalizes SerialPort's `tty` paths to the matching `cu` device. Fixed 115200 baud, exclusive serial lock, `hupcl:false`, generation-aware disconnect/error/shutdown cleanup; no auto-connect. Physical telemetry never enters Project/undo/localStorage or AI tool context.
- `serialport@13` and ArduPilot `node-mavlink@2.3.0` supply transport/typed protocol definitions. A bounded frame reader validates dialect CRC, V1 lengths, V2 flags/truncation, filters radio/GCS heartbeats, timestamps channels, preserves unknowns, and bounds aircraft/messages. Signed traffic remains unverified and prevents requests. Battery 0 reports take precedence over SYS_STATUS fallback.
- Connect sends **zero bytes**. A separate **Request telemetry** action allows only five targeted SET_MESSAGE_INTERVAL requests (attitude 5 Hz, position 2 Hz, GPS/SYS_STATUS/battery 1 Hz) and one REQUEST_MESSAGE for AUTOPILOT_VERSION. It requires a fresh disarmed unsigned aircraft heartbeat, allows one pending request, and cancels on link/arming changes. No generic send endpoint, arming, flight modes, missions, persistent parameters or GCS heartbeat. Reporting rates may remain active after serial disconnect; no SRx parameter was written.
- **Real hardware:** user confirmed ground radio connected, QGC closed, props removed. Initial six-second passive check: 599 bytes, 24 valid packets, zero rejected frames, aircraft sysid 1 / compid 1, MAVLink 2, disarmed/Stabilize/Standby. The app then displayed that real heartbeat with zero TX. Explicit request transmitted 264 serialized bytes and received an accepted, source-matched version ACK plus firmware **4.7.1** and all four telemetry groups. Battery approximately 24.6 V; GPS no fix / zero satellites. Relative altitude is labeled an autopilot estimate, not clearance above the floor.
- Verified UI Disconnect released the OS port, retained readings became stale, and reconnect recovered live telemetry. Repeated the targeted request successfully in the new connection. **User confirmed physical roll/pitch tilts match the live horizon.** Left the app in the connected telemetry view. No aircraft mission upload, emergency-stop/failsafe test, arming, motor test or flight performed.
- **Evidence:** 69 focused hardware/display tests, **949 total tests in 54 files**, strict TypeScript and production build pass. Tests include malformed/fragmented/signed frames, sentinels, source separation, request allowlist/ACK freshness, no-write connect, cancel/reconnect races, API origin/peer/body guards, and display freshness. Online npm audit is zero after narrow xml2js 0.6.2 override/source-map-js 1.2.2 patch. Existing Node 23.3.0 is outside the declared supported runtime range; existing production chunk-size advisory remains. Browser pointer actions were unreliable in this session; accessible keyboard controls completed the actual interactions.

Record: [physical bench evidence](../artifacts/one-drone-test/physical-bench-verification.json). Guide and screenshot: [Lucidity One bench test](LUCIDITY_ONE_BENCH_TEST.md).

**Bench follow-up:** after confirming the horizon test, the user reported repeated beeping and possible overheating. Advised pausing and safely disconnecting flight battery; no further aircraft commands. Last received telemetry was disarmed/Stabilize, approximately 24.58 V and 0.73 A, then heartbeat became stale. No ESC/FC/VTX temperature channel is available in this integration; the cause of beeping is unconfirmed. Resolve this hardware question before further powered testing.

**Next stage, after resolving the beeping:** implement an inspectable ArduPilot mission adapter with explicit props-off/disarmed upload gating, preserve/read existing mission before any replacement, and verify semantic readback. Existing studio JSON/CSV remains simulation-only. No export-to-flight path exists yet; GPS, emergency stop and failsafes still need separate operational verification before flight.

## October 8, 2026 — user-directed one-drone flight rehearsal and visual test plan

The user returned and asked to stop feature coding, prepare a simple flight-only test for an existing SpeedyBee/GPS quad, and walk through the example in the app. The recurring feature-iteration automation is now **PAUSED**. Do not resume feature work or add aircraft control without new direction.

- Wrote and then shortened [the test plan](ONE_DRONE_TEST_PLAN.md) to three stages, with a workflow diagram, actual app screenshots, and a height/time plot generated from the downloaded CSV. The precise FC model/revision, installed firmware/version, and positioning hardware remain unconfirmed. Official ArduPilot/Betaflight/INAV/QGC/MAVLink documentation informed the conditional upload/readback procedure. No firmware change, aircraft connection, physical mission upload, simulator-autopilot run, or flight was performed.
- Prepared an initial one-drone, ten-second stationary-hover data sample using the existing exporter. Schema/import round-trip and all 21 CSV rows passed. The app imported it through its normal file chooser and played to the ten-second endpoint at ENU `(0,0,3)`.
- In the app, authored the full visual rehearsal using scene duration, per-drone Auto key, and timeline key dragging. Initial five-second ramps correctly raised a sampled peak-speed failure (~1.10 m/s against the sample's 1 m/s design limit). Lengthened each ramp to six seconds: final keys at **0/6/16/22 s**, heights **0/3/3/0 m**, and constant East/North zero. Observed final playback stop at **22.000 s / 0 m** and scrubbed the midpoint to **11.000 s / 3 m**.
- Used the real **Portable design bundle** and **Sampled trajectories** buttons. Copied the resulting browser downloads into `artifacts/one-drone-test/one-drone-flight-rehearsal.lucid.json` and `.preview.csv`. Verified all **45 rows**, exact CSV equality with the evaluator applied to the downloaded JSON, four key positions/times, monotonic climb/descent, ten-second hold, and current-revision review. Sampled peak speed **0.9203 m/s**, acceleration **0.4601 m/s²**, zero failed design checks; review is still **incomplete**, with **flightReady: false**. Evidence: `artifacts/one-drone-test/verification.json`.
- Walkthrough used a separate **localhost:5173** browser origin; original **127.0.0.1:5173** Prismatic remains 10 lights/two scenes, paused at 34 seconds, with Undo disabled. Backed up the separate origin's starting demo through Export before importing. Final rehearsal is retained on localhost, paused at its start, in Design/Front view with drone 1 selected and soundtrack muted. Rehearsal browser error log was empty.
- Browser download-event waiting did not resolve, although the file appeared in Downloads. Subsequent exports were verified by the app's success state and exact downloaded-file content. Initial file chooser operation eventually succeeded; its unusually long elapsed tool time is not an application latency measurement. Local shell networking was sandbox-limited; the existing 5173 server was already running and browser access worked. No saved original show, credentials, live model calls, hardware, publication, or neighboring CAD changes.

Before the user redirected work, scene-scoped proposal metadata/controls had already landed. Stabilization passed **27 helper tests**, **10 card tests**, strict TypeScript, and production build (main 681.67 kB / 205.01 kB gzip; existing size advisory). Their integrated browser coverage remains unfinished. Removed only this turn's unfinished synthetic scene-target fixture. Retained prior developer diagnostics for later investigation; no further feature iteration was done after the direction change.

**Next:** obtain the exact board/firmware information and tailor the props-off aircraft checklist. The studio still has no aircraft compiler or upload interface; a manually reproduced ground-station mission does not establish direct export-to-aircraft execution. Physical flight requires a separately commissioned aircraft and pilot-controlled baseline.

## October 8, 2026 — expanded private comparison with retained renderer

Completed a browser-independent expanded Before/Draft layout, prioritizing the immersive viewing surface while retaining the expert review controls.

### Completed

- **Expand comparison** fills the available browser viewport through application layout. Before/Draft, both scene clocks, the shared transport, and Restore stay accessible. Stage's corner control delegates to the same expansion state for private comparisons; other Stage uses retain their existing native fullscreen behavior.
- **Review controls** opens a scrollable tray for audition ranges/speed, scene navigation, and measured evidence. These controls remain mounted when hidden, retaining their values. The tray clears the version header and transport, including short and portrait viewports.
- One persistent Stage and playback hook survive expansion, restoration, version changes, and tray toggles. Existing resize handling adjusts canvas dimensions/projection without moving the camera. Target markers and captured framing stay intact, and clean review captures remain separate from interface overlays.
- Escape first closes a topmost nested dialog, then restores an expanded comparison, then closes the normal preview. Restoration also works from the outer heading/Close control and returns focus to the persistent Expand button. Hidden tray controls leave the Tab sequence.
- Scoped responsive styles wrap narrow controls and omit redundant stage captions/badges where they collide with other chrome; the same scene and viewpoint information remains available in the header and viewer settings. No project, operation schema, or provider behavior changed.
- Extended the synthetic proposal fixture with cumulative canvas mounts/removals and observed context-event counters. Added `/test-fixtures/comparison-layout.html`, which resizes one persistent iframe to exact 390×844, 900×480, and 1440×900 CSS viewports. Both use existing injected providers and no saved-show persistence.

### Evidence and limits

- **865 tests pass in 49 files** with two workers in 9.93 seconds. Strict TypeScript and the final production build pass. Independent source review confirmed same-Stage ownership, nested-dialog isolation, and Escape/focus behavior. Browser QA caught a tray overlap with transport; adjusted its bounds and verified the correction in short and portrait layouts.
- Main-window fixture kept 0.25× loop playback, enabled target marks, and the selected Before version through Restore/Expand. Space/native controls and ordinary playback remained usable. A captured Before still was clean of markers and interface, at **1824×687**, with consistent 2.167-second clock and yaw-0/pitch-0/FOV-60 metadata.
- Nested capture Shift-Tab wrapped to Download JSON. Escape closed that child while leaving the comparison expanded; Escape on the parent Close button restored normal layout and focused Expand; another Escape closed the preview. With the tray collapsed, Tab from Review controls wrapped to the parent Close button.
- Final responsive fixture showed **one canvas mount / zero removals / one active canvas** through expansion/restoration, version changes, playback, tray operations, and all three viewport sizes; closing produced **one mount / one removal / zero active**, with no observed context loss/restoration. At 390×844 the modal had no horizontal overflow, transport occupied y761–789, and the open tray ended at y747. At 900×480 the tray ended at y385, above transport y399–427; both scene clocks remained above it. At 1440×900 the stage reached 1382×640.5 CSS pixels with transport still inside the viewport.
- Separate measured-camera fixture recalled Draft at show 2 seconds, yaw 45°, pitch 0°, FOV 60°. Captured aspect stayed square through expanded **458.5×458.5 CSS pixels** and restored **278×278**, then produced an expanded **687×687** PNG with the same exact camera/time. These are injected-provider numerical/visual checks, not live model evaluation.
- The in-app browser viewport override did not change its actual dimensions, so responsive checks used the explicit same-origin iframe and read back real child dimensions. This establishes responsive layout in that engine, not physical-device or cross-browser qualification. The wrapper logged a MutationObserver Node-type diagnostic on initial load and on a fresh load. The lifecycle counters and completed interactions functioned normally, but its source was not established; fixture diagnostics need a follow-up investigation. Main studio and the separate camera fixture had no warning/error logs.
- Main production chunk **678.04 kB / 203.88 kB gzip**, CSS **115.62 / 23.92 kB**; existing size advisory remains. The saved Prismatic 10-drone revision 42 remains paused at 34 seconds, Undo disabled. Local preview remains available. No saved project/bookmark or artist selection changes, model calls, credentials, aircraft, uploads, publication, or adjacent CAD edits. No new GPU/endurance benchmark or CLI model evaluation was run.

### Next bounded slice

First isolate the iframe fixture load diagnostic before extending responsive coverage. The next product slice is scene-aware proposal target inspection with explicit all-scenes versus selected-scene membership. Account for incoming transition overlap and retain inactive-ID disclosure, rather than implying every proposal target changes visibly at the current playhead. Keep the same expanded review and clean capture workflow.

## October 8, 2026 — explicit proposal targets in Before/Draft

Completed the read-only proposal target preview slice. Artists can mark the complete set of explicitly targeted drone IDs while comparing the original show with an agent's private draft.

### Completed

- **Show marks** in the private Viewer starts off and identifies explicit per-drone operation targets across all scenes. The card shows the complete union, active/inactive membership in the current version, granular operation count, and the count of other operations that are not marked. It explains that targets can include no-ops and resets and do not imply a visible difference.
- Validated proposal commands derive an owned, frozen, sorted union for edits, transforms, setting/removing/moving keys, and resets. Before and Draft each filter against their own fleet bounds. Dormant IDs and targets from a subsequently removed scene remain part of the explicit proposal union. Broad scene/show changes do not invent target membership. The helper observes the existing 128-operation bound and handles all 100,000 stable IDs without page truncation.
- Read-only Stage previews reuse the separate post-composer ring renderer through a project/revision/fleet-bound target. Switching Before/Draft retains the toggle and shared camera/time; a different comparison starts unmarked. Design suspends marks. The card cannot select drones or apply edits. Native Space toggles marks without starting transport.
- Fixed a paused-render capture edge case: the capture frame omits rings, then the next frame restores them while preserving the enabled toggle. Captured pixels, authored RGB, glow, and exposure remain independent of the editing overlay.
- Added a development-only fixture with two injected-provider runs through the real stage/review/finish harness. Both contain eight mixed commands and 201 explicit target IDs: 600→900 growth and 600→300 shrink. The fixture has no saved-project persistence. Updated product, technical, harness, research, and README descriptions.

### Evidence and limits

- **865 tests pass in 49 files** with two workers in 8.44 seconds. After simplifying redundant validation, all 39 focused preview/target/card checks and strict TypeScript passed again. Tests cover six command families, ownership, no-ops/reversed changes, removed scenes, inactive IDs, fleet growth/shrink, malformed inputs, broad-operation exclusion, complete 100,000-ID derivation, and accessible card states. Independent implementation/renderer review found no remaining issue.
- In-app browser growth fixture opened unmarked. Enabling marks showed **201/201 active** in Draft and **200/201 active · 1 inactive** in Before; amber control lights stayed unmarked. Switching versions preserved the paused one-second clock and pose. Keyboard Space toggled marks without playback. Design hid the card and Viewer restored it.
- Capturing Before with marks enabled produced a clean **1464×417** still with no rings and correct Before/600-drone/revision-7, one-second, yaw-0/pitch-0/FOV-60 metadata. Closing the capture restored rings while still paused. Shrink opened unmarked, showed **100/201 active · 101 inactive** in Draft, and retained **200/201** in Before. Scrubbing one frame retained the complete target count. Fixture warning/error logs were empty.
- The fullscreen button enlarged the in-app host surface and controls remained usable; element-only native fullscreen was not established. Chrome corroboration was unavailable because that browser backend disconnected. A reliable expanded comparison layout is the next slice rather than claiming cross-browser fullscreen qualification.
- Strict TypeScript and the final production build pass. Main chunk **676.27 kB / 203.22 kB gzip**, CSS **111.34 / 23.26 kB**; the existing chunk-size advisory remains. No dependency or provider framework was added.
- Main Prismatic remains the saved **10-drone revision 42**, two 24-second scenes, paused at 34 seconds with Undo disabled and empty warning/error logs. The loopback studio remains available and the disposable fixture was closed. No saved project/bookmark, selection, credential, model call, aircraft, upload, publication, or neighboring CAD change was made.
- These are deterministic and injected-provider checks, not live-model evaluation. The CLI evaluation runner was not rerun. Full-ID tests establish completeness, not 100,000-drone GPU frame rate or endurance. Markers follow evaluated current positions, ignore occlusion, and describe command targeting rather than changed pixels or scene-specific visual impact.

### Next bounded slice

Give private Before/Draft comparisons a reliable expanded viewer layout independent of native fullscreen, retaining accessible marker controls, version switching, transport, and clean captures. Verify short and tall viewports and preserve the artist's immersive pose/time and saved show.

## October 8, 2026 — preview complete audience matches in the immersive viewer

Completed the optional audience highlight slice. Artists can inspect every matched location, including dark lights, before committing a selection, then return to a clean show render.

### Completed

- **Preview matches** closes the audience query dialog and retains an owned complete result without changing selection, camera, or show time. A compact card labels captured criteria, matched time, and current position time. Hide/Show, Clear, Replace, Add, and explicit **Recall query view and time** are available in normal and fullscreen Viewer.
- Membership stays fixed to the captured query while rings follow those IDs at the current evaluated show frame. Design suspends the overlay; returning to Viewer restores it. Project identity, revision, fleet count, and read-only changes invalidate it. Empty and stale results cannot start a preview.
- `audience-highlight.ts` validates report completeness and canonical metadata, freezes owned nested data, and exposes a constant-time current-project guard. Its position writer supports all 100,000 IDs, maps blended ENU to East/Up/-North, preflights invalid coordinates/capacity/aliasing before writes, and preserves source buffers and spare output capacity.
- Separate post-composer Points rendering keeps rings out of bloom, exposure, authored channels, and review captures. It reuses a packed position buffer, uploads only visible changed targets/frames, stops on context loss, and disposes resources on unmount. Rings intentionally ignore venue occlusion. This is an editing overlay, not a lighting effect.
- Added a development-only 600-drone fixture with 200 dark front targets, 200 lit front controls, 200 dark rear controls, original selection, clock, and synthetic revision advancement. It does not mount saved-show persistence or a model provider. The card's keyboard boundary preserves native Space activation without triggering the editor's global playback shortcut.

### Evidence and limits

- **843 tests pass in 47 files** with `--maxWorkers=2` in 8.24 seconds, including 44 new core checks. Focused highlight/selection/inspection coverage: 69 passing tests. Strict TypeScript and production build pass; independent renderer/fixture review found no remaining issue after the keyboard fix.
- Chrome fixture query found all 200 dark in-frame matches. Preview left the original four selected IDs, show time 1, and revision 7 unchanged. Screenshots showed thin rings at dark locations, with the amber lights unchanged; Hide removed the rings. Add produced 204 selected IDs, repeated Add stayed 204, and Replace selected exactly IDs 1, 4, …, 598.
- Scrubbing to 2 seconds preserved the captured 1-second label. Design hid the card; Viewer restored it. Looking behind kept the rear dark with no query rings there. Explicit recall restored yaw 0 and time 1. Fullscreen layout and marker toggle worked. Advancing the synthetic revision cleared the card; a zero-match query disabled Preview. Fixture warning/error logs were empty.
- Restarted the loopback Vite preview, which was no longer running. Reopened the existing saved Prismatic document in the in-app browser: it now has **10 active drones / revision 42**, two 24-second scenes, paused at 34 seconds. This differs from the September baseline and was preserved. Its query found 10 matches; Preview then Space on Hide kept playback paused and Undo disabled. Clear removed the card. No selection or authored change was applied; final warning/error logs were empty. The studio tab remains available; the disposable fixture was closed.
- Main production chunk: **672.25 kB / 202.17 kB gzip**; CSS **109.65 / 23.04 kB**. The existing chunk-size advisory remains. No package or provider framework was added.
- The 100,000-ID tests prove numerical completeness and buffer bounds, not GPU frame rate/endurance. Browser checks used the static synthetic formation; animated coordinate interpolation has deterministic coverage. Context loss and capture exclusion were source-reviewed, not forced in the browser. No live model, image transmission, credentials, saved bookmark changes, aircraft, publication, or neighboring CAD changes.

### Next bounded slice

Connect an explicit affected-drone preview to completed agent proposals, deriving full stable IDs from validated operations and mapping them separately to Before/Draft fleet bounds. Reuse the display-only renderer while preserving read-only proposal semantics, captured evidence identity, current selection, and clean exported frames. Verify mixed operation sets, dormant IDs, version switches, and large targets with an injected provider before adding any model image input.

## September 27, 2026 — complete audience targets for agent edits

Connected exact audience discovery to one atomic per-drone edit without sending every matching ID through model context. Added a visible activity summary and an isolated Before/Draft browser fixture.

### Completed

- `inspect_audience_selection` retains its bounded sorted pages and complete counts, and now returns an opaque `targetId` for the entire nonempty matching set. Empty complete results return null; an out-of-range empty page can still reference a nonempty full set. The original captured artist selection and completed review are unchanged.
- New tool 15, `stage_audience_operation`, accepts that target plus one ordinary per-drone command with `ids` omitted and the scene/key parameters explicit. It supports base edits, transforms, setting/removing keys, and resetting drone edits. The harness injects every owned matching ID and uses existing transaction, operation-count, and conservative expansion checks. Final proposals contain explicit IDs, not handles.
- Run-local storage retains at most eight targets and 200,000 total IDs, with oldest-first eviction. Records own frozen IDs and captured query/view metadata; registration rejects cancellation or a changed private document/operation count. Any successful staging, including a no-op, invalidates all targets. Failed staging preserves them. Immutable store replacement integrates with shallow checkpoint rollback, including output-budget failures after query eviction or staging.
- Activity cards distinguish complete counts from the page preview, show captured region/light/scope/view/time, and explain temporary-target expiry. Staging confirms the full matched count and exact-ID expansion while preserving the existing source-operations disclosure. Historical or empty results do not imply a currently usable handle.
- Added CLI case **audience-full-targeting**: 600 active drones, 200 dark in-frame matches, 200 already-lit front controls, 200 dark rear controls, a disjoint original selection, and dormant authored work. Its conditional provider consumes the actual 128-ID page and opaque target, stages all 200 matches, requeries to zero, reviews, and finishes. An independent projection/arithmetic oracle checks exact membership, full authored preservation, and ordered handle-bound evidence.
- Existing audience/camera evaluation oracles now recognize this new staging tool when validating edit boundaries. Equivalent target-based key edits pass; an extra target edit after the final measurement invalidates that evidence. Added `/test-fixtures/audience-targeting.html`, which mounts real activity and proposal preview components without saved-project persistence or a live provider. Updated product, technical, harness, evaluation, research, README, and machine-readable tool documents.

### Evidence and limits

- **799 tests pass in 46 files** using `vitest run --maxWorkers=2`; strict TypeScript and the production build pass. The initial unrestricted parallel run encountered seven timeout-only failures across unrelated existing suites during a roughly 44-second shared stall. Reduced concurrency passed the complete suite in 8.64 seconds without relaxing timeout limits or changing test assertions.
- Target lifecycle/real-harness coverage verifies complete expansion beyond the page, all five command families, stale/cross-run IDs, empty results/pages, original selection, immutable ownership, count/ID eviction, failed apply/expansion limits, cancellation, and query/stage output-budget rollback. Evaluation adversaries reject page-only and wrong-set edits, damaged channels, missing/stale measurements, mismatched handles, and inconsistent staging evidence. Activity summaries have six rendering checks.
- All **11 CLI fixture cases pass**, zero model tokens: `artifacts/agent-evaluation-full-audience-targeting-2026-09-27.json`. The new case passes ten findings and produces one explicit operation containing all 200 IDs. These are deterministic harness results, not live-model quality measurements.
- Browser fixture showed 200 matches with page 1–128, one staged operation for all 200, and zero matches after the edit. Expanded source listed IDs 1, 4, …, 598. At the same show time 1 and stage-facing pose, Before displayed the existing amber grid and Draft added interleaved cyan lights. Fullscreen rendered correctly; turning to yaw 180° left the rear dark. Warning/error logs were empty. The temporary fixture tab was closed afterward.
- Main Prismatic remained 800 drones, two 24-second scenes, paused at 34 seconds, Viewer 360°, Undo disabled, with empty warning/error logs. HMR closed the previous session-only selection dialog. No saved show, bookmark, model credential, aircraft, upload, publication, or neighboring CAD change occurred.
- Production main chunk: 662.59 kB minified / 198.96 kB gzip; CSS 108.09 / 22.79 kB. The existing chunk-size advisory remains. Selection worker remains 68.38 kB. No new package or provider framework was added.
- Handles describe membership at one captured numerical frame and expire after edits; they do not follow drones continuously or measure occlusion/perceived visibility. Bounded 100,000-ID storage/selection checks are not large-fleet rendering or endurance qualification. Live-provider behavior remains untested pending configuration.

### Next bounded slice

Add an optional audience-view target highlight so artists can see the matched group before committing selection, with a clear way to return to the unmarked immersive preview. Keep highlight geometry separate from authored light channels, preserve stage/camera and historical query identity, and verify large-set bounds and the same controls in fullscreen.

## September 27, 2026 — exact audience-based drone selection

Connected the immersive viewer to complete stable-ID selection and gave the agent the same numerical targeting calculation. This slice changes selection only until the artist or agent uses an existing editor command.

### Completed

- **Select from view** in the editable Viewer opens explicit scope, region, and light-state criteria. Search all active drones or the current selection; choose the camera frame, stage-relative Front/Right/Rear/Left, or Overhead; filter lights on/off/either. Run captures exact show time, pose, stage, aspect, and scope.
- The worker returns the complete sorted matching set, considered/fleet counts, and captured metadata. The ID preview is bounded to 32 with an explicit remaining count; all matches reach **Replace selection** or **Add to selection**. Empty Replace clears selection. Add uses a Set union because ordinary pointer multi-select uses toggle semantics. Viewer shows the selected count; Design keeps selection rings/gizmos.
- Historical results keep their original criteria when form inputs change. Cancellation/failure retain the prior complete report; worker generations and project/revision guards discard late results and disable stale commits. Explicit selection changes open the existing inspector without editing authored geometry/lights or creating undo history. Read-only study/proposal previews do not expose this selection dialog.
- Refactored audience inspection into a shared per-drone frame classifier, retaining blended positions/RGB, frustum edges/depth, directional and overhead semantics. `selectAudienceDrones` owns all inputs before yielding, preflights the existing frame/key budget, and returns complete active IDs only. Valid dormant IDs remain in historical scope metadata but do not contribute to considered/matched counts. Empty active scope skips evaluation. Work yields before evaluation and every 1,024 classified IDs, including the final chunk, with cancellation checks and no partial publication.
- Added tool 14, `inspect_audience_selection`: explicit captured view/time/criteria plus fleet/original-selection scope, offset, and limit 1–128. Pages contain complete counts, sorted IDs, continuation metadata, captured context, and `stagedOperations`; the full scope/match list stays internal. This marker is captured before async work and distinguishes successive private drafts that share revision base+1. Paging must keep identical criteria/project/revision/operation count and restart after edits. Original artist selection and completed review are unchanged.
- Returned IDs can feed existing granular commands. This is read-only discovery, not a new query-to-edit shortcut: very large agent targets still require paging within call budgets or an artist-prepared complete selection. Updated product, technical, harness, research, README, and machine-readable tool documentation.

### Evidence and limits

- **744 tests pass in 42 files**, including 16 new core/worker and 25 agent cases. Independent review found no actionable issue. Coverage includes analytic ENU boundaries, yaw/pitch/aspect/depth, blended keyed motion/RGB/flash, empty/dormant scopes, irregular 257-ID scopes, complete 100,000-ID results, pre-await ownership, budget preflight, initial/mid/final cancellation, and actual worker protocol.
- Agent tests verify 133 matches paged 40/40/40/13, an original irregular selection beyond the initial 128-ID context preview, selected IDs becoming dormant after fleet reduction, bounded output, repair, cancellation, and a real-harness edit using the gathered exact IDs while preserving nonmatches and unrelated channels. A pending baseline page remains revision 7 / operation count 0 despite a direct concurrent stage; successive draft pages both use revision 8 but operation counts 1 and 2.
- Strict TypeScript and production build pass. Main chunk: 655.28 kB minified / 196.80 kB gzip, retaining the existing size advisory; dedicated selection worker 68.38 kB. All ten existing scripted CLI evaluations pass with zero model calls/tokens: `artifacts/agent-evaluation-audience-selection-2026-09-27.json`. The default rehearsal and case set remain unchanged.
- Browser at main Prismatic time 34: in-frame/either found **175 of 800** active drones, with only the first 32 displayed and +143 clearly labelled. Replace selected all 175 in Viewer and inspector. Finding the same set and choosing Add retained 175, proving union rather than toggle behavior. Undo remained disabled and show time remained 34.
- Current-selection/in-frame/lights-off found zero while considering all 175. Empty Replace cleared the selection. A subsequent Current selection query considered zero IDs rather than falling back to the whole fleet. Changing the form to fleet/overhead preserved the previous captured empty-selection result until Run; the fresh overhead query then found **536 of 800**, with +504 beyond the preview. Closed it without applying that set.
- Fullscreen showed the complete empty-result dialog and disabled empty Add; improved empty-result copy to remove misleading references to hidden IDs. Final normal-size dialog is left open with the 175-ID report, no applied selection. Prismatic remains r41, 800 drones, two 24-second scenes, show time 34, Undo disabled. Final browser warning/error log is empty. A transient HMR reset earlier closed the session-local dialog; reopening after module stabilization succeeded.
- No authored show/bookmark change, live model request, credentials, aircraft action, upload, publishing, or neighboring CAD edit. Browser cancellation/stale-project races were not forced; guards have deterministic/source coverage. Full 100,000-ID numerical selection is tested, not large-fleet GPU/endurance performance. The geometric/light-state query does not measure occlusion, perceived visibility, continuous coverage, artistic quality, or flight readiness.

### Next bounded slice

Add bounded, run-local audience query handles so an agent can stage one existing granular operation on the complete matching set without paging every ID into model context. Bind handles to the exact captured criteria, owned IDs, and staged-operation count; invalidate them after any successful edit, cap retained handle/count memory, preserve the original artist selection, and expand through existing transaction/budget checks. Use fixtures that prove large-set completeness, stale-handle rejection, nonmatch preservation, cancellation, and inspectable exact proposal operations. Keep explicit artist approval/application semantics unchanged.

## September 27, 2026 — evidence-driven camera refinement and review links

Completed the numerical camera inspection → precise edit → reinspection → visual review loop with an injected provider and an isolated browser fixture. No live model was used.

### Completed

- Added the tenth CLI case, **camera-light-refinement**. Its provider reads actual camera-path counts, inspects the starting viewpoint, derives selected visible dark IDs, changes only their brightness keys, reinspects the identical path, reviews, and returns a proposal. The seven active drones include unselected and selected-outside-view decoys; dormant drone 9 retains authored work.
- The independently specified path maps camera 0/4/8 seconds to show 1/2/3 and yaw 0/45/90°. The oracle expects unchanged geometry [5,4,5] and lights [2,1,2] → [4,3,4]. It verifies full authored content, exact camera/context/clocks, successful paired before/after trace evidence, staging boundaries, and final operation-count provenance. Alternate split batches remain accepted. Damaged channels, wrong IDs, stale evidence, invalid pairings, mismatched clocks, and prose-only completion fail.
- Completed `AgentResult` values now include an optional deeply owned copy of the validated run viewer context. Camera traces retain one lit count beside each pair of clocks, allowing independent summary consistency checks without copying full per-sample totals. Default UI rehearsal stays unchanged; failed/cancelled results and restored checkpoints do not invent viewer evidence.
- **Measured review moments** now accepts camera-path minima/maxima only when endpoint IDs/names/poses/venue/aspect agree with that run capture, every mapped time and count is valid, and extrema/mean match earliest-tie rules. Only original/final-draft provenance produces links. Poses are reconstructed with the shared camera sampler; held-show rows can retain distinct poses. Existing deduplication, latest-evidence ordering, 12-moment cap, and both-version representation remain.
- Review cards display camera elapsed/duration, sample index, easing, show time, Before/Draft, counts, and source event. Open explicitly recalls one measured pose and show frame, pausing playback and exposing **Captured frame**. It does not start an inferred camera trajectory.
- Added `/test-fixtures/camera-review.html`, a development-only page that runs the real fixture/harness and mounts the actual proposal preview without the saved-project editor. Vite disposal aborts pending fixture work and unmounts its root. Updated the README, product, technical, harness, research, and evaluation documents.

### Evidence and limits

- **703 tests pass in 40 files**, 77 more checks than the previous slice. The camera navigation suite adds 47 cases; independent review ran 93 camera/review checks and 49 camera/general evaluation checks with no actionable issue. Strict TypeScript and production build pass. Main chunk: 638.29 kB minified / 192.29 kB gzip, retaining the existing size advisory. The dev fixture is not a production entry.
- All ten CLI fixture cases passed with zero model calls/tokens: `artifacts/agent-evaluation-camera-refinement-2026-09-27.json`. The camera case passed all eleven findings. These scripted tests qualify deterministic behavior and evidence plumbing, not a live model's judgment, cost, latency, or creativity.
- Browser fixture produced four validated moments: two Draft camera extrema, a Before fixed-view inspection, and a Before camera minimum. Equivalent Before maximum evidence was correctly deduplicated against the later fixed-view inspection. Cards distinguished camera 4/8 seconds, sample 2/3, from show 2 seconds, and displayed 1/7 Before versus 3/7 Draft.
- Opening the Draft midpoint recalled yaw 45°, paused at show 2 seconds, and exposed captured aspect 1:1. Opening the Before counterpart switched versions while preserving that measured pose/time and the enabled framing choice. Fullscreen screenshots showed one lit point Before and three Draft at the same square projection. This is an observed synthetic render, not general vision or continuous visibility qualification.
- Hot reload initially produced duplicate React root warnings in the dev fixture while its imported modules changed. Added disposal/abort handling, cold-reloaded, then verified a subsequent fixture-module update recreated the four moments with no new warning. Logs retain three historical duplicate-root warnings through 12:19:14; no new one appeared after the clean reload and update. Closed the temporary fixture tab after checking it.
- Main Prismatic stayed 800 drones, two 24-second scenes, playhead 34, Undo disabled. HMR cleared the session-only prepared move; restored a six-second Smooth Center · stage → Rear · overhead audition at zero and left the main preview available. No saved show/bookmark edit, API credential, live call, aircraft action, upload, publication, or neighboring CAD change.
- Camera links validate internal result consistency, not authenticated external provenance; they do not re-evaluate every fleet count when opening. Legacy/recovered camera traces without viewer/count evidence remain unlinked. The numerical loop does not model occlusion, perceived brightness, continuous coverage, or flight readiness. Live-provider quality, large-fleet rendering/endurance, and image-based agent critique remain unqualified.

### Next bounded slice

Add audience-based drone selection shared by the artist and agent: derive a bounded complete set from a captured view/time and explicit geometric or light criteria, then pass those stable IDs through existing granular commands. Preserve the distinction between camera-frustum geometry and perceived visibility, make selection changes inspectable, and use fixtures with dark, behind-camera, unselected, and dormant work to prove exact targeting without changing choreography implicitly.

## September 27, 2026 — sampled audience camera-move analysis

Connected the immersive camera rehearsal to a shared composition report for the artist and assistant. This slice adds numerical evidence along a moving audience view, with separate camera and show clocks.

### Completed

- Prepared camera auditions now expose **Analyze move**. The dialog captures the current owned path and viewport aspect when Run is pressed, with an explicit show interval and 2–12 fixed samples. Equal show endpoints hold one frame while sampling the full camera move. Opening analysis pauses preview playback; running the calculation does not move the camera or show clock.
- The worker report records exact camera/show times, every sampled pose, fixed stage placement, captured aspect, full-fleet geometry/light counts, and minimum/maximum/arithmetic-mean lit-in-frame counts. It uses the same blended show evaluator and audience projection as existing inspections, with exact endpoints and earliest-tie extrema.
- Explicit per-row **Inspect** recalls that sample's audience pose and show time, clears the prepared camera move, and closes the report. Inspect uses the current viewport framing; captured aspect remains visible historical metadata. Normal and fullscreen dialogs use the same controls.
- Job generations and project identity/revision guards reject late results. Cancel, worker errors, and invalid reruns retain a prior complete report; stale project reports disable Inspect. Core preflight enforces per-frame work plus aggregate 2-million-point / 20-million-key-work budgets before evaluation, owns inputs before asynchronous work, and never publishes partial results.
- The thirteenth agent tool, `inspect_camera_move`, resolves captured current/saved endpoint IDs, constructs a hypothetical fixed-stage path, and invokes this shared calculation on the current private draft. It propagates cancellation, preserves completed review, and records the exact request, both clocks, summary, limits, and harness provenance in compact traces. It neither controls the live camera nor supplies viewport images. Default scripted rehearsal remains unchanged.
- Updated README, product, technical, harness, research, and machine-readable tool documentation. The next research step now reflects the implemented bridge rather than describing it as future work.

### Evidence and limits

- **626 tests pass in 38 files**, including 15 new core/worker cases and 24 new real-harness cases. Analytic fixtures independently check shortest-yaw counts, dark versus lit geometry, moving/flashing shows, incoming blends, held frames, exact endpoints, immutable input capture, preflight, cancellation after the final row, and a 100,000-drone numerical sample. Independent source review found no actionable lifecycle or ownership issue.
- Strict TypeScript and the production build pass. Main chunk: 635.35 kB minified / 191.43 kB gzip; the existing size advisory remains. The dedicated camera-report worker is 71.29 kB. All nine existing CLI fixture evaluations passed with zero model calls/tokens; report: `artifacts/agent-evaluation-camera-move-2026-09-27.json`. These nine cases remain distinct from the new tool's 24 tests.
- Browser at 1165 × 813: Center · stage → Rear · overhead, six seconds Smooth, show 34–40 seconds, five samples. Camera times were 0/1.5/3/4.5/6; show times were 34/35.5/37/38.5/40. At aspect 1.4343220338983051:1, lit counts were 175/419/770/755/738, with minimum 175, maximum 770, and mean 571.4.
- **Hold current show frame** kept every show sample at 34 seconds while camera poses changed; lit counts were 175/419/770/737/716 and mean 563.4. Exact midpoint metadata was E 0 / N −17.5 m, eye 1.75 m, yaw 7.5°, pitch 60°, FOV 89.5°. Invalid sample count 1 displayed a repairable error while preserving this complete report.
- Closing analysis without Inspect retained camera elapsed 0, stage-facing yaw 0°, show time 34, and disabled Undo. Inspecting camera 3 seconds / show 37 seconds closed the report, cleared prepared transport, sought 37, and recalled north −17.5 m with rounded yaw 8° and lens 89.5° in the viewer UI. Fullscreen analysis captured its own 1.6:1 aspect and displayed complete table controls. Explicit inspection of the first sample restored the stage-facing 34-second view.
- Left the normal-size main viewer with a six-second Smooth Center · stage → Rear · overhead move prepared at zero. Prismatic remained 800 drones, two 24-second scenes, 48 seconds, playhead 34, Undo disabled. Browser logs retain transient Vite module-reload errors from 11:48 during development; completed checks added no application/WebGL diagnostics.
- No authored show or bookmark changes, live model request, API credential, aircraft action, publishing, upload, or neighboring CAD edits. Worker cancellation/stale races use deterministic/source evidence rather than forced browser fault injection. No large-fleet render/endurance qualification, rendered-image reasoning, occlusion analysis, continuous coverage, aesthetic judgment, or flight certification is claimed. Reports are session-local, and camera-move traces do not yet create proposal-preview review links.

### Next bounded slice

Add a conditional fixture evaluation that consumes `inspect_camera_move` results, makes a precise lighting edit, and checks the path again before completing its proposal. Use independent expected counts and authored-channel preservation checks. Then connect validated final-draft camera-move samples to explicit proposal-preview review moments, preserving the separate clocks, captured aspect, and original/final provenance rules.

## September 27, 2026 — private audience camera audition

Added timed camera rehearsal between saved audience views, separate from drone choreography and the show clock.

### Completed

- **Audience camera audition** is available in every Viewer 360° Stage. Select the current camera or a saved starting view, a saved destination, 1–30 seconds, and Smooth or Linear motion. Explicit **Prepare camera move** captures owned endpoints without moving the camera; Play/Pause, scrub, Start, Replay, and Clear operate that prepared move. Invalid form values retain the previous plan.
- Position, eye height, pitch, and field of view interpolate; yaw takes the shortest arc with a clockwise 180° tie. Smooth uses cubic smoothstep. Endpoints are exact and independently owned. The stage remains fixed: both saved layouts must agree with each other and the current reference stage.
- The camera clock advances in the existing Stage RAF independently of show playback. Camera snapshots settle between RAFs, and monotonic rebasing avoids counting time twice when a synchronous capture precedes an older RAF timestamp. Atomic viewer/venue baselines prevent automatic stage-facing logic from overwriting translated camera directions. UI progress publishes at 10 Hz while moving.
- Direct drag, arrows/Home, wheel zoom, direction buttons, camera/venue edits, and bookmark/evidence recall take over and clear the move. Closing the panel or opening viewing settings pauses and publishes the current pose. Design, project-ID changes, context loss, and unmount clear it. Same-project Before/Draft switches preserve the path and clock. Frame capture pauses both camera and show clocks before the existing exact-frame capture.
- The compact panel separates draft fields from prepared transport. Browser review identified an initially hidden Play button after preparation; successful Prepare now scrolls to and focuses Play, without scrolling during playback or discarding typed fields. The controls fit the short proposal preview and fullscreen. Updated product, technical, harness, research, and README documentation.

### Evidence and limits

- **587 tests pass in 36 files**, including 21 new camera-plan/clock cases. Sixty focused camera/viewer checks pass. Tests cover canonical bounds, fixed layouts, deep ownership, exact endpoints, shortest/opposite yaw, smoothstep, intermediate bounds, fractional timing, pause/rebase/seek, delayed/backward/extreme timestamps, and endpoint holds. Independent source review of core, Stage lifecycle, and controls found no actionable issue. Strict TypeScript and production build pass; main chunk is 620.38 kB minified / 187.57 kB gzip with the existing size advisory.
- Browser prepared Center · stage → Rear · overhead over six seconds. Native keyboard seek to three seconds, followed by an actual frame capture, recorded E 0 / N −17.5 m, eye 1.75 m, yaw 7.5°, pitch 60°, vertical FOV 89.5°, while the show remained at 34 seconds. These match the independent midpoint expectation. An invalid zero-second duration preserved the prepared move.
- A 30-second camera move and show playback ran together. Switching Draft to Before preserved active camera progress (0.53 → 1.06 seconds) and show progress (34.3 → 34.8). Capture later paused the camera around 21 seconds. A separate capture begun with both clocks playing paused the camera near 0.60 seconds and the show at 0.346 seconds; its image metadata recorded the corresponding interpolated pose.
- ArrowRight took over and removed the prepared camera transport; playing a new move and switching Design/Viewer also removed it. Fullscreen showed the full panel and exact endpoint/Replay controls, then returned to normal size. Main preparation passed after a clean reload; Prismatic remained two scenes, 800 drones, 48 seconds, playhead 34, Undo disabled.
- Development hot reload had left the main mounted renderer with an older API. Its friendly unavailable message prompted a normal browser reload; the clean app then supported preparation correctly. Historical Vite module-reload errors from 11:14 remain in the console, with no new application/WebGL diagnostics during completed checks. The reload cleared the session-only scripted proposal used for earlier private checks; it was never applied. Left the main viewer with a six-second Smooth Center · stage → Rear · overhead move prepared and paused at its start.
- No authored show or saved-view edits, API key, live model, provider request, aircraft action, publishing, external upload, or neighboring CAD changes. Stage/venue mismatch, invalid poses, and timing boundaries have deterministic coverage; browser project-replacement/context-loss races and large-fleet endurance were not forced. This is a desktop camera rehearsal, not a persisted camera track, agent camera tool, video export, or aesthetic/flight qualification.

### Next bounded slice

Add a sampled composition report along a prepared camera move with an explicit mapping to show time, using the existing numerical audience engine. Share the same bounded calculation with a read-only agent tool so the assistant can inspect what changes across a camera rehearsal. Keep exact sampled poses/times visible, cancellation and previous-result preservation, and no implicit camera movement or authored edits.

## September 27, 2026 — portable audience review files

Added one portable `.lucid-frame` artifact containing the rendered PNG and its exact camera/time metadata, plus read-only import throughout the studio.

### Completed

- **Prepare review file** produces an explicit **Download review file** link beside the separate PNG and JSON downloads. **Open review file** works in the main Stage, independent study, and private proposal preview, including Design mode and without a capture-capable renderer. Capture remains specific to private audience previews.
- A bounded versioned container binds canonical metadata and PNG bytes with SHA-256. Import validates exact lengths, strict metadata ownership/consistency, PNG chunk structure/CRC, static-image status, pixel limits, and compressed scanline lengths/filter bytes before browser decoding and dimension checks. Independent review caught animated-PNG and BOM acceptance; both are now rejected.
- Browser testing exposed a further issue: `Image.decode()` accepted a structurally valid PNG with invalid compressed data as a blank image. Native bounded decompression now rejects that fixture while retaining real black images. It streams/discards output, supports declared PNG formats and Adam7, and cancels pending work. Internal compressed-stream canonicality still depends on native codecs and is not claimed.
- Imported reviews display original project/revision/time/camera and **Imported review · integrity checked**, with an explicit distinction between consistency and authorship. They never apply edits or recall the camera. A shared job generation, abort controller, temporary decode URL, and owned retained URLs prevent stale replacement and preserve the previous still on failure.
- Responsive review actions wrap as complete buttons within narrow modals. Added a reproducible, clearly synthetic fixture generator and valid/tampered/invalid-compression artifacts. Updated product, technical, agent, research, and README documentation.

### Browser evidence and limits

- **566 tests pass in 35 files**, strict TypeScript and production build pass. Twenty-nine new artifact cases cover owned canonical metadata, byte tampering/lengths, APNG/BOM rejection, PNG checksums/pixel formats, actual compressed-data failures, all supported color/depth combinations, independently derived Adam7 pass lengths, over/underexpansion, cross-chunk filters, codec support, cancellation within large output chunks, and late EOF errors. Independent source review found no remaining actionable issue. Main chunk: 608.69 kB minified / 184.15 kB gzip, retaining the existing size advisory.
- A real Before capture at 34 seconds, 598 × 417 pixels and the recorded 1.4343220338983051:1 projection, prepared a native `.lucid-frame` download link with the expected timestamped filename. The browser's download-event observer timed out, so actual filesystem download and reimport of that downloaded file remain unverified. Core byte round trips and fixture imports were verified separately.
- The valid synthetic review imported with its 256 × 128 image, 12-second time, original camera, and synthetic project label. A changed checksum failed while keeping that still. After adding compressed-data validation, the previously browser-accepted blank-image fixture failed with the explicit compressed-data error and retained the preceding review.
- Main Design-mode import left Prismatic's 34-second playhead and disabled Undo intact. A 390 × 844 viewport showed the complete imported image, metadata, and wrapped actions without horizontal overflow. The temporary viewport override was reset.
- Left a real **Draft** audience still open: Prismatic r42, Chromatic vortex at 34 seconds, 1470 × 417 pixels, yaw 0°, pitch 35°, eye height 1.7 m, vertical FOV 90°, glow 0.85, exposure 1.15. Its review file is prepared. Final logs retain eight temporary Vite module-reload errors from 10:44:41; finished checks produced no new application/WebGL diagnostics.
- No Apply, saved-show edits, provider requests, credentials, aircraft actions, external upload, publishing, or neighboring CAD changes. Native decoder compatibility has been checked in the current in-app browser and Node test runtime, not every browser. Large-image endurance, forced browser cancellation/context-loss, model image reasoning, and flight qualification are not established.

### Next bounded slice

Return to the immersive viewing experience: add an explicit private audience-camera audition between saved viewpoints, with inspectable timing and smooth motion. Keep this presentation layer separate from drone choreography and saved-show history, and retain direct look-around controls. The agent should eventually operate the same camera tools after deterministic behavior is established.

## September 27, 2026 — local rendered audience captures

Added explicit still capture and review to the private Before/Draft audience preview, with a PNG and an owned metadata sidecar.

### Completed

- **Capture audience frame** pauses the shared transport at its settled time, waits for the exact owned document/side/sample to render, and captures the postprocessed canvas. A queued change to version, seek, camera/venue, aspect, framing, or appearance rejects the capture. The original pre-pause React props may wait for publication rather than being mistaken for a new edit.
- The matching RAF forces a fresh composer render and starts PNG bitmap copying synchronously in that callback. Metadata is captured beside the draw, before asynchronous encoding: project/revision, Before/Draft side, shared and sampled time, held endpoint, scene/local time, fleet, audience snapshot, projection aspect, framing, raster dimensions, glow/exposure, and UTC timestamp. Interface overlays and frame margins are excluded.
- One bounded capture job per Stage, ten-second deadline, explicit Cancel, and exactly-once abort/context-loss/unmount handling. Valid images are capped at 16 million pixels / 32 MiB; the encoder validates PNG MIME/signature and ignores late/duplicate callbacks. Metadata validation does not scan authored drone/key payloads.
- One local retained still with nested review and separate **Download PNG** / **Download JSON** actions using a shared timestamped filename stem. Failed replacement preserves the previous image; successful replacement and unmount release owned URLs. Switching to Design while encoding does not relabel or discard an already-copied historical bitmap; its review opens only when Viewer is available.
- Updated product, technical, harness, research, and README documentation. No image tool or provider image input was added; captures remain local.

### Evidence and limits

- **537 tests pass in 34 files**, including 26 metadata/encoder tests and seven request-matching tests. Cases cover exact scene/held endpoints, ownership and bounds, original pause-pair waiting, strict document identity, changed camera/venue/appearance/framing, PNG failures, timeout/cancellation during encoding or header validation, cleanup, and late callbacks. Independent source review found no remaining actionable issue. Strict TypeScript and production build pass; the main chunk is 596.62 kB minified / 179.96 kB gzip with the existing size advisory.
- Browser captured a rendered 1470 × 417 Draft image at 34 seconds with yaw 0°, aspect 3.525:1, glow 0.85, and exposure 1.15. After switching the live view to Before at 24 seconds and yaw 180°, reopening the still retained Draft/34 seconds/yaw 0°.
- Capturing the shorter Draft at shared time 48 seconds recorded sampled time 43.2 seconds, scene-local 19.2, and **End frame held**. Capturing during playback paused at 0.29979999995231627 seconds; the image's exact timestamp agreed with the preview's rounded 0.300-second accessible clock.
- Recalled the measured Before view at 34 seconds, enabled Captured frame, and captured in fullscreen: **1932 × 1347 pixels**, aspect 1.4343220338983051:1, stage-facing camera. Screenshot confirmed a nonblank postprocessed image and complete review layout. The still survived leaving fullscreen and a Design/Viewer round trip. Main playhead stayed at 34 seconds with Undo disabled; left this full-resolution still open for review in the normal-size browser.
- The PNG download-event observer timed out; no successful file-download round trip is claimed. PNG display and metadata/serialization behavior were verified, while both explicit download actions remain available. This is a browser verification limit, not evidence that the encoder failed. Cancellation/context-loss races have deterministic/source coverage, not forced browser fault injection.
- Introducing the new modules produced temporary Vite reload errors and one old mounted Stage lacked the new capture method; reopening the private preview installed the current renderer API. Completed capture checks showed no new application/WebGL errors; final logs retain eight module-reload messages from that development update. No Apply, saved-show edits, live model, API credentials, aircraft, publishing, or CAD changes.

### Next bounded slice

Package each review image and its metadata into one portable artifact with an integrity check, then verify the export/import path with bounded fixtures and a visible browser result. Keep historical captures separate from saved-show edits and do not add model uploads until their review/consent contract is designed.

## September 27, 2026 — captured audience framing

Added an explicit way to reproduce an agent inspection's projection inside the immersive Before/Draft preview, independent of the surrounding window shape.

### Completed

- Opening a measured moment makes its aspect available as **Captured frame** in Viewer 360°. The toggle starts off, remains accessible in fullscreen, and retains its choice across Before/Draft switches and later moment recalls. Design uses the full viewport and restores the framing choice on return to Viewer. Direction, lens, appearance, playback, and authored show data remain independent.
- A small geometry helper fits a centered frame using fractional CSS dimensions and the exact captured camera aspect. The canvas, renderer, and postprocessing share that frame; surrounding controls stay in the full-size host. Frame margins receive no canvas look gestures. Sprite sizing and drag sensitivity use the fitted dimensions.
- ResizeObserver handles host changes; mode/aspect changes reconcile before rendering and before audience-context capture. Unchanged frame geometry does not resize render targets. Invalid/empty frame geometry hides the canvas and suppresses rendering/capture until a usable size returns. Subpixel frames retain exact CSS/projection geometry while allocating at least one logical raster pixel.
- Review identified projection overflow for extremely small otherwise-positive aspects. The viewer accepts only candidates whose horizontal projection coefficient remains finite in Float32 at the narrowest supported 45° lens. Unsupported historical candidates offer no framing toggle; the existing agent transport schema is unchanged.
- Product, technical, README, harness, and research docs explain the opt-in frame, historical count semantics, movable camera, and numerical rather than rendered-image evidence.

### Evidence and limits

- **504 tests pass in 32 files.** Twenty-seven new framing tests cover centered wide/tall/same-aspect layouts, fractional geometry, bounds, ownership, resize, unrepresentable dimensions, and real Three projection matrices. An independent Three projection oracle agrees with audience-inspection membership across six viewport shapes when the captured aspect is used; natural-aspect counterexamples demonstrate the difference. Strict TypeScript and production build pass. The main chunk is 584.36 kB minified / 176.15 kB gzip, retaining the existing size advisory. Independent source review found no remaining actionable issue.
- In the desktop browser, the recorded 1.4343220338983051:1 aspect fitted a 398.742 × 278 CSS-pixel canvas inside a 980 × 278 host. An explicit comparison at 34 and 35 seconds reproduced **175 lit points at 34 seconds**, matching the original Before inspection. This used the existing zero-token scripted proposal, not a live model.
- Design restored the full 980 × 278 canvas; returning to Viewer kept the frame enabled. Fullscreen fitted 1288.02 × 898 inside a 1438 × 898 host. Dragging the left margin left yaw at 0°; a canvas drag moved yaw to 8°, and Home restored stage-facing 0°. The fullscreen toggle restored full viewport framing and could re-enable the capture.
- A temporary 620 × 1100 viewport produced a 508 × 354.174 frame centered vertically in the 508 × 498 host. Restoring the default browser size restored the original centered frame. Changing framing while playing kept the shared clock running; an explicit moment recall paused at 34 seconds and retained the enabled frame. The temporary viewport override was reset.
- Closing preserved the main 34-second playhead and disabled Undo. Left a reopened Before preview paused at 34 seconds, stage-facing, with Captured frame enabled and the evidence list collapsed. Final browser warnings/errors were empty. No Apply, saved-show edits, API credentials, live provider, aircraft, publishing, or neighboring CAD changes. Different-aspect moment sequences have helper/source coverage; this browser proposal exposed one recorded aspect. Tests do not establish identical rendered pixels, occlusion, aesthetic quality, or six-figure endurance.

### Next bounded slice

Add explicit local frame capture for proposal review: produce a rendered still with its exact document version, show time, camera, and aspect metadata. Keep capture inspectable and tied to the displayed moment, handle cancellation/stale state, and avoid external upload or live-provider claims. This supplies a concrete foundation for later image-based agent review.

## September 27, 2026 — measured audience review moments

Connected completed agent audience inspections to explicit camera/time navigation in the private Before/Draft preview.

### Completed

- Successful `inspect_viewpoint` and `compare_viewpoints` trace results now carry harness-generated project, base revision, evaluated revision, and staged-operation count. Original-document evidence uses zero operations; completed-draft evidence must match the final proposal's count. Intermediate batches are omitted because their private revision alone cannot distinguish them from the final draft.
- A bounded helper derives at most 12 owned review moments from the completed run's full trace. It validates unique tool start/result pairs, provenance, canonical camera snapshots/aspects, finite show-time bounds, fleet counts, and extrema at actual comparison sample times. Equivalent moments are deduplicated, with both versions represented when valid evidence exists. Malformed, legacy, and recovered traces without provenance do not create links.
- **Measured review moments** is collapsed by default. Rows identify Before/Draft, the captured audience view, show time, inspection or sampled extremum, measured lit-point count, source event, and captured aspect. Measurements are numerical geometry without occlusion; current preview dimensions can produce different framing.
- **Open moment** pauses, selects the measured version, seeks its show time, and recalls its audience pose/venue. It switches Design to Viewer 360° through the existing camera API, preserving the renderer, appearance, audition loop, and playback rate. Ordinary A/B switching still preserves the artist's current camera.
- Tightened preview spacing to fit the new row without reducing the 280-pixel minimum canvas. Updated product, technical, harness, research, and README documentation.

### Evidence and limits

- **477 tests pass in 31 files**, including 21 new helper and real-harness cases. They cover baseline/final/intermediate provenance, ambiguous or malformed events, camera/count/time bounds, ownership, deduplication/caps, actual comparison extrema, and cumulative continuation. Independent recomputation checks the emitted counts; the default rehearsal remains eight tools with audience context and zero model tokens. Strict TypeScript and production build pass; the main chunk is 582.38 kB minified / 175.47 kB gzip with the existing size advisory.
- Fresh browser rehearsal proposed 48 → 43.2 seconds. Its captured Before inspection reported **175 / 800 lit points** at 34 seconds and aspect 1.4343220338983051:1. Opening that moment from a playing Design preview selected Before, paused at 34 seconds, restored the stage-facing eye-level camera, and retained a 24–32-second loop at 0.5×. The outside-loop position correctly offered **Play returns to In**.
- Looking behind and switching normally to Draft preserved 34 seconds and the new 180° direction; explicitly opening the moment restored Before and the captured stage-facing camera. Closing preserved the main 34-second playhead and disabled Undo. Left a reopened Draft preview at 34 seconds facing the stage, with the measured-moments section available.
- Final 1165×813 screenshot fits header, canvas, controls, and footer. Console retains a previously corrected hot-reload declaration-order error and its React warning; no new application/WebGL diagnostics appeared during these completed checks. No Apply or saved-show edits, credentials, live provider, aircraft, or neighboring CAD changes. Multi-view extrema have deterministic coverage; broad mobile/fullscreen combinations and six-figure endurance remain unqualified.

### Next bounded slice

Make captured framing reproducible in review: offer an explicit captured-aspect frame within the immersive preview, preserving the current viewport as the default. Keep the audience camera, Before/Draft clock, and measurement provenance aligned, and verify resize/fullscreen behavior without changing authored show data.

## September 27, 2026 — private audition loops and playback speed

Added repeated slow/fast visual inspection to the Before/Draft audience comparison without changing authored timing or the main transport.

### Completed

- One shared preview speed (0.25×, 0.5×, 1×, 1.5×, or 2×), optional In/Out loop, and exact full-show endpoint stop. Enabled loops use `[In, Out)` and preserve overshoot across delayed frames and multiple wraps. Shorter versions still hold their own endpoint while the common clock continues, then resume on wrap.
- Compact Loop/rate/status controls and a collapsible range editor. Numeric bounds and Set In/Out are explicit show seconds; canvas-only I/O/L shortcuts mark bounds or toggle looping. Inputs are kept separate from validated committed bounds. Invalid attempts show an error and retain the previous range; typing/marking may pause. Loop off retains the range but plays the full show.
- **Loop scene** encloses the selected scene's Before/Draft intervals; **Loop transition** encloses its existing positive incoming blends. First scenes and cuts have no blend interval. Added/removed/reordered scenes use stable IDs; a wide enclosure can include intervening scenes. Presets replace draft input, pause, enable looping, and seek In.
- A preview-only hook synchronously settles the old clock before a speed change or pause, returns exact stopped time for marking, and cancels pending RAF work with a generation guard. Speed changes continue from the settled time unless already ended. A/B switches stay outside the clock lifecycle. Paused seeks can inspect outside the loop; Play returns to In when needed, and Restart respects the active loop.
- Review found and fixed nested-dialog shortcut isolation in fullscreen, where portals are physically inside the Stage. Both DOM containment and nearest-dialog ownership are now checked. The collapsed layout budgets space for the extra toolbar while keeping a minimum 280-pixel canvas. Product, technical, harness, and README docs updated.

### Evidence and limits

- **456 tests pass in 29 files**; 44 new clock/validation cases and eight new preset/integration cases. Coverage includes supported rates, zero/resume/EOF anchors, invalid finite bounds, fractional and adjacent-float ranges, delayed/multiple wraps, speed rebasing, overflow, ownership, actual retiming, shifted/reordered scenes, inactive blends, and shorter-document holds. TypeScript and production build pass.
- A fresh eight-tool scripted rehearsal used zero model tokens and left the 48 → 43.2-second proposal unapplied. Browser **Loop transition** chose 24–32 seconds. Invalid 40–32 input preserved 24–32 with an inline error. A 24–25-second range continued at 2× across repeated wraps, Before/Draft switching, and audience direction changes.
- A landmark seek to 48 seconds paused outside that range with **Play returns to In**; Play resumed inside 24–25. Set In stopped at 24.825199999809264 seconds, matching the sampled clock's 24.825-second accessible readout (the native frame-step slider rounds its own value). Changing from 0.5× to 2× retained active playback and advanced from 00:00:24:06 to 00:00:24:14 instead of restarting.
- In fullscreen, nested Audience comparison opened on its own focused dialog. Space/backslash preserved the outer Before selection and 00:00:24:19 paused clock; Escape closed only the nested dialog. Loop off plus Restart returned to zero. Canvas I/O/L established 24–30.4 seconds; typing L in the speed select left looping unchanged, and canvas Space resumed within the range.
- Closing preserved the main 34-second playhead and disabled Undo. Reopened the preview and left Draft paused at 30.4 seconds facing the stage, with a 24–32-second loop and 0.5× speed ready. The final 1165×813 collapsed layout fits header, audience canvas, controls, and footer.
- A temporary memo declaration-order error during hot reload was corrected before the finished browser checks and caused a development refresh; the saved project remained intact. Final logs retained that error and its React warning, with no new application/WebGL diagnostics during completed checks. No Apply, credentials, live provider, aircraft, saved-show edits, or CAD edits. This is deterministic/mock verification, not live-model evaluation or six-figure/endurance qualification. Arbitrary mobile sizes and every nested-panel combination were not exercised.

### Next bounded slice

Connect proposal review to the agent's measured evidence: derive a small set of explicit review moments from successful viewpoint/transition inspection results, and let the artist open those moments in the private Before/Draft preview. Validate their document revision, camera references, and time bounds; keep arbitrary text and unsupported visual claims out of executable navigation.

## September 27, 2026 — changed-scene navigation in audience comparison

Added editing landmarks to the immersive Before/Draft preview so an artist can find a proposed change from the same audience position.

### Completed

- **Changed scene** lists authored changes using stable IDs, including added, removed, renamed, and reordered scenes. Later scenes whose start merely shifted are not counted as edited. All 1,024 possible IDs across two 512-scene documents are navigable; the existing compact impact report still defaults to 12. Fleet, tempo, design-limit, and project-name changes remain explicit without scene edits.
- Each side offers its own scene start, first/last eligible edited key, and changed transition endpoint. Landmarks are deduplicated and bounded, exclude dormant drone keys and out-of-scene key timestamps, and do not claim the onset of an interpolated visual difference. Exact nonfinal end keys, including timestamps that round onto the next scene boundary, are excluded from in-scene key jumps.
- Selecting a scene changes only the navigation selection. A labelled Before/Draft landmark pauses playback, chooses that version, and seeks its show-global time. Both currently playing scene names and **Scene +** local clocks remain visible, with independent held-end labels. The one mounted Stage, shared clock, audience direction, and read-only behavior remain intact.
- Navigation and its option list are memoized outside playback. Compact controls, long-name truncation, native select keyboard behavior, and a viewport-sized dialog keep the audience canvas prominent. Product, technical, harness, and README instructions updated.
- Browser checking uncovered a fractional transition endpoint bug: `30.4 - 24` can be slightly below `6.4`. The shared `frameAt` now recognizes the exact global transition endpoint before dividing, without an epsilon. All four easing profiles have regression coverage for the endpoint and a strictly earlier sample.

### Evidence and limits

- **404 tests pass in 27 files**; strict TypeScript and production build pass. Sixteen new helper tests plus seven command-to-navigation integration cases cover default/full scene bounds, per-side landmarks, add/remove/reorder/rename, downstream shifts, global-only changes, dormant records, ownership, actual retiming, differing current scenes, held endpoints, and fractional transition completion.
- Browser generated a fresh eight-tool rehearsal with zero model tokens after the shared timing module refreshed the page. Its 48 → 43.2-second proposal remained unapplied. At a captured 180° look direction, Draft's 30.4-second key/transition endpoint now shows **Formation**. Starting playback then jumping to Before's 32-second key paused, selected Before, and retained 180°.
- Selecting the current changed scene and pressing backslash while its select was focused left Before at 32 seconds. At shared 48 seconds, the readouts showed Before scene-local 24 seconds and Draft scene-local 19.2 seconds with **End frame held**. The 24-second scene-start jump showed the incoming scene at local zero. The final 1165×813 layout fits the enlarged canvas, landmarks, and footer controls.
- Closing left the main playhead at 34 seconds and Undo disabled. Reopened Draft at 34 seconds, stage-facing 0°. Browser logs retained four Vite reload errors from module updates; no application/WebGL errors appeared in the finished checks. No Apply, live provider, credentials, aircraft, saved-show edits, or neighboring CAD edits occurred. Added/removed/many-scene navigation has fixture coverage; those UI variants, mobile/fullscreen/endurance, and 100,000-drone performance were not browser-qualified.

### Next bounded slice

Add a private audition range and playback speed to the Before/Draft comparison: loop a short transition or key interval while looking around and switching versions. Keep explicit show-global bounds, independent endpoint holds, one shared transport, and the main show untouched.

## September 27, 2026 — synchronized Before/Draft audience preview

Made the visual effect of a proposal directly comparable before applying it, using one persistent preview canvas and one shared show clock.

### Completed

- Proposal **Preview** now offers **Before** and **Draft**, each labelled with fleet size and duration. Switching changes the displayed document while retaining the same mounted Stage, audience/Design camera, lens, reference venue, appearance, viewport aspect, and playhead. One renderer avoids doubling WebGL work for a side-by-side layout.
- Preview opens from the main viewer's current audience snapshot, captured once and installed before the first rendered frame. Later camera gestures affect either version equally. Stage does not reapply the opening snapshot on project switches.
- A silent shared transport spans the longer version using show-global time. Each document clamps independently to its own endpoint; **End frame held** appears only strictly after the selected version ends. The shorter end frame is not continuously re-evaluated while the longer shared clock continues. Version switches do not restart playback.
- Added independent owned baseline/draft capture with project ID/revision validation and private atomic command application. Inputs, returned sides, proposal data, and viewer snapshots do not share mutable references. Stale proposals retain the existing close/apply guards; no preview control commits edits.
- Canvas Space/backslash shortcuts, native keyboard behavior for controls, local seek/restart, and nested comparison pause behavior. Portal containment guards keep an inner numerical comparison's keys from switching or playing the outer preview. README, product, technical, and harness docs describe the exact clock and camera semantics.

### Evidence and limits

- **381 tests pass in 25 files**; strict TypeScript and production build pass. Seventeen new helper tests cover cross-project/stale rejection, invalid-batch rollback, ownership, finite/clamped time, shorter/longer/reordered shows, independently checked transition positions, preserved dormant/beyond-scene keys, and exact endpoint handling. Main chunk remains about 562 kB minified / 169 kB gzip, with Vite's existing size advisory.
- Browser generated a fresh eight-tool scripted rehearsal (zero model tokens), proposing 48 → 43.2 seconds. Preview opened at the main captured 180° rear direction and 34-second playhead. Button and backslash switches retained that camera/time. At the shared 48-second endpoint Draft showed its exact 43.2-second end frame with the held label; Before showed 48 seconds without it.
- Playback continued through version switches from 00:00:00:18 to 00:00:10:17 instead of restarting. Canvas Space started playback; opening numerical comparison paused locally at 00:00:10:19. Space/backslash in that nested dialog changed neither the outer version nor its playhead; Escape closed the nested report independently.
- Closing the preview left the main playhead at 34 seconds and Undo disabled. Restored the main stage-facing view and reopened the unapplied proposal: Draft starts at 34 seconds and 0° stage-facing orientation. No Apply was attempted. Final browser logs retained four historical Vite reload errors from introducing the new modules; completed checks showed no application/WebGL errors. Broad mobile/fullscreen, stale-edit UI races, and six-figure performance were not exercised. No live model, credentials, aircraft, or neighboring CAD work was used.

### Next bounded slice

Add changed-scene navigation within proposal comparison, with explicit baseline/draft cue names and useful jump points for affected timing or keyframe ranges. Help the artist find the visible effect of an edit while keeping shared-clock semantics clear and every change unapplied until chosen.

## September 27, 2026 — measured audience-aware agent refinement

Completed the next bounded evaluation slice: a conditional scripted agent that measures the audience composition, makes a precise brightness edit, and measures it again before returning a reviewed proposal.

### Completed

- Added the ninth CLI case, **audience-light-refinement**. Its isolated seven-drone fixture has three lit points ahead and, behind the viewer, one lit point, two selected dark points, and one unselected dark decoy. A dormant ninth drone and beyond-scene keys test preservation. Captured north/south camera poses and aspect make its expected geometry explicit.
- The fixture provider consumes actual comparison output to choose the weaker view, then actual viewpoint inspection to intersect selected IDs with dark in-frame points. It merges only brightness into existing keys at 0/1/2 seconds, compares again, reviews, and returns an unapplied proposal. It refuses to finish when measured improvement is missing. This is a deterministic conditional program, not a model or a default UI rehearsal change.
- An independent oracle checks north geometry/lit counts of 3/3 throughout, south geometry 4 throughout and lit counts 1→3 at each sampled moment, unchanged authored/evaluated motion, and unchanged unselected RGB. The full-document oracle also rejects damaged channels, dormant work, and other changes that sparse samples would miss. Reports include exact captured poses/aspects/times, compact before/after counts, and contributing comparison event IDs.
- Evidence must cover both captured views before the first successful edit and after the last. Valid separate per-view comparisons and split edit batches pass; duplicate one-view reports and stale comparisons followed by another edit fail. Review caught and corrected an initial same-call-only restriction. The fixture prompt explicitly requests the bounded three-sample comparison protocol.
- Added 18 adversarial integration tests and five provider responsiveness tests. They exercise wrong-view/ID edits, decoy changes, flattened keys, wrong boundaries, motion/color damage despite matching counts, missing/stale/wrong-time evidence, no-ops and prose-only claims. The provider also follows changed measured geometry and selected IDs instead of hard-coded targets.
- Updated evaluation, product, technical, harness, README, and research status docs. Numerical camera context is clearly distinguished from future rendered-image review.

### Evidence and limits

- **364 tests pass in 24 files**; strict TypeScript and production build pass. All nine CLI fixture cases pass with zero input/output model tokens. Final report: `artifacts/agent-evaluation-audience-verified-2026-09-27.json`. Earlier focused/intermediate reports remain as execution records. The audience case passes all 13 named findings through six actual tool calls and three brightness-key operations, applied only to an isolated in-memory verification copy.
- The browser's existing 1,200-light study remained available at 12 seconds. Behind changed heading to 180°, and Stage restored 0° without moving its playhead. Left it open facing the stage. Browser warnings/errors were empty. No UI code changed in this slice; broader UI checks were not repeated.
- Main production chunk remains 558.23 kB minified / 167.56 kB gzip with the existing Vite size advisory. These checks do not establish live-model competence, rendered-image understanding, continuous visibility, performance at 100,000 fully-keyed drones, or flight readiness. No credentials, live provider, aircraft, saved-project edits, or neighboring CAD changes were involved.

### Next bounded slice

Add a synchronized before/after audience view for AI proposal previews: use the same captured camera and playhead to compare the saved baseline with the private draft, making the visual effect of a refinement directly reviewable without applying it. Keep independent transport, explicit camera controls, cancellation/recovery, and current project preservation intact.

## September 27, 2026 — audience comparison across time

Added a bounded composition report shared by the artist and agent, connecting saved audience views to explicit moments in the show.

### Completed

- **Compare views** is available in main Viewer 360°, the independent surrounding study, and draft previews. Select one to four current/saved views, a current-scene/whole-show/custom range, and 2–12 evenly spaced samples with exact endpoints. The selected interval also displays its beat span.
- The report compares minimum, maximum, and sampled-mean lit-in-frame counts, then exposes per-moment stage-relative quadrants, overlapping overhead, geometric frustum, and lit-frustum counts. Each report retains captured camera/stage/aspect metadata and project revision. **Inspect** restores the selected captured pose, seeks that preview's own transport, and closes the report.
- A shared immutable calculation preflights two million point inspections, twenty million aggregate weighted key operations, and the existing per-frame key budget. UI computation runs in a dedicated terminable worker. Cancellation/failure preserves previous reports; revision changes terminate current work and make earlier results stale. Generation guards ignore late messages.
- Added the twelfth read-only agent tool, **compare_viewpoints**, using the same calculation against the current private draft. The harness awaits tool Promises, propagates cancellation, and preserves reviewed operations. Compact traces retain times/view metadata/summaries without duplicate per-sample rows. Default scripted rehearsal remains eight calls when audience context is present.
- Dialog portals support nested study/draft comparisons. Escape closes only the top dialog and restores its trigger focus. Keyboard trapping handles focus loss when running forms disable controls and excludes hidden/inherited-disabled fields. README, product, technical, harness, and tool metadata documents updated.

### Evidence and limits

- **341 tests pass in 22 files**; strict TypeScript and production build pass. Thirty new tests cover analytical changing visibility, exact endpoints, immutable captures, summary/tie semantics, budgets/abort, two-view agent results, unknown-ID repair, invalid inputs, response limits, preserved reviews, and cancellation stopping later tools. Main bundle: 558.23 kB minified / 167.56 kB gzip, with the existing Vite size advisory; comparison worker: 69.21 kB.
- Browser main report sampled 24/30/36/42/48 seconds: stage-facing lit counts ranged 136–242 (sampled mean 181.2), versus 717–770 (mean 743) for **Rear · overhead**. Entering one sample showed an inline error and retained the report. Inspect at 30 seconds recalled the saved 1.8 m eye height, 15° yaw and overhead look. A custom 34–48-second two-sample report restored **Center · stage** at 34 seconds.
- Browser study report sampled 0/12/24/36/48 seconds, with 300 drones in each horizontal quadrant at every listed time and stage-facing lit counts 514–526. Shift-Tab wrapped within the nested report; Escape closed only the report and restored its trigger focus. A subsequent first-chapter report's Inspect 12 action moved only the study playhead. Left the stage-facing study open at 12 seconds; main Prismatic remained at 34 seconds, 800 drones/two 24-second scenes, Undo disabled. Browser warnings/errors were empty.
- Core/agent cancellation has deterministic coverage; interactive worker cancellation and project-change races were not forced in the browser. Draft-preview wiring is type-checked but not separately browser exercised. Fullscreen, mobile, endurance, and six-figure fully-keyed playback remain unbenchmarked. Whole-project clone/worker serialization scales with document size beyond the frame-work estimates.
- Discrete sampled geometry does not measure rendered pixels, occlusion, perceptual quality, or continuous coverage. No live model requests, keys, aircraft, publishing, or saved-show edits were used.

### Next bounded slice

Add a deterministic audience-aware agent scenario: use comparison to choose a precise editable lighting/motion change, verify the resulting composition at explicit moments, and preserve unrelated authored channels. Keep preview interaction and measured draft review central; qualify real model choices after a key is supplied.

## September 27, 2026 — surrounding study and agent audience inspection

Combined the user's immersive-view priority with the agent harness: a separate authored surrounding show, and a read-only numerical tool for inspecting the show from captured audience viewpoints.

### Completed

- **360° study** opens **All around you** in a separate read-only preview: 1,200 individually authored lights, three 16-second chapters, flowing ribbons across the full horizon, and an overhead crown. The 120 BPM study has explicit per-drone motion, color, and brightness keys with continuous scene boundaries. It is silent; the existing soundtrack stays paused.
- The study has its own playhead, playback, chapter jumps, Viewer/Design cameras, and an editable JSON download. Opening and closing it never replaces the current project. Its reproducible source is `src/core/immersive-study.ts`, CLI `scripts/immersive-example.ts`, and shipped bundle `public/examples/immersive-study.lucid.json`.
- Added the eleventh expert tool, **inspect_viewpoint**. Main-stage audience pose, current aspect ratio, and local saved viewpoints are captured once when a request starts. Strict transport/harness validation clones the context and rejects malformed ranges, duplicate IDs, and unexpected fields. The agent discovers views through `inspect_show`, then inspects current or saved IDs against its current private draft.
- Inspection uses the shared motion/light evaluator, including incoming scene blends, brightness, flash gating, and beat modulation. Counts cover the entire active fleet: stage-relative front/right/rear/left, overlapping overhead count, camera frustum, positive RGB, and their intersection. At most 32 evenly distributed representative rows are returned. It does not move the camera, stage edits, or invalidate a completed review.
- Both audience inspection and existing frame sampling now check a conservative five-million weighted active-key-work budget before evaluation. Missing views are repairable errors. Rehearsal conditionally exercises the new tool when viewer context exists, with unique call IDs and bounded inspectable trace fields including snapshot/aspect, counts, semantics, and limitations.
- Modal Escape handling now lets nested viewer controls consume their own cancellation gesture before closing the dialog. Product, technical, harness, README, and tool-manifest docs describe the new flow.

### Evidence and limits

- **311 tests pass in 20 files**. After the final trace-detail adjustment, all 56 focused harness/expert/viewpoint tests passed again; strict TypeScript and the production build pass. Vite retains its bundle advisory (542 kB main chunk / 163 kB gzip). The 38 additions include analytic perspective/ENU/blend/light fixtures, context validation and immutable capture, read-only review preservation and tool repair, conditional rehearsal, study coverage/continuity, and shipped bundle/CSV round trips. A transient syntax error during parallel test-file editing was fixed before the successful complete run.
- Browser: the independent preview opened at eight seconds with 1,200 lights and three chapters. Inspected stage-facing, rear-facing (180° at 24 seconds), and overhead renders (40 seconds). Playback advanced from 24 to 48 seconds and stopped at the endpoint. Closing returned focus to the study button; main Prismatic study remained 800 drones/two 24-second scenes at 34 seconds with Undo disabled. Escape closed a focused inner viewer panel before the dialog; a second Escape closed the dialog and restored focus. Final browser warnings/errors were empty. Left the stage-facing study open at eight seconds.
- Browser rehearsal completed **eight tools** with zero input/output tokens. `inspect_viewpoint` reported the captured current view at 34 seconds: 200 front, 202 right, 200 rear, 198 left; 536 overhead; 175 in the camera frustum; 770 lights on. The resulting 43.2-second proposal remained unapplied; the saved show stayed at 48 seconds. No live model request or aircraft access occurred.
- Inspection is analytical geometry, not rendered-pixel review, occlusion, photometric visibility, or flight qualification. The study is a creative example with `flightReady: false`, not a validated route plan. Browser tests did not exercise the download button; artifact parsing and shared CSV evaluation are covered by deterministic fixtures. No endurance or six-figure fully-keyframed playback benchmark was run.

### Next bounded slice

Add a bounded comparison of saved audience views across a selected time/beat range, with explicit sampled moments and a compact in-studio composition report. Let the agent use that report to propose editable lighting or motion refinements while retaining the artist's direct controls and revision-bound review. Continue fixture-driven model tooling until a key is supplied.

## September 27, 2026 — venue plan and saved audience views

Continued the immersive viewer priority with one bounded slice: place the audience viewpoint and reference stage in a plan, then save exact views for comparison.

### Completed

- Extracted the viewer settings into a dedicated panel with **Venue plan** and **Saved views** tabs. Header/tabs stay visible while the body scrolls. Saved viewpoints remain one click away in the focused preview.
- Top-down plan with independently draggable viewer/stage markers, 1 m arrow-key steps, 10 m Shift steps, coordinate ranges of ±100/250/500 m, pointer capture, and gesture cancellation. Precise coordinates accept signed values and commit on blur/Enter. Stage placement now supports East/North and a front-facing compass heading; its architecture and lights move together while the ground and audience stay fixed.
- Up to 12 named local views per project. Explicit Save/Recall/Remove controls store the exact ENU position, eye height, yaw/pitch, vertical FOV, and reference stage placement. Capture uses runtime values instead of the throttled compass; recall advances camera baselines atomically so the next frame cannot reset the saved direction.
- A separate strict versioned bookmark archive enforces size/name/count limits, project identity, finite/canonical values, and owned copies. Malformed or unavailable storage reports an error while preserving existing data. Saving rereads the latest archive so another open preview's newer views are retained. There is no automatic save or recall, and bookmarks are outside choreography/export/history.
- README, product, and technical documents now describe the implemented venue/viewpoint workflow and its storage boundaries.

### Evidence and limits

- **273 tests pass in 17 files**; strict TypeScript and the production build pass. Vite reports the existing bundle-size advisory at 531 kB minified / 159 kB gzip for the main chunk. New tests cover arbitrary target bearings, stage/snapshot normalization, repeated fractional-angle preservation, strict bookmark storage and failures, and the real venue hierarchy/resource disposal.
- Browser: keyboard moved the viewer to East 1 / North 10 m without changing the 34-second playhead. Drag moved the stage to East 37.8 / North 42.5 m; a typed negative East value committed correctly. Eye height, lens, and stage heading changed independently.
- Created two useful local views, **Center · stage** and **Rear · overhead**. After a full reload both remained available. Rear recall restored North −35 m, eye height 1.8 m, FOV 89°, yaw 15° and overhead direction; stage returned to East 0 / North 70 / front heading 180°. Center recall restored the default audience pose. Design/Viewer switching retained the recalled look and exposed the expected editing controls. Browser diagnostics returned no warnings/errors. Left the focused viewer facing the stage, with both saved views available in the open panel.
- Prismatic study remained 800 drones, two 24-second scenes, and the playhead at 34 seconds; Undo remained disabled through the checks. Bookmarks are local viewing preferences, not portable venue assets or authored camera tracks. Gesture cancellation is implemented but was not exercised mid-drag in the browser. No live model or aircraft calls were made.

### Next bounded slice

Build a separate, purpose-authored surrounding-show example with choreography across front, sides, rear and overhead, clearly marked as a design study. Add spatial context to the agent's read-only inspection tools so it can describe what is visible from a saved audience pose. Keep the current saved project untouched; qualify live agent behavior only after the user supplies a key.

## September 27, 2026 — immersive audience view and group transforms

The user redirected the active iteration toward experiencing a show from inside a 360° drone area, with a stage in front. Finished the bounded transform work already in progress, then prioritized the viewer. Tool-connection interruptions occurred; no continuous work is claimed during those gaps.

### Completed

- **Viewer 360°** is now the default: a fixed eye-level perspective at the audience center, full horizontal look-around, and an initial upward 35° view with a 90° vertical field of view. The camera changes independently of all authored drone positions.
- Drag to look, focused arrow keys for 5°/15° turns, Home to face the stage, and Stage/Left/Right/Behind/Sky controls. The compass shows the camera heading and stage bearing; its view cone follows the horizontal field of view. Direction controls restore canvas focus so arrow keys cannot accidentally scrub the timeline.
- Center/Rear/Left/Right audience presets, custom ENU location, eye height, field of view, and stage distance. A restrained stage, panel/truss, ground references, and instanced audience silhouettes give the view human scale. These settings remain local display/session state.
- Design mode keeps orbit/front/top cameras and editing tools. Mode changes preserve its camera and drain pending OrbitControls damping. Hidden selection marker work is skipped during audience playback, and venue resources are explicitly disposed.
- `transform_drones` now supports explicit-pivot rotation and nonuniform scale in addition to translation, for complete authored paths or a position key at scene-local time. Fixed order, right-hand axis semantics, reflections/collapses, exact cardinal angles, finite-coordinate checks, and identity precision are covered. Other channels, dormant work, and unselected content are preserved.
- Eight deterministic agent evaluation cases now include large irregular selected path transforms and transforms during an incoming blend. Agent command discovery and instructions describe the full transform semantics. Product and technical docs reflect the immersive viewer direction.

### Evidence and limits

- **256 tests pass in 15 files**; strict TypeScript and the production build pass. The 54 additions since recovery include 34 viewer-math checks, nine core transform checks, five expert-tool checks, and six evaluation regressions. Vite reports a bundle-size advisory for the 516 kB main minified chunk (154 kB gzip); startup/performance profiling remains future work.
- All eight CLI fixture evaluations passed with zero model tokens. Report: `artifacts/agent-evaluation-transforms-2026-09-27.json`. No live provider, credentials, or aircraft access was used.
- Browser on the existing Prismatic study: inspected the stage-forward and overhead renders; drag changed heading from 0° to 46°; Behind showed 180°; canvas Right changed 0° to 5° without changing the 34-second playhead; Home restored stage-facing orientation. The Rear preset moved the viewer to North −35 m; eye height and lens inputs changed to 1.8 m/89° and were restored to 1.7 m/90°.
- Design/Viewer switching retained the design controls. Overhead playback advanced from 34 seconds to the 48-second endpoint and stopped cleanly; browser diagnostics returned no warnings/errors. Left the focused Viewer open facing the stage at approximately 34 seconds. The authored show remains 800 drones/two 24-second scenes, with Undo disabled throughout these camera-only checks.
- These are desktop preview checks, not an endurance or frame-rate benchmark. Camera/venue settings are not saved in Project/export; no VR/headset integration, spatial audio, custom venue import, or calibrated light simulation is implemented. The earlier recovered-agent-preview and saved-show Apply checks remain unperformed; this UI work exercised the newly requested main viewer.

### Next bounded slice

Prioritize the immersive workflow: reusable venue/viewer placements stored separately from choreography, a plan view for placing audience positions and stage orientation, and a purpose-authored surrounding-show example. Keep expert authoring available through the same canvas and commands. Named drone groups and key-range editing remain worthwhile engine work. Qualify live agent behavior only after the user supplies a key.

## September 23, 2026 — recoverable proposals and measured changes

Resumed the partial recovery slice after usage-limit interruptions. No work is claimed during those interruptions. This slice retains the v0.4 engine and show format; no key or live provider was used.

### Completed

- Explicit **Draft files** controls: save one pending proposal locally per project (1 MB UTF-8), download a portable draft, open a file, or restore the local copy after a reload. The local slot is separate from the saved show and is only replaced by an explicit save.
- Strict portable checkpoints include proposal commands and a SHA-256 base-content fingerprint. Restore verifies project identity and exact content, privately replays bounded operations, and runs a fresh design review. Prior stored review evidence is never trusted.
- Revision-only differences are accepted after exact content verification, because importing show JSON assigns a new local revision. Restored commands are bound to the current revision. Content differences remain rejected; recovery never merges or commits edits.
- **What changes** derives duration, fleet, scene, authored drone-record, channel, and keyframe differences from the documents. Exact key identity and dormant edits are included. Affected authoring scope is distinguished from measured movement; scene details are bounded to 12 entries.
- Recovery captures the proposal's original base, guards against concurrent show/draft replacement, disables conflicting proposal actions during restore, and keeps the current draft until opening succeeds. Failed/stopped replacement attempts also retain an already-stale unapplied draft for inspection or download.
- Product, technical, and harness documents describe the implemented recovery flow and its limits.

### Evidence and limits

- 202 tests pass in 14 files, including 36 new checkpoint, storage, and impact checks. Strict TypeScript compilation and the Vite production build pass. The imported-content fixture uses the actual show bundle writer/parser and verifies the returned proposal applies only at its current revision.
- Browser: generated an unapplied rehearsal with a measured 48 → 43.2-second show, one edited scene, and 800 edited drone records. Saved it to the separate local draft slot, reloaded the studio, restored the proposal, and saw fresh review events and the same measured changes. The saved Prismatic study stayed at 48 seconds and 800 drones; no Apply was performed.
- Automatic approval review interrupted a subsequent click to open the recovered 3D preview because its review connection disconnected. That recovered-preview interaction is not recorded as verified. Earlier v0.4 animated preview checks remain the baseline. Do not bypass this rejection or apply the rehearsal to the saved project for QA.
- File import/export serialization, exact-content verification, revision rebinding, fresh review, command/expansion limits, malformed/oversized input, caller mutation during hashing, storage failure preservation, and bounded semantic impact use deterministic fixtures. The browser file chooser/download round trip has not been exercised in this slice.
- Recovery retains completed proposals only. Conversation history and interrupted runs are not durable. Checkpoints require the matching show content; the full show is not embedded. Review remains bounded and incomplete for flight planning. Live model quality, access, latency, and cost remain untested.

### Next bounded slice

Add named drone selections and shared pivot rotation/scaling commands, with deterministic evaluation cases proving preservation of each drone's geometry and unrelated light channels. Resume the recovered-preview UI check only when browser approval is available. Continue fixture-driven agent work until the user supplies a key.

## September 18, 2026 — v0.4

The user asked for continued research and implementation while away, prioritizing AI and advancing expert show editing in parallel. No API key has been supplied for live qualification. A thread heartbeat provides bounded continuation runs. Read recent user direction before choosing another slice.

### Completed

- Primary-source comparison of Responses, OpenAI Agents SDK, Vercel AI SDK, and LangGraph. Chose a replaceable, bounded runtime over the shared editing engine. See [AGENT_RESEARCH.md](AGENT_RESEARCH.md).
- Ten agent tools: command-schema discovery, paged scene/selection reads, direct authored-drone inspection, complete-selection operations, frame samples, atomic private drafts, bounded review, and proposal completion.
- Server-only Responses adapter with continuation preservation, sequential calls, retries, cancellation, usage, and no browser key. Local NDJSON API has request limits, one active run, host/origin checks, and stream cleanup.
- Agent panel with connection/context, tool activity, scripted rehearsal, raw operations, authoritative review findings, trace export, and a separate animated read-only 3D draft viewer.
- Transition easing/curves, seconds/beats/presets, beat snapping, scene speed multipliers, independent key/transition scaling, and scoped speed feedback. See [TRANSITIONS.md](TRANSITIONS.md).
- Format 3 / engine 0.4 export identifies new transition semantics; imports retain formats 1 and 2.
- Exact draft continuation: follow-up requests retain prior operations against the saved base revision, refine the current private state, and require fresh review. Failed/stopped refinements retain the prior proposal, visibly stale if the show changed.
- Relative `transform_drones` translation for an entire authored path or a scene-local position key; geometry, dormant authored positions, and unrelated light channels are preserved.
- Repeatable headless evaluation runner with six synthetic cases, semantic preservation checks, safe report output, default fixture mode, and explicitly selected live mode. See [AGENT_EVALUATIONS.md](AGENT_EVALUATIONS.md).
- Timing fixes preserve unedited numeric precision, exact identity of closely spaced keys, roundoff at duration bounds, stationary color fades, real cut displacement, and correct measurement invalidation.

### Evidence and limits

- 166 tests pass in eleven files: 80 editor/core and 86 agent/transport/evaluation checks. Model fetches are mocked. Six CLI fixture evaluations passed with zero tokens; report: `artifacts/agent-evaluation-fixture-v0.4.json`. CLI rejects implicit live-all runs and refuses to overwrite an existing report.
- Browser retiming: a 24-second scene at 2× became 12 seconds; its 4-second ease-out blend became 2 seconds; keys 0/8/16/24 became 0/4/8/12. Original 24-second duration, 8-second smooth blend, and original keys were restored afterward.
- Browser rehearsal: seven tools produced an unapplied proposal with authoritative findings. Its isolated 3D preview played a 43.2-second draft while the saved show stayed 48 seconds.
- Browser continuation: a second rehearsal retained the first command and returned two cumulative operations. The isolated preview duration was 39.36 seconds; no Apply was performed. Final browser diagnostics contained no errors/warnings.
- Strict TypeScript compilation and the v0.4 production build pass, including bundled documentation.
- Local HTTP fixture: four virtual drones, HTTP 200, completed result, three proposed operations, 23 streamed events. Cross-origin and wrong-content-type requests returned 403/415. No saved-project change or live provider request.
- Automatic approval review rejected applying the rehearsal to the user's saved show because it considered that specific mutation unapproved. The draft remains unapplied. Do not retry that saved-project action merely for QA; atomic commit and stale revision checks use disposable in-memory fixtures.
- Live model quality, API/model access, cost, and latency remain untested. Configuration presence is not evidence of a successful provider call.

### Next slices without a key

1. Expand evaluation cases to relative group motion, multi-turn refinement, and subjective creative review after a key is available. Do not confuse the six scripted fixture passes with live-model success.
2. Shared expert commands for named selection groups, rotation/scaling around a pivot, keyframe range timing, and phased light distributions. Relative translation now exists. Keep arbitrary point/channel authoring available.
3. Run recovery/review ergonomics: export/import a pending proposal with its base revision, large-selection diffs, and history across reloads. Persist no credentials or opaque model reasoning in browser traces.
4. Bounded rendered-frame context for future model review. Current tools provide numeric samples; the agent does not yet see screenshots, cameras, or imported music.

### When the user returns

Follow [AGENT_HARNESS.md](AGENT_HARNESS.md). Keep a supplied key in the server environment or `.env.local`; choose a model available to their API project. Start with a small synthetic fixture and one narrow live task, inspect exact operations, then expand the creative evaluation set. Do not infer live choreography quality from rehearsal success.

Keep edits inside `drone-studio/`, preserve CAD assets and user projects, maintain localhost preview, and run focused checks appropriate to changes. Simulation and portable export remain the scope; aircraft control is not implemented.

## October 14, 2026 — unified agent-first workspace

Implemented the agreed Home / Tools / Music / Drone Show / Code structure. Added 18 searchable tool areas with visible current support, guided connection checks, a real ArduPilot parameter exchange/editor with independent readback, configuration backup/compare, an ESP esptool workflow, a local code editor and explicit command runner, a bounded hardware assistant with reviewed proposals, and a computer-preview melody composer. Existing storyboards, show authoring and bounded motor-test behavior are retained.

Full feature coverage, data handling, API contracts, verification and remaining adapter work are in [WORKSPACE.md](WORKSPACE.md). Betaflight MSP, ESC passthrough, calibration commands, FC flashing and mission execution remain unimplemented. No physical hardware operation or live model request was performed during this implementation pass.


## October 16, 2026 — integrated ESC reader

Added bounded, read-only ArduPilot USB → MSP → BLHeli four-way ESC inspection. Available in Music and Tools; assistant tools inspect_escs and prepare_esc_read expose actual readback and the operator workflow. Initial hardware failure uncovered ESC boot settling and ArduPilot's four-second alternate-protocol timeout/resume requirement. Corrected both, added a fixed read-only MAVLink resume request, and retested after the user confirmed a full power cycle.

Physical success at 16:27: four J-H-40 / BLHeli_S 16.7, directions Normal / Reversed / Normal / Normal; telemetry restored with a new disarmed heartbeat. Stored raw settings readback in docs/esc-readback-2026-10-16.json. No flash, erase, settings writes, motor throttle or arming commands. Startup melody writing and live motor melodies remain unfinished. User confirmed props removed and flight battery connected for the test.

## 2026-10-16 — Reviewed ESC startup installation

Added a Music startup installer for the physically identified J-H-40 / EFM8BB2
ESCs: pinned official Bluejay 0.21.0 at 24 kHz, full firmware backups, connection-bound
review plans, direction preservation, complete image readback, and guarded
melody-only changes after upgrade. No raw firmware/serial endpoint is exposed.
The UI distinguishes preparation, approved installation and audible verification.
Fault tests cover changed fourth ESC, corrupted readback and lost write ACK.
Hardware flashing is pending a fresh full backup and review; no hardware writes
were performed. See ESC_STARTUP_INSTALLER.md for scope and remaining verification.


### Physical startup preparation, 16:54

Opened Music for the operator, connected the direct ArduPilot USB FC, and read
fresh disarmed telemetry at 23.9 V. Fixed heartbeat decoding during the outbound
quiet interval (two regression tests). Read and saved complete 8 KiB backups
from all four ESCs; hashes verified, directions N/R/N/N, telemetry restored.
The Bluejay 0.21.0 / J-H-40 / 24 kHz + First light review is open in Music.
Firmware installation awaits explicit approval. 30 focused tests and build pass.


### Physical installation and audible verification, 16:58

Operator approved Bluejay 0.21.0 at 24 kHz on all four J-H-40 ESCs and First light.
Installed and verified every image; bootloaders and N/R/N/N direction settings
preserved. Operator power-cycled USB/battery and confirmed hearing the melody.
A subsequent read reconfirmed Bluejay and settings. Saved evidence in
esc-startup-installed-2026-10-16.json and esc-startup-power-cycle-2026-10-16.json.
Motor operation and flight have not been tested; Bluejay control defaults include
disabled temperature protection as disclosed in the approved plan.

### Music setup simplification

Moved firmware setup into one top-of-page panel with a ready summary and current
startup sound. Sound cards reuse the connection and offer computer playback,
melody-only Set as startup, or read-only replay of the installed startup melody.
Firmware approval is never bypassed by the simpler sound-selection action.
Detailed technical information is tucked into setup; the per-card modal contains
only the selected sound, persistent-change explanation and props/power checks.
Full suite: 78 files, 1,274 tests. Browser computer playback verified. Physical
replay awaits a reconnected USB device; no further firmware writes were performed.

## October 17, 2026 — shared color balance and appearance switch

Updated the cream and graphite palettes around a 60% neutral workspace, 30%
supporting surfaces/navigation, and 10% accent hierarchy. Reduced large Music and
Drone Show accent fills while preserving selection cues and the glossy drone-play
action. Moved appearance from the app selector into the bottom-left sidebar footer;
the collapsed rail keeps its sun/moon switch, and the expanded rail includes a
system-appearance option. Preference persistence and cross-tab synchronization
are retained.

Reviewed all five app areas and a dialog in both themes, keyboard switching,
reload persistence, cross-tab updates, and 390px/320px navigation. Focused tests:
18 passed. TypeScript and production build pass. Updated the design-system
contract and visual catalog; evidence is in `docs/screenshots/color-balance-*.png`.

## October 17, 2026 — recoverable storyboard deletion

Added a trash action to saved storyboard cards with inline confirmation and a
collapsed Recently deleted list with Restore. Open and Delete are separate
keyboard-accessible controls using shared design-system buttons and tokens.
Deletion preserves the project in the same atomic library record; stale autosave
cannot resurrect it. Deleting the last storyboard keeps the library empty across
reload, and restoring replaces any inactive fallback even when IDs match. Active
deletion saves current edits first and aborts if that save fails.

Removed the user-requested Prismatic study and My first one-drone show from Saved
through the new UI. First drone test remains the only saved storyboard, with its
four scenes and 24-second duration. Both removed items remain recoverable.

Validation: 48 focused storage, Home and design-system tests pass; TypeScript and
production build pass using the installed Node 23.3 runtime. The initial shell's
Node 19 lacks recursive directory reads and crypto.hash, causing tooling failures;
no test expectations were weakened. The project continues to recommend Node 22 LTS.
Browser checks covered Cancel/Escape, simulated quota failure, active/last deletion,
reload persistence and restoration of an edited fallback-ID project in an isolated
session-storage fixture. Verified the real library after reload; screenshot:
screenshots/storyboard-delete-2026-10-17.png. Browser automation used keyboard
activation after pointer coordinates failed to line up with the rendered viewport.
No aircraft commands were sent. Next useful library slice: rename/duplicate actions
without entering the editor.

## October 17, 2026 — one-drone Zorro stop-switch storyboard

Added a saved 20-second **Zorro kill-switch test** storyboard for the requested
all-four-motor props-off check. It has a dedicated schematic preview, a connected
aircraft assignment, physical readiness checks, timer, and session-only operator
outcome. The control boundary is explicit throughout: the Zorro arms, throttles,
and requests RC6 motor emergency stop; Lucidity only receives telemetry, times,
and records the observation. The existing First drone test remains a separate
one-motor-at-a-time MAVLink sequence. Edited flight or motor cues invalidate the
new exercise; export offers only its editable bundle, never a trajectory CSV.

Validation: 37 focused tests pass; TypeScript and production build pass with the
installed Node 23.3 runtime. Browser verified New storyboard creation, saved
editor preview, and Run storyboard opening the dedicated panel. No drone was
connected in that browser check, so assignment and timer were correctly disabled.
No arming or motor commands were sent; physical RC6 behavior remains unverified.
Outcome persistence beyond the open panel is not implemented.
See `docs/ZORRO_STOP_TEST.md` for the short operator flow and ArduPilot references.

Next slice: after the operator confirms this guided RC control path is the desired
test, verify the complete receive-only telemetry/assignment/timer flow with the
physical propellers-off aircraft and record whether all four motors stop. If
app-commanded simultaneous output is required instead, design and validate a
separate gated control path before exposing it; sequential MAVLink motor tests
cannot serve that purpose.

## October 17, 2026 — props-off idle storyboard execution

The operator clarified that the storyboard itself must start the motors. Replaced
the guided timer with a fixed **Props-off idle** storyboard. In its Run view,
Lucidity now sends a normal ArduPilot arm command, observes the accepted ACK and
armed heartbeat, holds no throttle, and requests disarm after 20 seconds. This
uses `MOT_SPIN_ARM` for simultaneous four-motor idle output; no sequential motor
test, RC override, force-arm, throttle, takeoff, or flight-path command is sent.
The user can flip the radio's motor emergency-stop switch at any point and replay
after a confirmed disarmed heartbeat. The storyboard and preview use generic
idle-show language; the Run dialog holds the operational checks.

The server permits only one matching ArduCopter 4.7.1 quad with fresh Stabilize,
battery, bidirectional telemetry, and read-back of RC6 stop, armed-idle speed,
auto-disarm delay and pre-arm checks. It owns the serial command path during the
run, enforces a 20-second server timer and short browser lease, and reports
uncertain disarm separately from a confirmed disarmed heartbeat. A mode change
while disarm confirmation is pending no longer traps the controller in stopping.
The Run dialog was condensed; setup is shown as unchecked until read. The local
preview server was restarted with the new API, and the browser showed the saved
Props-off idle storyboard and its disabled Run controls with no drone connected.

Focused tests: **85 passed**. Full suite: **82 files, 1,303 tests passed**
with `--maxWorkers=2`; TypeScript and production build passed. An initial
CSS-token failure was fixed. The existing ESC installer fake-time test passes
alone but can fail intermittently at default parallelism under host load;
one sequential default suite passed before the final inspector change. All controller
and UI tests use injected snapshots/serial mocks. **No live arm or four-motor run
was performed in this slice.** The operator must observe motor rotation and radio
stop behavior on the props-off aircraft; Lucidity cannot measure either. Next:
read current setup on the connected drone, resolve any blocked parameters through
normal ArduPilot setup, then make one supervised props-off run and record the
observed stop result before any prop-on testing.
## October 17, 2026 — DroneBridge ground-radio recovery in Lucidity

Added a recovery panel to **Tools → ESP & radio links**. It checks the fixed
DroneBridge setup address through Lucidity's local same-origin server, verifies
the device identifies as an ESP32-C6, and offers an explicitly confirmed switch
back to ESP-NOW GND mode while the aircraft USB link is disconnected. The write
contains only `esp32_mode: 5`; pairing, channel, passwords, and link secrets are
neither requested nor submitted. This is a narrow ground-radio mode recovery,
not full AIR/GND binding or channel configuration.

Evidence: official DroneBridge frontend maps mode 5 to ESP-NOW GND; its firmware
settings handler accepts partial JSON and preserves omitted values. Two injected
fetch tests pass, TypeScript and production build pass under Node 23.3, and the
live Lucidity UI displays the new panel. Its read-only check currently reports
the radio setup address unreachable from this Mac, so no live mode write or
MAVLink reconnection has been verified. No radio settings or aircraft commands
were sent. Next: with the Mac connected to the ground radio's setup Wi-Fi, check
the radio in Lucidity, let the operator confirm the mode change, then verify a
fresh aircraft heartbeat and return telemetry through the USB link.

## October 17, 2026 — Live receive-only radio isolation

Lucidity opened the USB ground ESP32 at `/dev/cu.usbmodem11401`, 115200 baud.
With the aircraft powered, it received one valid 21-byte MAVLink packet per
second and no aircraft heartbeat. The same rate continued after the operator
disconnected the flight battery, confirming those packets alone do not prove
the air link is delivering flight-controller telemetry. Both radios were
reported to show solid red LEDs, but the ground LED remained red with the air
unit unpowered, so that observation cannot establish an active link. The
ground USB radio was unplugged/replugged and Lucidity reconnected; its receive
rate was still one packet per second. We have not yet confirmed whether the
aircraft was repowered after that restart. No arm, motor, parameter, binding,
or radio-mode command was sent.

The radio panel now explains that setup Wi-Fi may be absent during normal
ESP-NOW operation and that a ground-radio heartbeat does not establish an
aircraft link. Two focused mock tests and the production build passed. Next:
confirm aircraft power and compare the packet stream; if still absent, isolate
AIR-to-GND binding from FC-to-AIR UART before changing configuration.

After the operator repowered the drone, the ground USB still delivered only
the same 21-byte packet each second and no aircraft heartbeat. We tried the
firmware's staged button binding flow (GROUND double-click, AIR triple-click,
GROUND single-click to end); the ground unit visibly rebooted in Lucidity's
byte counters and paused its normal output during the session, but aircraft
telemetry did not return. We then disconnected the battery and ground radio,
connected Lucidity directly to the SpeedyBee USB, and received a fresh
ArduCopter system-1 heartbeat (disarmed, Stabilize). A read-only parameter
request completed 1,085/1,085 values; SERIAL3_PROTOCOL=2 and
SERIAL3_BAUD=115, consistent with MAVLink2 at 115200 on UART3. No settings
were written. The next physical isolation is checking which FC pads the AIR
radio cable uses and whether that connector is seated. The FC USB has since
been unplugged; the battery remains off pending that inspection.

The operator confirmed the AIR cable uses the SpeedyBee T3/R3 pads. With all
power removed they reseated its connector and antenna, then repowered both
radios. Lucidity still received only the ground radio's one 21-byte packet per
second and no aircraft heartbeat. The battery was disconnected again. This
leaves AIR UART input versus AIR/GROUND RF transport unresolved; no flight or
motor command was sent.

Lucidity now offers a role-specific DroneBridge setup check in **Tools → ESP &
radio links**. It reads only public device information and UART counters
(`read_bytes`, `serial_dec_mav_msgs`) from the selected radio; it never reads
the settings endpoint, which can expose link secrets. After a physical AIR
setup-mode inspection, an explicitly confirmed restore writes only AIR
`esp32_mode: 4`, with the aircraft USB link disconnected. The existing GROUND
restore similarly writes only mode 5. This code has not yet been exercised
against the AIR hardware. Four injected adapter tests and the production build
passed with Node 23.3. The local preview shows the AIR/GROUND selector and
read-only check. Next: briefly enter AIR setup mode, read its counters twice
while the FC is powered, restore AIR mode, then verify the wireless aircraft
heartbeat. Rising UART counters with no GROUND heartbeat would focus recovery
on RF binding; flat counters would focus on AIR serial input or wiring.

Live AIR setup-mode check then identified DroneBridge 2.4 and reported 596
UART bytes / 28 decoded MAVLink messages in Lucidity. This establishes that
the FC-to-AIR serial path is active at least at that instant; a second sample
was not captured before the operator used the UI's AIR restore. Lucidity now
shows that the `esp32_mode: 4` request was accepted and the radio is rebooting.
This confirms the request, not yet successful ESP-NOW pairing or a fresh
aircraft heartbeat. Next: reconnect the USB GROUND radio, verify Mac Wi-Fi has
left AIR setup mode, and run Lucidity's receive-only aircraft check.

After the operator reconnected GROUND USB and returned the Mac to its normal
Wi-Fi, the local Lucidity service still showed the USB link listening at
115200, 110 valid packets / 2,310 bytes over about 110 seconds, and no
aircraft. These are consistent with only the GROUND unit's one packet per
second; the AIR UART finding did not restore the wireless aircraft path.
Lucidity's USB connection was explicitly disconnected (local API returned
`state: disconnected`, no aircraft) for a coordinated power cycle of both
radios. Next: after both units restart without BOOT/RESET, reconnect Lucidity
receive-only and test for a fresh ArduCopter heartbeat. Do not infer link
recovery from the GROUND LED or byte count alone.

The coordinated restart completed with GROUND USB first and the drone battery
second, without pressing radio buttons. Lucidity re-opened the same Espressif
port receive-only. At the next read, it had received 336 bytes in 16 valid
packets over 16 seconds, with `aircraft: []` and zero transmitted bytes.
Restart alone did not recover AIR→GROUND transport. Official DroneBridge
source confirms the GROUND double-click / AIR triple-click binding runtime
can synchronize the group without rotating its secret; a fourth GROUND click
would replace the group and must be avoided. Next: verify GROUND entered
binding by its packet stream pausing before involving AIR, then complete one
timed bind and check for a fresh aircraft heartbeat.

The operator double-clicked GROUND BOOT. Lucidity observed a reboot-size byte
jump and then the valid packet count stopped at 62 for more than 14 seconds,
consistent with the dedicated binding runtime. The operator triple-clicked
AIR BOOT, then single-clicked GROUND BOOT to end the session. GROUND resumed
its serial packet stream (73 then 87 valid packets), but Lucidity still showed
`aircraft: []` and zero transmitted bytes. The UI has not proven whether the
AIR-side triple-click registered or whether binding succeeded; do not report
the radios as paired. Further blind restarts or binding presses would add
little evidence. Next: verify AIR is actually in ESP-NOW mode and inspect a
non-secret binding outcome or firmware/mode mismatch before retrying.

The operator confirmed neither ESP32 exposes a visible status LED beyond its
solid red power light, so LED color cannot establish a bind outcome. Lucidity's
radio panel still reports no aircraft heartbeat. Official DroneBridge source
shows a brief single BOOT press enters setup AP mode (and resets only the AP
SSID/password), while a long press resets all settings; the requested next
check is a short GROUND press with the drone battery off, followed by a
read-only firmware/public-stat inspection in Lucidity. No further bind or
motor command has been sent. The remaining limitation is that the AIR→GROUND
RF failure has not been isolated to configuration, firmware, or hardware.

## October 18, 2026 — Operator-requested full radio reset

The operator requested resetting both Vimdrones ESP32-C6 radios completely and
starting again after repeated unsuccessful recovery. Official DroneBridge
documentation confirms a BOOT hold longer than 1.8 seconds resets all radio
settings to defaults and restarts setup AP mode; a brief press resets only
mode and AP credentials. Firmware and ArduPilot are separate from this reset.
The clean re-pair path is GROUND double-click to create/start the group, AIR
triple-click to join, then GROUND single-click to end; the source shows that a
successful bind persists channel, link secret, and roles 5/4. This procedure
has not yet been performed in the new reset sequence. First physical step
requested: battery off, props off, reset only USB GROUND with a 2–3 second BOOT
hold, and confirm setup Wi-Fi appears. Before a flight or show, recheck the
AIR UART input, external antenna setting as applicable to the board, and a
fresh aircraft heartbeat. Do not infer success from the ground radio's own
heartbeat or solid red power LED.

The operator reported that the GROUND setup Wi-Fi was absent after the
2–3-second BOOT hold and objected to switching the Mac off its internet Wi-Fi.
The Mac still enumerated the GROUND radio at `/dev/cu.usbmodem11401`; Lucidity
remained disconnected, and a read-only three-second USB sample received zero
bytes. This is consistent with the radio leaving normal GROUND mode, but does
not prove a factory reset or explain the missing AP. The recovery path now
uses DroneBridge's physical button binding without switching Mac Wi-Fi; the
operator has been asked to reset AIR with props removed. Binding and aircraft
heartbeat verification remain pending. If the no-AP condition persists after
pairing fails, inspect radio firmware, antenna selection, or RF hardware
instead of repeating blind button presses.

The operator reported full BOOT-hold resets on both radios, followed by one
GROUND double-click / AIR triple-click / GROUND single-click binding attempt.
Lucidity opened the Espressif GROUND USB port receive-only at 115200. After
16 seconds it had 48 valid MAVLink packets (1,008 bytes), zero transmitted
bytes, and no aircraft heartbeat. A separate read-only MAVLink parameter
request to GROUND component 68 returned `SYS_ESP32_MODE=5` (decoded from the
UINT8 bytes packed into PARAM_VALUE), establishing that GROUND entered
ESP-NOW GND mode. This does not establish that AIR joined: there are still no
AIR or ArduCopter packets. Lucidity released the USB port after the check.
Next: with battery off and GROUND unplugged, connect AIR directly by USB to
inspect its mode and non-secret UART/antenna settings. Do not repeat blind
binding attempts or start a show while no fresh aircraft heartbeat exists.

The operator connected AIR itself by USB with the flight battery off. Its
Espressif USB serial identity differed from GROUND's. A read-only, allowlisted
boot-log capture identified AIR mode 4 and the reset UART configuration:
`gpio_tx=0`, `gpio_rx=0`, `baud=57600`, RTS/CTS both zero. The flight controller
is configured for 115200 baud on T3/R3; the Vimdrones ESP32-C6 board pinout
marks AIR IO5 as TX and IO4 as RX. Thus the AIR UART is disabled after the full
reset, independently explaining why no flight-controller telemetry reaches
GROUND. The AIR/FC serial repair to verify is TX 5, RX 4, baud 115200, with
RTS/CTS left at zero, followed by a fresh aircraft heartbeat test. Mode 4
alone does not prove RF pairing or aircraft delivery.

The operator briefly pressed AIR BOOT while USB powered to reopen setup AP.
macOS shows `DroneBridge for ESP32` at full signal with GROUND unplugged, but
refused a join using its remembered connection. The Mac remains on its normal
internet Wi-Fi. The operator has been asked to join AIR setup using the
documented reset password `dronebridge`, forgetting the saved network first if
needed. No serial setting has yet been written. Once setup is reachable,
write only the three known UART fields, restore AIR mode, read back the
allowlisted boot settings, then test receive-only via GROUND. Do not read
`/api/settings`, which includes secrets.

The AIR setup SSID temporarily disappeared after a USB RTS diagnostic reset.
A safe allowlisted ROM capture showed `boot:0x0 (USB_BOOT)`: the diagnostic had
put the ESP32 into USB bootloader mode rather than normal DroneBridge startup.
No flash was changed. After the operator unplugged and reconnected AIR USB
without pressing BOOT, they confirmed the setup SSID reappeared. Do not use
that RTS pulse for future AIR configuration checks; verify through the public
setup status or a clean power startup instead. AIR serial settings remain to
be restored, and an aircraft heartbeat remains unverified.

The operator opened the AIR radio's setup page and found no UART TX/RX or
baud controls. The v2.4.1 frontend hides exactly those controls when its
public `/api/system/info` reports `serial_via_JTAG=1`, the `USBSerial`
firmware flavour. DroneBridge documents this flavour for GROUND USB use;
AIR-to-flight-controller UART requires the standard ESP32-C6 build. This is a
firmware-flavour mismatch, so changing the mode in the existing form cannot
restore the FC serial link. The earlier proposed UART web-form edit is not
available on this firmware and must not be attempted through hidden fields.
The vendor-specific Vimdrones board pinout labels IO5 TX and IO4 RX, but
verify wiring and correct AIR hardware identity before applying any firmware
change. No flash or form save has been performed. The operator should keep
GROUND firmware intact, and AIR restoration requires a reviewed standard
ESP32-C6 firmware flash followed by UART configuration and fresh telemetry
verification. Both devices remain unsuitable for flight commands until that
verification succeeds.

The operator explicitly approved installing official standard DroneBridge
v2.4.1 ESP32-C6 firmware on AIR only. The official flasher recognized the
USB-connected ESP32-C6. We selected the plain `ESP32-C6` standard flavour
(rather than `USBSerial` or `Official HW`), ran Flash, and observed its final
"Successfully flashed DroneBridge to ESP32!" message. GROUND firmware was
not touched. The flasher directs a power cycle next. Pending: clean AIR USB
reboot, verify the setup UI exposes UART TX/RX/baud, set the vendor-labelled
IO5 TX / IO4 RX at 115200 and MAVLink/AIR mode, and check actual aircraft
heartbeat through GROUND with propellers removed. Flash success is not yet
evidence of UART configuration, radio binding, or an aircraft link.

After a clean AIR USB reboot, its setup UI now visibly exposes UART fields.
The operator selected ESP-NOW LR AIR, channel 6, MAVLink, TX GPIO5, RX GPIO4,
RTS/CTS 0; a read-only view of the live setup form confirmed these values.
However the saved UART baud still reads 57600, so it cannot match the FC's
115200 configuration yet. The operator was asked to change **only** baud to
115200 and save. Vimdrones' board pinout labels IO5 TX and IO4 RX, while
generic DroneBridge ESP32-C6 hardware guidance cautions that GPIO4/5 may be
unavailable on some generic boards. Treat that mapping as board-specific and
verify actual UART bytes and aircraft heartbeat before assuming it works.
The operator subsequently reported the baud change saved. Readback has not
yet been observed because AIR rebooted out of setup AP mode. The next check
is a receive-only Lucidity snapshot after AIR is back on the FC telemetry
connector, GROUND USB is on the Mac, and the drone battery is connected with
all propellers removed. A GROUND-only heartbeat is not a passed check.
The operator reconnected AIR to FC telemetry, USB GROUND to Mac, and powered
the aircraft with props removed. Lucidity opened the recognized GROUND serial
device (`/dev/cu.usbmodem11401`, serial ending `FB:34`) at 115200, but its
status still reported zero received bytes, zero packets, and no aircraft after
the first listening interval. No arm or motor command was sent. Lucidity
released the port for a clean GROUND USB restart; this receive-only retry is
pending. Do not interpret the AIR flash or saved baud as restored telemetry.
After the clean GROUND USB restart, a second Lucidity listener received
1,808 bytes / 77 valid MAVLink packets with no invalid frames, but still no
aircraft entry or autopilot heartbeat. This shows the GROUND USB serial path
and its own MAVLink output recovered; it does not show an AIR link. Lucidity
released the port again. With the AIR firmware now corrected, the next
bounded diagnostic is one documented BOOT-button pairing sequence (GROUND
double, AIR triple, GROUND single to end), then another receive-only check.
After the operator requested a post-binding check, Lucidity again received
valid MAVLink packets but no aircraft. An eight-second read-only serial scan
reported exactly eight heartbeat packets from system 1, component 68 and no
other sender IDs or message types; this is consistent with GROUND's own
periodic output, not verified AIR or autopilot traffic. No bytes were sent.
The next diagnostic is the AIR radio's setup-mode UART input/decoded MAVLink
counters in Lucidity, checked twice for increase. This separates FC-to-AIR
serial ingress from ESP-NOW transport before any further binding attempts.
The operator later showed a Lucidity AIR setup-mode reading of 403 UART input
bytes and 19 decoded MAVLink messages with the flight controller powered and
GROUND USB unplugged. This is positive evidence that the FC-to-AIR serial path
is carrying decodable MAVLink, although a second timed reading was not captured
to establish its sustained rate. AIR was then returned to ESP-NOW AIR mode;
the subsequent GROUND USB check still showed no aircraft heartbeat. The next
diagnosis should focus on AIR/GROUND RF mode, channel, and pairing state rather
than reflashing AIR or changing its UART pins blindly. Keep all propellers off
and do not run a storyboard until a fresh aircraft heartbeat is verified.
The operator then reported that the aircraft connection worked. Lucidity's
history contains a recent ArduCopter heartbeat and telemetry from this
reconnection, but at the later documentation check the heartbeat was stale and
the UI was waiting for the aircraft again; the drone may have been powered off
afterward. Record the successful reconnect as operator-reported and previously
observed, not as a currently continuous link. Added `docs/RADIO_RECOVERY.md`
and a collapsed quick-recovery guide in Tools → ESP & radio links. The guide
starts with a fresh aircraft heartbeat check, uses AIR setup mode only when
needed, captures UART counts before restoring AIR mode, and avoids blind reset
or reflash. Next: verify a fresh link when the aircraft is powered again; if it
fails, compare AIR/GROUND non-secret RF configuration rather than repeating
the full reset.


## October 18, 2026 — Check my drone beta

Added a contained five-stage diagnostics experience from Home and Tools: prepare,
automatic checks, hands-on checks, isolated ground-radio/power verification, and
report. The initial deterministic rules cover ArduCopter 4.7.1 stable quadcopters.
The flow uses real existing serial, ESC-reader and bounded motor-test services;
physical observations remain separate from command acknowledgement. New pre-arm
request support and health/UID/receiver decoding provide device-backed evidence.
Reports distinguish failures, missing evidence and unsupported coverage, keep five
validated local records, and export JSON. Historical reports cannot run devices.
See [DRONE_CHECK_BETA.md](DRONE_CHECK_BETA.md) for scope and limitations.

Validation: full Vitest suite passed (85 files, 1,333 tests); final TypeScript and
production build passed. Browser verification exercised the complete synthetic
flow, successful ESC readback, motor command without automatic physical pass, a
reported motor failure, rejection while direct USB remained present, successful
UID/configuration radio comparison after simulated unplugging, report export
(46 recorded checks) and historical report action gating. Home navigation, light
and dark themes, and the real app shell at 390px were checked; no horizontal
overflow was observed. Fixed inherited form styling that stacked checkbox labels.

Screenshots: `screenshots/drone-check-beta-light.png`,
`screenshots/drone-check-beta-dark.png`, `screenshots/drone-check-beta-mobile.png`,
and `screenshots/drone-check-home.png`. No new workflow was run against a real
aircraft during this implementation. Physical qualification remains outstanding;
these reports are not flight clearance.

## October 18, 2026 — Props-off idle run gate

The connected System 1 ArduCopter reported `DISARM_DELAY=10`, so the 20-second
props-off idle storyboard correctly kept Run disabled. With the operator's
explicit approval and a fresh disarmed Stabilize heartbeat, Lucidity changed
only `DISARM_DELAY` from 10 to 30 and verified the independent readback. Restore
the original 10-second value after the bench test; the longer delay changes
the aircraft's automatic disarm behavior.

The radio delivered a partial parameter list (1,084 of 1,085 values), and the
setup check was asking for `ARMING_CHECK`. ArduPilot 4.7 renamed that parameter
to `ARMING_SKIPCHK`; the name, rather than packet loss, explains why the
targeted `ARMING_CHECK` read never answered. Updated the gate to require
`ARMING_SKIPCHK=0` (no checks skipped), added a bounded named-parameter read for
the four props-off setup values, and made the run panel show the measured
blocking value and one precise next step. Focused tests and production build
passed before the parameter-name correction; repeat them after the correction.
The dev-server restart released the USB port, which Lucidity reopened. The
aircraft heartbeat was stale because the operator had disconnected the flight
battery; this is not evidence of another radio failure. No storyboard was
started. Next: after the operator reconnects battery with props off, verify a
fresh heartbeat, recheck the four setup parameters, then let the operator
confirm the physical checks and initiate the run.

Follow-up on the same evening: official ArduPilot documentation showed
`ARMING_CHECK` was renamed to `ARMING_SKIPCHK` in the current firmware line.
The new named read returned `RC6_OPTION=31`, `DISARM_DELAY=30`,
`MOT_SPIN_ARM≈0.10`, and `ARMING_SKIPCHK=0` from the disarmed aircraft. The
controller and UI now require the actual 4.7 parameter. Focused tests passed
(4 files, 58 tests) and production build passed. The operator then started
the props-off idle storyboard while the app was rebuilding. Lucidity reported
an early end at 16.9 seconds and a run-view connection warning; a fresh
disarmed heartbeat was observed immediately afterward. The operator reported
that all four motors turned, RC6 was flipped, and all four stopped. This is
physical evidence for the stop-switch check, but not a clean 20-second timing
pass. No new run was initiated by the agent.

The original `DISARM_DELAY=10` is **not yet restored**: the GROUND USB radio was
unplugged before the restore, so Lucidity correctly made no parameter write.
When the operator reconnects GROUND and powers the disarmed, props-off drone,
read and restore 10 with independent readback before any props-on operation.

## October 19, 2026 — Existing one-foot storyboard, first-flight gate

The operator confirmed the props-off four-motor/RC6 stop test worked, but also
confirmed **there has been no props-on flight**. The existing saved storyboard
`One drone · 1 ft hover` was inspected in Lucidity: one scene, four altitude
keys at 0/2/6/9 seconds, a one-foot peak, and no motor cue. It was preserved;
the successful props-off idle storyboard was not overwritten. Its library card
now says `Flight study · simulation`, while props-off idle is correctly labeled
as a props-off sequence. `Run storyboard` becomes `Flight readiness` for the
existing hover study, showing its actual nine-second design profile and three
qualification gates. It sends no flight command. A prior private animation was
aligned with the same one-foot, nine-second concept. The older three-meter plan
now points to the current study rather than presenting itself as the next run.

Evidence: focused Vitest files for preview, telemetry UI, and library passed;
TypeScript and production build passed with Node 23. Browser verification
opened the existing saved storyboard and the Flight readiness modal, confirmed
the 1.0 ft/9 s summary, then confirmed library labels for all three active
projects. The aircraft was disconnected and the operator said its battery was
off with props removed, so no hardware command was sent. The original
`DISARM_DELAY=10` remains pending until the disarmed aircraft and USB ground
radio are connected for readback and restoration. No live height sensor,
AltHold/Loiter performance, flight mission upload, or props-on flight was
validated. Next: restore/read back `DISARM_DELAY=10`; complete a pilot-controlled
first Stabilize takeoff/landing before attempting altitude hold or an AUTO show.

## October 19, 2026 — Radio input in Lucidity

Replaced the Receiver tool's raw-parameter-only view with a dedicated **Radio setup** screen. It now displays fresh MAVLink RC channel values for roll, pitch, throttle, yaw, the aircraft's configured flight-mode channel, and the verified RC motor-stop assignment. The screen reads ArduPilot `RCMAP_*`, `FLTMODE_CH`, and `RC6_OPTION` on request; until then it explicitly labels default channel numbers as provisional. Other reported channels can be expanded. Stale receiver data is hidden, and non-ArduPilot aircraft show only raw channels rather than an invented control map. The monitor polls the local status endpoint at 4 Hz and requests `RC_CHANNELS` at 5 Hz. A dedicated receiver-only request and connection check allow direct flight-controller USB with the flight battery disconnected, without requiring GPS or battery reports. It makes no arm, throttle, motor, or persistent setting change.

Evidence: focused radio framing, mapping, decoder, service, middleware and tool-catalog tests passed (94 tests); the full suite passed (86 files, 1,341 tests), and TypeScript and production build passed. The browser showed the new Radio setup navigation and disconnected-state workflow in Lucidity. A development-only fixture verified the connected channel bars, aircraft mapping read, RC6 motor-stop label, and updates from synthetic stick/switch values; the fixture intercepts every request and never connects to hardware. No real aircraft was connected during this implementation, so stick response on the Zorro has not yet been verified here. This is **not full QGroundControl calibration parity**: transmitter EdgeTX mixes cannot be edited over MAVLink, and guided ArduPilot endpoint calibration plus flight-mode assignment/readback still need dedicated adapters and live validation. Next: use this screen with the direct USB controller and props off to observe CH1–CH6, then implement the guarded calibration and mode editor from the observed channel mapping. The previously elevated `DISARM_DELAY=30` remains pending restoration to the original 10 after a disarmed props-off reconnection.

## October 19, 2026 — Live radio and battery checks before first flight

With props removed, the SpeedyBee F405 Mini was connected directly by USB and the operator powered the Zorro. Lucidity received a fresh ArduCopter 4.7.1 heartbeat and RC channels. The operator confirmed roll, pitch, throttle, yaw, and flight-mode bars each respond; live `RCMAP_*` readback maps them to channels 1–4, `FLTMODE_CH=5`, and `RC6_OPTION=31`. Throttle settled near 988 µs at stick minimum; RC3 calibration is 1000–2000 µs. All six `FLTMODE*` slots currently read Stabilize (0), `ARMING_SKIPCHK=0`, and the aircraft stayed disarmed. Turning the Zorro off with props removed produced `Radio Failsafe - Disarming` / `PreArm: Radio failsafe on`; turning it back on produced `Radio Failsafe Cleared` and fresh RC data. This establishes receiver-loss detection while disarmed, not in-flight failsafe behavior.

Read `DISARM_DELAY=30`, restored the original 10 via a guarded expected-value write, and received readback `30→10`. The connected pack was confirmed by the operator as Tattu R-Line 4S 650 mAh; a separate charger measured 16.73 V and Lucidity measured about 16.80 V. The aircraft had `BATT_CAPACITY=3300`, `BATT_LOW_VOLT=10.5`, and `BATT_FS_LOW_ACT=0` (warn only). After the operator confirmed the pack and approved the failsafe change, guarded writes with independent readbacks set capacity `3300→650`, low voltage `10.5→14.0 V`, and low action `0→1` (Land). These were made only while disarmed with props removed. The low threshold is 3.5 V/cell for this 4S pack; its behavior under motor load has not been tested. Critical-voltage action remains disabled. The percentage estimate and current calibration have not been independently validated.

Current frame readback: `FRAME_CLASS=1`, `FRAME_TYPE=12` (BetaFlight X); `SERVO1_FUNCTION` through `SERVO4_FUNCTION` are 33–36. Earlier operator-reported A–D motor directions match the expected test-order pattern, but physical corner confirmation was qualified as “looks good.” The operator was asked to disconnect battery and USB, then explicitly confirm A front-right CCW, B rear-right CW, C rear-left CCW, D front-left CW before mounting props. No props-on flight, arm command, automated takeoff, height hold, mission upload, or in-flight failsafe test occurred. Battery telemetry showed 16.8 V, while GPS had no fix indoors. A telemetry-rate request reported failure to obtain its expected acknowledgement/version response despite fresh telemetry; the parameter write readbacks and live RC data were separately confirmed. Next: resolve motor-corner confirmation, inspect propeller pitch/installation with all power disconnected, and conduct outdoor pre-arm/GPS/first manual Stabilize checks with an experienced pilot before AltHold, Loiter, or any automated show.

## October 19, 2026 — First props-on manual flight reported successful

The operator confirmed that the quad lifted off, hovered, landed, and disarmed under Zorro pilot control. The operator and accompanying pilot reported no flip tendency, strong drift, oscillation, unusual motor noise, or hot hardware afterward. This is the first reported props-on flight of this airframe and establishes a pilot-controlled Stabilize hover/landing milestone. The USB GROUND radio was optional for that flight and Lucidity was disconnected, so there is no independent in-app flight telemetry, log, altitude, GPS, or battery-under-load record for this run. Do not characterize it as an AltHold, Loiter, RTL, or automated storyboard validation. Next: inspect the ArduPilot onboard flight log and battery status, then test AltHold and Loiter separately with a clear pilot takeover path before any automated show integration.

## October 21, 2026 — One-drone flight-show readiness audit

The operator reports another flight and asks to run a complete one-drone Lucidity show. The exact modes flown and three-position CH5 readback are still awaiting operator confirmation. The last *specified* flight evidence remains the October 19 pilot-controlled Stabilize hover/landing. In the app, the saved **One drone · 1 ft hover** storyboard opens with one nine-second scene and an explicit simulation-only Flight readiness panel. The current local aircraft status has a disconnected USB link and stale heartbeat; no aircraft command was sent during this audit. The source contains no MAVLink mission compiler, mission upload/download/readback, or props-on flight runner. The existing Run storyboard paths are props-off motor tests and armed idle only. Therefore the hover storyboard cannot yet be represented as an executable aircraft mission, and its exported local trajectory CSV is not an ArduPilot mission.

ArduPilot's [AUTO guidance](https://ardupilot.org/copter/docs/auto-mode.html) says AUTO should follow successful AltHold and Loiter flight and requires healthy positioning. Its [AltHold guidance](https://ardupilot.org/copter/docs/altholdmode.html) warns that barometric altitude hold can become erratic close to the ground because of prop wash. A one-foot target is not justified by the known GPS/barometer alone; a downward height sensor and demonstrated behavior would be needed for that exact height. Next: confirm the three Zorro CH5 positions and pilot-flown AltHold/Loiter evidence, inspect the flight log and GPS/battery health, then build and test a separate ArduPilot mission adapter with disarmed upload/readback before exposing any physical launch action in Lucidity. Preserve the storyboard and props-off runners unchanged.

## October 21, 2026 — Two-show flight sequence

The operator clarified that AltHold and Loiter have **not** yet been flown and plans to try them with a pilot this weekend. Created [FIRST_LIVE_SHOW_SEQUENCE.md](FIRST_LIVE_SHOW_SEQUENCE.md): a compact path from those pilot checks through a new mission upload/readback implementation, SITL and failure rehearsal, props-off transfer check, supervised vertical show, log review, then an out-and-back show. It distinguishes the saved one-foot simulation from a future pilot-approved flight altitude and treats five feet of GPS-guided motion as a precision question to validate, not a guaranteed trajectory. Documentation only; no aircraft command, mission upload, or hardware change was made. The next implementation slice is the bounded one-drone ArduPilot mission compiler and SITL evaluation, while the operator independently verifies AltHold/Loiter and CH5 mode behavior.

## October 21, 2026 — One-drone mission preparation implemented

Added an editable **First live hover** storyboard (2 m design height, 15 s authored scene) and created one in the operator's local Lucidity library. The old one-foot study and props-off stories remain intact. Its Flight readiness panel now walks through local preview, serial connection, live disarmed quad assignment, revision-bound mission review, propeller removal confirmation, upload, and full readback. It shows TAKEOFF → LOITER_TIME → LAND and explains that ArduPilot controls actual climb, hold and landing timing. The flight-run button remains disabled.

The new ArduPilot adapter accepts only a single vertical one-drone scene, rejects lateral motion, lighting, bench cues and unreviewed low heights, and binds a prepared plan to the storyboard and USB connection. It refuses to overwrite an existing authored mission. Before writing, it backs up the empty or home-only state; a cleared mission needs fresh 3D GPS, HDOP at most 1.4 and global position to establish seq-0 home. The MAVLink exchange handles legacy and INT mission requests, bounded retries/deadlines, cancellation, disconnection, complete readback comparison and an explicit unknown state after a possibly partial write. Recovery requires a fresh empty or valid home-only readback before retrying. No arm, AUTO, motor or physical flight command was added.

Evidence: 93 test files and 1,385 tests passed with two workers; TypeScript and the production build passed using local Node 23.3.0. An initial default-parallel test run had one unrelated ESC timing-test failure under load; that test passed in isolation and the complete two-worker rerun passed. The actual browser showed the new saved storyboard, its 2 m/5 s command preview, and a disabled flight-run control. An isolated browser fixture exercised mock connect → assign → review → upload/readback; mock success is not live hardware evidence. Official ArduCopter 4.7.1 SITL, disarmed and isolated on localhost, accepted and returned all four mission items through Lucidity's service for both empty and home-only starting missions. Its actual normalization and legacy request behavior were incorporated before the full readback passed. No aircraft serial port was opened for this implementation.

Limits and next slice at the time of the implementation check: the physical quad had not received this mission and the uploaded mission had not yet been flown in SITL or in air. A successful storage readback alone does not prove takeoff, altitude hold, landing or disarm. The operator still needs pilot-flown AltHold and Loiter, mode-switch/AUTO takeover verification, GPS and battery/log review, then a supervised props-off real-aircraft upload/readback. Complete SITL flight, loss/recovery and pilot-takeover evaluation before implementing/enabling a Lucidity launch runner. The five-foot out-and-back show remains a later, separately validated design.

## October 21, 2026 — Exact live-hover template flown in isolated SITL

Official ArduCopter 4.7.1 SITL on localhost accepted Lucidity's saved **First live hover** mission from an empty mission state. Through the real `AircraftService` disarmed upload path, readback returned home → TAKEOFF 2.0 m → LOITER_TIME 5 s → LAND; count was four and comparison matched. A separate home-only start also uploaded and read back successfully. No real USB radio or aircraft was opened.

In an independent simulator-only flight evaluation, normal Stabilize arming followed by `MAV_CMD_MISSION_START` climbed to 2.122 m, held near 1.99 m, landed and reported disarmed by HEARTBEAT after about 18.6 s. Mission progress reported current items 0→1→2→3 and reached items 1 and 2. On a second simulator run, a MAVLink mode switch to Loiter at 1.215 m took over from AUTO, then a deliberate LAND mode change landed and disarmed. Direct AUTO arming was denied by default Copter settings, and simply selecting AUTO after Stabilize arming did not take off; it auto-disarmed. Thus Lucidity's present upload/readback remains storage-only, and its disabled flight-run button is accurate. The 15 s authored scene is not an exact ArduPilot flight duration.

Evidence and reproduction: [SITL_MISSION_EVALUATION_2026-10-21.md](SITL_MISSION_EVALUATION_2026-10-21.md) and the loopback-only `scripts/mission-sitl-service-smoke.ts` / `scripts/mission-sitl-flight-eval.ts`. The five mission evaluation suites passed 43 deterministic tests; TypeScript passed. This is simulator evidence, **not** a physical-flight test or clearance. The Loiter takeover was a MAVLink simulation, not a check of the user's Zorro switch or RC failsafe. Next: implement a reviewed launch/monitor/abort path with normal pre-arm gates and fresh state checks, test replay/reset and adverse link cases in SITL, and complete the operator's AltHold/Loiter and supervised props-off upload/readback on the actual quad before considering an automated props-on show.

### SITL repeat-start and telemetry disconnect follow-up

The loopback-only `scripts/mission-sitl-launch-contract-eval.ts` queried default SITL parameters `FS_GCS_ENABLE=0`, `FS_THR_ENABLE=1`, `FS_OPTIONS=16`, and `FS_GCS_TIMEOUT=5`. After one normal mission flight and disarm, a disarmed `MAV_CMD_DO_SET_MISSION_CURRENT` seq 1 with reset flag 0 returned accepted ACK and fresh current item 1 without arming. A second normal Stabilize arm plus `MAV_CMD_MISSION_START` returned accepted ACK, flew the mission again to 2.125 m peak, landed, and reported disarmed. On a third simulator run, the localhost telemetry TCP socket was closed for 8.007 s while AUTO/armed at 1.007 m. It reconnected to a fresh AUTO/armed heartbeat at 1.842 m, then observed landing and disarm. Progress during the gap was unobserved. This is **not** a triggered GCS failsafe test: GCS failsafe was disabled in SITL, no periodic GCS heartbeat was sent, and RC was not disconnected. It does not validate physical DroneBridge loss or the user's quad parameters. It establishes the need for fresh state reconciliation after telemetry interruption before a UI claims completion or offers another run. See the [SITL evaluation](SITL_MISSION_EVALUATION_2026-10-21.md) for exact evidence and limits.

Final integration check: the Flight readiness screen now presents the remaining pilot, real-aircraft mission-storage, simulator recovery, and live-launch gates in a compact list; Run stays disabled. The UI recovery predicate now rejects an invalid seq-0 home entry using the same frame and coordinate checks as the aircraft service. In the actual localhost app, the saved **First live hover** card opened, its 2 m/5 s command preview rendered, the USB radio showed as disconnected, and the unavailable Run control was visible. The localhost preview was confirmed serving again after a browser reload. The full suite passed **93 files, 1,388 tests** with two workers, and the final TypeScript/production build passed. No physical serial connection or aircraft command was made during this integration check. The [launch gate note](MISSION_LAUNCH_GATE.md) records the missing runtime evidence and safe stop semantics for the next implementation slice.

### Flight observation and mode-switch visibility follow-up

The MAVLink decoder and status API now retain source-bound `MISSION_CURRENT`, `MISSION_ITEM_REACHED`, and `EXTENDED_SYS_STATE` landed state. A bounded command-ACK event stream preserves source, target, command and result with a checked cursor, so a later flight runner can correlate fresh acknowledgements instead of relying on a single last-ACK field. Deterministic decoder/service tests cover source isolation and stale/invalid cursors. This adds observation only: no arming, mode change, mission start, or flight control route was enabled.

Radio setup now reads the aircraft's `FLTMODE1` through `FLTMODE6` assignments and highlights the slot selected by fresh live switch PWM. It also shows the aircraft-reported current mode for comparison and makes no parameter writes. A three-position switch may select slots 1/4/6 rather than 1/2/3, depending on its PWM outputs. Boundary/mapping tests passed, and a synthetic browser fixture visibly stepped through slots 1, 4 and 6. The actual Zorro's new switch mapping has not yet been tested against the connected quad through this view.

After these changes, the complete two-worker suite passed **94 files, 1,394 tests** and the TypeScript/production build passed with local Node 23.3.0. The actual localhost **First live hover** readiness view and an isolated radio-mode fixture were visually checked; all mock/SITL checks remain distinct from physical-aircraft evidence. The saved live-hover candidate is still preparation-only and the flight Run control remains unavailable. No real USB port was opened or aircraft command sent in this follow-up. Next: the operator confirms the Zorro mode positions and flies AltHold/Loiter with a pilot; then perform disarmed props-off mission upload/readback on the quad, implement and rehearse the correlated flight launch/monitor/land transaction in SITL including adverse cases, and only then reassess a supervised physical show.

### Read-only prelaunch mission-storage verification

`AircraftService.verifyMissionForLaunch` now freshly re-downloads the complete four-item mission while the aircraft reports disarmed. It requires a current reviewed storyboard on the same connection generation, fresh heartbeat/GPS/position, a valid seq-0 home, and an exact TAKEOFF → timed LOITER → LAND readback. The returned 15-second proof is bound to the storyboard revision, aircraft and connection. A changed storyboard, replaced mission, stale telemetry, reconnect or later mismatching readback invalidates it. The status and proof both state **storage only; no flight is authorized**. The check does not arm, change mode, start a mission or expose a launch route. Battery, RC, failsafe, EKF, home and pilot checks remain separate gates.

Seven new deterministic service tests covered matching readback, changed mission/home, storyboard revision, stale telemetry, expiry, reconnect and subsequent readback invalidation. The three focused mission suites passed 28 tests and TypeScript passed. Official isolated ArduCopter 4.7.1 SITL initially refused verification before a GPS fix; after fresh GPS/position, its service-level upload and readback returned home plus the saved 2.0 m/5 s mission, and the new storage proof passed. This was localhost SITL, **not** a physical-aircraft check. The simulator was stopped afterward. Next: finish the launch monitor/abort contract in SITL, then validate the actual quad's preflight and disarmed props-off storage path before any supervised automated flight.

### Final flight-readiness integration and fail-closed observer

An independent review found that the mission comparator had skipped seq-0 home validation. It now rejects a wrong HOME command, frame, sequence or invalid coordinates/altitude while allowing Copter to rewrite home coordinates. Deterministic mutations cover these failures. The Flight readiness blocker for pilot mode tests now opens Lucidity Radio setup directly; in the running localhost app, returning to Drone Show resumed the same saved First live hover storyboard. The link is unavailable during an active upload.

Added a pure `flight-progress` observer for a future simulator runner. It consumes source-bound heartbeat, mission-current/reached, position and landed-state evidence and classifies pending, active, pilot takeover, uncertain and landed. It sends no commands and has no route or physical UI integration. Eight deterministic cases cover missing progress, staleness, link-generation change, sequence regression/stall, takeover, non-AUTO disarm, and completion without a final LAND-reached event. Copter 4.7.1 SITL did not emit that final reached event, so completion instead requires LAND current, prior LOITER reached, prior airborne evidence, and fresh disarmed/on-ground/near-zero position. A disconnected or ambiguous run remains uncertain.

**Final check:** 96 test files and **1,410 tests passed** with two workers; TypeScript and the production build passed with local Node 23.3.0. Localhost preview remains listening on `127.0.0.1:5173`; the First live hover preparation UI and Radio setup link were visually checked. SITL was stopped after its isolated verification; no physical serial device was present and no real aircraft command was sent. The live Run button remains disabled. The remaining blockers are pilot-flown AltHold/Loiter and takeover/mode-slot checks, physical props-off upload/readback and preflight evidence, then a guarded launch/monitor/land runner with adverse-case SITL tests. The 1 ft design study and 5 ft out-and-back are not yet physical-flight candidates.

### Simulator launch transaction, EKF gate, and storage proof UI

The **First live hover** Flight readiness panel now offers a read-only **Verify stored mission** action after disarmed, props-off upload/readback. It re-downloads all four items and displays a 15-second, aircraft/link/storyboard-revision-bound proof that the mission is stored; it explicitly does not clear a flight. The physical **Run flight unavailable** control remains disabled. An isolated mock-browser walk-through exercised connect, assign, plan review, upload, full readback, proof display and expiry; this was an injected fixture, not the user's aircraft.

Added a guarded launch transaction only for an injected, hardcoded `127.0.0.1:5760` ArduCopter 4.7.1 SITL adapter. It correlates mission reset, normal non-forced ARM and MISSION_START with source/target-matched ACKs and fresh state, never blindly retries unknown outcomes, watches mission progress, and requests LAND for a normal active-run stop. `MISSION_CURRENT.total=3` is correct for Copter's four stored items because HOME is excluded. A source-bound `EKF_STATUS_REPORT` gate requires fresh absolute horizontal and vertical position plus vertical velocity before ARM, and a new healthy report after ARM before START; predicted-only or EKF fault flags block it. The general checkup now reads Copter 4.7's `BATT_FS_LOW_ACT` and `ARMING_SKIPCHK` rather than obsolete parameter names.

One fresh-wipe guarded **normal SITL** run completed after virtual-sensor warmup: EKF flags 831 passed; the exact 2.0 m takeoff/5 s hold/LAND mission uploaded and read back; commands `[224,400,300]` each received a correlated ACCEPTED ACK; the transaction observed AUTO/armed and later **landed**, disarmed, on ground at 0.016 m. Earlier attempts stopped safely on missing current-item telemetry, sensor inconsistency, AUTO requiring position, or early EKF flags 167 (no absolute position; constant-position mode). A first successful flight run exposed a harness polling gap; periodic observation fixed the final landed verdict. The separate simulator LAND, takeover, missing-ACK, repeated-launch and link-loss paths of this transaction still need SITL evaluation. See [SITL_MISSION_EVALUATION_2026-10-21.md](SITL_MISSION_EVALUATION_2026-10-21.md) for exact limits.

The complete suite passed **98 files, 1,439 tests**, and the production build passed with local Node 23.3.0. The localhost preview remained on `127.0.0.1:5173`; no real serial device was opened or aircraft command sent in this slice. **Not ready for props-on Lucidity launch:** the actual quad still needs pilot-flown AltHold/Loiter, verified CH5 mode/takeover behavior, flight log and battery/failsafe review, and a disarmed props-off mission upload/readback. A physical launch/monitor/stop route and its explicit UI gates have not been built. Next: run adverse guarded cases in SITL, then complete the supervised aircraft checks before designing the physical launch adapter. The later five-foot out-and-back requires separate positioning evidence and mission/compiler work.

### Weekend one-drone path and field readback

Created [WEEKEND_ONE_DRONE_SHOW.md](WEEKEND_ONE_DRONE_SHOW.md), a five-step go/no-go path for one supervised **First live hover** at a 2 m design height with a 5 s hold and ArduPilot-controlled landing. It identifies two independent blockers: Lucidity has no physical launch route, and this quad has not yet flown AltHold/Loiter or demonstrated the intended CH5 takeover. The one-foot storyboard remains a simulation study. The checklist points to the real props-off transfer, field recheck and postflight log review rather than treating SITL as flight clearance.

The Flight readiness UI and middleware now permit **read-only** connect, assign, review and full mission verification after propellers are installed at the field. Upload remains restricted to a disarmed, props-off aircraft, with a second explicit reviewed-upload confirmation. Both confirmations reset after an upload attempt. A link loss/restart clears the visible proof; the service still binds its 15-second storage proof to the aircraft, link generation and storyboard revision. An isolated browser fixture exercised props-on readback, props-off upload, restart and re-verification with injected mock telemetry. Focused UI/middleware/service tests passed **16/16**; no physical aircraft was connected and no flight command was added.

Lucidity's fixed disarmed telemetry request now includes source-bound EKF, landed-state and mission-current streams at 2 Hz; HOME remains one-shot and waypoint-reached event-driven. `verifyMissionForLaunch` also requires seq-0 HOME to be nonzero and within 10 m of fresh source-bound global position after readback. Deterministic zero/near/far tests passed (**19/19**), and framing/service checks passed (**42/42**). This is a storage/proximity check, **not** a home-set, EKF, pre-arm or future-flight guarantee; a physical runner must repeat a fresh readback and independently check flight readiness.

Fresh-wipe ArduCopter 4.7.1 SITL exercises of the guarded **loopback-only** transaction passed explicit LAND (`[224,400,300,176]`, final disarmed/on-ground), simulated Loiter takeover (not marked as autonomous completion), a suppressed START ACK (reported unknown, no retry), and a midflight TCP link loss (reported unknown; fresh receive-only reconnect saw actual AUTO/armed before separate simulator-only LAND recovery). A repeat attempt exposed intermittent observer uncertainty when `MISSION_CURRENT` moved backward near landing. A timestamped trace plus local Copter 4.7.1 source showed the mission resets during LAND disarm before the newer disarmed heartbeat may arrive. The observer now defers only seq 3→1 after final LAND, prior reached/airborne evidence, on-ground/near-zero position and an older armed heartbeat; it requires a newer disarmed heartbeat within three seconds. Airborne reset or a fresh still-armed heartbeat remains unknown. One fresh-wipe two-flight repeat then passed: first and second flights ended landed/disarmed/on-ground at 0.007 m and 0.008 m, with a new full readback/proof and reset before the second. Focused observer/harness tests passed **33/33** and TypeScript passed. These are simulator outcomes, not the user's DroneBridge/Zorro path. **Final integration:** the full suite passed **98 files, 1,445 tests** and the TypeScript/production build passed with local Node 23.3.0 after the observer and UI edits. Localhost preview remained listening on `127.0.0.1:5173`; SITL was stopped with no port 5760 listener. Next: complete the guarded physical launch/monitor/land route behind pilot and aircraft gates, and perform the real props-off upload/readback plus AltHold/Loiter/mode-switch qualification before reassessing a first flight.

### Guarded physical launch path and field-flow integration

Implemented the local AircraftService physical Run path for the saved 2 m/5 s **First live hover** storyboard. Its field check refreshes the full mission readback and short-lived revision/aircraft/link proof; checks fresh ArduCopter 4.7.1, disarmed/on-ground GPS/EKF, 4S battery and RC telemetry; and reads selected arming, AUTO, RC-loss LAND, EKF LAND, battery LAND/delay, RC6 and flight-mode parameters without changing them. The service admits exactly one flight run, journals it before any command, resets to mission item 1 while disarmed, then sends normal non-forced ARM and MISSION_START with correlated ACK plus fresh aircraft-state evidence. The UI exposes Check flight readiness, Run storyboard, live status and normal LAND. It also makes an unknown launch or LAND response explicit and refuses blind retries. Voluntary disconnect and competing writes are blocked during an active run. An interrupted or ambiguous run remains locked until the operator removes props and the server sees fresh disarmed/on-ground/near-home telemetry for reconciliation; a landed run can be prepared again with a new proof. RC6 cuts motor output and is not the normal in-air stop.

**Evidence:** fresh-wipe Copter 4.7.1 **SITL**, reached through an injected loopback adapter for the physical command class, passed normal mission completion, explicit LAND, suppressed START ACK (unknown without retry), mid-flight telemetry loss/reconnect (still unknown), and a full two-flight repeat after new readback/proof. The physical serial device, DroneBridge and Zorro were not used. The HTTP boundary and UI run flow were exercised with injected service/mock-browser fixtures; injected service preflight/parameter checks were added and are pending final consolidated verification. These are not a full end-to-end physical-aircraft flight or proof that the actual battery/failsafes respond correctly. Copter 4.7.1's `MAV_CMD_RUN_PREARM_CHECKS` ACK confirms processing, not pre-arm success; the normal ARM remains authoritative. Lucidity emits no GCS heartbeat, so a configured GCS-loss action is not demonstrated as a link-loss LAND response.

**Next:** complete focused tests, full suite and production build, keep the localhost preview usable, then require the operator's actual AltHold/Loiter flights and reachable mode-switch/takeover check, onboard GPS/compass/battery/log/failsafe review, and a props-off real-aircraft mission upload plus full readback. Only after those pass should a qualified pilot supervise one outdoor Lucidity-launched 2 m hover/hold/LAND. The 1 ft design study and 5 ft out-and-back are still not physical mission candidates.

### Final readiness audit and recovery fixes

The final review found and fixed three concrete issues before the field handoff. The UI's LAND affordance now recognizes the decoder's actual `Auto` mode, with a regression test based on that canonical value. An interrupted run can be recovered after a server restart or USB reconnect: the operator explicitly selects the freshly connected, disarmed quad, removes all props and confirms it is on the ground; the server checks that selection against its durable system/component/UID journal before clearing the lock. For an unknown run, the modal allows USB disconnect only after the props-off and grounded confirmations; active/airborne disconnect remains blocked. A journal written immediately before a launch-adapter failure now surfaces as **unknown** instead of falsely **idle**, so the locked run stays visible and recoverable. Tests cover these cases without sending real aircraft commands.

**Final evidence:** the complete two-worker suite passed **99 files, 1,460 tests**; TypeScript and the production Vite build passed with local Node 23.3.0. A mock browser exercised Run → active → LAND → landed, unknown/reconnect/reconcile, and props-off disconnect. In the actual localhost app, the saved **First live hover** card opened and its Flight readiness dialog displayed the 2 m path, three mission commands, disconnected-port state and disabled Run control. The preview process remained listening on `127.0.0.1:5173`; SITL TCP port 5760 had no listener. Fresh-wipe Copter 4.7.1 SITL passed the physical command class's normal, LAND, missing START ACK, link-loss and two-flight repeat cases through an injected loopback adapter; see [the SITL record](SITL_MISSION_EVALUATION_2026-10-21.md). No real USB radio or aircraft command was used for this final integration check.

**Next field slice:** the pilot verifies AltHold, Loiter and actual CH5 switch takeover; reviews the flight log, battery under load and GPS/compass/failsafes; then, with props removed, uses Lucidity to upload and read back the saved mission on the real quad. The field readiness check may identify parameters needing intentional pilot review, especially RC-loss action and low-battery delay; Lucidity does not silently change them. Only after those checks pass should one supervised outdoor **First live hover** use the guarded Run/LAND path. This software validation is not a physical end-to-end flight test.

## October 22, 2026 — Flight-log review for the throttle-dependent shiver

The operator reported a fast in-air shiver/buzz in Stabilize that worsened with throttle. The quad was landed, disarmed and unplugged; no prop or motor felt loose by hand. A separate `PreArm: Battery 1 low voltage failsafe` / `RC not found` screenshot was taken with **FC USB power only and the flight battery disconnected**, so those messages are not evidence of a fully powered flight fault. The aircraft later reconnected, but the in-air shiver remained. No further flight was recommended pending onboard-log and physical inspection.

Added Lucidity **Tools → Flight logs**. With one fresh, disarmed ArduCopter/MAVLink 2 aircraft and the propellers-off confirmation, the operator can list onboard DataFlash recordings, download one complete `.BIN` with progress/cancellation, save the original, and inspect a bounded report of VIBE/clipping, ATT/RATE desired-versus-measured motion, CTUN throttle, battery and mode records. The file can also be opened locally in the browser without connecting the aircraft or uploading the file. Analysis uses self-describing FMT records, normalizes chart times to elapsed recording time, and labels whole-log throttle/vibration correlation as exploratory; it does not diagnose a component or clear the aircraft to fly. A compact read-only arming-status area in Radio setup displays the last aircraft-reported `PreArm:`/`Arm:` message, its age, current mode, raw CH6 input and configured RC6 function without inferring switch polarity.

The MAVLink adapter uses only `LOG_REQUEST_LIST`, `LOG_REQUEST_DATA` and `LOG_REQUEST_END` plus a GCS heartbeat during transfer; there is no erase route or flight/arm/motor command in this workflow. It checks source identity, bounds each request and retry, requires complete byte coverage, and blocks competing aircraft operations while a log is being transferred. Cancellation and link loss leave no partial file; an earlier completed download survives a failed/cancelled list refresh. Direct FC USB while disarmed and battery-off is the preferred large-log path; DroneBridge transfer speed and the physical quad's logging backend are unverified. ArduPilot's [log-download protocol](https://shop.ardupilot.org/dev/docs/mavlink-log-download.html) requires disarming and one data request at a time; its [log-message reference](https://logbrowser.ardupilot.org/copter/docs/logmessages.html) defines the VIBE fields used here.

**Evidence at the time of that implementation:** the complete two-worker suite passed **102 files, 1,480 tests**; TypeScript and the production Vite build passed with local Node 23.3.0 **after the final UI edits**. Deterministic protocol, parser, service and HTTP-boundary tests cover complete transfer, source/size validation, cancellation, preserved original bytes and prohibited log erase. Isolated **ArduCopter 4.7.1 SITL** returned one 2,515,346-byte log through the actual AircraftService transfer twice; the downloaded SHA-256 matched the source exactly, and the parser read 62,075 records (including ATT, RATE, VIBE, CTUN, BAT and MODE). SITL was stopped afterward. A development-only injected browser fixture exercised listing, 0/33/67% progress, inspection, cancellation during listing and download, retry, oversize refusal and local `.BIN` import; its saved synthetic `.BIN` matched the fixture bytes. The actual localhost `#/tools/diagnostics` page rendered the disconnected workflow. These browser checks use synthetic data, not the user's drone. The subsequent real-aircraft log read and review are recorded below.

### Actual wobbly-flight log, assistant removal, and ChatGPT bridge plan

With the user's explicit confirmation of **direct FC USB, battery disconnected, every propeller removed**, Lucidity received a live disarmed Stabilize heartbeat and listed ten onboard logs. It downloaded log 10; the operator confirmed that this was the wobbly flight. The 409,746-byte original is saved locally at `artifacts/flight-logs/2026-10-22-wobbly-flight-log10.BIN` (ignored by Git; SHA-256 `8e45e26aacb0979960f3d0ec3698b28674f626ce8ebccea0fb7ac0f8e856029c`). No arm, motor, parameter-write, or flight command was sent. [The focused review](FLIGHT_LOG_REVIEW_2026-10-22.md) records powered-interval rate divergence with centered roll/pitch sticks and sharply varying motor commands. This substantiates the reported oscillation but not its cause. Individual VIBE axes remained below 30 m/s², with two clips after a throttle cut; the former combined-magnitude number must not be compared to ArduPilot's per-axis guidance. The operator reported no unusual relative motor or electronics heat. The quad remains grounded pending prop/motor/frame/FC-mount inspection and supervised initial tuning. No stable AltHold/Loiter or Lucidity physical flight is claimed.

The Flight logs report now displays VibeX/Y/Z summaries and traces separately and labels combined magnitude. A test specifically covers sub-30 per-axis readings whose vector magnitude exceeds 40. A side agent removed the built-in assistant dock, Home/Tools prompts, Show panel, and both assistant server routes; the expert editor, aircraft tools, saved storyboards, and dormant command/evaluation harness remain. The latter is no longer wired into the running app or provider calls. [The ChatGPT bridge plan](CHATGPT_BRIDGE_PLAN.md) proposes compact workspace/aircraft reads, a small local MCP tool surface, revision-bound reviewed edits, and a private connection with measured latency. This is a plan, not an installed ChatGPT connector. Official OpenAI documentation confirms custom MCP servers and private Secure MCP Tunnel support, subject to workspace access and a tunnel runtime key.

**Validation:** the localhost Home and Drone Show screens rendered without assistant controls, and the user's four saved storyboard cards were still present. The updated DataFlash focused tests and TypeScript passed; the final production build passed with Node 23.3.0. A two-worker full-suite run hit the existing ESC fresh-telemetry timing flake (1 failure in 1,467 tests); that ESC suite passed in isolation, then the complete one-worker suite passed **100 files, 1,467 tests**. The direct real-log browser download worked; after the dev-server restart the artifact was preserved in the ignored local file. The corrected axis UI was covered by focused tests; the browser automation's local-file chooser did not open for a later manual re-import, so that specific corrected visual report remains unverified with the real file. Next: physically inspect the grounded quad and review the recorded tune with the pilot before a controlled retest; for product work, implement the first read-only workspace snapshot and MCP tool prototype, then measure it against the screenshot-driven flow before connecting ChatGPT.

### Direct-USB level reference check

After the second controlled rate-gain reduction, the operator reported that the fast wobble had stopped but a slow left drift remained in Stabilize. The new onboard log showed much lower sampled roll-rate error, but its powered intervals were too short and GPS lacked a fix, so it could not establish drift direction or root cause. With the props removed, battery disconnected and airframe physically level, live direct-USB telemetry remained near +3.0° roll while RC roll was centered. [CONTROL_TUNE_2026-10-22.md](CONTROL_TUNE_2026-10-22.md) records the flight and level evidence.

Added a guarded **Sensors & GPS → Calibrate level** flow using ArduCopter's fixed board-level trim command (MAVLink 241, parameter 5 = 2). The service requires a fresh disarmed single ArduCopter on a freshly enumerated direct ArduPilot USB port, rejects recent flight-battery voltage and competing operations, requests fresh `AHRS_TRIM_X/Y` before and after, matches a final source/target ACK, and requests a post-command attitude. The UI shows live roll/pitch, offers Request attitude, requires explicit physical checks, and displays before/after readings and an unconfirmed state without silently retrying. This does not substitute for full accelerometer calibration or prove flight drift is corrected. The localhost Sensors & GPS page visibly showed fresh +3.0° roll and -0.2° pitch after reconnect. Eight focused mock tests passed across backend, route and UI; TypeScript and the production build passed. A pre-existing fake-timer hook timeout prevents using the full middleware suite as validation for this slice. No physical calibration command had been sent at the time of this entry. Next: with the level airframe still stationary, run one authorized calibration, verify independent trim/attitude readback, and then perform a separate short supervised hover to assess drift.

**Physical calibration outcome:** After explicit operator authorization, one level command was sent on the disarmed direct-USB controller at 21:40:18 UTC. ArduPilot returned `MAV_RESULT_ACCEPTED` and a `Trim OK` status message. `AHRS_TRIM_X` moved from −0.014354081 to +0.038675606 rad, `AHRS_TRIM_Y` from −0.000857927 to −0.003461692 rad; stationary roll/pitch moved from +3.046°/−0.152° to +0.007°/−0.004°. A separate parameter request returned the same new trims, and live attitude remained near 0° on both axes. The app showed this updated level reading. No reboot persistence or in-flight drift improvement has yet been measured. See [CONTROL_TUNE_2026-10-22.md](CONTROL_TUNE_2026-10-22.md) for the full evidence and next controlled flight check.
