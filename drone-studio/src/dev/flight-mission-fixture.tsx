import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import type { AircraftSnapshot } from '../aircraft/types';
import { createOneFootHoverStoryboard } from '../components/first-flight-preview';
import { FlightMissionPanel } from '../components/FlightMissionPanel';
import '../styles.css';

if (!import.meta.env.DEV) throw new Error('Flight mission fixture is development-only.');

const project = createOneFootHoverStoryboard('fixture-two-meter-hover');
project.name = 'Fixture · first flight hover';
project.limits.maxAltitude = 3;
project.cues[0].name = 'Rise · hold · land';
project.cues[0].duration = 11;
const frameTimes = [0, 3, 7, 11];
for (const [index, key] of project.cues[0].droneEdits!['1'].keyframes!.entries()) {
  key.time = frameTimes[index];
  if (key.position![2] > 0) key.position![2] = 2;
}
const port = '/dev/cu.fixture-ground-radio';
let connected = false;
let linkGeneration = 0;
let armed = false;
let stale = false;
let uploadFails = false;
let mockMission: AircraftSnapshot['mission'];
let storedMission = false;
let launchProof: { verificationId: string; expiresAt: number } | null = null;
let mockRun = { runId: null as string | null, aircraftId: null as string | null, planId: null as string | null,
  state: 'idle', reason: '', issuedCommands: [] as number[], progress: null };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
function mockSnapshot(): AircraftSnapshot {
  const now = Date.now();
  return {
    now,
    link: {
      state: connected ? 'listening' : 'disconnected', path: connected ? port : null,
      baudRate: 115200, connectedAt: connected ? linkGeneration : null, error: null,
      bytesReceived: connected ? 2048 : 0, packetsReceived: connected ? 60 : 0,
      invalidFrames: 0, lastPacketAt: connected ? now : null, transmittedBytes: 0,
    },
    aircraft: connected ? [{
      id: 'fixture-quad', systemId: 1, componentId: 1, protocolVersion: 2,
      signing: 'unsigned',
      heartbeat: { receivedAt: stale ? now - 20_000 : now, armed,
        mode: mockRun.state === 'active' ? 'Auto' : mockRun.state === 'landing' ? 'Land' : 'Stabilize',
        customMode: mockRun.state === 'active' ? 3 : mockRun.state === 'landing' ? 9 : 0,
        systemStatus: 'STANDBY', autopilot: 3, vehicleType: 2 },
      attitude: null, gps: null,
      position: { receivedAt: stale ? now - 20_000 : now, latitude: 37.77, longitude: -122.41,
        relativeAltitudeM: armed ? 2 : 0, altitudeMslM: 10, groundSpeedMps: 0 },
      extendedState: { receivedAt: stale ? now - 20_000 : now, landedState: armed ? 2 : 1, vtolState: 0 },
      battery: null, messages: [],
    }] : [],
    ...(mockMission ? { mission: mockMission } : {}),
  };
}

