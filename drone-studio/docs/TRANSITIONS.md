# Transition and timing authoring

Scene timing is an expert editing surface. A scene can run animation throughout its incoming blend and after it. The blend is not a separate freeze or an automatically planned flight trajectory.

## Transition profiles

An optional `cue.transitionEasing` field selects `smooth`, `linear`, `ease-in`, or `ease-out`. An omitted field means `smooth`, preserving existing projects exactly. The profile is applied by `frameAt`, which the live viewer, direct manipulation, shared evaluator, and CSV export use.

For normalized transition time `u`, clamped to `[0, 1]`:

| Profile    | Blend weight        | Largest interior slope |
| ---------- | ------------------- | ---------------------- |
| `smooth`   | `6u⁵ − 15u⁴ + 10u³` | 1.875                  |
| `linear`   | `u`                 | 1                      |
| `ease-in`  | `u³`                | 3                      |
| `ease-out` | `1 − (1 − u)³`      | 3                      |

The prior scene is evaluated at its final local time. The incoming scene is evaluated at its current local time. Positions and RGB blend between those values. The opening scene has no incoming blend, while a zero-duration transition performs an instant creative cut. Reordering the opening scene preserves its authored transition settings.

Linear and one-sided easing profiles may create endpoint velocity jumps. They are useful creative controls; the review does not certify a finite acceleration bound for them.

## Timing commands

These commands use the existing atomic operation batch and expected revision. The engine clones, applies, validates, and increments the project revision once. Invalid timing rejects the whole batch.

```json
[
  { "type": "update_cue", "id": "in-orbit", "patch": { "transitionEasing": "smooth" } },
  { "type": "transition_to_beats", "id": "in-orbit", "beats": 8 },
  {
    "type": "retime_cue",
    "id": "in-orbit",
    "speed": 2,
    "scaleKeyframes": true,
    "scaleTransition": true
  }
]
```

`transition_to_beats` computes `beats × 60 / project.bpm` at that point in the batch. It changes a duration, not a persistent tempo link. Changing the project tempo later does not automatically change this duration. The inspector also offers snapping the blend's end to the nearest global show beat; bounds clamp the result to the scene interval, which can leave an edge off-grid when the scene itself is off-grid.

Floating-point roundoff at a timing bound is normalized within eight machine-epsilon units at the bound's scale. A full-scene blend expressed as beats therefore stays valid after conversion. Substantive overshoots still reject; timing is never broadly rounded to milliseconds.

`retime_cue` divides scene duration by `speed`. Thus `2` plays the scene twice as quickly, and `0.5` doubles its duration. By default it also divides incoming transition duration and every authored key time by that value. Optional `scaleKeyframes: false` and `scaleTransition: false` preserve those respective times. A preserved transition that no longer fits the scene rejects the edit, rather than silently shortening it.

Retiming retains dormant drone IDs and keys beyond the current scene duration. Scaling applies to them too when enabled. Key values, easing, colors, positions, flash frequency, and flash phase remain unchanged. Flash is still tied to the global clock, so a scene retime does not preserve the same flash phase at corresponding local frames. Later scenes ripple in time; the soundtrack remains at its original show time. Scene duration must remain at least 1/30 second, every key time must remain within 0–1800 seconds, and the show remains limited to 30 minutes. No automatic clipping drops authored data.

Key commands match an exact authored timestamp first. An approximate time within one microsecond is accepted only if exactly one key matches. Ambiguous approximate references reject the entire batch, and deleting a key removes only the matched key. Thus tightly spaced keys remain individually addressable after a speed-up. Numeric inspector fields retain full authored precision when focused and blurred without an edit.

## Motion feedback

The inspector computes feedback on demand. This avoids background work on every paused viewport frame.

For a static incoming target, all active drone IDs are analyzed. The longest displacement from the prior final pose is multiplied by the authored profile's maximum slope and divided by blend duration. This yields an analytic peak speed inside the blend for these straight trajectories. The optional target-speed button solves the same relationship for duration. It refuses a duration longer than the scene; the user can lengthen the scene or choose a different speed. This feature does not resolve collisions, assignment, lifecycle planning, or endpoint velocity discontinuities.

A stationary blend has no motion to fit, so its authored light fade stays unchanged. An instant cut reports actual displacement between the previous final pose and the next opening pose for the full fleet, while leaving speed unbounded rather than inventing a finite value. Measurements are invalidated whenever the project object changes, including loading another project with matching revision and scene IDs.

For an animated incoming target, the inspector evaluates 65 times and at most 1,000 evenly distributed active drone IDs. It reports the largest distance per sample interval, explicitly labeled as a sampled estimate. It can miss faster motion between samples, hold-key jumps, and motion in unsampled drones. It is not a continuous maximum speed or a safety bound. Target-speed fitting is unavailable for this case because changing blend duration also changes the animated target being approached.

`ShowEvaluator.cuePositions` and `samplePositions` inspect IDs in the full original fleet, so inspecting a subset does not regenerate a smaller formation. The report handles an incoming blend ending exactly at a scene boundary without accidentally measuring a subsequent scene cut.

The project review now uses each authored profile for separation samples and static interior speed. Instant cuts leave speed and acceleration incomplete when no other observed failure applies. Linear and one-sided profiles leave acceleration incomplete because of endpoint velocity jumps. Animated project review remains sampled and incomplete. Export bundles describe the supported transition profiles and default explicitly.

## Verification

The focused transition tests cover old-project parity, profile clamping, sampler/subset/CSV/export agreement, finite-bound limitations, independent retiming toggles, dormant data retention, retimed-motion equivalence, atomic rejection, stale revisions, beat conversion, analytic speed, animated estimates, and exclusion of a following cut. Regression cases also cover tightly spaced key identity and ambiguous references, timing roundoff versus actual overshoots, stationary fades, and measured cut displacement. Browser interaction and performance qualification remain separate checks.

## Next extensions

Per-channel transition curves, editable Bézier handles, assignment-aware collision-free transitions, segment-level curve editing, marker-linked timing, audio time-stretching, and continuous motion envelopes remain future work. These controls currently operate on authored drone identity and straight blend interpolation; they do not introduce a hardware route planner.
