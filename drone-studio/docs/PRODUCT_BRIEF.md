# Lucidity product brief

**Draft v2 · October 14, 2026 · Expert capability first**

Lucidity is an agent-first engineering workspace for designing, configuring, programming, testing, and operating drones. It is built around an expert's need for precise control across a varied collection of aircraft, components, firmware, and custom behaviors.

The promise is **complete control of your builds, with their tools, state, code, and evidence connected in one workspace**. The agent can inspect and operate that environment, automate repeated work, and explain unfamiliar systems. Expert capability sets the product's depth; AI makes that depth easier to use.

Drone shows are one application of this platform. Parts planning, virtual builds, board programming, tuning, ground control, and diagnostics share the same underlying aircraft records and tools.

## Purpose and primary audience

**Confirmed October 14, 2026:** the initial audience is an expert who needs extensive control over a variety of drone builds. Beginner acquisition and first-drone onboarding are deferred. The [discovery brief](PRODUCT_DISCOVERY.md) develops the proposed primary persona: an expert drone builder and systems integrator.

This person can work with technical documentation, configuration files, device consoles, and detailed measurements. They modify builds, combine subsystems, investigate unexpected behavior, and care about exactly what changed. Their builds may serve different purposes and use different flight stacks.

The problem hypothesis is that managing those differences across separate tools creates repeated work and breaks the connection between hardware, configuration, code, and results. Lucidity should make complex changes easier to execute, inspect, reproduce, and recover from.

Experts also encounter unfamiliar subsystems. The agent's explanations should help them cross those gaps while preserving the controls needed to inspect and challenge its work. Over time, that same capability can make the platform accessible to less experienced users.

## Foundational principles

**Build the granular capabilities first. Give humans and agents access to the same capabilities. Make the UI precise, fast, and understandable.**

- **Deep control:** expose supported parameters, board resources, ports, protocols, firmware operations, actuator controls, mission items, telemetry, and code. Preserve stack-specific names and semantics.
- **Equal ways of working:** direct manipulation, parameter tables, console commands, scripts, and agent requests refer to the same target and state. The manual workspace should be useful without an agent.
- **Composability:** experts can combine primitives into custom workflows, save scripts, and extend device support through documented interfaces.
- **Inspectability:** show intended changes, actual commands, responses, readback, and test results at the level the user needs.
- **Continuity:** connect each aircraft's parts, firmware, configuration, programs, and runs across revisions.
- **Progressive explanation:** offer guidance and references where needed, with quick access to full technical detail and no mandatory tutorial path.

“Full control” means depth within the selected hardware's actual capabilities. Each integration exposes its supported operations and gaps; adding a common UI must retain the distinct capabilities of each ecosystem.

## Main capabilities

| Area | Expert capability |
| --- | --- |
| Build engineering | Register existing aircraft and components, manage owned inventory, design virtual builds, compare variants, document wiring and resource assignments, inspect compatibility evidence, and source replacements. Keep planned and installed parts distinct. |
| Configuration and tuning | Inspect and edit complete supported parameter sets, filter and compare snapshots, retain profiles and per-aircraft overrides, configure receivers, motors, ESCs, sensors, navigation, power, and flight behavior. Preview and verify targeted changes. |
| Firmware and board programming | Work with firmware versions, build targets, source, build output, flashing, device consoles, and recovery. Include supported flight controllers, ESCs, radios, ESP boards, and companion computers. |
| Code and automation | Create scripts, device tools, test procedures, mission logic, and custom behavior. Give UI, CLI, and agent access to the same documented operations and execution records. |
| Simulation and diagnostics | Run supported flight-stack simulations and bench tests; plot, inspect, replay, and compare telemetry and logs. Connect results to the hardware and software revision that produced them. |
| Flight and missions | Plan and edit missions, inspect exact commands and coordinate frames, transfer and read back plans, monitor aircraft, and access supported operational controls and pilot takeover. |
| Shows and coordinated operation | Author individual paths and light channels, simulate choreography, assign compatible aircraft, and develop validated deployment and operational workflows for multiple vehicles. |

Virtual building serves engineering work: compare a replacement board, explore a wiring change, or branch a proven design. Estimates identify their assumptions, and compatibility findings distinguish documented support from unresolved questions.

## The agent's role

The agent acts as a technical collaborator with access to the workspace's real tools. It gathers state, investigates differences, proposes precise changes, writes and runs code, verifies outcomes, and records its work. Experts can delegate at the level of a parameter, a subsystem, or a complete bounded task.

Representative requests include:

1. **“Compare these two builds and explain why their receiver configurations differ.”** Inspect component identities, firmware versions, and current snapshots; show the exact differences and supporting evidence.
2. **“Replace this flight controller in the build plan and show everything affected.”** Revisit wiring, ports, resource assignments, firmware support, and configuration compatibility without changing the connected aircraft.
3. **“Apply this configuration group to these compatible aircraft, preserving their individual calibration.”** Resolve each target, produce a per-aircraft change plan, and verify each result separately.
4. **“Compare the logs before and after this tuning change.”** Tie measurements to the relevant configuration, distinguish findings from hypotheses, and propose a focused next experiment.
5. **“Write and test firmware for this peripheral board.”** Produce editable source, build and test records, a target-specific deployment plan, and console evidence.

