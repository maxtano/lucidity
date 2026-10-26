import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AircraftSnapshot, AircraftTelemetry } from '../aircraft/types';
import { LevelCalibration, levelCalibrationBlockReason, requestLevelAttitude } from './LevelCalibration';
import type { AircraftContext } from './useAircraft';

const now = 100_100;
const checks = { propsRemoved: true, batteryDisconnected: true, physicallyLevel: true, still: true, directUsb: true };
const aircraft = (): AircraftTelemetry => ({
  id: 'serial:/dev/cu.usbmodemFC/1/1', systemId: 1, componentId: 1,
  protocolVersion: 2, signing: 'unsigned',
  heartbeat: { receivedAt: 100_000, armed: false, mode: 'Stabilize', customMode: 0,
    systemStatus: 'Standby', autopilot: 3, vehicleType: 2 },
  attitude: { receivedAt: 100_000, rollDeg: 3.1, pitchDeg: -0.4, yawDeg: 0 },
  gps: null, position: null, battery: null, messages: [],
});
const snapshot = (): AircraftSnapshot => ({
  now, link: { state: 'listening', path: '/dev/cu.usbmodemFC', baudRate: 115200,
    connectedAt: 99_000, error: null, bytesReceived: 100, packetsReceived: 10,
    invalidFrames: 0, lastPacketAt: 100_000, transmittedBytes: 0 },
  aircraft: [aircraft()],
});
const block = (state: AircraftSnapshot, confirmed = checks, at = now) =>
  levelCalibrationBlockReason({ snapshot: state, aircraft: state.aircraft[0], now: at,
    serviceUnavailable: false, checks: confirmed });

describe('level calibration UI readiness', () => {
  it('requires fresh disarmed ArduCopter telemetry and every bench confirmation', () => {
    expect(block(snapshot())).toBeNull();
    expect(block(snapshot(), { ...checks, directUsb: false })).toContain('direct flight controller USB');
    expect(block(snapshot(), { ...checks, physicallyLevel: false })).toContain('physically level');
    const armed = snapshot(); armed.aircraft[0].heartbeat.armed = true;
    expect(block(armed)).toContain('Disarm');
    const staleAttitude = snapshot(); staleAttitude.aircraft[0].attitude!.receivedAt = 95_100;
    expect(block(staleAttitude)).toContain('fresh roll and pitch');
    const powered = snapshot(); powered.aircraft[0].battery = { receivedAt: 100_000, voltageV: 15.9, currentA: null, remainingPercent: null };
    expect(block(powered)).toContain('Unplug the flight battery');
    expect(block(snapshot(), checks, 105_000)).toContain('fresh aircraft heartbeat');
    const radio = snapshot(); radio.aircraft[0].heartbeat.vehicleType = 6;
    expect(block(radio)).toContain('ArduCopter');
    const many = snapshot(); many.aircraft.push({ ...aircraft(), id: 'another' });
    expect(block(many)).toContain('Only one aircraft');
  });

  it('shows measured angles but leaves the command disabled until checks are complete', () => {
    const state = snapshot();
    const device: AircraftContext = {
      snapshot: state, aircraft: state.aircraft[0], now, live: true,
      error: '', selectedId: state.aircraft[0].id, setSelectedId: () => {},
    };
    const html = renderToStaticMarkup(<LevelCalibration device={device} />);
    expect(html).toContain('Live roll');
    expect(html).toContain('3.1°');
    expect(html).toContain('-0.4°');
    expect(html).toContain('Direct FC USB unconfirmed');
    expect(html).toMatch(/disabled=""[^>]*>.*Calibrate level/s);
    expect(html).toContain('does not confirm that left drift is fixed');
  });

  it('offers an attitude request with a fresh heartbeat and reports the endpoint result', async () => {
    const state = snapshot();
    state.aircraft[0].attitude = null;
    const device: AircraftContext = {
      snapshot: state, aircraft: state.aircraft[0], now, live: true,
      error: '', selectedId: state.aircraft[0].id, setSelectedId: () => {},
    };
    const html = renderToStaticMarkup(<LevelCalibration device={device} />);
    const requestButton = html.match(/<button[^>]*>.*?Request attitude<\/button>/s)?.[0];
    expect(requestButton).toBeDefined();
    expect(requestButton).not.toContain('disabled');
    expect(html).toContain('Waiting for fresh roll and pitch telemetry');
    expect(html).toContain('Wait for fresh roll and pitch readings.');

    const calls: { path: string; body: unknown }[] = [];
    const response = snapshot();
    response.request = { state: 'partial', aircraftId: state.aircraft[0].id,
      startedAt: 99_900, message: 'Some reporting groups are missing.' };
    const received = await requestLevelAttitude(state.aircraft[0].id, async <T,>(path: string, body?: unknown) => {
      calls.push({ path, body });
      return response as T;
    });
    expect(calls).toEqual([{ path: 'aircraft/request-telemetry', body: { aircraftId: state.aircraft[0].id } }]);
    expect(received).toEqual({ received: true, message: 'Fresh roll and pitch received. Live readings will update above.' });

    response.request = { ...response.request, state: 'failed', message: 'No matching acknowledgment arrived.' };
    const failed = await requestLevelAttitude(state.aircraft[0].id, async <T,>() => response as T);
    expect(failed).toEqual({ received: false, message: 'No matching acknowledgment arrived.' });
  });
});