// Every network call from this page is intercepted; neither USB nor the real aircraft API is reachable.
window.fetch = async (input, init) => {
  const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
  if (path === '/api/aircraft/ports') return json({ ports: [{ path: port, manufacturer: 'Mock only' }] });
  if (path === '/api/aircraft/status') return json(mockSnapshot());
  if (path === '/api/aircraft/mission/launch-status') return json(mockRun);
  if (path === '/api/aircraft/connect' && init?.method === 'POST') {
    connected = true;
    linkGeneration++;
    mockMission = undefined;
    return json(mockSnapshot());
  }
  if (path === '/api/aircraft/disconnect' && init?.method === 'POST') {
    connected = false;
    mockMission = undefined;
    return json(mockSnapshot());
  }
  if (path === '/api/aircraft/mission/plan' && init?.method === 'POST') {
    const body = JSON.parse(String(init.body)) as { storyboard: typeof project };
    const height = Math.max(0, ...body.storyboard.cues[0].droneEdits!['1'].keyframes!.map((key) => key.position?.[2] ?? 0));
    if (height < 2) return json({ eligible: false, reason: 'Mock planner: altitude must be at least 2 m.' });
    mockMission = { state: 'planned', aircraftId: 'fixture-quad', planId: 'fixture-plan',
      message: 'Mock review only; no hardware contacted.' };
    return json({ eligible: true, plan: {
      planId: 'fixture-plan', storyboardId: body.storyboard.id, revision: body.storyboard.revision,
      heightM: height, holdSeconds: 4,
      items: [
        { seq: 1, command: 22, label: 'Take off vertically', altitudeM: 2 },
        { seq: 2, command: 19, label: 'Hold at current location', altitudeM: 2, holdSeconds: 4 },
        { seq: 3, command: 21, label: 'Land at current location', altitudeM: 0 },
      ],
      warning: 'Mock mission only. No firmware accepted this plan.',
    } });
  }
  if (path === '/api/aircraft/mission/upload' && init?.method === 'POST') {
    if (!uploadFails) storedMission = true;
    mockMission = uploadFails
      ? { state: 'unknown', aircraftId: 'fixture-quad', planId: 'fixture-plan', message: 'Mock upload timeout.' }
      : { state: 'verified', aircraftId: 'fixture-quad', planId: 'fixture-plan', missionCount: 4,
        message: 'Mock four-item upload readback.' };
    return uploadFails
      ? json({ error: 'Mock upload timeout; outcome unknown.' }, 504)
      : json({ state: 'verified', missionCount: 4, message: 'Mock readback: four items matched. No hardware was contacted.' });
  }
  if (path === '/api/aircraft/mission/verify' && init?.method === 'POST') {
    if (!storedMission)
      return json({ error: 'Mock mission has not been uploaded and read back.' }, 409);
    const body = JSON.parse(String(init.body)) as { storyboard: typeof project };
    const verifiedAt = Date.now();
    mockMission = { state: 'verified', aircraftId: 'fixture-quad', planId: 'fixture-plan', missionCount: 4,
      message: 'Mock fresh four-item readback.' };
    return json({ verificationId: 'fixture-proof', planId: 'fixture-plan', aircraftId: 'fixture-quad',
      storyboardId: body.storyboard.id, revision: body.storyboard.revision, connectionGeneration: linkGeneration,
      verifiedAt, expiresAt: verifiedAt + 15_000, missionCount: 4, heightM: 2, holdSeconds: 4,
      message: 'Storage only: mock readback matches this storyboard. No flight authorized.' });
  }
  if (path === '/api/aircraft/mission/launch-check' && init?.method === 'POST') {
    if (!connected || !storedMission || armed || stale) return json({ error: 'Mock aircraft is not ready.' }, 409);
    launchProof = { verificationId: `fixture-launch-${Date.now()}`, expiresAt: Date.now() + 15_000 };
    mockMission = { state: 'verified', aircraftId: 'fixture-quad', planId: 'fixture-plan', missionCount: 4,
      message: 'Mock field readback and readiness passed.' };
    return json({ ready: true, ...launchProof, message: 'Mock field checks passed.' });
  }
  if (path === '/api/aircraft/mission/launch' && init?.method === 'POST') {
    const body = JSON.parse(String(init.body)) as { verificationId: string; checks: Record<string, boolean> };
    if (!launchProof || body.verificationId !== launchProof.verificationId ||
      Date.now() >= launchProof.expiresAt || !Object.values(body.checks).every(Boolean))
      return json({ error: 'Mock launch proof or checks failed.' }, 409);
    launchProof = null;
    armed = true;
    mockRun = { runId: 'fixture-run-1', aircraftId: 'fixture-quad', planId: 'fixture-plan',
      state: 'active', reason: 'Mock AUTO mission active; no USB command sent.',
      issuedCommands: [224, 400, 300], progress: null };
    return json(mockRun);
  }
  if (path === '/api/aircraft/mission/land' && init?.method === 'POST') {
    if (mockRun.state !== 'active') return json({ error: 'Mock run is not active.' }, 409);
    mockRun = { ...mockRun, state: 'landing', reason: 'Mock LAND request accepted.' };
    window.setTimeout(() => { armed = false; mockRun = { ...mockRun, state: 'landed', reason: 'Mock landed and disarmed.' }; }, 1800);
    return json(mockRun);
  }
  if (path === '/api/aircraft/mission/reconcile' && init?.method === 'POST') {
    const body = JSON.parse(String(init.body)) as { aircraftId: string; propsRemoved: boolean; confirmed: boolean };
    if (body.aircraftId !== 'fixture-quad' || (mockRun.aircraftId && body.aircraftId !== mockRun.aircraftId) ||
      !body.propsRemoved || !body.confirmed ||
      !connected || armed || stale ||
      !(mockRun.state === 'unknown' || (mockRun.state === 'rejected' && mockRun.issuedCommands.length > 0)))
      return json({ error: 'Mock recovery requires the same live, grounded, disarmed aircraft with props removed.' }, 409);
    mockRun = { runId: null, aircraftId: null, planId: null, state: 'idle', reason: '', issuedCommands: [], progress: null };
    storedMission = false;
    mockMission = undefined;
    launchProof = null;
    return json({ recovered: true, message: 'Mock interrupted run cleared. Review and upload a new mission.' });
  }
  if (path === '/api/aircraft/mission/readback' && init?.method === 'POST')
    return json({ aircraftId: 'fixture-quad', count: 0, items: [], message: 'Mock empty mission readback.' });
  if (path === '/api/aircraft/mission/cancel' && init?.method === 'POST') return json(mockSnapshot());
  return json({ error: `Mock fixture blocked ${path}` }, 404);
};

