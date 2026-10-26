# Studio agent: implementation and operation

**September 27, 2026 · Current local implementation**

The studio now has a bounded, model-backed tool loop over the expert editing engine, plus a scripted rehearsal that exercises the same tools without an API key. It builds an inspectable private draft; the artist can preview, apply, or discard it. The AI runtime does not simplify the editor into a set of formation recipes.

**Live API behavior and creative quality have not been tested.** Provider tests use synthetic credentials and mocked HTTP responses. An earlier seven-call browser rehearsal opened the draft preview. Browser application to the saved show was blocked by automatic approval review during that QA, so that draft remained unapplied. Atomic command application and stale-revision rejection are covered by fixtures; the browser Apply path is not recorded here as an executed success.

## Local setup

Use the supported Node version described in [README.md](../README.md), install dependencies, and run `npm run dev`. Both the normal development and preview scripts bind to `127.0.0.1`.

When ready for live testing, create `.env.local` from [.env.example](../.env.example) if it does not already exist. Enter the key locally, then restart the server:

```dotenv
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-6-astra
```

`OPENAI_MODEL` is configurable; choose a model available to the API project. The example/default model ID is not an account-access guarantee. The agent connection settings also allow a per-run model ID. Do not give the key a `VITE_` prefix: Vite exposes such variables to browser code. `.env*` files are ignored except the empty `.env.example` template.

The browser receives a configuration-present flag and model ID. **Check connection checks local configuration, not provider credentials or model access.** Loading the studio or checking status makes no model request. A live request begins when the artist starts a run.

The transport is a Vite plugin for the local development/preview server. A static deployment of `dist/` alone does not provide the agent API. Local Host/Origin checks, a required client header, and a single-run lock are implemented; this is not an authenticated multi-user backend.

## Live and rehearsal modes

| Mode              | Behavior                                                                                                                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connected model   | Sends the brief and bounded editing context through the server-only OpenAI Responses adapter. The model chooses tools, can repair tool errors, and may return a reviewed proposal or a text response. Requires a configured key.                                       |
| Harness rehearsal | Runs a deterministic script: seven tool calls without audience context, eight with its added viewpoint inspection. It does not interpret the brief, use a model, or consume API tokens. Useful for testing inspection, staging, sampling, review, and the proposal UI. |

With a drone selection, rehearsal edits up to the first **32** selected IDs: cyan base color, 2 Hz flashing, and cyan-to-pink color/brightness keys at local time zero and up to two seconds. It does not add position keys or lift the drones. With no selection, rehearsal retimes the selected scene to **1.25×** speed and scales transition/key times together. This small fixture is separate from the live tools’ full-selection support.

The rehearsal calls `inspect_show`, `inspect_scene`, `command_schema`, `stage_operations`, `sample_frame`, `review_draft`, and `finish_proposal`. When audience context is present it also calls `inspect_viewpoint` immediately after `inspect_show`, using the captured playhead/current view and up to eight representative rows. Unsupported or invalid fixture edits still fail through the real editor validation; rehearsal is not a shortcut around the command engine.

## Components and data flow

```text
AgentPanel + captured editing context
          │ POST /api/agent/run
          ▼
Vite middleware ── server environment / one active run
          ▼
runAgent ── provider interface ── OpenAI Responses OR scripted provider
          │
          ├── inspect / discover / sample
          ├── stage commands on a private project
          ├── review current draft
          └── return exact commands + project ID + base revision
          │ NDJSON activity and result
          ▼
Proposal / authoritative review / source operations / visual preview
          │ artist chooses Apply edit
          ▼
Shared applyOperations → one editor revision and undo step
```

- [types.ts](../src/agent/types.ts) defines provider, request, event, result, budget, and draft contracts.
- [harness.ts](../src/agent/harness.ts) owns the loop, captured selection, context, budgets, cancellation checks, event log, and rehearsal provider.
- [tools.ts](../src/agent/tools.ts) exposes the editor through fifteen tools and derives command discovery from the actual Zod definitions.
- [openai.ts](../src/agent/openai.ts) makes server-side calls to the fixed official Responses endpoint. The key stays in the Authorization header; it is not sent to the client.
- [middleware.ts](../src/agent/middleware.ts) serves `GET /api/agent/status` and `POST /api/agent/run`; [client.ts](../src/agent/client.ts) consumes the NDJSON stream.
- [AgentPanel.tsx](../src/components/AgentPanel.tsx) renders context, activity, proposals, review findings, source operations, visual preview, and trace download.

