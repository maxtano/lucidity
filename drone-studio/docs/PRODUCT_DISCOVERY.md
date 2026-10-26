# Lucidity people problems and workflows

**Discovery brief v3 · October 14, 2026 · Expert audience**

Lucidity's confirmed initial audience is an expert who needs deep control across varied drone builds. The proposed primary persona is **the expert drone builder and systems integrator**: someone who combines hardware, firmware, configuration, and code, and needs to make changes precisely across different aircraft.

The central problem hypothesis is **the cost of managing complexity across builds and tools**. The person has technical ability but must repeatedly reconstruct state, translate between interfaces, preserve important differences, and connect changes to results. The [product brief](PRODUCT_BRIEF.md) defines the platform that should support this work.

The expert audience is a product decision. The persona details, problem severity, and preferred first workflow below remain hypotheses for research. Beginner recruitment and first-flight teaching are deferred. AI accessibility remains a core principle and should help experts with unfamiliar subsystems as well as make the same tools approachable to others over time.

## Primary persona

Expertise should be identified through demonstrated work. Recruit people who have configured or substantially modified multiple builds, use detailed settings or consoles, and can show a recent investigation, migration, or custom integration.

| Dimension | Hypothesis to investigate |
| --- | --- |
| Context | Owns or maintains several builds with different components, firmware, and purposes. May work independently or on a small team. |
| Goal | Make the exact intended change and understand its consequences while preserving each aircraft's identity and working state. |
| Existing capability | Can interpret documentation, inspect parameters, reason about hardware, use diagnostic data, and work with scripts or firmware when relevant. Expertise can differ by subsystem. |
| Trigger | A new build, component replacement, firmware update, tuning experiment, unexplained behavior, or a configuration to reproduce elsewhere. |
| Current approach | Uses specialist configurators, ground stations, ESC tools, terminals, source repositories, logs, build notes, and saved configurations. |
| Friction | Repeated inspection and copying, uncertain provenance, version differences, fragmented evidence, and custom operations that do not fit a preset workflow. |
| Trust requirement | Exact targets and values, direct access, documented semantics, visible evidence, preserved unrelated state, and practical recovery. |

**Proposed job statement:** When I develop, change, or troubleshoot one of my builds, help me inspect its complete relevant state, execute precise operations, and compare the outcome with previous versions or other aircraft, so I can iterate faster and reproduce what works.

The first user does not need to be a professional by job title. A serious hobbyist can have the same control requirements. A fleet owner alone does not establish this persona; the meaningful behavior is technical work across differing builds.

## Adjacent expert audiences

| Audience | Distinct work | Relationship to the first focus |
| --- | --- | --- |
| Firmware or autonomy developer | Builds software, integrates peripherals, simulates behavior, and diagnoses runtime results. | Guides code, toolchain, simulator, and extension requirements. |
| Technician or operator maintaining aircraft | Replaces components, commissions vehicles, checks differences, and restores operation. | Guides repeatability, target identity, maintenance records, and partial-failure recovery. |
| Expert show designer or fleet integrator | Edits detailed choreography and translates it into coordinated aircraft operation. | Extends the current show workspace and tests planning-to-execution continuity. |
| Expert exploring an unfamiliar subsystem | Knows the overall domain but needs focused help with a new board, protocol, or stack. | Tests whether agent explanations preserve technical precision and user control. |

Research should start with the builder and integrator. Adjacent participants help reveal missing controls; their full workflows do not all need to enter the initial release.

## Problems to validate

| Problem | Concrete situation | Evidence to seek |
| --- | --- | --- |
| P1 Reconstructing state | Before changing a build, the expert must establish its actual parts, firmware, settings, and previous modifications. | The artifacts consulted, time spent, missing information, and conflicting records. |
| P2 Preserving differences | A template or saved configuration needs adaptation to another aircraft or firmware version. | Which settings were portable, which required judgment, and what was mistakenly overwritten or omitted. |
| P3 Moving between tools | One task crosses configuration, ESC settings, device consoles, source, and logs. | Exact handoffs, copied information, reconnects, and loss of context. |
| P4 Connecting changes to results | A behavior changes after hardware, firmware, or tuning work. | The configuration and logs available, how they are aligned, and whether the cause can be isolated. |
| P5 Repeating custom work | The same inspection, setup, or experiment is manually reconstructed for another build. | Existing scripts, checklists, repeat steps, and failure handling. |
| P6 Reaching the required control | A needed operation is absent from a workflow, hidden, or available only through another interface. | The raw command or specialist operation, why it matters, and the consequence of excluding it. |

