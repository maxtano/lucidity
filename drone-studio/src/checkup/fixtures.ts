/** Synthetic fixtures for tests and the development-only preview. Never a hardware fallback. */
import type { AircraftSnapshot, AircraftTelemetry } from '../aircraft/types';
import type { ParameterSnapshot } from '../aircraft/parameters';
import type { CheckClient } from './runner';
export function syntheticAircraft(now: number): AircraftTelemetry {
  return { id: 'fixture:1:1', systemId: 1, componentId: 1, protocolVersion: 2, signing: 'unsigned',
    heartbeat: { receivedAt: now, armed: false, mode: 'Stabilize', customMode: 0, systemStatus: 'Standby', autopilot: 3, vehicleType: 2 },
    version: { receivedAt: now, flightVersion: '4.7.1', releaseType: 255, uid: 'uid:123456789' },
    health: { receivedAt: now, present: (1 << 28) | 15, enabled: (1 << 28) | 15, healthy: (1 << 28) | 15, loadPercent: 20 },
    attitude: { receivedAt: now, rollDeg: .2, pitchDeg: -.3, yawDeg: 90 },
    gps: { receivedAt: now, fix: '3D fix', fixType: 3, satellites: 14, hdop: 1, latitude: null, longitude: null },
    position: null, battery: { receivedAt: now, voltageV: 22.6, currentA: 0, remainingPercent: 90 },
    receiver: { receivedAt: now, channels: [1500, 1500, 1000, 1500], rssi: 160 }, messages: [],
    lastPrearmAck: { receivedAt: now, command: 401, result: 0, targetSystem: 254, targetComponent: 190 } };
}
export const controllerPath = '/dev/cu.usbmodemCHECK', radioPath = '/dev/cu.usbserialRADIO';
export function syntheticSnapshot(now = 10000): AircraftSnapshot {
  return { now, link: { state: 'listening', path: controllerPath, baudRate: 115200, connectedAt: 1000, error: null, bytesReceived: 1000, packetsReceived: 100, invalidFrames: 0, lastPacketAt: now, transmittedBytes: 0 },
    aircraft: [syntheticAircraft(now)], request: { state: 'verified', aircraftId: 'fixture:1:1', startedAt: 2000, message: 'Synthetic two-way response verified.' } };
}
export function syntheticParameters(now = 10000): ParameterSnapshot {
  const entries: Record<string, number> = { FRAME_CLASS: 1, FRAME_TYPE: 1, ARMING_SKIPCHK: 0, BATT_MONITOR: 4, BATT_LOW_VOLT: 21, BATT_CRT_VOLT: 20, BATT_FS_LOW_ACT: 1, FS_THR_ENABLE: 1, FS_GCS_ENABLE: 1,
    RCMAP_ROLL: 1, RCMAP_PITCH: 2, RCMAP_THROTTLE: 3, RCMAP_YAW: 4, SERVO_BLH_AUTO: 1, SERVO_BLH_PORT: 0 };
  for (let n = 1; n <= 4; n++) Object.assign(entries, { [`SERVO${n}_FUNCTION`]: 32 + n, [`SERVO${n}_MIN`]: 1000, [`SERVO${n}_MAX`]: 2000, [`RC${n}_MIN`]: 1000, [`RC${n}_MAX`]: 2000, [`RC${n}_TRIM`]: 1500 });
  const size = Object.keys(entries).length;
  return { aircraftId: 'fixture:1:1', startedAt: 2000, state: 'complete', expected: size, received: size,
    parameters: Object.entries(entries).map(([name, value], index) => ({ name, value, index, count: size, type: 9, receivedAt: now, revision: 1 })) };
}
export function syntheticClient() {
  let clock = 10000, path = controllerPath, connectedAt = 1000, connected = true, requestedAt = 2000;
  let params = syntheticParameters(clock);
  const calls: { path: string; body: unknown }[] = [];
  const controls = { controllerPresent: true, mutation: undefined as ((snapshot: AircraftSnapshot) => void) | undefined, partial: false, absent: false };
  const snapshot = () => {
    const s = syntheticSnapshot(clock);
    s.link.path = path; s.link.connectedAt = connectedAt; s.link.state = connected ? 'listening' : 'disconnected';
    s.link.packetsReceived = Math.floor(clock / 100); s.link.bytesReceived = clock;
    s.request!.startedAt = requestedAt;
    if (!connected || controls.absent) s.aircraft = [];
    controls.mutation?.(s);
    return s;
  };
  const client: CheckClient = async <T>(endpoint: string, body?: unknown, signal?: AbortSignal) => {
    signal?.throwIfAborted(); calls.push({ path: endpoint, body });
    let value: unknown;
    if (endpoint === 'aircraft/ports') value = { ports: [{ path: radioPath, manufacturer: 'Synthetic radio' }, ...(controls.controllerPresent ? [{ path: controllerPath, manufacturer: 'Synthetic ArduPilot' }] : [])] };
    else if (endpoint === 'aircraft/status') value = snapshot();
    else if (endpoint === 'aircraft/connect') { path = (body as { path: string }).path; connected = true; connectedAt = clock; value = snapshot(); }
    else if (endpoint === 'aircraft/disconnect') { connected = false; value = snapshot(); }
    else if (endpoint === 'aircraft/request-telemetry') { requestedAt = clock; clock += 10; value = snapshot(); }
    else if (endpoint === 'aircraft/prearm-check') { const requestedAt = clock; clock += 10; value = { requestedAt }; }
    else if (endpoint === 'aircraft/parameters/read') { params = syntheticParameters(clock); params.startedAt = clock; if (controls.partial) { params.state = 'partial'; params.received--; params.parameters.pop(); } value = params; }
    else if (endpoint.startsWith('aircraft/parameters?')) value = params;
    else if (endpoint === 'aircraft/esc/read') value = { aircraftId: 'fixture:1:1', path, startedAt: clock, finishedAt: clock, state: 'complete', message: 'Synthetic ESC read complete.', count: 4, telemetryRestored: true, escs: [1, 2, 3, 4].map(index => ({ index, firmware: 'Bluejay', version: '0.21.0', layout: 'J-H-40', direction: index === 2 ? 'Reversed' : 'Normal' })) };
    else if (endpoint === 'aircraft/motor-test') { clock += 11000; value = { ...snapshot(), motorTest: { state: 'accepted', aircraftId: 'fixture:1:1', motor: (body as { motor: number }).motor, startedAt: clock - 11000, availableAt: clock, message: 'Synthetic acceptance; movement unconfirmed.' } }; }
    else if (endpoint === 'aircraft/motor-test-stop') value = snapshot();
    else throw new Error('Synthetic preview: this hardware action is unavailable. No device was contacted.');
    return structuredClone(value) as T;
  };
  return { client, controls, calls, snapshot, now: () => clock, wait: async (ms: number, signal: AbortSignal) => { signal.throwIfAborted(); clock += ms; } };
}
