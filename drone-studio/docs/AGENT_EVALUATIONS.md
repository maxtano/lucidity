# Repeatable agent editing evaluations

The evaluation runner sends ordinary editing prompts through the same agent loop and tools as the studio. Each case owns a small synthetic project. It checks the resulting authored document against an independently constructed expected outcome, including content that must remain unchanged. It never loads or modifies a saved user show.

There are two explicit modes. **Fixture mode** uses scripted tool calls to check the harness and evaluation machinery, with no network requests or API key. **Live mode** asks a configured model to solve the same cases. Fixture success is not evidence that a model can understand or create choreography.

## Run the fixtures

From `drone-studio/`, using the supported Node version:

```bash
npm run --silent agent:eval -- --list
npm run --silent agent:eval
npm run --silent agent:eval -- --case scene-retime
npm run --silent agent:eval -- --out artifacts/agent-fixture-report.json
```

The default is fixture mode, even if an API key is configured. `--list` prints case IDs, titles, and prompts. `--case` can be repeated. The JSON report goes to stdout; progress goes to stderr. `--out` writes a report and refuses to overwrite an existing file. Use a different filename for each run.

## Case coverage

| Case ID                       | Request and invariant                                                                                                                                                                                                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selected-lights`             | Set base color and flash on two selected lights, preserving their positions, brightness, animation keys, other lights, and show settings.                                                                                                                                                                 |
| `complete-selection`          | Change brightness for all 333 irregular selected IDs in a 997-drone fixture, including IDs outside the initial 128-ID context preview. Preserve every unselected light.                                                                                                                                   |
| `scene-retime`                | Play the second scene at 2× speed, scaling its incoming transition and every key, including dormant drone IDs and keys beyond the trimmed scene. Preserve the first scene.                                                                                                                                |
| `beat-transition`             | Change tempo to 160 BPM, set six beats to 2.25 seconds, and select ease-out without retiming scenes or keys.                                                                                                                                                                                              |
| `position-at-playhead`        | Convert show time 11 seconds to scene-local time 4 seconds, changing one position channel while preserving that key's light channels and easing.                                                                                                                                                          |
| `fleet-expansion`             | Grow from 8 to 16 drones, retain dormant authored work, and give one newly active drone a specified base color.                                                                                                                                                                                           |
| `group-path-transform`        | Rotate and scale 173 irregular selected paths around a fixed pivot, also transform an authored dormant ID, and preserve timing, light channels, unselected work, and other scenes.                                                                                                                        |
| `group-transform-at-playhead` | Transform scene-local targets during an incoming blend, merge only the current position key, and preserve mixed light keys and all other authored content.                                                                                                                                                |
| `audience-light-refinement`   | Compare stage-facing and rear-facing captured views at 0/1/2 seconds, restore brightness only for selected dark lights in the weaker view, and verify sampled counts again. Preserve the unselected dark decoy, geometry, other channels/keys, and dormant work.                                          |
| `camera-light-refinement`     | Inspect a North-to-East camera move at camera elapsed 0/4/8 seconds mapped to show time 1/2/3. Brighten only selected dark lights inside the starting frame; remeasure after the final edit. Preserve geometry, outside selected lights, unselected and dormant decoys, and every other authored channel. |
| `audience-full-targeting`     | Query 200 dark in-frame lights in a 600-drone show, consume the returned complete-set target despite a 128-ID page, brighten all matches with one operation, and requery. Preserve already-lit, behind-view, originally selected, and dormant work.                                                       |

These prompts are deliberately precise to test tool use and preservation. The audience case checks numerical composition at explicit sample moments; it does not assess artistic direction, ambiguous intent, musical phrasing, perceived visual quality, or long open-ended conversations. Direct tool/unit tests separately cover repair, cancellation, draft continuation, relative transformations, and resource limits.

### Audience-aware refinement

Run `npm run --silent agent:eval -- --case audience-light-refinement`. The seven-drone fixture has three lit points in the stage-facing view and four points in the rear-facing view: one lit, two selected dark lights, and an unselected dark decoy. A dormant ninth drone also contains authored work. Fixed camera poses make the expected geometry analytically clear. Existing selected-drone keys mix brightness with motion, color, and easing; commands must merge only the requested brightness channel at scene-local 0/1/2 seconds.

The scripted provider consumes actual `compare_viewpoints` output to choose the view with the lower sampled mean, then consumes `inspect_viewpoint` output to identify the selected dark points in that frame. It stages one atomic command batch, compares again, reviews, and finishes. It does not substitute canned tool results or treat its own final prose as evidence. The independent oracle expects stage-facing lit counts to remain 3/3/3, rear-facing counts to improve from 1/1/1 to 3/3/3, and geometry to remain unchanged. The full authored-document oracle separately rejects changes that happen to produce the same sampled counts while damaging other content.

Reports include compact `audienceEvidence` with exact captured poses/aspects, sampled before/after counts, and contributing comparison event IDs. Successful comparison events must precede the first successful edit and follow the last successful edit, using the requested views and the specified three-sample interval. Each phase may compare both views together or cover them through separate calls; edits may use multiple valid batches. An older after-report cannot satisfy the check if another edit follows it. These samples do not establish continuous coverage, rendered appearance, occlusion, or artistic quality; fixture success does not qualify real model choices.

### Camera-aware refinement

Run `npm run --silent agent:eval -- --case camera-light-refinement`. This tenth case has seven active drones and a dormant ninth authored record. Four points follow the North-to-East camera path: one lit anchor, two selected dark lights, and an unselected dark decoy. A third selected dark light stays outside the path. Two unrelated lit anchors enter only the first and last frames. The fixed venue, 60° vertical FOV and 1:1 aspect give independently known geometric counts of 5/4/5.

The eight-second linear camera move samples elapsed times 0/4/8, mapped to show times 1/2/3. The conditional scripted provider consumes actual `inspect_camera_move` measurements, uses `inspect_viewpoint` at the starting show moment to identify selected dark in-frame drones, merges their existing brightness keys, then inspects the same move again before review and finish. Unsuitable measurements or missing improvement stop the fixture. No camera motion, live show changes, or provider API calls occur.

The independent oracle expects lit counts to improve from 2/1/2 to 4/3/4 with unchanged geometry. `cameraEvidence` records exact captured endpoints, aspect, both clocks, counts, and before/after event IDs. Trace checks require uniquely paired successful calls, no reused call/error ambiguity, exact requested camera path and time mapping, numeric sample counts and summaries, and draft provenance matching the actual proposal operation count. Before evidence must precede the first edit; after evidence must follow the last edit. Valid split command batches are accepted. The complete authored-document check also rejects plausible changes that yield the same counts, including brightening the wrong equally visible drone, changing brightness to another positive value, touching the outside selected light or dormant work, or damaging unrelated channels. Camera seconds used as key times, missing/stale measurements, wrong paths, and forged trace fields fail as well.

### Complete audience targeting

Run `npm run --silent agent:eval -- --case audience-full-targeting`. This eleventh case has 600 active drones: IDs 1, 4, …, 598 are 200 dark lights ahead of the viewer, the next ID in each group is already lit ahead, and the third is dark behind. The original four-ID selection is disjoint from the requested set; dormant ID 900 also contains authored work. The provider reads the actual `inspect_audience_selection` response and uses its `targetId` in one `stage_audience_operation`, then repeats the same query expecting no remaining dark in-frame matches before review and completion.

The independent oracle derives expected IDs arithmetically, checks the complete authored document, and verifies ordered query → matching-target stage → final-query evidence. The 128-ID page cannot satisfy the full 200-ID edit by itself. A development-only `/test-fixtures/audience-targeting.html` page runs this synthetic case and mounts the actual activity summary, full proposal operations, and Before/Draft audience preview without loading saved-project persistence.

## Run a live case when a key is available

Configure `OPENAI_API_KEY` and `OPENAI_MODEL` in the server environment or `.env.local` as described in [AGENT_HARNESS.md](AGENT_HARNESS.md). Environment values override the file. Choose a model available to your API account; the runner does not assume access to a particular model.

```bash
npm run --silent agent:eval -- --mode live --case selected-lights \
  --out artifacts/agent-live-selected-lights.json
