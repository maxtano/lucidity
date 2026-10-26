import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AircraftSnapshot, AircraftTelemetry } from '../aircraft/types';
import { MotorBenchPanel, motorPulseBlockReason, motorStopAvailable } from './MotorBenchPanel';

const aircraft = (): AircraftTelemetry => ({
  id: 'serial:bench/1/1',
  systemId: 1,
  componentId: 1,
  protocolVersion: 2,
  signing: 'unsigned',
  heartbeat: {
    receivedAt: 100_000,
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
  version: { receivedAt: 100_000, flightVersion: '4.7.1', releaseType: 255 },
});
const snapshot = (): AircraftSnapshot => ({
  now: 100_100,
  link: {
    state: 'listening',
    path: 'bench',
    baudRate: 115200,
    connectedAt: 99_000,
    error: null,
    bytesReceived: 1000,
    packetsReceived: 20,
    invalidFrames: 0,
    lastPacketAt: 100_000,
    transmittedBytes: 0,
  },
  aircraft: [aircraft()],
  request: {
    state: 'verified',
    aircraftId: 'serial:bench/1/1',
    startedAt: 99_900,
    message: 'Firmware identified',
  },
});
const reason = (
  state: AircraftSnapshot,
  options: { now?: number; busy?: boolean; serviceUnavailable?: boolean } = {}
) =>
  motorPulseBlockReason({
    snapshot: state,
    aircraft: state.aircraft[0],
    now: 100_100,
    busy: false,
    serviceUnavailable: false,
    ...options,
  });
const motorResult = (
  state: AircraftSnapshot,
  resultState: NonNullable<AircraftSnapshot['motorTest']>['state'] = 'accepted'
) => {
  state.motorTest = {
    state: resultState,
    aircraftId: state.aircraft[0].id,
    motor: 1,
    startedAt: 100_000,
    availableAt: 105_000,
    message: 'Motor command received.',
  };
  return state;
};

describe('motor bench command eligibility', () => {
  it('accepts the identified fresh disarmed quad without requiring GPS or battery telemetry', () => {
    expect(reason(snapshot())).toBeNull();
  });

  it('blocks old heartbeat, armed state, unsupported source and multiple aircraft', () => {
    const stale = snapshot();
    expect(reason(stale, { now: 105_000 })).toContain('fresh');
    expect(reason(stale, { now: 99_999 })).toContain('fresh');
    const armed = snapshot();
    armed.aircraft[0].heartbeat.armed = true;
    expect(reason(armed)).toContain('disarmed');
    for (const change of [
      (item: AircraftTelemetry) => {
        item.componentId = 2;
      },
      (item: AircraftTelemetry) => {
        item.heartbeat.autopilot = 12;
      },
      (item: AircraftTelemetry) => {
        item.heartbeat.vehicleType = 1;
      },
    ]) {
      const state = snapshot();
      change(state.aircraft[0]);
      expect(reason(state)).toContain('ArduPilot quadcopter');
    }
    const signed = snapshot();
    signed.aircraft[0].signing = 'unverified';
    expect(reason(signed)).toContain('signed');
    const multiple = snapshot();
    multiple.aircraft.push({ ...aircraft(), id: 'other' });
    expect(reason(multiple)).toContain('exactly one');
  });

  it('requires a verified firmware identification for this aircraft', () => {
    const absent = snapshot();
    delete absent.request;
    expect(reason(absent)).toContain('Request telemetry');
    const other = snapshot();
    other.request!.aircraftId = 'other';
    expect(reason(other)).toContain('Request telemetry');
    const failed = snapshot();
    failed.request!.state = 'failed';
    expect(reason(failed)).toContain('Request telemetry');
    const wrongFirmware = snapshot();
    wrongFirmware.aircraft[0].version!.flightVersion = '4.6.0';
    expect(reason(wrongFirmware)).toContain('4.7.1');
    const partial = snapshot();
    partial.request!.state = 'partial';
    expect(reason(partial)).toBeNull();
    const priorConnection = snapshot();
    priorConnection.link.connectedAt = 100_000;
    expect(reason(priorConnection)).toContain('Request telemetry');
  });

  it('blocks unavailable links, pending commands and the server cooldown', () => {
    expect(reason(snapshot(), { serviceUnavailable: true })).toContain('service');
    const disconnected = snapshot();
    disconnected.link.state = 'disconnected';
    expect(reason(disconnected)).toContain('serial link');
    expect(reason(snapshot(), { busy: true })).toContain('current command');
    const pendingTelemetry = snapshot();
    pendingTelemetry.request!.state = 'pending';
    expect(reason(pendingTelemetry)).toContain('current command');
    expect(reason(motorResult(snapshot(), 'pending'))).toContain('current command');
    expect(reason(motorResult(snapshot()))).toContain('Cooldown');
    const cooled = motorResult(snapshot());
    cooled.aircraft[0].heartbeat.receivedAt = 105_000;
    expect(reason(cooled, { now: 105_000 })).toBeNull();
  });

  it('keeps stop available for our motor test when telemetry is stale or armed', () => {
    const state = motorResult(snapshot());
    state.aircraft[0].heartbeat.armed = true;
    state.aircraft[0].heartbeat.receivedAt = 0;
    expect(motorStopAvailable(state, state.aircraft[0], false)).toBe(true);
    expect(motorStopAvailable(snapshot(), aircraft(), true)).toBe(true);
    expect(motorStopAvailable(snapshot(), aircraft(), false)).toBe(false);
    expect(motorStopAvailable(state, { ...aircraft(), id: 'other' }, false)).toBe(false);
    state.link.state = 'disconnected';
    expect(motorStopAvailable(state, state.aircraft[0], true)).toBe(false);
  });
});

describe('motor bench result display', () => {
  const render = (state: AircraftSnapshot) =>
    renderToStaticMarkup(
      <MotorBenchPanel
        snapshot={state}
        aircraft={state.aircraft[0]}
        now={100_100}
        busy={false}
        pulsePending={false}
        stopPending={false}
        serviceUnavailable={false}
        onPulse={() => {
          throw new Error('Rendering cannot send a command');
        }}
        onStop={() => {
          throw new Error('Rendering cannot stop hardware');
        }}
      />
    );

  it('requires opening and explicitly assigning a sample before it can run', () => {
    const html = render(snapshot());
    expect(html).toContain('Open bench sample');
    expect(html).toContain('Assign Drone 1 to System 1 / Component 1');
    expect(html).toContain('Open the bench sample to begin.');
    expect(html).toContain('Run bench sample · 1s');
    expect(html.match(/type="checkbox" disabled=""/g)).toHaveLength(3);
    expect(html).not.toContain('checked=""');
    expect(html).toContain('not your show’s flight trajectory');
  });

  it('separates ACK from observed movement and does not claim stopped after stop request', () => {
    const html = render(motorResult(snapshot()));
    expect(html).toContain('Command accepted · rotation unconfirmed');
    expect(html).toContain('Motor A ·');
    expect(html).toContain('Your observation · separate from controller acknowledgement');
    expect(html).toContain('Motor moved and stopped');
    expect(html).toContain('No movement');
    expect(html).not.toContain('Operator observed:');
    expect(html).toContain('Wait for the pulse and cooldown to finish');
    expect(html).toContain('firmware briefly enables motor output');
    const stopped = render(motorResult(snapshot(), 'stop-requested'));
    expect(stopped).toContain('Stop requested · verify the motors');
    expect(stopped).toContain('disconnect battery power');
  });
});
