# ESC startup melodies

Implemented October 16, 2026. One-time firmware setup lives at the top of **Music → Motor melody setup**. Once ready, each sound offers **Set as startup**; the installed sound offers **Play on drone**.
Full-backup preparation was physically verified on October 16 at 16:54 local.
All four 8 KiB images were saved and their SHA-256 hashes checked; fresh disarmed
telemetry returned after passthrough. Plan: 1dc47b2b-e26b-4144-8841-6c74f6bc96ce.
Backup: artifacts/esc-backups/1dc47b2b-e26b-4144-8841-6c74f6bc96ce.json.
With explicit operator approval, all four ESCs were upgraded and verified at 16:58 local.
The operator then power-cycled and confirmed hearing First light. A subsequent
readback confirmed Bluejay and the preserved Normal / Reversed / Normal / Normal
directions. See esc-startup-installed-2026-10-16.json and
esc-startup-power-cycle-2026-10-16.json. Motor spin and flight were not tested.

## Supported operation

- Exactly four J-H-40 / EFM8BB2 (signature E8B2, interface 1) ESCs.
- Stock BLHeli_S 16.7, EEPROM revision 33 → official Bluejay 0.21.0, 24 kHz.
- Bluejay 0.21.0, EEPROM revision 208 → melody-only update.
- Normal/reversed directions only. Other targets, revisions and 3D mode fail closed.
- Bluejay's 128-byte melody structure, up to 62 pulse pairs and 10 seconds.
  Long notes/rests are split; unsupported pitches and overflow are rejected,
  never silently truncated. All 15 library motifs fit.

The 24 kHz choice retains BLHeli_S's nominal fixed PWM frequency. This is still a
motor-control firmware change: it is not a transparent sound-only update.
Directions, beep strength, beacon strength and beacon delay retain their original
values. Other control settings use the pinned Bluejay defaults, including disabled
temperature protection. The UI discloses this and requires explicit firmware approval.
Motor operation and tuning require separate verification before flight.

## Prepare, review, install

1. Reuse the existing direct ArduPilot USB connection. Props removed, disarmed,
   fresh powered battery telemetry, AUTO=1 and PORT=0 prerequisites remain enforced.
2. Read all identities, then all 8 KiB of each ESC, including its bootloader.
   Verify target/MCU bytes, supported settings layout and unlocked code flash.
3. Save the four original images, hashes, settings, melody and exact plan in a
   durable, exclusive-created JSON file under `artifacts/esc-backups`. Flush it
   before exposing the review. If backup writing fails, installation is unavailable.
4. The plan expires after ten minutes and is bound to the current connection.
   Install requires its opaque id and explicit persistent-sound approval; upgrades
   also require firmware-change approval. Requests cannot provide firmware bytes,
   addresses, arbitrary serial commands or remote download URLs.
5. Before the first erase, reread and compare **all four complete images** against
   their backups. A change on ESC 4 prevents writes to ESC 1.
6. Upgrade sequence: EEPROM recovery marker; page-1 jump to retained bootloader;
   erase/verify page 0; write/verify application pages 2–12; restore pages 0–1;
   finally write settings with preserved direction and selected melody. This
   follows ESC Configurator's BB2 recovery ordering. Never erase/write >=0x1c00.
7. Melody-only changes preserve the entire settings page except the melody bytes
   and startup-melody enable flag. Read back the **whole 8 KiB image**, including
   untouched bootloader, before recording each ESC as verified.
8. Reset only verified ESCs, exit passthrough and require fresh disarmed telemetry.
   A lost write ACK is not retried. Stop immediately, retain the backup, report
   incomplete firmware and leave the affected ESC in the bootloader. No automatic
   rollback or forced target override exists. In-process motor tests are blocked
   after an incomplete write until a successful installation.

The operation owns the USB link, and continues if its HTTP client goes away.
Do not restart the local server or unplug power while installing. Closing the
modal is disabled during an operation. The app cannot prevent another program
from operating hardware after Lucidity exits; recovery warnings are material.

## Playback distinction

Bluejay's standard DShot commands 1–5 play fixed beacon tones. They do not accept
arbitrary pitches or invoke the custom startup melody. This implementation installs
the persistent startup melody. Power-cycle and **listen** to verify playback.
Readback verification is not audible confirmation. The installed sound can be replayed from Music: the service checks the cached
melody, uses the read-only inspection/reset path, and checks fresh melody bytes
before reporting a replay request. No flash-write capability is granted. A change
on the device is reported as a mismatch, not success. Listen to confirm sound.
Live preview of an uninstalled melody remains unavailable; no buzzer `PLAY_TUNE`
fallback is used, and auditioning a different sound never silently changes startup settings.

The sound-card **Set as startup** action explicitly authorizes a persistent melody
change. It prepares a durable backup, requires `melodyOnly: true` (rejects stock
firmware), then consumes the reviewed plan without firmware-change approval.
The more detailed firmware upgrade review remains only in the top setup panel.
Readiness and the current-startup badge come from all four current-connection
readbacks, not localStorage or a matching tune title. Prerequisite telemetry and
parameters are reused while fresh; every hardware request retains backend checks.

## Provenance and validation

- [Official pinned release](https://github.com/bird-sanctuary/bluejay/releases/tag/v0.21.0)
- [Exact image and source](../firmware/bluejay/README.md)
- [ESC Configurator flashing sequence](https://github.com/stylesuxx/esc-configurator/blob/master/src/utils/FourWay.js)
- [Bluejay startup/beacon implementation](https://github.com/bird-sanctuary/bluejay/blob/v0.21.0/src/Modules/Fx.asm)
- [Melody timing formula](https://github.com/bird-sanctuary/bluejay-rtttl-parse)
- [Migration guidance](https://github.com/bird-sanctuary/bluejay/wiki/Migrating-from-BLHeli_S)

Tests cover release hashing and HEX parsing, melody encoding against an upstream
converter vector, target/MCU rejection, bootloader bounds, direction preservation,
full-image writes through the actual protocol encoder, corrupt readback, durable
backups, all-device preflight comparison, approvals, expired/single-use plans and
lost write acknowledgements. The pre-existing read-only hardware inspection is
documented in ESC_READER.md and docs/esc-readback-2026-10-16.json.

The physical preparation test exposed a heartbeat timing bug: incoming MAVLink
was being routed away from the decoder during the 4.1-second outbound quiet
interval. The decoder now keeps processing telemetry until just before MSP
discovery, including changes to armed status. Regression tests cover both a
fresh heartbeat during the quiet interval and arming during that interval.
