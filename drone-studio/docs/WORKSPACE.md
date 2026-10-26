# Lucidity workspace — implementation and mission

Visual design, UX research, typography, colors, and interaction rules: [UX_DESIGN.md](UX_DESIGN.md).
October 14, 2026. Lucidity brings drone setup, configuration, programming, motor music, and show design into one local workspace. The user works through explicit app controls, and ChatGPT can guide that work from outside the app. The person handles physical tasks and operating decisions. Software progress must be backed by device responses rather than a simulated checklist.

## Product navigation

- **Home:** real connection state, next actions, and the four workspaces.
- **Tools:** searchable configuration and hardware workflows. The catalogue in `src/platform/catalog.ts` describes the available tools.
- **Music:** a local motor-melody composer and computer-audio preview.
- **Drone Show:** the existing storyboard library and authoring studio, preserved as a feature. Switching away pauses its main playback. Project, undo, and library state remain in the mounted editor.
- **Code:** a persistent-in-session file editor and local command runner. Files live in `workbench-files/` and are ignored by Git.

Switch apps using the selector above the contextual left sidebar. Each app supplies its own navigation there; Home has no permanent global tab row. The sidebar footer provides connection controls, including active aircraft selection when devices are available. Hash routes support browser navigation and direct links, such as `/#/tools/parameters`. The selector returns to the last Tools section. The sidebar collapses to an icon rail on desktop and opens as a drawer on phones. Code has separate Editor and Terminal views within the app. Music, code, and show state remain in memory while switching apps. See UX_DESIGN.md for keyboard and responsive behavior.

## Feature coverage

October 18 addition: **[Check my drone (Beta)](DRONE_CHECK_BETA.md)** opens from
Home or Tools. One guided page contains preparation, automatic diagnostics,
ESC reads and operator observations, isolated ground-radio verification, and
local/downloadable reports. The first rules target ArduCopter 4.7.1 stable
four-motor builds; unsupported and outstanding checks remain explicit.

| Area                  | Implemented now                                                                                                                                                          | Remaining integration                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Connection            | Listed USB port selection, receive link, bounded guided telemetry request and verification; DroneBridge ESP32-C6 ground-mode recovery from its setup AP                  | Broader OS/transport support; complete AIR/GND binding and channel setup; durable setup-task recovery                  |
| Parameters            | Complete reported ArduPilot list, name/value search, count/index completeness, individual reviewed write, explicit readback, backup download, imported backup comparison | Firmware-matched descriptions/ranges/units, bulk restore, missing-index retry, PX4 encoding adapter                    |
| Frame and outputs     | Filtered live FRAME / AHRS / SERVO / MOT parameters; known frame and motor-function value labels                                                                         | Verified frame-specific motor diagram                                                                                  |
| Ports/peripherals     | ArduPilot serial/CAN parameter groups                                                                                                                                    | Graphical wiring and port mapping; Betaflight MSP                                                                      |
| Receiver/modes        | RC, RSSI, flight-mode and arming parameter groups                                                                                                                        | Live receiver bars and interactive calibration                                                                         |
| Power                 | Battery and ESC telemetry parameter groups; battery readings in telemetry                                                                                                | Guided battery-monitor calibration                                                                                     |
| Sensors/GPS           | Parameter groups and received attitude/GPS/position                                                                                                                      | Sensor calibration command state machines                                                                              |
| Motors                | Existing ArduPilot quadcopter bench sample, one motor, fixed 5%, one second, existing checks/ACK/stop/observations                                                       | Adjustable test profiles, measured rotation, firmware-specific physical mapping                                        |
| ESCs                  | Full feature inventory and explicit unsupported state                                                                                                                    | BLHeli_S / Bluejay / AM32 discovery, passthrough, read/write, direction, flash and melody upload                       |
| Tuning                | ArduPilot ATC/PSC/PILOT/INS/AUTOTUNE/ACRO parameters                                                                                                                     | Graphical rates/filters/profiles and version-aware constraints                                                         |
| Failsafes             | ArduPilot FS/FENCE/RTL/ARMING/BATT_FS parameter groups                                                                                                                   | Operational verification workflows                                                                                     |
| Firmware              | Local ESP binary staging, SHA-256, explicit address, detected port, esptool identification and write-flash process output                                                | FC DFU/bootloader adapters, target metadata, remote firmware catalogue, multi-image bundles, integrated backup/restore |
| Radios                | Existing MAVLink ESP radio link checks; ESP flash workflow                                                                                                               | Firmware-specific pairing/channel setup, ELRS adapter                                                                  |
| OSD/video/accessories | ArduPilot OSD/VTX/CAM/MNT/NTF/RELAY/SERVO parameters                                                                                                                     | Visual layout editors, Betaflight-specific operations                                                                  |
| Missions              | Explicit capability inventory                                                                                                                                            | Mission/geofence upload/readback, fleet execution and flight operations                                                |
| Diagnostics           | Live existing telemetry, received status messages, snapshot export                                                                                                       | Onboard log download, MAVLink inspector, Blackbox analysis                                                             |
| Music                 | Editable pitch/rest/duration sequence, three original motifs, tempo, local tune library, Web Audio preview, RTTTL export                                                 | Firmware-specific encoding/limits, hardware playback/upload                                                            |
| Code                  | Simple text files, local save/read/download, arbitrary explicitly reviewed shell commands, job output, exit codes, timeout and stop                                      | Interactive PTY input, nested project tree, diff UI, source-control integration                                        |

Family labels on cards describe intended coverage, not protocol compatibility. Read/write parameters currently require an unsigned, fresh, disarmed ArduPilot autopilot component. The parameter list is whatever that aircraft reports, rather than an invented list of example values. Raw numeric values are always retained. Known labels include Motor1–Motor4 (33–36) and FRAME_TYPE 12 (BetaFlightX); unfamiliar values remain numeric.