The provider adapter requests `store: false`, encrypted reasoning continuation, sequential function calls, and at most 4,000 output tokens per request. Raw output items are retained within the run for continuation, including reasoning items and assistant phase; hidden reasoning is not emitted to the UI or exported trace.

## Fifteen editing tools

All tool envelopes use strict argument validation. `command_schema` returns the full editor command contract, including runtime refinement notes. Commands are parsed again before staging; unknown properties are rejected rather than silently dropped.

| Tool                         | Actual contract                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inspect_show`               | No arguments. Summarizes draft scenes/timing, fleet, limits, supported commands, staged count, captured-selection counts, and available current/saved audience viewpoints.                                                                                                                                                |
| `inspect_selection`          | `offset`, `limit` ≤128. Pages the complete selection captured at run start and identifies active/dormant IDs.                                                                                                                                                                                                             |
| `inspect_scene`              | `cueId`, drone-edit `offset`/`limit` ≤32, and `keyframeOffset`/`keyframeLimit` ≤32. Returns authored data with continuation offsets; generated preset positions are sampled separately.                                                                                                                                   |
| `inspect_drones`             | `cueId`, up to 128 direct `ids` (empty means captured selection), `offset`/`limit` ≤32, `keyframeOffset`/`keyframeLimit` ≤32, and scene-local `localTime`. Directly retrieves authored base channels and key pages, surrounding keys per channel, and evaluated scene targets.                                            |
| `command_schema`             | `operationType`; an empty string returns the command union. Supports discovery of new expert/timing commands without a separate handwritten command schema.                                                                                                                                                               |
| `sample_frame`               | Show-global `time` and up to 128 active drone `ids`. Returns ENU positions, rendered RGB, local time, and scene blend from `ShowEvaluator`.                                                                                                                                                                               |
| `inspect_viewpoint`          | Show-global `time`, `viewId` (empty for captured current view, otherwise a saved ID from `inspect_show`), and `limit` 1–32. Counts the full active fleet around that audience view and returns bounded representative rows. Read-only; does not move the camera or invalidate review.                                     |
| `compare_viewpoints`         | Show-global `start < end`, `samples` 2–12, and 1–4 unique `viewIds` (empty ID means captured current view). Compares geometric/light counts at evenly spaced times including both endpoints; returns per-view minimum, maximum, and mean in-frustum lit counts. Read-only and cancellable; preserves draft review.        |
| `inspect_camera_move`        | Captured `fromViewId`/`toViewId` (empty means current), camera `duration` 1–30, `easing` linear/smooth, show-global `start <= end`, and `samples` 2–12. Reports full-fleet geometric/light counts along the interpolated camera path with explicit camera/show sample times. Read-only and cancellable; preserves review. |
| `inspect_audience_selection` | Exact matching active IDs at captured `time`/`viewId`, filtered by `region`, `lights`, and fleet/original-selection `scope`. Returns up to 128 sorted IDs per page, complete counts, and a temporary target for all matches; read-only, cancellable, and review-preserving.                                               |
| `stage_operations`           | `operationsJson` encodes a nonempty command array; `explanation` describes the change. Appends an atomic batch to the private draft.                                                                                                                                                                                      |
| `stage_selection_operation`  | `operationJson` encodes one `edit_drones`, `transform_drones`, `set_keyframe`, `remove_keyframe`, or `reset_drones` command **without `ids`**; the tool injects the complete captured selection. Also requires `explanation`.                                                                                             |
| `stage_audience_operation`   | `targetId` from a nonempty audience query, `operationJson` with one of the same five per-drone commands **without `ids`**, and `explanation`. Expands the complete matching set atomically; successful edits expire all targets.                                                                                          |
| `review_draft`               | No arguments. Runs bounded design review or returns an explicit workload-limited result.                                                                                                                                                                                                                                  |
| `finish_proposal`            | `title`, `description`, `changes`. Returns the exact staged commands after the latest draft has been reviewed. Must be the last call in its turn.                                                                                                                                                                         |

The initial model context contains only the first 128 selected IDs and a truncation flag. The full immutable selection stays in the run and is available through selection inspection/staging and `inspect_drones`; the agent need not reconstruct arbitrary IDs from a range. If a draft shrinks the fleet, captured IDs can become dormant and still receive authored edits. `sample_frame` requires active IDs. `inspect_drones` can inspect dormant edits and returns `null` for a dormant position with no authored base or position keys, rather than guessing a generated formation.

`inspect_drones` reports the scene's target channels before the incoming scene blend, flash gating, or beat modulation. It supplies neighboring keys even when those keys are outside the requested page. Each channel interpolates independently; its first/last key holds outside its keyed range. Use `sample_frame` for the actual rendered, show-global result.

### Audience viewpoint inspection

`inspect_audience_selection` turns exact audience criteria into a paged set of stable active IDs. Arguments are `time`, captured `viewId` (empty means current), `region` (`in_frame`, `front`, `right`, `rear`, `left`, `overhead`), `lights` (`any`, `on`, `off`), `scope` (`fleet` or original captured `selection`), `offset`, and `limit` 1–128. It evaluates the current private draft through the shared audience classifier. Valid dormant scope IDs are excluded from considered/matched counts; an explicitly empty selection matches nothing.

The result names the captured view and exact time/pose/aspect/criteria, current scene/local time/blend, `stagedOperations`, complete `matchedCount`, active `consideredCount`, fleet count, and a sorted ID page with `hasMore`/`nextOffset`. It also returns `targetId` for a nonempty complete set, even when the requested page is empty. An empty complete result returns null. Pages remain useful for inspection; they must share criteria and staged-operation count, because private draft revision alone repeats across edit batches. The query preserves authored data, completed review, and the original captured selection.

For one uniform edit to every match, call `stage_audience_operation` with that target and one existing per-drone command with `ids` omitted. The scene ID and channel/key parameters remain explicit. The target determines membership at the query's captured frame; it does not silently choose the command's scene or key time. The tool inserts all IDs and stages through the ordinary transaction, operation-count, and draft-expansion checks. Final proposal operations contain the explicit full ID list, not a temporary handle. `stage_selection_operation` continues to address the original artist selection.

Targets are owned and local to one run, capped at eight records and 200,000 total retained IDs with oldest-first eviction. Any successful draft edit expires all of them, including a no-op command. A failed edit preserves them for repair. Unknown, evicted, expired, or cross-run IDs are repairable errors; query again after editing. A cancelled or stale asynchronous query cannot register a target. Copy-on-write storage participates in harness rollback when result budgets fail. Targets are not saved in project files, checkpoints, or continuation requests; retained proposal operations are ordinary commands.

Compact selection traces retain the explicit criteria, captured context, counts, page IDs/bounds, and harness provenance. They do not create camera review links. Membership is a single-frame geometric/light result, not rendered occlusion or continuous visibility. Later edits or another show time can change it; stage-relative quadrants remain independent of camera yaw. Missing views, invalid arguments, workload limits, and cancellation remain explicit errors rather than partial sets.

When available, the main studio viewer contributes an optional `viewer` request context: `current: { snapshot, aspect }` and `savedViews: [{ id, name, snapshot }]`. A snapshot contains the exact camera pose (East/North position, eye height, yaw, pitch, vertical FOV) and reference stage placement/heading. Up to 12 saved views are captured; names and IDs remain untrusted data. The server strictly validates and clones this context. Moving the camera or changing saved views afterward does not change an active run. A missing context or unknown view ID produces a repairable tool error, not a guessed camera.

`inspect_viewpoint` evaluates the **current private draft** at the requested show-global time. It returns the selected snapshot/name, captured aspect, active scene/local time, blend, stage bearing, full-fleet totals, and up to 32 deterministic representative drones. Saved snapshots use their own pose/venue with the captured **current** viewport aspect; bookmarks do not store an aspect ratio.

- Front/right/rear/left partition drone geometry relative to the bearing from the viewer to the stage center, independent of camera yaw and stage front heading. Overhead (elevation at least 70°) overlaps those quadrants. Directly vertical/coincident points use stage bearing as a deterministic azimuth fallback.
- `inFrustum` uses the captured camera pose, vertical FOV, aspect, and 0.1–5,000 m forward depth. `visible` on a representative row means this same geometric condition only. Dark drones still count geometrically.
- `lightsOn` means at least one evaluated RGB component is positive; `inFrustumLightsOn` counts the intersection. Positions and RGB include incoming scene blending, keyed channels, brightness, flash gating, and beat modulation. Rows are evenly spaced stable IDs across the active fleet, not a brightest/most-visible sample.

This is analytical geometry, not screenshots or computer vision. It does not measure rendered pixels, occlusion, venue obstruction, perceived brightness, artistic quality, or flight readiness. The agent cannot reposition the viewer or change bookmarks through this tool. The separate **360° study** preview is a read-only example with its own show and clock; opening it does not replace the main project or redirect the assistant's captured main-view context.

`compare_viewpoints` evaluates 1–4 distinct captured views across 2–12 evenly spaced show-global times, including the exact requested endpoints. Both endpoints must lie inside the current private draft and `start` must precede `end`. For example, `{ "start": 0, "end": 8, "samples": 5, "viewIds": ["", "rear-seat"] }` compares the current view with a saved ID discovered through `inspect_show`. Each view retains its own pose and venue but uses the captured current aspect. Unknown IDs and missing context return repairable errors.

The comparison result contains `projectId`, `revision`, exact `times`, and `views`. Each view includes its captured `id`, `name`, `snapshot`, `aspect`, per-time `{time, totals}` samples, and a summary: `minInFrameLights`, `maxInFrameLights`, `meanInFrameLights`, `minAt`, and `maxAt`. Those statistics use `inFrustumLightsOn`; ties report the earliest sampled time. No individual-drone rows are returned. Mean is an arithmetic mean of the sampled counts, not a time-integrated visibility measurement. Sparse sampling can miss motion or flashes between samples. Comparing views does not establish continuous coverage, artistic quality, or flight readiness, and neither stages edits nor invalidates an existing draft review.

`inspect_camera_move` uses the same numerical engine along an interpolated audience path. For example, `{ "fromViewId": "", "toViewId": "rear-seat", "duration": 6, "easing": "smooth", "start": 34, "end": 40, "samples": 5 }` resolves two captured endpoints and maps camera times 0/1.5/3/4.5/6 seconds to show times 34/35.5/37/38.5/40. Saved IDs must first be discovered through `inspect_show`. The endpoints must describe the same reference stage. Camera duration is 1–30 seconds, easing is linear or cubic smoothstep, and the show interval must lie within the current private draft. Equal show endpoints deliberately hold one show frame while the camera moves.

The result owns the full `request` (plan endpoints, names, captured aspect, and mapping), per-sample `{ cameraTime, showTime, snapshot, totals }`, and minimum/maximum/arithmetic-mean lit-in-frame counts with earliest-tie sample indices. The compact trace retains the exact request, both clocks with one `inFrameLights` count per sample, summary, limits, resolved IDs, and harness provenance without duplicating full totals. Preflight applies the existing per-frame budget plus 2 million total point inspections and 20 million aggregate key-work units; cancellation cannot publish a partial report. This is a hypothetical read-only path and preserves completed draft review. It does not prepare, play, or move the live camera. Validated original/final results can supply explicit minimum/maximum proposal-preview links; only the artist's Open action recalls a sampled pose. The default rehearsal remains unchanged, with dedicated tool tests and a camera-light case among the eleven CLI fixtures.

The default rehearsal remains seven calls without captured context and eight with its single-frame inspection. A separate deterministic test provider exercises comparison, unknown-ID repair, and cancellation through the real harness; this is fixture validation, not a live-model quality result.

The `audience-light-refinement` evaluation extends that path into an editing loop on an isolated seven-drone fixture. Its provider reads actual comparison and viewpoint results, restores the selected dark lights in the weaker view using brightness keys, then compares again before review and proposal completion. The `camera-light-refinement` case separately consumes a North-to-East path report, derives selected visible dark IDs from a viewpoint inspection, edits only their requested brightness keys, and reinspects the same path. Independent oracles check exact sampled counts, ordered before/after tool evidence, full authored preservation, and the original project revision. These are two of eleven CLI cases and do not alter the default UI rehearsal or any saved user show. See [evaluation contract](AGENT_EVALUATIONS.md).

### Relative movement without flattening choreography

The shared `transform_drones` command accepts `cueId`, `ids`, a required ENU `translation` vector (use `[0,0,0]` for rotation/scaling alone), and an explicit scope:

- `base_and_keys`, with `time` omitted, transforms every selected drone's own base and every authored position key. Timing, easing, light channels, unselected drones, and keys beyond the scene duration are preserved. Generated active positions are materialized using the full original fleet, so separate drones keep their geometry.
- `key_at_time`, with scene-local `time` required, evaluates each drone's own scene target and merges a transformed position at that time. Other channels and easing on an existing key remain intact. Exact authored timestamps win; a rounded timestamp can match only one nearby key. Ambiguous matches fail atomically. A time beyond the scene duration creates a dormant authored key.

Dormant IDs can be transformed when they have explicit base positions or position keys; a dormant drone with neither is a repairable error. One relative command can target the complete captured selection without sending hundreds of per-drone absolute patches. An `edit_drones.position` patch remains a uniform absolute base override; keyed positions override it.

Optional `scale: [east,north,up]` multiplies offsets on the fixed ENU axes. Negative values reflect and zero collapses an axis. Optional `rotation: {axis: [east,north,up], angleDegrees: number}` rotates around a normalized, nonzero axis using the right-hand rule: positive Up rotation moves East toward North. Either field requires an explicit `pivot: [east,north,up]` in metres; a pivot without rotation or scale is rejected. The pivot is fixed, never silently inferred from the selection.

The order is `pivot + rotation(scale * (position - pivot)) + translation`. For example, this rotates each selected path 90° about Up after doubling its East extent around `[10,-4,30]`, then lifts it five metres:

```json
{
  "type": "transform_drones",
  "cueId": "opening",
  "ids": [2, 5],
  "translation": [0, 0, 5],
  "pivot": [10, -4, 30],
  "scale": [2, 1, 1],
  "rotation": { "axis": [0, 0, 1], "angleDegrees": 90 },
  "scope": "base_and_keys"
}
```

The point `[12,-4,30]` becomes `[10,0,35]`. Angles are reduced modulo 360 before conversion, and exact quarter turns use exact sine/cosine values; nearby angles are not snapped. Identity rotation/scaling preserves coordinates without subtracting and re-adding a pivot. Nonfinite input/output is rejected atomically. Transforming authored endpoints does not add an orbital arc between them; additional position keys are needed for that motion.

These whole-path transforms are available to the agent and command/CLI surface. The viewport's existing point gizmos keep their current base/auto-key behavior; this slice does not add new inspector controls or change gizmo semantics.

Coordinates are **East/North/Up meters**. Key times are scene-local seconds; sampling uses show-global seconds. There is no screenshot/image tool, music-analysis tool, arbitrary code runtime, shell, network browser, hardware control, or deployment tool in this harness. The model can inspect numerical samples but cannot yet see the rendered viewport.

## Draft, preview, and application semantics

Each run captures project, scene, playhead, selection, and optional audience-view context at submission. The server validates and clones the project and viewer data. A successful staging call replays the accumulated commands against that original base, validates the combined transaction, and only then replaces the private draft. Failed batches preserve the preceding draft. Every new staged batch invalidates the previous review; read-only viewpoint inspection does not.

A follow-up brief automatically refines the current unapplied, nonstale draft. The request includes `previousDraft` with the original project ID/revision and exact prior operations. The harness validates that identity, replays those commands through the same staging/expansion budgets, and gives the model the resulting private draft. It does not ask the model to reconstruct earlier edits from prose. The final proposal contains all earlier and new commands against the original saved revision; it needs a fresh review, and Apply executes the combined proposal once. Prior commands count toward the same 128-command ceiling. Failed or stopped refinements restore the previous applicable draft in the panel.

Finishing requires commands and a review attempt covering the latest operation count. It does **not** require all design checks to pass. The proposal contains project ID, base revision, descriptions, and exact operations. An agent that stops after staging without finishing a reviewed proposal fails with no applicable proposal.

Preview captures owned baseline/draft documents after validating project identity and revision, and evaluates the proposal without saving it. Its modal contains a single read-only spatial stage with **Before/Draft** switching, shared playback, and a scrubber. Both versions use the same show-global clock, camera, lens, and appearance; the audience pose is captured from the main viewer when the preview opens. The clock spans the longer version and explicitly labels a shorter version's held final frame. With the canvas focused, Space controls preview playback and backslash switches versions; form controls retain native keyboard behavior. Main show music stays paused. Apply routes the same operations through the editor’s shared revision guard and creates one undo step. Discard removes the current proposal/preview from the panel and records that it was not applied.

Private review offers **Expand comparison** without invoking native fullscreen. Version and transport controls remain visible; **Review controls** exposes the existing audition, navigation, and evidence controls in a scrollable tray. The Stage stays mounted, preserving camera, target markers, playback, and captures. Expansion affects no proposal operations or agent context. Nested dialogs retain Escape and focus ownership; Escape on the expanded comparison restores its normal layout before a later Escape closes it.

Changed-scene navigation is derived from the captured documents once, outside playback. It uses stable scene IDs and authored impact rather than treating every downstream timing shift as a new edit. Before/Draft landmarks explicitly select a version and seek its show-global time; both current scene/local-time readouts remain visible for comparison. Edited-key landmarks exclude dormant drones and keys outside the displayed scene, and are not claims about where an interpolated difference begins. Preview navigation remains private and never changes the main playhead or project history.

An optional audition loop and 0.25×/0.5×/1×/1.5×/2× rate support repeated visual inspection. The same absolute show-time interval and viewing speed apply to Before/Draft; switching versions does not restart the clock. Loop bounds are validated separately from editable input, and an invalid attempt preserves the last valid range. An enabled loop wraps `[In, Out)`; outside-range paused inspection is allowed, and the next Play starts at In. Loop off plays through the shared full-show duration. A shorter document still holds its final frame while the common clock continues or wraps. Scene presets enclose both documents' selected scene timings, and transition presets enclose existing positive incoming blends. These controls do not change proposal operations or evaluate a live model.

Successful audience inspection/comparison trace results carry harness-owned provenance: project ID, base revision, evaluated revision, and staged operation count. The count is necessary because intermediate private drafts all use the base revision plus one. Measured review moments are derived from the completed result's full event list, never the live UI's truncated activity list or model prose. Zero staged operations identifies Before; the exact final operation count identifies Draft. Intermediate results are omitted. Moment fields are validated against the matching document, canonical captured camera, sampled times, and fleet bounds before becoming explicit preview navigation. A viewpoint inspection contributes its measured time; a comparison contributes sampled minimum/maximum times retained in its compact summary. Other tool prose does not invent camera evidence.

Camera-move evidence also requires the completed result's owned `viewer` capture. Its endpoint IDs/names/poses, fixed venue, and aspect must match; every mapped camera/show time and sampled count is validated, and extrema/mean are recomputed with earliest ties. Valid minimum/maximum rows become owned interpolated snapshots with separate camera elapsed/duration/sample/easing metadata. The preview always seeks the row's show time. Equal show times do not collapse distinct sampled poses. Older camera traces without counts or captured viewer context yield no inferred links; imported/restored checkpoints do not reconstruct this evidence. The result context and trace are consistency-checked internal evidence, not authenticated external records or a new flight review.

Opening a review moment is a display-only action: pause, choose version, seek global time, and explicitly recall the captured audience pose on the mounted Stage. It retains preview rate/range and does not apply the proposal. The action makes that moment's aspect available through the optional **Captured frame** toggle, off by default. With it enabled, the audience projection uses the exact captured aspect inside a centered frame across resize, fullscreen, and A/B switching; normal Design framing remains full viewport. A later moment updates the available aspect while retaining the toggle choice. Synchronous audience-context capture resolves the effective frame before reporting its aspect. Legacy results or restored checkpoints without valid inspection provenance yield no review links; recovery does not recreate missing evidence from descriptions.

Optional proposal target markers derive from the complete validated granular operations, not a bounded tool page or prose summary. The preview owns a sorted union of explicit IDs across all scenes, including dormant IDs and no-op/reset targets, and filters active membership independently for Before and Draft. Six command families are supported, including moving one drone's key; broad scene/show commands are counted separately without inferred rings. The toggle starts off, follows current evaluated positions, and survives version switches and fullscreen without changing selection, clocks, or authored data. These are operation-scope aids, not measured visual differences. Captured review images exclude the markers and the paused display restores them afterward. No new provider tool or image input is introduced.

The artist can explicitly capture a local rendered audience still from the private preview. Its PNG and JSON metadata are bound to an exact paused document/version/time and current camera/framing/appearance. Queued-state changes cancel capture; once the browser copies the rendered bitmap, later viewing changes cannot relabel it. The UI retains one still with explicit downloads and cancellation. This adds no agent tool, image provider input, external transmission, or visual-quality claim: the agent still consumes numerical audience evidence only.

A portable `.lucid-frame` file now keeps the PNG and metadata together with a whole-body checksum. Explicit import validates structure, metadata, byte integrity, and browser image decoding before read-only display. Imported metadata is historical, untrusted evidence: the checksum does not establish authorship, actual capture provenance, or a match to the current saved project. It cannot become an agent tool result, camera recall, or applied edit through this import path.

Artists can privately audition an interpolated camera move between current/saved audience views. This camera clock is independent of the show clock and survives Before/Draft switching within the same project. Frame capture pauses both; normal agent-context capture settles and owns the actual current camera snapshot while later viewing motion may continue. The agent receives fixed current/saved snapshots and can construct a hypothetical path through `inspect_camera_move`; it receives no live camera track or images. The artist's **Analyze move** report shares that calculation, and only an explicit **Inspect** action recalls a sampled camera and show time. No camera-control tool or authored camera command is exposed yet.

Manual edits can continue while a run works on its snapshot. A changed revision or project ID makes its proposal stale; preview closes and Apply is unavailable. There is no automatic rebase. Project changes and Stop also invalidate the UI generation token so late results cannot replace the active result.

## Execution and resource limits

| Budget                                                         | Current default/hard ceiling                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Model turns / tool calls                                       | 12 turns / 40 calls                                                               |
| Commands in one proposal                                       | 128                                                                               |
| Tool argument / result                                         | 96,000 / 64,000 serialized characters                                             |
| Provider response / accumulated context                        | 196,000 / 400,000 serialized characters                                           |
| Run duration                                                   | 120 seconds                                                                       |
| One provider step, including retries                           | 60 seconds                                                                        |
| HTTP request body                                              | 32,000,000 bytes                                                                  |
| Project snapshot / conservative draft expansion                | 32,000,000 serialized characters                                                  |
| UI brief                                                       | 8,000 characters                                                                  |
| Active server runs                                             | One; another request receives 409                                                 |
| Captured saved viewpoints / representative rows per inspection | 12 / 32                                                                           |
| Audience/frame inspection estimated active key work            | 5,000,000 weighted operations in relevant current/previous scenes                 |
| Audience comparison viewpoints / sampled times                 | 4 / 12                                                                            |
| Audience comparison fleet × times × viewpoints                 | 2,000,000                                                                         |
| Audience comparison total estimated active key work            | 20,000,000 across sampled times and viewpoints; the per-frame limit still applies |

Direct callers may tighten harness budgets but cannot raise their ceilings. The draft expansion estimate includes the base document, per-ID expansion of color/keyframe edits, and potential growth of transformed bases/position keys. It tracks earlier key authoring in the same proposal and can reject a large edit before allocating all authored objects. It is conservative and may reject work whose final serialized document would be smaller; it is not a process memory quota.

`inspect_viewpoint` and `sample_frame` check active key work before evaluation. For each edited active drone in the current and previous scenes, the estimate is `keyCount × (8 + ceil(log2(max(1, keyCount))))`, accounting conservatively for independent channel scans and sorting. Dormant IDs and unrelated scenes are excluded. Exceeding the budget returns an error without inventing a partial inspection. Viewer aspect must be finite, greater than zero, and at most 100; snapshot coordinates/angles must already be canonical and in range.

`compare_viewpoints` checks its whole requested workload before evaluation, copies the current draft and view inputs, and yields between individual viewpoint/time inspections. Its accumulated weighted key-work estimate includes every requested view. Oversized requests fail without a partial comparison; use fewer viewpoints or sample times. Returned reports remain subject to the ordinary tool-result and accumulated-context budgets.

Provider network failures, retryable rate limits, and server errors get at most two retries, after 400 ms and 800 ms. Authentication failures and exhausted quota do not retry. Tool schema/command errors return structured feedback so the model can repair them within its budget. Repeated tool call IDs are rejected to avoid ambiguous replay.

Stop aborts the client request; a closed response aborts the server run and provider request. The client also cancels a response body if parsing or an event callback fails. Deadline/cancellation checks surround provider and tool steps; synchronous editor computations are not preempted midway. Comparisons additionally check cancellation between their bounded frame inspections and yield to the event loop. The harness awaits asynchronous tools and refuses late completion after cancellation. Budget or cancellation failure returns no applicable proposal.

## Design review limits

Review calls the same `validateProject` engine used elsewhere. The harness skips that computation when its estimated sample count multiplied by fleet size exceeds **2,000,000**, or, for position-keyframed work, sample count multiplied by authored key count exceeds **5,000,000**. A skipped review is returned as `reviewLimited` with no invented motion/separation metrics.

For position-keyframed shows, the review engine uses samples no more than 0.5 seconds apart for fleets through 2,000; larger fleets receive 17 sparse motion samples without pair-separation analysis. Static straight transitions also have analytic checks, with limitations for cuts and velocity discontinuities. Review remains incomplete and `flightReady` remains false.

The panel displays authoritative issues/incomplete checks or the workload-limited notice independently of the model’s prose. Review findings do not prevent creative authoring; they are not flight clearance.

## Activity, history, and persistence

Activity streams as NDJSON phase/tool-start/tool-result/validation-error/completed events and connection retry notices. These are **step events**, not streamed model text tokens or live tool-argument deltas. The adapter awaits each complete provider response before dispatching its calls. Event details contain bounded counts/status summaries; the final proposal exposes complete proposed operations.

Comparison trace details retain project identity/revision, requested time endpoints and exact sample times, and each view's captured ID/name/snapshot/aspect plus aggregate summary and limitations. Per-time count rows stay in the tool response for the model and are omitted from the compact activity trace.

The panel keeps up to ten recent user/assistant history entries. The harness sends the last eight, each capped at 3,000 characters, alongside fresh editor context. Proposed, applied, and discarded work is labeled in that history. Exact unapplied commands are carried separately when refining a draft; conversation prose is not the source of draft state. Changing project clears history. This is not durable conversation memory.

Trace download writes `lucidity-agent-trace.json`, containing captured run mode/model/project ID, submitted prompt, UI events, final result, usage counters, operations, and available review. It does not contain the API key, complete original project snapshot, or raw model continuation history. It may contain proprietary creative content from prompts and operations. There is no server trace database, remote telemetry integration, trace replay, or automatic trace persistence.

Reloading loses run activity, conversation history, and unsaved proposals. Completed proposals can now be explicitly saved and reopened through **Draft files**. Runs cannot reconnect/resume after interruption. Failed/cancelled runs do not expose their partially staged operations; during refinement the prior completed draft is retained, but new unfinished edits are lost.

### Draft recovery and measured changes

**Save draft locally** stores one pending proposal per project, up to 1 MB of UTF-8 JSON, in a separate browser slot. Saving replaces that project's earlier local draft; a failed write preserves the earlier value. Nothing is saved automatically, and applying a proposal does not erase the recovery copy. **Download draft** and **Open draft file** support a portable `lucidity.agent-draft` version 1 file up to 32 MB. Keep its original show JSON as well: the checkpoint includes commands and a base fingerprint, not the full show.

Reopening verifies the project ID and a SHA-256 fingerprint of all original show content. Object property ordering is ignored; array ordering is retained. A revision-only difference is allowed because importing a show assigns a new local revision. After exact content verification, the commands are replayed privately against the current revision and receive a fresh bounded design review. Changed show content is rejected; recovery does not merge edits. Reopening never applies the proposal. The artist can preview it, refine its exact commands, or choose Apply.

Checkpoints contain proposal title, description, change notes, operations, creation time, and base identity/fingerprint. They omit conversation history, credentials, model continuation, and prior review results. Imports reject unknown fields and enforce the same 128-command and conservative expansion limits as the harness, plus a 32 MB UTF-8 document cap and 128-level JSON nesting bound. Review workload limits remain visible after recovery.

**What changes** is computed from the original and proposed documents independently of the agent's text. It shows duration, fleet size, edited scenes and authored drone records, channel flags, and key counts. A drone record is one scene/ID pair. Affected authoring scope includes the full fleet for scene-wide geometry, palette, or timing edits; it is not a measurement of drones moved. Exact key timestamps define identity, so a moved key counts as removed and added. Dormant authored data is included. Scene detail output is capped at 12 rows with a remaining count; it does not generate or sample frames.

## Existing CLI is a separate surface

`npm run --silent agent -- ...` still runs [scripts/agent.ts](../scripts/agent.ts). Its `--brief` uses the legacy deterministic template proposer; it does not use this model loop. `--command` and `--commands-file` execute explicit shared editor operations and write an output bundle to stdout, leaving source files untouched. `--tools` prints [agent-tools.json](agent-tools.json), the editing contract with model-harness metadata, rather than exposing these fifteen orchestration tools as CLI commands. This legacy CLI does not execute hosted models.

The separate `npm run --silent agent:eval` command runs [scripts/evaluate-agent.ts](../scripts/evaluate-agent.ts). Its default fixture mode exercises synthetic editing cases without credentials or network calls. Explicit `--mode live --case ID` (or `--mode live --all`) uses server-side configuration to evaluate a model on those cases. It records exact proposals, semantic preservation checks, usage, and latency, without changing a saved show. See [AGENT_EVALUATIONS.md](AGENT_EVALUATIONS.md) for commands, report semantics, and pending live qualification.

## Live qualification when the key is available

These are pending acceptance tasks, not completed API tests:

1. Verify a small live inspection completes with the selected model, then produce a simple color proposal. Record latency, turns, and provider usage.
2. Preview, apply, and undo one granular change; compare exact IDs/channels and preserve unrelated keys. Repeat with a noncontiguous selection larger than 128 IDs and a relative path translation. Refine the unapplied draft, then confirm its combined commands apply exactly once.
3. Request a transition in beats and a scene speed change; verify duration, key-retiming policy, and sampled preview agree with the final operations.
4. Exercise a recoverable argument error, stale draft after a manual edit, Stop during a model request, provider failure, and exhausted budget. Confirm no unexpected saved edit.
5. Review the authoritative findings and trace. Confirm the model explains material limits and never describes a proposal as already applied.
6. Compare several saved creative tasks across candidate models/prompts before making quality, cost, or speed claims. Then qualify longer generation and larger documents separately.

For the primary-source runtime comparison and future architecture choices, see [AGENT_RESEARCH.md](AGENT_RESEARCH.md). For executed checks, use [VERIFICATION.md](VERIFICATION.md).
