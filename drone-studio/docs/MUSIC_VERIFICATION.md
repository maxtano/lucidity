## Music setup UX and physical installation — October 16, 2026

The operator explicitly approved Bluejay 0.21.0 / 24 kHz on all four J-H-40 ESCs
and First light as startup. Installation completed with full-image readback at
16:58 local. After power-cycling, the operator confirmed hearing the new melody.
A subsequent read confirmed Bluejay and directions Normal / Reversed / Normal /
Normal. Evidence: esc-startup-installed-2026-10-16.json and
esc-startup-power-cycle-2026-10-16.json. Motor spin/flight remain untested.

The Music page now has one top-level Motor melody setup panel. Setup collapses
when ready; the connection persists across sound cards. The library identifies
the installed sound by its encoded bytes on all four ESCs. That sound has a shiny
Play on drone action; other sounds offer Set as startup in a short confirmation
modal. This saves and verifies a melody without allowing a firmware upgrade.
Firmware upgrade review and compatibility details are confined to setup.
Uninstalled melodies are previewed on the computer; this version does not provide
transient motor previews or disguise a persistent change as a preview.

Validation: 78 test files / 1,274 tests pass. Coverage includes readiness after
reconnection/arming/partial reads, matching actual melody bytes, no-write replay,
melody-only refusal of stock firmware, preserved motor settings, API guards,
and fresh prerequisite reuse. Browser check confirmed the top panel, all 15
cards, and computer playback (Stop state). No USB device was enumerated during
this UX pass, so the new replay button has software verification only. The earlier
startup installation and operator's audible confirmation remain valid evidence.

Earlier entries below are chronological records, superseded where noted.

---

## Startup installer update — October 16, 2026

Music now prepares full backups and reviewed startup installations for the identified
J-H-40 / EFM8BB2 ESCs. Pinned Bluejay 0.21.0 firmware, motor directions and complete
image readback are covered by protocol/service fault tests. The full suite passed
1,262 tests; subsequent installer/API changes passed 64 focused tests and the
production build. Physical installation and audible confirmation remain pending:
the USB device is currently absent. No ESC firmware was written during this work.
See ESC_STARTUP_INSTALLER.md for exact support and verification scope.

## October 16: ESC reader verified on hardware

Music → Identify ESC firmware and Tools → ESC configuration now use the integrated read-only ArduPilot USB passthrough reader. At 16:27 local time it read all four physical ESCs as **J-H-40 / BLHeli_S 16.7**, directions **Normal / Reversed / Normal / Normal**, and restored fresh disarmed MAVLink telemetry. No erase, flash, setting writes or throttle commands were sent. Operator confirmed propellers removed and battery connected before testing.

The first attempt rejected ESC initialization and did not restore telemetry; it was reported failed. After the operator power-cycled, ESC settling timing and ArduPilot alternate-protocol recovery were corrected, and the next actual passthrough read succeeded. A preflight attempt also correctly refused to proceed without fresh battery telemetry; the UI now requests streams itself.

See [ESC reader documentation](./ESC_READER.md) and [raw timestamped readback](./esc-readback-2026-10-16.json). This establishes current firmware and settings only. Custom motor melody playback, firmware flashing and startup melody installation remain unfinished. Earlier notes below describe superseded behavior.

---

## October 16 correction: motor melodies

The previous Music UI sent MAVLink PLAY_TUNE to an onboard buzzer. This is not ESC/motor playback; the operator heard no sound and reports no buzzer. Removed that route from Music. Heartbeat connection no longer implies sound support. Each melody now opens a motor setup dialog with RTTTL copy/download and direct-USB setup instructions. The legacy buzzer API remains separate and is not used by Music.

Last recorded ESC readback: four J-H-40 / BLHeli_S 16.7, directions Normal / Reversed / Normal / Normal (see ITERATION_LOG). This is historical evidence, not automatic detection. A fresh direct-USB read is needed before firmware work. No ESC writes or firmware changes were performed in this correction.

Research: [Bluejay settings](https://github.com/bird-sanctuary/bluejay/wiki/Settings) supports RTTTL startup melody storage. [Current beep implementation](https://github.com/bird-sanctuary/bluejay/blob/main/src/Modules/Fx.asm) has five fixed DShot beacon tones and a separate EEPROM melody player. The historical test-melody-pwm release used beep 5 to play the melody; do not assume this behavior in current firmware. [ESC Configurator](https://github.com/stylesuxx/esc-configurator) provides the established programming workflow.

Remaining: verified ESC identity/compatibility, integrated ESC read/write and readback, and a supported live motor preview transport. Export is preparation only; actual startup playback has not passed an end-to-end physical test. Computer playback remains available. The older verification notes below describe the superseded buzzer implementation.

---

# Sound library verification — 2026-10-16

Implemented fifteen original note-based presets shared by Home and Music, computer preview, search, selection, composer handoff, saved melody persistence, and RTTTL export. Local audio import supports file selection/drop and clip playback; recordings are temporary references, not automatically transcribed ESC melodies. YouTube conversion is not implemented.

Drone preview uses the existing local aircraft service and targeted MAVLink PLAY_TUNE. Requires props-off confirmation, fresh unsigned disarmed ArduPilot telemetry, and no conflicting bench/parameter/terminal operation. Limits: fifteen seconds, 99 MML characters, single playback, repeat-send cooldown. Serial write completion is reported as sent, never as audible playback or startup installation. Playback requires a compatible flight-controller buzzer.

Validation: full suite passed (72 files, 1,224 tests). Final affected suite passed (22 tests), including actual packet decode, extension preservation, buffer limits, stale/armed rejection, missing props confirmation and repeat-send rejection. Production build passed. Browser verified search, keyboard-triggered synthesized playback, selection, composer handoff, saving and two-second WAV import/playback (duration 2, paused false, no media error). Screenshot: artifacts/music-library.png.

Hardware verification is incomplete: the initial USB device disappeared, and the local service reported no ports and no aircraft. No physical tune was sent and no ESC settings were changed. ESC identification, melody write/readback and power-cycle verification remain necessary. There is no ESC passthrough/memory-write adapter in this app. Export plus external compatible configurator is a manual fallback, not completion of integrated startup installation.

Primary research:
- https://github.com/bird-sanctuary/bluejay/wiki/Settings — ESC startup melody settings.
- https://mavlink.io/en/messages/common.html#PLAY_TUNE — buzzer message format.
- https://github.com/ArduPilot/ardupilot/blob/master/libraries/AP_Notify/ToneAlarm.cpp — MML handling and tune concatenation.
- https://github.com/ArduPilot/ardupilot/blob/master/libraries/AP_Notify/ToneAlarm.h — 100-byte buffer (99 characters plus terminator).

Next physical step: reconnect the drone with propellers removed, identify ESC model/firmware and buzzer support, then test a short tune. Startup support must use the detected ESC protocol and preserve/read back original configuration; do not substitute motor-test throttle commands for audio.
