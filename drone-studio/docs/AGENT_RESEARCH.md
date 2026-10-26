# Agent tooling and harness direction

**Research date: September 18, 2026.** Primary documentation only. This is a tooling assessment and design recommendation; it does not claim that every proposed capability is implemented. No API key was read, no live model request was made, and no provider quality, latency, or cost was benchmarked for this research. See [VERIFICATION.md](VERIFICATION.md) for executed checks and [TECHNICAL.md](TECHNICAL.md) for the application contract.

## Recommendation

Keep Lucidity’s editing engine and tool contract independent of the model runtime. Start with one bounded agent loop, a server-side OpenAI Responses adapter, and a deterministic test provider. Make the editor’s full capabilities available through inspectable tools; do not turn the agent into another formation preset selector.

This is an application-specific judgment: a small loop is useful while the main work is establishing selection, timing, transactions, cancellation, and meaningful tool results. It is not a claim that custom orchestration is generally better than an SDK. OpenAI’s official comparison positions Responses as the direct-control option and the Agents SDK as the application-owned agent runtime. [OpenAI runtime comparison](https://developers.openai.com/api/docs/guides/agents).

Reconsider the runtime once the interaction contract is stable. Adopt **OpenAI Agents SDK** when reusable agents, sessions, handoffs, and built-in traces remove substantial application code. Adopt **Vercel AI SDK** when multiple providers and React streaming integration become the larger maintenance burden. Adopt **LangGraph JS** when jobs must survive restarts, branch, and pause for hours. None of these runtimes replaces the domain transaction engine or flight planning.

## Tooling comparison

| Option                                                   | What it supplies                                                                                             | What Lucidity still owns                                                                           | Fit                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Responses + a bounded loop                               | Function calls and results, structured arguments, streamed response events, direct control over continuation | Tool execution, run limits, retry policy, event log, cancellation, editor revisions, persistence   | Good initial adapter for proving the editing contract. The loop must remain small and well tested.          |
| OpenAI Agents SDK (`@openai/agents`)                     | Agent runner, reusable tools, handoffs, streaming, sessions/continuation, tracing                            | Show state, atomic edits, project conflicts, domain validation, render review, storage integration | Strong next option for an OpenAI-centered production harness.                                               |
| Vercel AI SDK (`ai`, provider packages, `@ai-sdk/react`) | `ToolLoopAgent`, provider abstraction, stopping conditions, tool lifecycle callbacks, React chat transport   | Authoritative project state, transaction/retry semantics, persisted runs, expert preview UI        | Strong alternative for a TypeScript product supporting several model providers.                             |
| LangGraph JS (`@langchain/langgraph`)                    | Stateful graph execution, checkpoints, streaming, interrupts and resumable workflows                         | Graph design, durable storage setup, edit idempotency, UI, provider/tool configuration             | Useful for lengthy generation/optimization jobs; more structure than the first interactive edit loop needs. |

Sources: [Responses function calling](https://developers.openai.com/api/docs/guides/function-calling), [Agents SDK](https://developers.openai.com/api/docs/guides/agents/sdk), [SDK running and continuation](https://developers.openai.com/api/docs/guides/agents/running-agents), [AI SDK ToolLoopAgent](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent), [AI SDK React useChat](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat), [LangGraph overview](https://docs.langchain.com/oss/javascript/langgraph/overview).

AI SDK exposes cancellation signals, timeouts, retry configuration, and step callbacks. Its telemetry uses OpenTelemetry and remains marked experimental; input/output recording is configurable. Its current stream-resumption guide explicitly documents a conflict with abort functionality, so reconnect behavior needs a deliberate product decision. [ToolLoopAgent reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent), [telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry), [stream resumption](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams).

LangGraph checkpoints are valuable, but resumed nodes can execute from their beginning. Application side effects must therefore be idempotent or isolated. Resuming an orchestration checkpoint cannot, by itself, undo or safely repeat an editor commit. [LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts), [persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence).

## Harness contract to build toward

These are proposed responsibilities, not a second scene schema:

1. **Capture context.** Supply project identity/revision, selected scene and drone IDs, show and scene-local playhead time, tempo, current tool, and a concise scene index. Read large point/keyframe sets through bounded tools instead of placing 100,000 drones in every prompt.
2. **Inspect before editing.** Give the agent semantic reads for scenes, selected channels, sampled poses, timing, and validation findings. Results should name the coordinate system, units, time basis, and any sampling limits.
3. **Use the expert commands.** Model operations map to the same scene, point, light, keyframe, transition, and retiming commands used by UI and CLI. Add selection expressions and procedural operations as capabilities grow; keep generated points editable.
4. **Work on a revision-bound draft.** Apply a complete tool batch to a clone, validate, and produce a diff. Reject stale base revisions. Publish one coherent revision with an undo step rather than leaking partially applied work into the document.
5. **Evaluate and refine.** Sample changed moments and review the result. Return actionable failures to the model: invalid ID, overlapping key time, stale revision, excessive displacement, or unsupported operation. Record what actually changed before claiming success.
6. **Finish precisely.** Report the changed scenes/IDs/channels, relevant times, and limitations. A valid design edit does not imply a verified flight plan.

Proposed tool families are `inspect_project`, `inspect_scene`, `inspect_drones`, `sample_show`, `apply_commands`, and `review_show`. Their names are illustrative. Tool schemas should enforce valid transport and values while leaving artistic geometry and choreography open. Schema strictness is a reliability mechanism, not a creative ceiling.

For high-volume geometry, add a bounded procedural generator interface that returns the same editable points/keys. Keep generated code and parameters inspectable. An eventual script sandbox needs resource limits and an explicit output contract; evaluating arbitrary model-generated JavaScript in the page is not that sandbox.

## Reliable execution and progress

Use explicit events such as run started, model turn started, text delta, tool requested, tool completed/failed, draft changed, review completed, and run finished/cancelled. Each event should carry a run ID and sequence number; edit events should also carry revisions. The UI can show expandable arguments, results, and diffs beside the actual preview. Show useful status, not invented progress percentages or hidden model reasoning.

Set independent budgets for turns, tool calls, argument/result bytes, affected objects, elapsed time, and output tokens. A limit should return a clear incomplete result. Never silently truncate an edit list and call it successful. Large legitimate jobs can be chunked with an explicit continuation strategy.

Retry transient provider failures with bounded backoff. Do not retry authentication or schema failures blindly. Do not automatically repeat a mutation after an ambiguous connection failure: use call IDs, cached outcomes, and revision checks to establish whether it already committed. Invalid tool arguments should become structured errors the agent can repair within its remaining budget.

Cancellation should abort the provider request and tool work, stop new steps, and invalidate late results. Check cancellation again immediately before publishing a draft. A cancelled run may leave an inspectable draft; it must not later overwrite a user’s manual edits. Persisting drafts and recovering a run after reload are separate capabilities from stopping an HTTP stream.

For a direct Responses adapter:

- Preserve returned output items needed for continuation, including reasoning items and assistant `phase` where present; do not reconstruct history from text alone.
- Match tool results to `call_id`. Wait for complete arguments before executing an edit.
- Use strict schemas where supported: each object disallows additional properties; properties are required, with nullable types for optional values. Still validate domain arguments in application code.
- Serialize revision-sensitive mutations. Setting `parallel_tool_calls: false` limits a turn to zero or one function call; a single atomic tool may contain a coherent command batch.

These requirements follow the [function-calling guide](https://developers.openai.com/api/docs/guides/function-calling) and [official state/phase guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.5). The latter is cited for continuation semantics, not as a model selection recommendation. Choose an available model through server configuration and evaluate it before establishing a default.

## Secrets, traces, and state

The browser calls a local application service; the service calls the provider. Keep credentials in server environment variables or a secret manager. Never put a key in a `VITE_` variable, browser storage, show JSON, exported traces, or chat history. Only expose whether configuration is present. A hosted version also needs authenticated project access and request limits. [OpenAI production guidance](https://developers.openai.com/api/docs/guides/production-best-practices).

Start with a local run log containing timing, tool names, revision IDs, counts, bounded results, errors, provider request IDs, and usage when available. Keep secrets and bulk show data out of routine logs. Add opt-in remote traces with deliberate retention/redaction rules. The Agents SDK supplies tracing across model calls, tools, handoffs, guardrails, and custom spans; this is a meaningful reason to adopt it once production diagnostics become a requirement. [SDK observability](https://developers.openai.com/api/docs/guides/agents/integrations-observability).

Conversation history and project history are different. The saved project revision is authoritative. On a new turn, re-read current selection/time/revision rather than trusting an old assistant summary. Save compact outcomes and operation references; keep large artifacts outside model history and read them as needed.

## Evaluation before and after the API key arrives

Deterministic fixtures can verify harness behavior without claiming that a model understands choreography. AI SDK also offers mock providers and simulated streams for this class of test. [AI SDK testing](https://ai-sdk.dev/docs/ai-sdk-core/testing).

| Case                          | Acceptance criterion                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| Recolor a selected subset     | Only the requested IDs/channels change; unrelated authored keys survive.                          |
| Slow a transition             | Exact duration/easing semantics appear in the diff; the same evaluator drives preview and export. |
| Retime a keyed scene          | Key times follow the requested scale/trim policy; total show timing remains consistent.           |
| Fix an invalid tool call      | A structured error reaches the agent; a corrected batch can succeed without partial mutation.     |
| Concurrent human edit         | A stale draft is rejected or explicitly rebased, never silently overwrites newer work.            |
| Cancellation during tool work | No later commit; cancellation status remains final.                                               |
| Duplicate call or retry       | The same logical operation does not create a second edit.                                         |
| Exhausted budget              | Run ends as incomplete with useful progress and no false success claim.                           |
| Sparse/huge project           | Context and result limits remain bounded; IDs and selection are not silently dropped.             |

After the key is supplied, run a small repeatable set of creative requests against saved starting projects. Record exact final diffs, success/failure, tool errors, user corrections, turns, latency, and usage. Use deterministic invariants for identity/timing/preservation and human assessment for aesthetics. Mock tests cannot establish model quality. OpenAI recommends moving from individual trace review into repeatable datasets and eval runs as behavior stabilizes. [Agent evaluation guide](https://developers.openai.com/api/docs/guides/agent-evals).

## Future visual review

Give the agent rendered images at specified times/cameras plus numerical samples and the applied diff. An image-capable model can critique silhouette, color balance, composition, and readability; it should then make granular edits through the same commands. Use a small contact sheet or selected key moments before considering continuous video.

Keep exact positions, drone counts, clearances, and physical limits in deterministic tools. Vision documentation explicitly notes imperfect counting and precise spatial localization. A pleasant render cannot establish collision freedom. [OpenAI images and vision](https://developers.openai.com/api/docs/guides/images-vision).

Rendered-image feedback remains a proposed extension. As of the September 27 implementation, the harness does capture numerical audience camera/stage context and can inspect or compare the draft from those fixed views. It still receives no viewport pixels or rendered frames. The audience-refinement fixture verifies numerical tool use and authored preservation; it does not qualify visual reasoning or model judgment. Adding a vision-capable provider alone does not supply those images.

Measured review links now connect validated original/final-draft audience results to explicit navigation in the private visual preview. This helps the artist inspect the numerical evidence at its captured pose and show time. An optional **Captured frame** toggle reproduces the recorded projection aspect through resizing and fullscreen. It does not supply images to the agent, reproduce exact pixels/occlusion, or demonstrate aesthetic judgment. The camera remains movable, and recorded counts describe only the captured pose and sampled time.

Local rendered stills are now available for the artist through explicit preview capture, with PNG and owned JSON metadata for document version, time, camera, framing, and appearance. The capture occurs immediately after a fresh postprocessed render; the [HTML canvas specification](https://html.spec.whatwg.org/multipage/canvas.html#dom-canvas-toblob) defines synchronous bitmap copying before asynchronous serialization. This is a local artifact foundation, not implemented image-based agent critique: no captured image is uploaded or included in a provider request.

The local review artifact now bundles image and metadata into a bounded `.lucid-frame` container with canonical JSON and a SHA-256 checksum. Read-only import validates PNG structure and then browser decoding before replacing the previous still. This closes the local image/metadata transfer path; it does not solve trustworthy provenance or model perception. Imported records are explicitly labelled and never become agent evidence or modify the current show. A future visual-review protocol still needs explicit image selection, provider transmission scope, and evaluations of actual image reasoning.

Private camera audition now lets the artist rehearse a timed move between audience viewpoints using a pure, tested interpolation/clock helper. A shared sampled composition calculation powers the artist's **Analyze move** report and the read-only `inspect_camera_move` tool. It maps camera elapsed time independently onto an explicit show interval, including a held show frame, and returns owned poses/times plus geometric/light counts. The agent still starts from captured current/saved views; the tool neither receives a live camera track nor moves the artist's preview. Numerical samples retain the existing limits around occlusion and aesthetics.

The `camera-light-refinement` fixture now consumes actual path measurements, conditionally repairs selected dark-light keys, and measures again before proposal completion. An independent oracle checks expected counts, clock/pose identity, trace order, and preserved authored content. Original/final camera extrema now produce explicit preview links after validation against the completed run's owned viewer capture and compact per-sample counts. A development-only page exercises that fixture with the real preview. These steps qualify the numerical loop and artist review connection; they do not establish model judgment or rendered-image critique. The next useful extension is a narrowly scoped, explicit rendered-frame input protocol with bounded image selection and real image-aware evaluations once provider testing is available.

## Implementation boundary

The artist can now preview a complete audience query as display-only rings before committing selection. Fixed historical membership is distinct from current animated positions, and an explicit recall action restores the query camera and time. This provides visual feedback for numerical targeting without changing the agent's tool contract, supplying rendered images to a provider, or qualifying visual judgment. Rendered review exports exclude these editing markers.

Completed proposal previews now expose the complete explicit target union from validated granular commands, filtered independently to the Before/Draft active fleets. This gives the artist a visual way to inspect command scope, including dormant IDs and targets beyond tool-page limits. It does not infer per-drone attribution for broad scene/show changes or claim that a targeted drone differs visually at the current time. The injected-provider fixtures exercise scope ownership and rendering controls; no provider sees these rings or rendered frames.

Audience-based selection now connects numerical viewing evidence to exact editing targets. The artist can commit the complete matching set from a captured frame, region, light state, and optional existing selection. The agent uses the same classifier through bounded pages with full counts and a staged-operation marker. A nonempty query also retains a temporary, owned complete ID set for one atomic shared operation. These run-local targets expire after successful draft edits and are bounded by count and total retained IDs. The proposal expands exact IDs through the existing command engine, preserving the artist's original selection. This removes the need to page a large matching set into model context before a uniform edit; it does not add model vision or establish creative quality.

This research recommends one replaceable runtime, not installing all three frameworks. Implementation and test results are tracked separately. The first milestone is a usable, cancellable, inspectable tool loop with deterministic fixtures and a server-only key boundary. Later milestones are live-provider qualification, persistent/recoverable runs, procedural code execution, and rendered-image review. Do not label those later milestones complete until exercised end to end.
