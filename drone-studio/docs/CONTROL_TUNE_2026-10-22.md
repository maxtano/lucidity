# First controlled roll/pitch tune — 2026-10-22

The wobbly Stabilize flight in [FLIGHT_LOG_REVIEW_2026-10-22.md](./FLIGHT_LOG_REVIEW_2026-10-22.md) showed large uncommanded roll-rate oscillation while the sticks were near center. The operator checked blade orientation and reported that the flight-controller stack is firm with no wires pressed against it. The log did not isolate a failed motor, prop, or ESC. This is an **initial stabilization tune**, not proof of the root cause or a flight clearance.

Lucidity connected directly to the ArduPilot USB serial device at `/dev/cu.usbmodem11401`. The aircraft heartbeat was fresh, disarmed, and in Stabilize; the battery telemetry field was null. The operator had been instructed to disconnect the flight battery and remove all propellers before connecting USB. Lucidity captured all **1,085 of 1,085** reported parameters in a complete local backup at `artifacts/flight-logs/2026-10-22-pre-tune-parameters.json` (ignored by Git).

Following [ArduPilot's initial-tuning response to oscillation](https://ardupilot.org/copter/docs/initial-tuning-flight.html), these six rate gains were reduced by 50% while disarmed. Each write used a fresh prior-value check and an independent readback. A separate targeted read afterward confirmed the reported values:

| Parameter | Before | Verified after |
| --- | ---: | ---: |
| `ATC_RAT_RLL_P`, `ATC_RAT_RLL_I` | 0.135 | 0.0675 |
| `ATC_RAT_RLL_D` | 0.0036 | 0.0018 |
| `ATC_RAT_PIT_P`, `ATC_RAT_PIT_I` | 0.135 | 0.0675 |
| `ATC_RAT_PIT_D` | 0.0036 | 0.0018 |

No filter, motor, battery, mission, or flight command was changed. `INS_GYRO_FILTER` and the four roll/pitch rate filters still read **20 Hz**; harmonic notch remains off. [ArduPilot's setup guide](https://ardupilot.org/copter/docs/setting-up-for-tuning.html) gives higher initial filter values for 5-inch props, but gives no specific 3.5-inch value. Changing filter bandwidth without gyro-noise evidence could expose more motor noise, so that remains a separate tuning step.

**Reboot verification complete:** after the operator disconnected and reconnected the flight-controller USB, Lucidity reopened `/dev/cu.usbmodem11401` and received a fresh, disarmed Stabilize heartbeat. A fresh parameter request returned all six new gains at the values in the table above. The direct USB connection initially stayed disconnected after replugging and required an explicit reconnect in Lucidity; this did not affect parameter persistence. No motor or arm command was sent.

## Follow-up flight and second reduction

The operator reported that the first reduction felt somewhat better, but a fast shiver remained and the quad slowly drifted left in Stabilize. They then confirmed that it was landed, disarmed, the battery was unplugged, and all propellers were removed before connecting the flight controller directly by USB. Lucidity downloaded onboard log 8 (2,154,996 bytes) to the ignored local file `artifacts/flight-logs/2026-10-22-post-tune-log8.BIN` (SHA-256 `fc703fc4696deb99d2fba7f3381797a56a85cc66f819a0a5d414c71588bd2bd3`). This log contains five armed Stabilize episodes over about 144 seconds and one incomplete trailing record.

The shiver is **not resolved** in the recorded powered intervals. At CTUN throttle output above 0.10, the median absolute roll-rate error was approximately 102 °/s post-tune versus 109 °/s in the earlier log; the post-tune peak reached about 202 °/s. The recording rates are too low to identify the buzz frequency or a faulty motor. Roll/pitch RC inputs remained centered. Individual post-tune VIBE peaks were X 8.9, Y 9.8, Z 28.0 m/s², with three cumulative clips. Battery voltage ranged about 15.42–16.12 V, with no obvious large collapse. GPS had no usable fix, so the log cannot measure the reported leftward movement. Several powered intervals estimated a few degrees of roll with a level-roll request, but neither the drift direction nor its cause can be established from this alone. Stabilize itself does not hold horizontal position; ordinary drift requires pilot correction [per ArduPilot](https://ardupilot.org/copter/docs/stabilize-mode.html). Do not attempt AutoTrim while the shiver remains.

Following the same [ArduPilot initial-tuning procedure](https://ardupilot.org/copter/docs/initial-tuning-flight.html), Lucidity applied a **second 50% reduction** of the six rate gains while the controller was freshly connected and disarmed. Fresh read-before values matched the first round; each write returned its own readback, and a separate request confirmed all six new values:

| Parameter | First reduction | Second reduction, independently read back |
| --- | ---: | ---: |
| `ATC_RAT_RLL_P`, `ATC_RAT_RLL_I` | 0.0675 | 0.03375 |
| `ATC_RAT_RLL_D` | 0.0018 | 0.0009 |
| `ATC_RAT_PIT_P`, `ATC_RAT_PIT_I` | 0.0675 | 0.03375 |
| `ATC_RAT_PIT_D` | 0.0018 | 0.0009 |

**Reboot verification complete:** the operator disconnected and reconnected the direct flight-controller USB. Lucidity reopened the ArduPilot port, received a fresh disarmed Stabilize heartbeat, and independently read all six gains at the second-reduction values shown above. No arm, motor, or flight command was sent.

At this point the second reduction had **not** yet been flight-tested. The cause of oscillation remained unknown, and the gains could make control markedly sluggish. The next step was a short pilot-controlled Stabilize check in clear, low-wind outdoor conditions, with immediate landing if shiver returned. If reverting is needed, restore the six original values from the local backup while disarmed, with each readback verified.

## Second-reduction flight observation

The operator reports that the wobble is no longer perceptible, but the quad slides left during throttle application and continues drifting left in the air in apparently calm conditions. With the battery disconnected and propellers removed, Lucidity downloaded the next onboard log to `artifacts/flight-logs/2026-10-22-wobble-free-left-drift-log7.BIN` (1,510,246 bytes; SHA-256 `c87e2505a75543deef721578af875e46341e04730514085641550a639629c4e0`). It contains several armed episodes; its powered throttle intervals are brief (longest approximately 1.8 seconds), so it does not prove sustained hover performance.

In throttle-output samples above 0.04, median absolute roll-rate error was about **9.8 °/s** versus **27.1 °/s** in the prior log, and none of 112 samples exceeded 50 °/s versus 47 of 145 previously. This supports the reported reduction in oscillation, with the limitation that both roughly 10 Hz logs include ground/takeoff activity. During the new powered intervals, `RCIN.C1` stayed at 1500 and `ATT.DesRoll` at 0°. Estimated roll was often several degrees positive before throttle and sometimes crossed negative during throttle pulses. This does not establish a consistent in-air left bank or a cause for the reported drift. The log has no usable GPS movement evidence. A read-only live telemetry request showed approximately **+2.9° roll** while the vehicle was stationary, but its physical support surface had not yet been confirmed level; do not recalibrate or trim from that number alone.

**Next:** confirm the propeller-free airframe is still on a genuinely level surface, compare its physical level with Lucidity's reported attitude, and review accelerometer calibration/level if they disagree. If the airframe's level estimate is correct yet a calm, steady Stabilize hover consistently drifts the same way, consider ArduPilot's documented [AutoTrim](https://ardupilot.org/copter/docs/autotrim.html) procedure with the pilot. No further gain or trim change was made in response to this log. Do not launch an automated storyboard until a sustained, stable pilot-controlled hover and flight-mode takeover are verified.

## Physical level check

The operator confirmed that the propeller-free airframe was stationary on a physically level surface with the flight battery disconnected and the flight controller directly connected by USB. Lucidity reconnected to the enumerated ArduPilot USB device and received a fresh disarmed Stabilize heartbeat. Its live attitude stayed near **+3.0° roll and −0.2° pitch** with the RC roll channel centered at 1500. The USB-only battery reading was 0.203 V; the accompanying low-battery and RC-missing pre-arm messages are expected with the flight battery unplugged and Zorro off. These observations support a level-reference mismatch as a contributor to the reported drift, but do not prove it is the only cause.

Lucidity now has a guarded **Sensors & GPS → Calibrate level** control for ArduCopter's board-level trim command. It requires a fresh disarmed direct-USB aircraft, one responding vehicle, a physically level and still frame, no connected flight battery, and explicit props-off checks. It requests `AHRS_TRIM_X/Y` before and after, correlates the command acknowledgment, and asks for a fresh post-command attitude. This is distinct from six-position accelerometer calibration and sends no arm, motor, or flight command. The feature passed eight focused mock tests and a production build.

## Authorized level calibration result

At **2026-10-22 21:40:18 UTC**, after the operator explicitly asked to calibrate, Lucidity sent the fixed board-level trim command exactly once over the enumerated ArduPilot USB port. Immediately beforehand, there was one fresh disarmed ArduCopter heartbeat, attitude was +3.047° roll / −0.132° pitch, and fresh battery telemetry was 0.203 V. ArduPilot returned a source/target-matched `MAV_RESULT_ACCEPTED` acknowledgment and `Trim OK: roll=2.22 pitch=-0.19 yaw=0.00` status text. The command's pre/post readbacks were:

| Reading | Before | After |
| --- | ---: | ---: |
| `AHRS_TRIM_X` | −0.014354081 rad | +0.038675606 rad |
| `AHRS_TRIM_Y` | −0.000857927 rad | −0.003461692 rad |
| Live roll | +3.046° | +0.007° |
| Live pitch | −0.152° | −0.004° |

An independent parameter request then read the same two new trim values, and subsequent live attitude was approximately +0.004° roll / +0.001° pitch. Lucidity's Sensors & GPS screen displayed both axes as 0.0°. No motor, arm, mission, or flight command was sent. The values have **not yet been checked across a power cycle**, and level calibration does **not** establish that the reported left drift has been fixed. Before any automated flight, use a separate short, supervised pilot-controlled Stabilize hover to observe whether drift remains; land if the fast shiver returns.

## Post-level one-sided takeoff observation

The operator then reported that, on gradual throttle, the **right side lifts first** and the quad leans and moves left. They landed, disconnected the battery, removed all props, and connected the flight controller directly by USB. Lucidity downloaded the newest onboard log (log 7, 1,044,996 bytes) to `artifacts/flight-logs/2026-10-22-post-level-left-liftoff-log7.BIN` (ignored by Git; SHA-256 `c72ef34b484c9cbb5a361cb07bb857ffd6b03695abec4cb1516f69bc04cae9f7`). The file was parsed read-only with 0 skipped bytes; its powered intervals are only about 1.7–2.5 seconds, so it is a takeoff/ground-contact record rather than proof of sustained hover.

In the clean first throttle ramp, RC roll/pitch were both 1500 and `ATT.DesRoll` was 0°. Measured roll went from +0.33° at t≈4.98 s to −1.73° at t≈5.88 s as throttle output increased from 0.069 to 0.122. Just before the negative roll began, requested outputs `RCOU.C1–C4` were nearly equal (at t≈5.28 s: 1302, 1302, 1293, 1311; at t≈5.38 s: 1310, 1314, 1306, 1315). This supports the operator's observation that the quad rolls as thrust increases **without a pilot or controller request for left roll**. RCOU records ESC commands, not measured motor RPM or thrust; near-ground contact and the roughly 10 Hz log rate limit inference. Another ramp had a large right/left output split, but the craft was already tilted, so that split could be the controller's correction rather than the cause.

A fresh direct-USB parameter read confirmed `FRAME_CLASS=1`, `FRAME_TYPE=12` (**BF_X**), `AHRS_ORIENTATION=0`, and `SERVO1–4_FUNCTION=33–36`. The [ArduCopter 4.7.1 BF_X motor matrix](https://github.com/ArduPilot/ardupilot/blob/Copter-4.7.1/libraries/AP_Motors/AP_MotorsMatrix.cpp#L580-L592) and [motor-test sequence guidance](https://ardupilot.org/copter/docs/connect-escs-and-motors.html) imply A = front-right CCW (output 2), B = rear-right CW (output 1), C = rear-left CCW (output 3), D = front-left CW (output 4), viewed from above with the aircraft nose forward. Earlier reported A–D physical positions did not match this, although labels or orientation could have been mistaken. **Do not make another props-on attempt until a new props-off A–D corner/direction check establishes the current mapping.** Do not add RC trim or further PID changes based on these short takeoff records.
