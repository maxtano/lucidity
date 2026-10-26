# Check my drone — beta

October 18, 2026. Open **Home → Check my drone**, or **Tools → Check my drone**
(`/#/tools/drone-check`). Preparation, automatic checks, physical observations,
radio verification and reports are steps of one page. No separate tool is required
to connect, read ESCs, request a bounded motor pulse, stop it or download results.
The shared theme and navigation remain available.

## Scope and behavior

The first rule set is `arducopter-bench-beta-1`: ArduCopter 4.7.1 stable,
four-motor builds, local serial USB at 115200 baud, and the existing supported
SiLabs BLHeli_S / Bluejay reader. Other firmware remains explicit unsupported
coverage for configuration rules. A build profile records its name and whether
GPS-assisted flight and a ground telemetry radio are expected. This is not yet a
complete parts catalogue or a board-specific wiring validator.

1. **Prepare:** select the direct FC USB device and confirm the props-off bench
   setup. Device enumeration is read-only; opening a connection requires Start.
2. **Automatic checks:** establish a fresh single disarmed ArduPilot target,
   request telemetry, collect the configuration, observe 12 one-second link
   samples, request native pre-arm checks and evaluate versioned rules. Partial
   parameter lists cannot clear configuration checks. The number of parameters is
   shown separately from the number of checks. There is no padding to claim
   hundreds of independent safety tests.
3. **Hands-on:** read supported ESC identities/settings, request an individual
   5% one-second motor pulse through the existing guarded backend, record position
   and direction observations, compare live attitude and receiver channels, and
   record a prior power-disconnected mechanical inspection. Commands being
   accepted never automatically mark physical movement as passed. The operator
   must know their frame's expected motor diagram; physical mapping is not inferred.
4. **Radio & power:** confirm battery power with controller USB removed, choose
   the ground radio and explicitly switch the connection. The former controller
   USB device must be absent from enumeration. A fresh controller hardware UID,
   firmware version, complete configuration hash, request/response evidence,
   reported battery voltage and observation window are compared. System ID alone
   is insufficient. This is sequential isolation of the two paths, not concurrent
   multi-port control, a range test or proof of loaded power performance.
5. **Report:** failures appear first with evidence and next steps. Passed, failed,
   blocked, unsupported and pending are distinct. Human observations are labeled.
   Keep five validated reports locally and download JSON. Reports contain no
   coordinates, full parameter dumps, radio credentials or AI-generated verdicts.

Configuration rules cover enabled arming checks, battery monitoring and threshold
ordering, enabled failsafe actions, distinct RC mappings, input endpoints, unique
motor output assignments and ordered output limits. These are narrowly named
checks; a pass is not certification that thresholds or actions suit the hardware.
Sensor rules require current health/readings; a pre-arm request ACK alone does not
pass the native pre-arm result. Fresh SYS_STATUS pre-arm present/enabled/healthy
bits and a matching ACK are required. Controller-reported warnings are retained
from the check window. Missing messages stay unverified.

## Boundaries

Automatic/radio phases send only explicit connection, telemetry, parameter-read
and pre-arm requests. No arming, firmware flashing, parameter writes or automatic
repairs occur. The new POST `/api/aircraft/prearm-check` accepts only `aircraftId`
and shares localhost/origin/JSON guards. Its backend enforces fresh disarmed
unsigned ArduPilot identity and serial ownership. It emits command 401 and
one-Hz receiver/power reporting requests, never command 400.

Automatic work checks connection identity, freshness and disarmed state while
polling. Loops and HTTP calls are bounded; Cancel or leaving the tool stops further
requests. Already-sent requests may finish. ESC reads retain the existing backend
ownership and cleanup protocol. Motor pulses retain the backend timeout/cooldown
and explicit Stop action. No device action automatically resumes from storage.

Reports are historical evidence, including immediately after a run. Fresh USB
identity is needed for further physical observations, and the cached configuration
hash is rechecked before ESC/motor operations. Reconnection requires a new USB
baseline for those actions. Radio verification compares against the historical
baseline and rejects changed firmware/configuration or different hardware.
Known limitations include settings changed by an external tool after observation,
RF interference not present during sampling, undetectable mechanical faults and
unreported device capabilities.

The report never says “ready to fly.” Operational failsafes, loaded power/thrust,
RF range and flight behavior remain uncovered. A physical preflight and fresh
controller checks at the flight site remain outstanding. The roughly ten-minute
bench experience is an estimate, not a measured hardware qualification.

## Implementation and verification

- `src/checkup/model.ts`: pure rule evaluation, evidence/result types and bounded
  versioned report persistence.
- `src/checkup/runner.ts`: cancellable sequential device orchestration, measured
  observation window and cross-path identity/configuration comparison.
- `src/checkup/DroneCheck.tsx`: the five-stage contained interface and operator actions.
- `src/aircraft/decoder.ts`: exact hardware UID, sensor health, RC input, power and
  separate pre-arm ACK decoding. SYS_STATUS health is decoded even when primary
  BATTERY_STATUS takes precedence for battery readings.
- `test-fixtures/drone-check.html`: development-only synthetic flow with a fake
  transport and separate in-memory report store. It cannot command physical devices.

Tests cover partial/foreign parameter lists, stale and misaddressed ACKs,
unsupported firmware, unhealthy sensors, duplicate output assignments, disabled
checks, corrupt reports, cancellation, identity changes, multiple/armed aircraft,
missing heartbeat, invalid frames and radio identity/configuration isolation.
Protocol/service/API tests constrain the new commands and request shape.
Browser verification uses the synthetic flow; physical qualification of this
combined workflow on a real aircraft is still outstanding.

October 18 validation: 85 Vitest files / 1,333 tests passed; TypeScript and
production build passed. The browser simulation covered all stages, blocked and
successful radio isolation, an operator-reported motor failure, JSON export and
historical report action gating. The real app Home entry, light/dark themes and
390px layout were checked. See the iteration log for screenshot paths.

References: [MAVLink pre-arm command](https://mavlink.io/en/messages/common.html#MAV_CMD_RUN_PREARM_CHECKS),
[system status](https://mavlink.io/en/messages/common.html#SYS_STATUS),
[ArduPilot pre-arm checks](https://ardupilot.org/copter/docs/common-prearm-safety-checks.html),
[motor order and direction](https://ardupilot.org/copter/docs/connect-escs-and-motors.html).