## Parameter contract

`GET /api/aircraft/parameters?aircraftId=...` reads the received cache. `POST /api/aircraft/parameters/read` requests the complete list and resets the collection. Each received PARAM_VALUE is tied to the decoder's connection identity; cache state cannot cross reconnects. A list is complete only with every unique index for the latest reported count. After 30 seconds, an incomplete collection becomes partial. Re-reading explicitly restarts collection; missing-index retransmission is not implemented.

`POST /api/aircraft/parameters/set` takes aircraftId, name, value, expected and confirmed=true. The UI saves the observed list to a separate local backup before sending. The backend reads the current value again, rejects a stale expected value, uses the received parameter type, writes once, allows echoes to settle, then requests a fresh read. A per-message revision prevents a cached response from satisfying the read. It verifies the normalized REAL32 value or exactly representable supported integer. This verifies a reported value, not persistence after a reboot or fitness for flight. A failed or interrupted write has an unconfirmed outcome; it does not imply rollback.

Parameter edits, telemetry requests and motor actions cannot overlap with a pending parameter write. The existing heartbeat, signed-link, armed-state, motor timeout and cooldown gates remain in force. Parameter packets are explicitly constructed; the HTTP interface has no arbitrary MAVLink-byte endpoint.

## Local workbench and flashing

The backend is provided by Vite dev/preview and is bound by local-peer, host, origin, JSON, custom-header and body-size checks. Static hosting does not provide it. Do not expose this local development service to a network.

Code commands are an explicit developer terminal, **not a filesystem or OS sandbox**. They run with the server user's permissions in `workbench-files/`, using a minimal inherited environment. The file editor only accesses bounded, simple regular files under that folder and rejects path traversal and symlink files. Executed scripts retain the user's normal OS capabilities. Commands require a reviewed run action each time.

One process runs at a time; output is bounded to the last 100,000 characters and 20 jobs. Commands time out after two minutes; esptool after three. Stop signals the process group, escalating if necessary. Interactive stdin is not supported. Closing a view does not stop a job; stop it explicitly. Server shutdown stops its jobs. The aircraft link must be disconnected for terminal/flashing work, and connection attempts are blocked while a local process owns the workbench.

ESP flashing uses the installed `python3 -m esptool`; Lucidity does not install it automatically. A binary up to 16 MB is staged locally under a content-derived name, its checksum is shown and rechecked before execution, and the user supplies the documented flash address. There is no guessed target, automatic erase, automatic retry, or claim of boot success from process exit alone. A successful esptool process must be reviewed for verification output and followed by a firmware boot check. Stopping a flash may leave it incomplete. Physical ESP flashing has not been qualified in this implementation pass.

## Built-in assistant removal

The workspace chat dock, Drone Show Assistant tab, Home prompt, tool-page prompts, and their server routes have been removed. The app does not read `OPENAI_API_KEY`, call a model provider, or send aircraft telemetry to one. The provider adapter, deterministic show-editing CLI, and synthetic evaluation harness remain dormant relative to the app for reproducible development checks. A model call is possible only through an explicitly invoked live CLI evaluation. Music, parameter backups, code files, and existing storyboards retain their storage boundaries.

## Verification

Tests cover real MAVLink parameter encoding/decoding, completeness, fresh readback, rejected writes, stale expected values, same-timestamp cache rejection, disconnect/armed/stale interlocks, and process ownership. Workbench tests exercise regular-file boundaries, a harmless local command, stop behavior, firmware staging and mutation detection, HTTP access guards, body limits, and the removed assistant route. Music tests check valid exports and malformed/bounded input.

Browser verification covers Home and all five routes, feature-level search, disabled disconnected parameter writes, melody preview with playback stopping on navigation, a harmless terminal command and its exit code, the existing storyboard library, and narrow Home/Tools layouts. No aircraft connection, motor pulse, parameter mutation or firmware flash was performed on physical hardware during this pass. No live provider request was made.

## Implementation priorities after this foundation

1. Qualify parameter reads and a controlled reviewed change on the actual ArduPilot bench setup, including disconnect and reboot behavior.
2. Import firmware-matched parameter metadata; add missing-index retry, guided calibration, receiver inputs, and the verified frame diagram.
3. Implement/test Betaflight MSP and ESC passthrough as separate adapters sharing serial ownership and typed device tools.
4. Add firmware target manifests, backup/restore, radio pairing and melody upload with device-specific verification.
5. Add durable setup tasks and programming review/diffs; design a fast, scoped ChatGPT-facing tool interface separately.
6. Build mission conversion/upload/readback and operational flight qualification as a distinct project from creative show export.

## Primary references and reuse

The feature inventory was checked against [Betaflight's setup guide](https://betaflight.com/docs/wiki/getting-started/setup-guide), [QGroundControl's setup view](https://docs.qgroundcontrol.com/Stable_V5.0/en/qgc-user-guide/setup_view/setup_view.html), [ESC Configurator](https://github.com/stylesuxx/esc-configurator), and [Espressif's esptool documentation](https://docs.espressif.com/projects/esptool/en/latest/esp32/). Parameter behavior follows [ArduPilot's parameter interface](https://ardupilot.org/dev/docs/mavlink-get-set-params.html) and the [MAVLink parameter protocol](https://mavlink.io/en/services/parameter.html). Existing node-mavlink supplies encoding/decoding. No QGroundControl, Betaflight or ESC Configurator source was copied in this pass; reuse needs component/license review when the relevant adapters are implemented.
