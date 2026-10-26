---
name: check-demo-drone
description: Check the simulated Lucidity One drone in the direction lab, explain its radio mismatch, and prepare or apply a reviewed demo change. Use when the user asks to try Lucidity Lab or check its simulated drone.
---

Use Lucidity Lab's MCP tools. This is a simulator, with no real drone connection.

1. Call inspect_drone. If disconnected, ask the user to click **Connect simulated drone** in the lab browser.
2. Explain the observed ground and aircraft channels. If they differ, call prepare_change and show its before/after.
3. Apply only after the user approves the proposed change. Pass the returned proposal ID and revision to apply_change.
4. Report the saved backup and simulated readback from the returned receipt. A matching simulated radio link does not establish flight readiness.
5. Use read_history when the user asks what changed.

If a proposal is stale, inspect and prepare again. Use only the supplied simulator tools for the demo. Do not inspect serial ports, run hardware commands, flash firmware, arm, or fly anything.