The agent should make experts faster through context gathering and execution as well as explanations. Its output remains editable and reproducible through manual tools or code.

## Workspace and records

The proposed workspaces are **Build, Workbench, Code, Simulate, Analyze, Fly, and Shows**. Home surfaces aircraft, build variants, recent changes, active connections, and unfinished experiments. Layouts should support quick search, keyboard use, simultaneous inspection, and adjustable information density.

The central model distinguishes:

- **Build designs:** versioned component choices, wiring, resource allocation, intended use, and compatibility findings.
- **Physical aircraft and devices:** stable identities, installed components, observed firmware, configuration snapshots, and maintenance history.
- **Programs and plans:** source, build artifacts, scripts, missions, and shows with explicit revisions.
- **Runs and evidence:** the selected aircraft, configuration and program versions, commands, telemetry, logs, observations, and results.

A design can produce multiple aircraft. Each aircraft keeps its own calibration, identity, installed differences, and execution history. Reusing a template creates an inspectable proposal for each target. Changing the template does not silently rewrite deployed aircraft.

Desired configuration, last observed state, and fresh live state remain distinguishable. Direct console work must be recorded where observable and followed by state refresh before subsequent edits rely on earlier values.

## Integration and execution model

Lucidity should own the shared workspace, capability interfaces, orchestration, and history. Adapters connect these to hardware and existing flight ecosystems while preserving their specific semantics.

Existing tools establish a substantial capability baseline. Mission Planner supports full parameter inspection and file comparisons; Betaflight exposes detailed configuration and device commands through its CLI; QGroundControl covers setup, missions, monitoring, and analysis. Lucidity's product hypothesis is that connecting expert operations across builds and making them agent-accessible can improve complete workflows. [Mission Planner configuration](https://ardupilot.org/planner/docs/mission-planner-configuration-and-tuning.html) · [Betaflight CLI](https://betaflight.com/docs/wiki/guides/current/Cli) · [QGroundControl guide](https://docs.qgroundcontrol.com/master/en/qgc-user-guide/)

Use a local device service with documented APIs, persistent records, and portable configuration and source artifacts. Essential manual device work should remain available without a cloud model. Expert console and extension paths should expose additional supported operations as integrations deepen.

Hardware actions retain explicit targets, applicable preconditions, and scoped authorization. Repeated operations can run within an authorized task without asking about every individual command. Firmware flashing, actuator tests, and flight execution remain distinct operations. The same execution requirements apply to UI, scripts, and agents.

Device acceptance, readback, and observed physical behavior are separate evidence. A failed multi-device operation records individual outcomes; recovery reconciles actual state before retrying. Configuration recovery depends on device and version support. Physical effects are not undoable document edits.

Time-critical control belongs to flight software and dedicated runtimes. The agent develops, configures, and supervises them. For example, PX4 defines ongoing offboard signaling requirements and loss behavior that the runtime must maintain. [PX4 offboard control](https://docs.px4.io/main/en/flight_modes/offboard)

## First delivery and expansion

**Proposed first complete workflow: compare and reproduce a precise change across two different builds.** Capture their real state, identify intended differences, apply a selected change to one compatible target, verify it, and retain a repeatable record. This tests the central value of managing variety.

Begin with deep support for one ecosystem and validate the design against a second. The current ArduPilot bench integration is an implementation foothold; expert workflow research should determine whether ArduPilot or Betaflight gives the strongest first complete experience.

| Milestone | Evidence of completion |
| --- | --- |
| Inspect and compare | Two aircraft records retain parts, firmware, and configuration. The user can inspect raw data and compare revisions while identifying unsupported information. |
| Make an exact change | Manual and agent paths apply the same selected changes, preserve unrelated state, and record readback and incomplete results. |
| Reproduce work | The workflow can be saved, rerun against a compatible target, and inspected without reconstructing its context. |
| Diagnose an iteration | A test or log is linked to its build and configuration, and before/after results support the next decision. |
| Expand depth and variety | Add another ecosystem, deeper programming and flashing, engineering views of virtual builds, and mission or show execution using the shared foundation. |

A limited initial hardware matrix can still offer deep control. Track coverage explicitly so experts can judge whether Lucidity can complete their particular workflow.

## Learning and existing foundation

Documentation, source references, and creator resources such as Joshua Bardwell remain useful on demand. The agent can explain an unfamiliar setting or relate a lesson to the selected build. Learning support sits alongside expert work; a beginner curriculum is a later product initiative.

Lucidity already contains granular show authoring, shared human and agent editing commands, proposal review, and a local aircraft service for telemetry and bounded ArduCopter motor tests. Cross-build configuration management, general board programming, virtual assembly, deep log analysis, and mission execution remain proposed work. [Show workspace](PRODUCT.md) · [Aircraft service](../src/aircraft/service.ts) · [Bench record](LUCIDITY_ONE_BENCH_TEST.md)

The next deliverable is an expert capability map and a Workbench storyboard for the comparison-and-change workflow. Success means experts can complete difficult tasks with exact control, less repeated work, reliable evidence, and fewer departures to other tools. Measure capability coverage, verified completion, iteration time, manual corrections, and recovery.
