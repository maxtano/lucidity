# Existing systems and research

**Primary-source research · checked September 18, 2026**

These notes distinguish published capabilities from our own architectural conclusions. Vendor descriptions are evidence of their intended workflows, not an independent audit or a scalability guarantee for Lucidity.

## Product landscape

| System | Published workflow | Useful lesson for this product |
| --- | --- | --- |
| Skybrush Studio | Blender-based storyboard, formations, planned transitions, light effects, and checks for altitude, motion, and proximity | Treat choreography as structured scenes and make validation part of authoring |
| SPH Drone Show Creator | Imports music, images, fonts, video, and 3D assets; produces drone animations | A serious creative workflow eventually needs richer inputs than geometric primitives |
| Verge Composer | Assets, timeline, inspector, and preview; visual effects and audio tracks; simplified effect customization | A dedicated studio can provide a faster starting point than a general 3D tool |
| Verge operating stack | Separate design, mission conversion, console, onboard system, and autopilot | Preserve separate responsibilities for design, validation, and execution |

Sources: [Skybrush Studio](https://skybrush.io/modules/studio/), [SPH Creator](https://shop.sphengineering.com/collections/drone-show-creator), [Verge Composer documentation](https://docs.verge.aero/drone-show-software/publish-your-docs/composer), [Verge architecture](https://docs.verge.aero/drone-show-technology/safety).

**Our inference:** the opportunity is an agent-accessible creative workflow with a transparent document model. Simply adding a chat box or exporting generic waypoints would not reproduce the mature capabilities above.

## How locations reach aircraft

Skybrush’s overview describes an individual flight plan on each drone and a shared GNSS timebase. Its compiled show file contains choreography information; its server converts the common show artifact into per-drone binaries for supported custom firmware. Outdoor positioning commonly uses RTK corrections. [Operating overview](https://docs.skybrush.io/public/faq/latest/overview.html), [SKYC/SKYB glossary](https://docs.skybrush.io/public/skybrush-live-doc/latest/appendix/glossary.html).

**Our inference:** Lucidity should eventually compile time-indexed trajectories and lights, upload them before flight, verify receipt and identity, then schedule local execution. Real-time control traffic and positioning corrections remain operational responsibilities even with preloaded shows. Avoid representing the browser as continuously steering the whole fleet.

## Interoperability is specific

Skybrush documents its own compiled export, trajectory/light sample-rate controls, and several third-party formats whose availability depends on product/license configuration. An editable Lucidity JSON file is therefore not automatically usable by a Skybrush or SPH operator. [Skybrush export reference](https://docs.skybrush.io/public/skybrush-studio-for-blender/latest/panels/safety_and_export/export.html).

MAVLink’s mission protocol defines mission transfer and acknowledgement semantics. Supported commands and frames vary by implementation. Its system identity range is 1–255. These details require a hardware adapter and a fleet-level identity/partitioning model; “supports MAVLink” would be too vague to claim synchronized light-show compatibility. [Mission protocol](https://mavlink.io/en/services/mission.html), [ID assignment](https://mavlink.io/en/services/mavlink_id_assignment.html).

**Decision:** the MVP exports an honestly named design bundle and a preview CSV, with explicit units and a null geographical origin. Native adapters come after selecting a partner.

## Language models and choreography

The current version of **SwarmGPT: Combining Large Language Models with Safe Motion Planning for Drone Swarm Choreography** separates language-driven composition from a motion safety filter. Its abstract reports simulation up to 200 drones and experiments up to 20 physical drones. This supports investigating the separation of creative intent from deterministic planning; it does not establish 100,000-drone feasibility. [Schuck et al., arXiv v2, October 2025](https://arxiv.org/abs/2412.08428v2).

**Decision:** define the editing commands and independent validator before connecting an LLM. The local interpreter is scaffolding for that interface. The UI must label it as such.

## Operational validation

Verge describes design-output checks, mission ingestion checks, and aircraft health checks before flight, as well as system simulation and field testing. Its documented criteria include motion, spacing, landing, flight duration, and geofences. [Verge validation reference](https://docs.verge.aero/drone-show-technology/safety).

**Decision:** a visually attractive draft can still be invalid. Keep design export possible for iteration, but mark it as non-flight-ready. A future aircraft mission compiler should block on failed or incomplete operational checks.

## What remains to research with a partner

- Aircraft platform, supported show formats, firmware permissions, and licensing.
- Positioning uncertainty and downwash envelopes at the intended formation density.
- Music timecode workflow and acceptable light/audio offset.
- Continuous collision detection, assignment strategies, and motion optimization.
- Reliable upload, artifact verification, signed schedules, and partial-fleet failure behavior.
- Operator geography and site constraints; determine requirements for that actual location rather than assuming a universal rule.
- Real planning, validation, rendering, and communications measurements at increasing fleet sizes.

No vendor price, throughput, comparative reliability, or 100k aircraft capability is assumed here.


## Editing experience research and resulting implementation

Apple describes Final Cut Pro’s magnetic timeline as keeping clips related while they move and avoiding accidental gaps. Our inference is to make scene order and duration directly manipulable, preserve local animation timing through ripple edits, and keep transport/zoom close to the work. This build implements a sequential ripple timeline; it does not reproduce Final Cut Pro’s full track/connection model. [Apple’s magnetic timeline guide](https://support.apple.com/guide/final-cut-pro/intro-to-the-magnetic-timeline-verb8fcfc133/mac).

Three.js documents TransformControls as a spatial manipulation control modeled after tools such as Blender, with translation, rotation, and scale. The studio now uses those real controls on a selected-point proxy and converts each resulting transform into explicit drone edits. A professional interaction model is therefore possible without embedding Blender. [Three.js TransformControls](https://threejs.org/docs/pages/TransformControls.html).

The resulting product decision is expert authoring first: individual lights and independent time channels are available directly and through source/commands. Blender assets and offline rendering remain potential integrations; no Blender component is currently embedded.