```

Start with that one narrow case, inspect its exact operations and findings, then expand to other cases. A model override can be supplied with `--model MODEL_ID`. A complete live suite requires `--mode live --all`; omitting the case selection is an error. Live runs incur API usage. No live evaluation was executed during this implementation.

Cases run serially. Each has a 45-second run budget, at most 10 model turns, 24 tool calls, and 32 total commands, plus tighter context/output budgets than an interactive run. Those limits are evaluation conditions, not guaranteed provider latency or token-cost caps. Press Ctrl+C to cancel the active request and skip subsequent cases. A failed case is recorded and the next selected case runs; cancellation ends the suite.

## Read the report

Reports label mode, provider, model, timestamps, duration, aggregate usage, and passed/failed/cancelled/skipped counts. Each case includes captured project/selection metadata, tool events, proposed operations, and named findings:

1. The agent completed and returned a reviewed proposal.
2. The owned input fixture remained unchanged.
3. The proposal targets the original project and revision.
4. Its complete operations apply once to an isolated in-memory copy, producing one new revision.
5. The requested authored outcome is present and unrelated content is preserved.
6. For audience or camera refinement, ordered inspection evidence and independently expected sampled composition changes are present.

The semantic comparison accepts different command strategies, object key ordering, keyframe ordering, and hexadecimal color casing. It checks stored authored content rather than only a few rendered frames, so dropping an inactive drone or changing an unrelated key fails. A failure reports the first differing document path rather than dumping the whole project.

Reports exclude raw provider continuation and opaque reasoning. The CLI redacts the configured key from its final serialized output; the evaluator also removes credential-shaped strings/fields. The synthetic case prompts and proposed operations are still included for inspection. Reports are not resumable agent checkpoints.

Exit codes: `0` for a passing suite/list/help, `1` for failed checks, `2` for configuration/CLI errors, and `130` for cancellation. A design review with issues can still produce a semantically correct editing result; passing these tests never establishes flight readiness. All flight and operator boundaries remain in force.

## Executed baseline

All eleven scripted fixture cases pass through the CLI with zero model tokens; report: `artifacts/agent-evaluation-full-audience-targeting-2026-09-27.json`. The new complete-target case passes ten findings and contains one explicit 200-ID operation. Previous ten-case camera and nine-case audience reports remain in `artifacts/` as historical records. The evaluator rejects wrong-ID or page-only edits, unrelated changes, omitted dormant keys, incorrect time coordinates, wrong transform pivots/direction/order, blended rather than scene-target positions, damaged brightness keys, missing or stale audience/camera evidence, mismatched temporary handles, prose-only success, caller mutation, and cancellation. It accepts repeated valid baseline queries, separate per-view audience comparisons, and equivalent target-based key operations in the older refinement cases. See [VERIFICATION.md](VERIFICATION.md) for the aggregate test/build record and [ITERATION_LOG.md](ITERATION_LOG.md) for upcoming work. No live model qualification is claimed.
