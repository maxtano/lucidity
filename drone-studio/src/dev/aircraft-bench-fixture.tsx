import { createRoot } from 'react-dom/client';
import App from '../App';
import type { AircraftSnapshot, AircraftTelemetry } from '../aircraft/types';
import { compileStoryboardBenchPlan } from '../core/bench-storyboard';
import '../styles.css';

// Development-only UI fixture. Every fetch is intercepted; there is no serial/API fallback.
if (!import.meta.env.DEV) throw new Error('This synthetic fixture is development-only.');
const path = '/dev/cu.usbmodemFIXTURE';
let connected = false;
let connectedAt = 0;
let transmittedBytes = 0;
let request: AircraftSnapshot['request'];
let motorTest: AircraftSnapshot['motorTest'];
let benchShow: AircraftSnapshot['benchShow'];
let leaseUntil = 0;
const fixtureTimer = window.setInterval(() => {
  if (benchShow?.state !== 'running') return;
  benchShow.elapsedMs = Math.min(benchShow.durationMs, Date.now() - benchShow.startedAt);
  if (!connected || Date.now() > leaseUntil) {
    benchShow.state = 'failed';
    benchShow.message = 'MOCK: client lease or serial connection lost. Remaining cues cancelled.';
    return;
  }
  for (const cue of benchShow.cues) {
    if (cue.state === 'waiting' && benchShow.elapsedMs >= cue.atMs) {
      cue.state = 'accepted';
      transmittedBytes += 44;
      motorTest = { state: 'accepted', aircraftId: aircraft.id, motor: cue.motor,
        startedAt: Date.now(), availableAt: Date.now() + 5000, message: 'MOCK: accepted. No real motor movement.' };
    }
    if (cue.state === 'accepted' && benchShow.elapsedMs >= cue.atMs + 1500) cue.state = 'confirmed';
  }
  if (benchShow.elapsedMs === benchShow.durationMs) {
    benchShow.state = 'completed';
    benchShow.message = 'MOCK: authored cues accepted with post-pulse disarmed heartbeats. No hardware commands were sent.';
  }
}, 100);
const aircraft: AircraftTelemetry = {
  id: 'fixture:1:1',
  systemId: 1,
  componentId: 1,
  protocolVersion: 2,
  signing: 'unsigned',
  heartbeat: {
    receivedAt: 0,
    armed: false,
    mode: 'Stabilize',
    customMode: 0,
    systemStatus: 'Standby',
    autopilot: 3,
    vehicleType: 2,
  },
  attitude: null,
  gps: null,
  position: null,
  battery: null,
  messages: [],
};
const snapshot = (): AircraftSnapshot => ({
  now: Date.now(),
  link: {
    state: connected ? 'listening' : 'disconnected',
    path: connected ? path : null,
    baudRate: 115200,
    connectedAt: connected ? connectedAt : null,
    error: null,
    bytesReceived: connected ? 1200 : 0,
    packetsReceived: connected ? 12 : 0,
    invalidFrames: 0,
    lastPacketAt: connected ? Date.now() : null,
    transmittedBytes,
  },
  aircraft: connected
    ? [{ ...aircraft, heartbeat: { ...aircraft.heartbeat, receivedAt: Date.now() } }]
    : [],
  ...(request ? { request } : {}),
  ...(motorTest ? { motorTest } : {}),
  ...(benchShow ? { benchShow } : {}),
});
const originalFetch = window.fetch;
window.fetch = async function (this: typeof globalThis, input, options) {
  // Exercise the native browser receiver check while keeping every API request local
  // to this fixture. This data URL never reaches the aircraft service or a network.
  await originalFetch.call(this, 'data:application/json,%7B%7D', { signal: options?.signal });
  const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
  const respond = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  if (url === '/api/aircraft/ports')
    return respond({ ports: [{ path, manufacturer: 'MOCK · no hardware' }] });
  if (url === '/api/aircraft/status') return respond(snapshot());
  if (options?.method !== 'POST')
    return respond({ error: 'Fixture blocks all non-fixture network access.' }, 400);
  const body = JSON.parse(String(options.body));
  if (url === '/api/aircraft/connect' && body.path === path) {
    connected = true;
    connectedAt = Date.now();
    request = undefined;
    motorTest = undefined;
    aircraft.id = `fixture-${connectedAt}:1:1`;
  } else if (url === '/api/aircraft/bench-show/start' && connected && request &&
    body.aircraftId === aircraft.id && body.propsRemoved && body.areaClear && body.hardwareCool &&
    benchShow?.state !== 'running') {
    let plan;
    try { plan = compileStoryboardBenchPlan(body.storyboard); }
    catch (error) { return respond({ error: String(error) }, 400); }
    if (plan.source.planKey !== body.reviewedPlanKey) return respond({ error: 'Reviewed storyboard changed.' }, 400);
    leaseUntil = Date.now() + 2500;
    benchShow = { runId: body.runId, aircraftId: aircraft.id, state: 'running',
      startedAt: Date.now(), elapsedMs: 0, durationMs: plan.durationMs, source: plan.source,
      message: 'MOCK: running the UI schedule. No physical aircraft.',
      cues: plan.cues.map((cue) => ({ ...cue, state: 'waiting' })) };
  } else if (url === '/api/aircraft/bench-show/renew' && benchShow?.runId === body.runId && benchShow?.state === 'running') {
    leaseUntil = Date.now() + 2500;
  } else if (url === '/api/aircraft/bench-show/stop' && benchShow && benchShow.runId === body.runId) {
    benchShow.state = 'cancelled';
    benchShow.message = 'MOCK: remaining cues cancelled. No hardware.';
  } else if (url === '/api/aircraft/disconnect') {
    connected = false;
  } else if (url === '/api/aircraft/request-telemetry' && connected) {
    transmittedBytes += 264;
    aircraft.version = { receivedAt: Date.now(), flightVersion: '4.7.1', releaseType: 255 };
    request = {
      state: 'partial',
      aircraftId: aircraft.id,
      startedAt: Date.now(),
      message: 'MOCK: matching ACK and version. No physical aircraft.',
    };
  } else if (
    url === '/api/aircraft/motor-test' &&
    connected &&
    request &&
    body.aircraftId === aircraft.id &&
    body.propsRemoved === true &&
    body.areaClear === true &&
    body.hardwareCool === true &&
    [1, 2, 3, 4].includes(body.motor)
  ) {
    transmittedBytes += 44;
    motorTest = {
      state: 'accepted',
      aircraftId: aircraft.id,
      motor: body.motor,
      startedAt: Date.now(),
      availableAt: Date.now() + 5000,
      message: 'MOCK: command accepted. No real motors moved.',
    };
  } else if (
    url === '/api/aircraft/motor-test-stop' &&
    connected &&
    motorTest &&
    body.aircraftId === aircraft.id
  ) {
    transmittedBytes += 44;
    motorTest = {
      ...motorTest,
      state: 'stop-requested',
      message: 'MOCK: stop requested. No hardware.',
    };
  } else return respond({ error: 'Fixture rejected this operation.' }, 400);
  return respond(snapshot());
};
// Isolated storyboard library: fixture edits never touch the user's saved projects.
const values = new Map<string, string>();
const storage: Storage = {
  get length() { return values.size; },
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value); },
  removeItem: (key) => { values.delete(key); },
  clear: () => values.clear(),
  key: (index) => [...values.keys()][index] ?? null,
};
const root = createRoot(document.getElementById('root')!);
root.render(
  <>
    <p style={{ padding: 16 }}>SYNTHETIC UI CHECK · no radio or aircraft connection</p>
    <App storage={storage} />
  </>
);
import.meta.hot?.dispose(() => {
  window.clearInterval(fixtureTimer);
  root.unmount();
  // Keep the interception until all best-effort cleanup requests have been dispatched.
  window.fetch = originalFetch;
});
