# Weekend one-drone Lucidity show

**Goal:** one supervised **First live hover**: rise to **2 m relative to ArduPilot home**, hold for **5 s**, then land. ArduPilot determines the climb and landing time; 2 m is not a measurement of clearance from the ground. The earlier 1 ft study remains simulation-only.

```mermaid
flowchart LR
  A[1 · Pilot checks] --> B[2 · Props-off transfer]
  B --> C[3 · Field readiness]
  C --> D[4 · One Lucidity run]
  D --> E[5 · Log review]
```

1. **Qualify the aircraft with the pilot.** On this quad, manually fly AltHold and Loiter after the successful Stabilize hover. In Lucidity Radio setup, verify which top-right Zorro switch positions actually select Stabilize, AltHold and Loiter, and practice returning to pilot control. Review GPS/compass, battery under load, onboard logs and the intended RC-loss action. [ArduPilot recommends successful AltHold and Loiter flight before AUTO.](https://ardupilot.org/copter/docs/auto-mode.html)
2. **Transfer the mission with props off.** Open **First live hover → Flight readiness**. Connect the USB ground radio with QGroundControl closed, assign the one live disarmed quad, review TAKEOFF → LOITER_TIME → LAND, then upload and verify all four stored items including HOME. Resolve any mismatch before continuing. This has passed in SITL, **not yet on this aircraft**.
3. **Check at the clear outdoor field.** After the pilot installs and checks the correct propellers, power the quad, reconnect Lucidity, and use its **read-only** field readiness check. It refreshes mission readback, ArduCopter 4.7.1 identity, GPS/EKF, on-ground state, 4S battery, RC inputs and selected failsafe parameters. It does not configure the aircraft. Check the pilot's switch access and physical area separately. The readiness proof lasts at most 15 seconds; repeat it if it expires. Lucidity sends no GCS heartbeat, so losing the DroneBridge/Mac link is **not** verified to trigger automatic LAND.
4. **Run one show with the pilot at the Zorro.** After every on-screen field confirmation and a passing **Check flight readiness**, press **Run storyboard** once. Lucidity's guarded service resets the reviewed mission, sends normal non-forced ARM, starts AUTO and monitors fresh flight evidence. **Land** requests LAND mode; it never disarms airborne motors. If the result is unknown or the link drops, do not press Run again: the pilot takes control using the tested mode switch, then confirms the aircraft is safely down. RC6 motor stop cuts thrust and is not a routine in-air abort.
5. **Review before any repeat.** Confirm disarmed/on-ground telemetry, inspect the onboard flight log, altitude, mode transitions, battery and failsafe messages, and check for unusual heat or damage. A new run requires a fresh mission/readiness proof. The proposed 5 ft out-and-back is a later project requiring separate horizontal-position evidence and mission support.

**Current evidence:** the fixed physical command transaction passed fresh-wipe Copter 4.7.1 **SITL** normal flight, explicit LAND, suppressed START ACK, link loss with unknown/reconnect, and a two-flight repeat. Middleware, service preflight and UI checks use injected fixtures; they do not validate DroneBridge, the Zorro, the quad, or outdoor flight. The actual quad still needs steps 1–3 before step 4. Never bypass an ArduPilot pre-arm check to meet the schedule. See [launch gate](MISSION_LAUNCH_GATE.md) for exact behavior and limits.
