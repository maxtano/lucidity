import { createRoot } from 'react-dom/client';
import { RadioSetup } from '../platform/RadioSetup';
import type { AircraftSnapshot, AircraftTelemetry } from '../aircraft/types';
import type { AircraftContext } from '../platform/useAircraft';
import '../design-system/tokens.css';
import '../platform/platform.css';

if (!import.meta.env.DEV) throw new Error('Synthetic radio fixture is development-only.');
let samples = [1500, 1500, 1000, 1500, 1000, 1000];
const switchPositions = [1000, 1500, 1815];
let switchPosition = 0;
const originalFetch = window.fetch;
const aircraft = (): AircraftTelemetry => ({
  id: 'fixture:1:1', systemId: 1, componentId: 1, protocolVersion: 2, signing: 'unsigned',
  heartbeat: { receivedAt: Date.now(), armed: false,
    mode: ['Stabilize', 'Loiter', 'AUTO'][switchPosition],
    customMode: [0, 5, 3][switchPosition],
    systemStatus: 'Standby', autopilot: 3, vehicleType: 2 },
  attitude: null, gps: null, position: null, battery: null, messages: [],
  receiver: { receivedAt: Date.now(), channels: samples, rssi: 94 },
});
const snapshot = (): AircraftSnapshot => ({
  now: Date.now(), link: { state: 'listening', path: '/dev/cu.usbmodemMOCK', baudRate: 115200,
    connectedAt: Date.now() - 10_000, error: null, bytesReceived: 1000, packetsReceived: 80,
    invalidFrames: 0, lastPacketAt: Date.now(), transmittedBytes: 0 }, aircraft: [aircraft()],
});
window.fetch = async function(this: typeof globalThis, input, options) {
  await originalFetch.call(this, 'data:application/json,%7B%7D', { signal: options?.signal });
  const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  if (url === '/api/aircraft/status') return respond(snapshot());
  if (url === '/api/aircraft/parameters?aircraftId=fixture%3A1%3A1')
    return respond({ aircraftId: 'fixture:1:1', state: 'complete', parameters: [] });
  if (url === '/api/aircraft/parameters/read')
    return respond({ aircraftId: 'fixture:1:1', state: 'complete', parameters: [
      ...['ROLL', 'PITCH', 'THROTTLE', 'YAW'].map((axis, index) => ({ name: `RCMAP_${axis}`, value: index + 1 })),
      { name: 'FLTMODE_CH', value: 5 }, { name: 'RC6_OPTION', value: 31 },
      { name: 'FLTMODE1', value: 0 }, { name: 'FLTMODE2', value: 0 },
      { name: 'FLTMODE3', value: 2 }, { name: 'FLTMODE4', value: 5 },
      { name: 'FLTMODE5', value: 5 }, { name: 'FLTMODE6', value: 3 },
    ] });
  if (url === '/api/aircraft/request-radio') return respond(snapshot());
  return respond({ error: 'Synthetic fixture blocks other requests.' }, 400);
};
const device = { snapshot: snapshot(), aircraft: aircraft(), selectedId: 'fixture:1:1',
  now: Date.now(), live: true, error: '', setSelectedId: () => {} } as AircraftContext;
createRoot(document.getElementById('root')!).render(<div className="lucidity-platform" style={{ height: 'auto', minHeight: '100vh', padding: 32 }}>
  <div style={{ maxWidth: 940, margin: '0 auto' }}>
    <p className="platform-eyebrow">SYNTHETIC · NO HARDWARE CONNECTION</p>
    <button className="platform-button" onClick={() => {
      switchPosition = (switchPosition + 1) % switchPositions.length;
      samples = [1850, 1250, 1700, 1100, switchPositions[switchPosition], 1900];
    }}>Move sample controls and mode switch</button>
    <RadioSetup device={device} />
  </div>
</div>);
