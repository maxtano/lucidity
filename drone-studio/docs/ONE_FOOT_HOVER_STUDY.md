# One-foot hover study

The existing **One drone · 1 ft hover** is a saved, editable Lucidity storyboard. It is a
visualization of one drone rising to 0.3048 m, holding for four seconds, and
returning to the ground. The 2 + 4 + 3 second timing is for the preview, not a
promise about the aircraft's climb, height control, or landing.

```text
Storyboard in Lucidity         Real-aircraft readiness
ground ─╮      ╭─ ground      props-off bench test: done
        ╰──────╯              DISARM_DELAY=10 readback: done
         1 ft                  Stabilize hover: reported successful
      2s  4s  3s              AltHold/Loiter and 1 ft sensing: unverified
```

The finished props-off idle storyboard remains separate and runnable. This
flight study has no bench motor cues and no flight runner. **Run storyboard**
opens flight readiness, not an arming control. Export saves creative data; its
CSV does not upload as an ArduPilot mission.

## Before an automated flight

1. `DISARM_DELAY=10` was restored and independently read back on October 19.
   A pilot-controlled Stabilize takeoff/hover/landing was reported successful.
2. Confirm the Zorro mode switch, GPS, battery and failsafes. Test AltHold and
   Loiter separately with a practiced pilot takeover before an AUTO mission.
3. Confirm an appropriate downward rangefinder and its live reading if the
   requirement is to hold **one foot accurately**. The known GPS, compass and
   barometer do not establish that accuracy. ArduPilot notes that AltHold can
   behave erratically close to the ground because of prop wash.
4. Only after those gates, implement and validate a proper mission path:
   compile for ArduPilot, upload while disarmed with props off, download and
   compare, then conduct an outdoor pilot-supervised flight with a practiced
   takeover. No such upload or execution path exists in Lucidity today.

ArduPilot's [first-flight guidance](https://ardupilot.org/copter/docs/initial-tuning-flight.html),
[AltHold guidance](https://ardupilot.org/copter/docs/altholdmode.html), and
[AUTO prerequisites](https://ardupilot.org/copter/docs/auto-mode.html) are the
references for the flight-mode order and near-ground caveat. This document is
the product's current readiness state, not flight clearance. See the
[staged first-live-show sequence](FIRST_LIVE_SHOW_SEQUENCE.md) for the planned
vertical mission and later out-and-back study.
