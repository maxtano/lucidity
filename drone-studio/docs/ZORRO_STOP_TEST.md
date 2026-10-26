# Props-off idle: one-drone storyboard

This storyboard is a 20-second ground show: Lucidity asks ArduCopter to **arm normally**, so all four motors should turn at the configured armed-idle speed. Lucidity then asks it to disarm. It sends no throttle, RC override, motor-test, or takeoff command. Nothing in this storyboard is a flight path.

```text
Run storyboard ──► normal arm ──► four motors at armed idle ──► disarm at 20 s
                                       │
                         Your radio motor-stop switch
                         can interrupt output at any time
```

1. Remove **all propellers**, secure the drone, clear the area, and keep the battery connector reachable. Link the Zorro and hold throttle at minimum. Close QGroundControl before Lucidity opens the serial radio.
2. Open **Your storyboards → Props-off idle → Run storyboard**. Connect the ground radio, request telemetry, assign the single aircraft, and select **Check setup**. The app reads the relevant ArduPilot settings; it does not change them.
3. Confirm the four on-screen checks and select **Run storyboard**. Observe the motors. Flip your configured radio motor-stop switch during the 20-second window and verify **every motor stops**. Lucidity will still request disarm at the end; wait for the disarmed confirmation before replaying.
4. Mark what you observed. You can reset the radio switch and replay the same storyboard for another attempt. If a motor keeps turning or disarm is unconfirmed, use the radio stop, disconnect the flight battery, and investigate before trying again.

The app requires a fresh Stabilize heartbeat, battery and bidirectional telemetry, ArduCopter 4.7.1, one assigned quad, no skipped pre-arm checks (`ARMING_SKIPCHK=0`), `RC6_OPTION=31`, `MOT_SPIN_ARM=0.05–0.15`, and `DISARM_DELAY=25–45` seconds. ArduPilot renamed the older `ARMING_CHECK` parameter to `ARMING_SKIPCHK` in this firmware line. A 20-second server timer and short browser lease request disarm if the view closes. If the link fails, motor state is reported as unconfirmed; only a fresh disarmed heartbeat confirms disarm. Motor movement and switch position are **observed by the operator**, not measured by Lucidity. If any of the settings need changing, use the normal ArduPilot setup flow while disarmed, then read them again in Lucidity.

This path has passed mock and fixture tests, **not a live four-motor run**. The physical result still needs observation on this drone. The existing “First drone test” is a separate sequential motor-test storyboard.

ArduPilot references: [Parameter name changes](https://docs.ardupilot.org/copter/docs/common-param-name-changes.html), [Arming the motors](https://ardupilot.org/copter/docs/arming_the_motors.html), [set motor range / MOT_SPIN_ARM](https://ardupilot.org/copter/docs/set-motor-range.html), [RC auxiliary function 31](https://ardupilot.org/copter/docs/common-auxiliary-functions.html), [MAVLink arming and disarming](https://ardupilot.org/dev/docs/mavlink-arming-and-disarming.html).