These hypotheses have useful starting evidence, but prevalence is unmeasured. The existing [bench record](LUCIDITY_ONE_BENCH_TEST.md) connects physical repair, configuration changes, and observed motor results. Earlier Lucidity discussions also described copying parameter values between a ground station and an agent. This gives us specific work to examine with experts.

The existing ecosystem already supplies powerful primitives. Mission Planner documents complete parameter views, saved files, and selective comparisons. Betaflight documents configuration exports, raw settings, and resource commands, including version-dependent behavior. Lucidity must establish an improvement at the level of complete expert tasks. [Mission Planner configuration](https://ardupilot.org/planner/docs/mission-planner-configuration-and-tuning.html) · [Betaflight CLI](https://betaflight.com/docs/wiki/guides/current/Cli)

## Expert capability standard

For each supported ecosystem, map operations to the real hardware and firmware interfaces. Record whether each operation is available through the UI, CLI or API, and agent tools, and how it is verified.

| Capability | What expert depth requires |
| --- | --- |
| Inspect | Full supported parameter sets, raw names and values, units and ranges where known, metadata sources, device identity, telemetry, and diagnostic messages. |
| Edit | Individual and selected batch changes, exact diffs, profile and target scope, resource assignments, version-aware validation, and readback. |
| Program | Editable source, build targets and artifacts, commands and output, firmware deployment, device consoles, and recovery paths. |
| Measure | Signal selection and plotting, log inspection and replay, explicit time alignment, before/after comparison, and links to the configuration used. |
| Reuse | Saved procedures, scripts, templates, portable exports, and per-aircraft overrides with inspectable application plans. |
| Extend | Documented interfaces for unsupported devices or specialist operations, with discoverable schemas and explicit execution scope. |

Shared controls should retain native stack-specific detail. For example, a common configuration view can organize settings while still exposing their original names, profiles, types, and version-specific semantics.

Powerful UI should improve expert speed: searchable tables, keyboard operations, simultaneous views, precise diagrams, and persistent selections. The user can complete a task directly, delegate part of it, or take over an agent operation using the same working state.

## Workflows to accelerate

| Workflow | Proposed Lucidity improvement | Completion evidence |
| --- | --- | --- |
| Compare two builds | Join component differences, firmware, configuration, and known overrides in one inspection. | Expert can identify intended and unexpected differences without re-entering data. |
| Replace a controller or peripheral | Connect revised parts and wiring to firmware support and a selective configuration migration. | A reviewed change plan and verified resulting state, with unresolved mappings explicit. |
| Investigate a regression | Align the relevant logs and measurements with the change history. | Evidence supports a focused experiment; measurements and inference are distinguishable. |
| Reproduce a setup | Turn a successful procedure into reusable operations with target-specific values. | Repeated execution preserves individual identity and calibration and records each outcome. |
| Develop custom behavior | Connect source, builds, simulation, deployment, and device output. | A repeatable run can be traced to the exact program and aircraft configuration. |
| Maintain a varied collection | Keep planned, installed, and last observed state attached to the right aircraft. | The user can resume work and detect drift or missing information. |

Measure active time, manual copying, tool changes, unsuccessful attempts, corrections, and completion against task-specific criteria. Set improvement targets after observing the baseline.

## Proposed first complete workflow

**Compare two builds, apply one precise change, and verify the result.** This is a candidate for research because it exercises granular control, aircraft identity, reusable work, and differences between builds.

1. Register or import two aircraft records with known parts, firmware, and configuration. Label live, saved, and simulated sources.
2. Capture or refresh their relevant state and select the revisions to compare.
3. Inspect differences, retaining raw values and the meaning of each setting within its own ecosystem.
4. Select a bounded change for one compatible target. Show exclusions, dependencies, and individual overrides.
5. Apply through either direct controls or the agent using the same operation interface.
6. Read back results, show partial failures and stale information, and preserve unrelated values.
7. Save the procedure and evidence so it can be inspected and adapted to another compatible build.

Begin by executing deeply within one flight stack. Use a second ecosystem during design research to expose assumptions. A comparison across stacks can show native data side by side; automated translation needs explicit mapping evidence for each operation.

The current ArduPilot integration is a starting asset. We should select the first supported ecosystem based on observed expert tasks, available test hardware, and achievable capability coverage. Existing code alone should not determine the target market.

## AI assistance and accessibility

The expert specifies an objective or exact operation. The agent gathers evidence, generates a concrete change or script, executes within authorized scope, and reports what was observed. It should handle repetitive inspection and coordination while keeping the technical result open to inspection.

Expert examples include “compare these snapshots,” “trace this setting to its firmware definition,” “write a repeatable bench procedure,” and “explain the differences after this board substitution.” The user chooses concise results or a detailed explanation.

Creator lessons and references, including Joshua Bardwell, remain available for unfamiliar topics. They can be attached to a component, setting, or workflow, preserving attribution and noting hardware differences. An expert's normal work should proceed without a required learning path.

Later, guided explanations and virtual practice can help less experienced users operate the same capabilities. The primary release is assessed on expert task completion and control. Teaching effectiveness becomes an additional measure when that audience is intentionally introduced.

## Parts planning and virtual builds

Parts registration, shopping support, and virtual assembly remain relevant to the expert audience. Reframe them around existing inventory, design variants, exact component revisions, wiring and pin assignments, replacement analysis, and upgrade paths.

A planned design and a physical aircraft remain linked but distinguishable. A component swap updates the affected compatibility findings and planned connections, with explicit unknowns. Cost, mass, or simulated-performance estimates identify their assumptions.

The virtual builder should help answer a real engineering question, such as what must change when moving to a different controller. Its first useful version can combine structured parts and wiring views; deeper geometry can follow where it changes decisions.

Earlier private Dronebuilder research remains input for parts identity, owned inventory, compatibility evidence, and sourcing. That research is not included in this repository. Broad shopping coverage and a beginner curriculum are outside the initial milestone.

## Research plan and decision criteria

Propose an initial round of **six expert workflow sessions**, followed by focused prototype sessions. Recruit for demonstrated work across multiple builds and include differing ecosystems, custom hardware or software, and both independent and small-team contexts. This is a qualitative starting sample.

Ask each participant to walk through a recent real change using their current tools and artifacts:

1. What was the intended result, and what differed between the builds involved?
2. Which exact controls, commands, files, and measurements did you need?
3. What information did you have to reconstruct, copy, or translate?
4. Which values or behaviors had to stay specific to this aircraft?
5. How did you verify the change and recover from unsuccessful steps?
6. What would prevent Lucidity from replacing part of that workflow?
7. What would you delegate to an agent, and what would you inspect or operate directly?

Record observed behavior, reported incidents, and inferences separately. Preserve artifacts and counterexamples where participants permit. Existing scripts and specialist tools belong in the comparison: they reveal the real capability baseline. This follows the practice of grounding needs in observed work and treating untested interpretations as assumptions. [User research guidance](https://www.gov.uk/service-manual/user-research/start-by-learning-user-needs)

Prototype the proposed comparison-and-change workflow with saved configurations and recorded data first. Evaluate both a manual route and an agent-assisted route. Then validate a bounded hardware integration, including target selection, exact value preservation, interrupted work, readback, and recovery.

A workflow earns priority when it is materially costly, recurs, needs controls Lucidity can expose deeply, and benefits from connected context or automation. Reconsider if experts already complete it efficiently, critical controls remain unavailable, or reviewing the agent costs more than doing the work.

**Next deliverable:** an expert capability matrix and Workbench storyboard showing two distinct builds, configuration and revision comparison, a granular edit, execution evidence, and reusable automation. These should define the minimum useful depth before deciding a larger feature roadmap.
