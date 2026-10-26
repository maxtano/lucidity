# Lucidity direction lab

Three tiny interaction samples, one simulated drone. Everything is in this folder; the existing `drone-studio` application is untouched.

## Try it

Double-click **Start Lab.command**, then open **http://127.0.0.1:4317**. Keep its Terminal window open. If the lab is already running, just open that URL.

Or, with Node 22+:

```sh
cd lucidity/direction-lab
npm ci
npm start
```

1. Choose **Inside your chat**, **Lucidity chat**, or **Chat + workbench**.
2. Click **Connect simulated drone**, then **Check my drone**.
3. Ask why, review channel 1 → 6, then **Apply & verify**.
4. Switch views to see the same state. **Start over** resets the simulated settings and receipts for another comparison.

The default is an instant scripted demo. Select **Live Codex · ChatGPT session** for real replies using your installed Codex CLI, already authenticated through ChatGPT. Messages use your plan allowance. The app never reads or stores your credentials. If unavailable, run `codex login` yourself or use the instant demo. There is no embedded OAuth login or API-key flow.

## Real tools in your existing chat

With the lab running, double-click **Try Real Chat.command** (or run `npm run chat` in another Terminal). It opens Codex with four temporary MCP tools:

- `inspect_drone`
- `prepare_change`
- `apply_change`
- `read_history`

Ask **“Check my demo drone.”** Review the proposed change, then approve it in that conversation. Watch the workbench update. The launcher adds settings only for that invocation; it does not install a global plugin or modify your Codex configuration.

The MCP server is in `plugins/lucidity-lab`. The `npm run chat` launcher resolves the Node executable and server paths automatically; machine-specific `.mcp.json` files are excluded from the repository. This trial is local Codex, not a claim that the plugin is published or installed in browser ChatGPT. ChatGPT testing/distribution depends on the host, account, and transport route.

## What is real

| Working | Simulated or not included |
|---|---|
| Three interactive layouts | All drone hardware and readback |
| Shared local state and persisted receipts | One simplified radio fault |
| Before/after review, backup, revision checks | Scripted replies in Instant demo |
| Actual MCP server and client integration | ChatGPT app-directory publication |
| Optional real replies through the signed-in CLI | Production standalone subscription onboarding |

The live browser assistant returns a constrained reply and can prepare a proposal. Only the Apply button writes the simulated setting. The MCP tools also support applying a reviewed proposal from the host chat. Neither path connects to USB, MAVLink, or a real aircraft.

Read the short, sourced research note at **http://127.0.0.1:4317/research**. It distinguishes platform access from the separate noncommercial license of the Sign-in DevKit, which is not bundled here.

## Small architecture

```text
Your existing chat ── MCP tools ──┐
                                ├─ local lab server ── simulated drone
Three browser views ── HTTP ─────┘          │
       │                                  └─ data/drone.json
       └─ optional Codex CLI reply             settings, backup, receipts
```

No build step. Node HTTP server + plain browser JavaScript. MCP SDK is the only feature dependency (plus its schema library). Live chat uses the official installed CLI subprocess with structured output, a read-only sandbox, and shell/app/plugin/delegation features disabled for that invocation. It does not alter the existing CLI login. Only recent lab messages and simulated state are intentionally provided to the model; do not use this prototype for sensitive data.

`data/drone.json` persists simulated state across server restarts. Browser chat transcripts stay in memory and clear on reload. The local server binds only to loopback and rejects cross-origin writes. This is a single-user experiment, not a hosted service.

## Checks

```sh
npm test
```

Tests cover persistence, duplicate apply requests, stale proposals, disconnected state, cross-origin writes, a delayed live-reply race, and an actual MCP stdio client/server workflow. Live model replies need a ChatGPT-authenticated CLI and internet access; the automated suite uses no model usage.

The two `.command` launchers prefer the Node 23.3.0 already installed on this Mac. On another machine, use Node 22+ and `npm start`. If port 4317 is busy, `PORT=4318 npm start`; use `LUCIDITY_LAB_URL=http://127.0.0.1:4318 npm run chat` for the matching tool connection.
