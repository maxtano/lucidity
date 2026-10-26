import { createRoot } from 'react-dom/client';
import { analyzeDataFlash } from '../aircraft/dataflash-analysis';
import type { AircraftSnapshot, AircraftTelemetry } from '../aircraft/types';
import { FlightLogs } from '../platform/FlightLogs';
import type { AircraftContext } from '../platform/useAircraft';
import '../design-system/tokens.css';
import '../platform/platform.css';

if (!import.meta.env.DEV) throw new Error('Synthetic flight log fixture is development-only.');

// The served DataFlash fixture makes Find → Inspect → Save and local import
// inspect identical synthetic evidence. No serial port or aircraft is accessed.
const fixtureResponse = await fetch('/test-fixtures/synthetic-flight.bin');
const fixtureBuffer: ArrayBuffer = await fixtureResponse.arrayBuffer();
const binary = new Uint8Array(fixtureBuffer);
const analysis = analyzeDataFlash(binary);
const downloadUrl = '/test-fixtures/synthetic-flight.bin';
type LogState = 'idle' | 'listing' | 'downloading' | 'complete' | 'error';
const state: {
  state: LogState;
  entries: { id: number; size: number; timeUtc: number }[];
  progress: { received: number; total: number } | null;
  error: string | null;
  artifact: { name: string; downloadUrl: string; analysis: typeof analysis } | null;
} = { state: 'idle', entries: [], progress: null, error: null, artifact: null };
let run = 0;
const wait = (milliseconds: number, token: number, action: () => void) =>
  window.setTimeout(() => { if (run === token) action(); }, milliseconds);
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
window.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
  if (url === '/api/aircraft/logs/status') return respond(state);
  if (url === '/api/aircraft/logs/list') {
    const token = ++run;
    state.state = 'listing'; state.progress = null; state.error = null;
    wait(6000, token, () => {
      state.state = 'complete';
      state.entries = [
        { id: 42, size: binary.byteLength, timeUtc: 1791405600 },
        { id: 41, size: 17 * 1024 * 1024, timeUtc: 1791394800 },
      ];
    });
    return respond(state);
  }
  if (url === '/api/aircraft/logs/download') {
    const token = ++run;
    state.state = 'downloading'; state.progress = { received: 0, total: binary.byteLength };
    state.error = null; state.artifact = null;
    wait(2500, token, () => { state.progress = { received: Math.floor(binary.byteLength / 3), total: binary.byteLength }; });
    wait(5000, token, () => { state.progress = { received: Math.floor(binary.byteLength * 2 / 3), total: binary.byteLength }; });
    wait(8000, token, () => {
      state.state = 'complete'; state.progress = null;
      state.artifact = { name: 'synthetic-flight-42.BIN', downloadUrl, analysis };
    });
    return respond(state);
  }
  if (url === '/api/aircraft/logs/cancel') {
    run++; state.state = 'idle'; state.progress = null; state.error = null;
    return respond(state);
  }
  return respond({ error: 'Synthetic fixture blocks all other requests.' }, 400);
};

const aircraft: AircraftTelemetry = {
  id: 'fixture:1:1', systemId: 1, componentId: 1, protocolVersion: 2, signing: 'unsigned',
  heartbeat: { receivedAt: Date.now(), armed: false, mode: 'Stabilize', customMode: 0,
    systemStatus: 'Standby', autopilot: 3, vehicleType: 2 },
  attitude: null, gps: null, position: null, battery: null, messages: [],
};
const snapshot: AircraftSnapshot = {
  now: Date.now(), link: { state: 'listening', path: '/dev/fixture-NOT-A-REAL-PORT', baudRate: 115200,
    connectedAt: Date.now() - 10_000, error: null, bytesReceived: 1000, packetsReceived: 80,
    invalidFrames: 0, lastPacketAt: Date.now(), transmittedBytes: 0 }, aircraft: [aircraft],
};
const device = { snapshot, aircraft, selectedId: aircraft.id,
  now: snapshot.now, live: true, error: '', setSelectedId: () => {} } as AircraftContext;

createRoot(document.getElementById('root')!).render(<div className="lucidity-platform" style={{ minHeight: '100vh', padding: 32 }}>
  <div style={{ maxWidth: 1020, margin: '0 auto' }}>
    <p className="platform-eyebrow">SYNTHETIC FLIGHT LOG · NO HARDWARE CONNECTION</p>
    <FlightLogs device={device} />
  </div>
</div>);
