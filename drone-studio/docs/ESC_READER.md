# Read-only ESC inspection

Lucidity provides **Tools → ESC configuration** and **Music → Identify ESC firmware**. The operator confirms props removed and direct USB; the tool refreshes FC parameters, reads ESC identities and settings, restarts each selected ESC and exits passthrough. It requires a new disarmed MAVLink heartbeat before returning the link to use. No firmware or settings are written.

The local endpoint is `POST /api/aircraft/esc/read` with `aircraftId`, `propsRemoved: true`, and `directUsb: true`, protected by the same localhost, same-origin and JSON-header checks as other aircraft operations. Results are available in `/api/aircraft/status` under `esc`, tagged with aircraft connection identity, USB path/serial and timestamps. The assistant's `inspect_escs` reads this report; `prepare_esc_read` opens the guarded reader. Download readback retains raw settings bytes as hex, including unsupported layouts for diagnosis. This is not a full firmware backup.

## Supported scope

- Direct ArduPilot USB (USB manufacturer check), fresh disarmed unsigned telemetry and battery voltage, passthrough AUTO=1 / PORT=0 read within the past minute.
- MSP API 1, FC variant ARDU; request 245 enters four-way passthrough and returns channel count (1–8).
- SiLabs bootloader mode 1, EFM8BB1/BB2/BB51 signatures and their known EEPROM addresses.
- BLHeli_S 16.0–16.7 layouts 32/33, Bluejay name with known layouts 200–208. Unknown firmware/layouts remain unknown; MCU or FC identity alone never proves melody support.
- Reads 112-byte settings; identified Bluejay receives a 255-byte settings read including melody storage. Firmware-name suffix is retained separately from the two numeric version bytes.
- A 4.1-second quiet interval lets ArduPilot accept MSP. ESCs settle for 1.2 seconds after passthrough; only explicit negative init ACKs are retried (three attempts, 250 ms apart). After exit, another 4.1-second interval and a fixed PARAM_REQUEST_READ restore MAVLink routing.
- Transport has bounded buffering, XMODEM CRC, command/address matching, negative-ACK errors and per-exchange timeouts. The read-only entry point sends only MSP discovery/passthrough and four-way init, read, reset and exit. Startup installation has a separate, reviewed, target-restricted API described in ESC_STARTUP_INSTALLER.md. No raw erase/write/throttle endpoint is exposed.
- Other aircraft commands and local terminal/flashing jobs cannot share an active ESC read. Interrupted cleanup or absent telemetry puts the link in error and asks for a power cycle.

A reviewed J-H-40 Bluejay startup installer is now implemented; see ESC_STARTUP_INSTALLER.md for its separate scope and pending physical verification. Live arbitrary motor melodies, general ESC setting editing, non-SiLabs adapters, and general Betaflight MSP support remain unfinished. A successful read establishes firmware/settings only, not sound playback or flight readiness.

## Protocol references

- [ArduPilot passthrough implementation](https://github.com/ArduPilot/ardupilot/blob/master/libraries/AP_BLHeli/AP_BLHeli.cpp)
- [ArduPilot alternate-protocol timeout and telemetry resumption](https://github.com/ArduPilot/ardupilot/blob/master/libraries/GCS_MAVLink/GCS_Common.cpp)
- [ArduPilot MSP constants](https://github.com/ArduPilot/ardupilot/blob/master/libraries/AP_MSP/msp_protocol.h)
- [Four-way protocol constants](https://github.com/stylesuxx/esc-configurator/blob/master/src/utils/FourWayConstants.js)
- [SiLabs signatures and memory addresses](https://github.com/stylesuxx/esc-configurator/blob/master/src/utils/Hardware/Silabs.js)
- [BLHeli settings layout](https://github.com/stylesuxx/esc-configurator/blob/master/src/sources/Blheli/eeprom.js)
- [Bluejay settings layout](https://github.com/stylesuxx/esc-configurator/blob/master/src/sources/Bluejay/eeprom.js)

## Validation

Protocol and service tests cover CRC, split/noisy packets, wrong addresses and commands, timeouts, negative ACKs, radio rejection, power/armed/stale gates, raw-setting identity decoding, unsupported firmware, concurrency, unplug and telemetry recovery. Middleware tests cover check requirements and arbitrary-field rejection; assistant tests ensure it reads reports without silently initiating hardware access.

Initial hardware validation exposed two integration requirements absent from isolated protocol tests: ArduPilot suppresses outbound MAVLink until an inbound MAVLink packet is parsed after the alternate-protocol timeout, and a rebooted FC may not stream battery telemetry until requested. The reader now handles both, along with the ESC Configurator settling interval. Initial negative init ACKs were reported as failures, not inferred firmware identities.


Physical verification (October 16, 2026, 16:27 local): four J-H-40 / BLHeli_S 16.7 ESCs read successfully through the Music UI, directions Normal / Reversed / Normal / Normal. A fresh heartbeat confirmed telemetry restoration. Raw evidence: `docs/esc-readback-2026-10-16.json`. Computer tests: 75 files / 1,250 tests passed; production build passed. The physical read was performed with operator-confirmed props removed and battery connected. No settings changes or motor-throttle commands were sent.