function Fixture() {
  const [open, setOpen] = useState(true);
  const [flags, setFlags] = useState(0);
  const setFlag = (field: 'armed' | 'stale' | 'uploadFails', checked: boolean) => {
    if (field === 'armed') armed = checked;
    if (field === 'stale') stale = checked;
    if (field === 'uploadFails') uploadFails = checked;
    setFlags((value) => value + 1);
  };
  const restart = () => {
    connected = false;
    mockMission = undefined;
    launchProof = null;
    if (mockRun.state === 'active' || mockRun.state === 'landing')
      mockRun = { ...mockRun, runId: null, aircraftId: null, planId: null, issuedCommands: [],
        state: 'unknown', reason: 'Mock service restarted during flight. Use pilot control.' };
    setFlags((value) => value + 1);
  };
  const simulate = (state: 'active' | 'takeover' | 'unknown' | 'landed') => {
    if (state === 'active') {
      connected = true;
      linkGeneration++;
      armed = true;
      mockRun = { runId: 'fixture-recovery-run', aircraftId: 'fixture-quad', planId: 'fixture-plan',
        state: 'active', reason: 'Mock AUTO mission active; no USB command sent.',
        issuedCommands: [224, 400, 300], progress: null };
      setFlags((value) => value + 1);
      return;
    }
    if (!mockRun.runId) return;
    mockRun = { ...mockRun, state, reason: `Mock ${state}; no hardware contacted.` };
    if (state === 'landed' || state === 'unknown') armed = false;
    setFlags((value) => value + 1);
  };
  return <main style={{ padding: 20, color: 'var(--ds-text)' }}>
    <h1>Flight readiness fixture</h1>
    <p>Isolated mock aircraft. No serial port, saved project, or real mission command is used.</p>
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <label><input type="checkbox" checked={armed} onChange={(event) => setFlag('armed', event.target.checked)} /> Simulate armed</label>
      <label><input type="checkbox" checked={stale} onChange={(event) => setFlag('stale', event.target.checked)} /> Simulate stale heartbeat</label>
      <label><input type="checkbox" checked={uploadFails} onChange={(event) => setFlag('uploadFails', event.target.checked)} /> Simulate upload timeout</label>
      <button type="button" onClick={restart}>Simulate aircraft service restart</button>
      <button type="button" onClick={() => simulate('active')}>Simulate active mock flight</button>
      <button type="button" onClick={() => simulate('takeover')}>Simulate pilot takeover</button>
      <button type="button" onClick={() => simulate('unknown')}>Simulate unknown state</button>
      <button type="button" onClick={() => simulate('landed')}>Simulate landed</button>
    </div>
    <small>Fixture refresh {flags}</small>
    <p><button type="button" onClick={() => setOpen(true)}>Open flight readiness</button></p>
    {open && <FlightMissionPanel project={project} saved onClose={() => setOpen(false)} />}
  </main>;
}

const root = createRoot(document.getElementById('root')!);
root.render(<Fixture />);
import.meta.hot?.dispose(() => root.unmount());
