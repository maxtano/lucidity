import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AircraftTelemetry } from '../aircraft/types';
import { aircraftFreshness, AircraftTelemetryDetails } from './AircraftPanel';

const telemetry = (): AircraftTelemetry => ({
  id: 'serial:/dev/cu.usbmodem11401/1/1',
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
});

describe('physical aircraft telemetry display', () => {
  it('shows a real source identity and leaves unreceived channels unknown', () => {
    const input = telemetry();
    const html = renderToStaticMarkup(<AircraftTelemetryDetails aircraft={input} now={100_500} />);
    expect(html).toContain('PHYSICAL AIRCRAFT');
    expect(html).toContain('System 1');
    expect(html).toContain('/ component 1');
    expect(html).toContain(input.id);
    expect(html).toContain('MAVLink 2');
    expect(html).toContain('Unsigned packets');
    expect(html).toContain('Heartbeat received');
    expect(html).toContain('Disarmed');
    expect(html).toContain('Stabilize');
    expect(html).toContain('Attitude unknown. No attitude message received.');
    expect(html).toContain('WAITING FOR ATTITUDE');
    expect(html).toContain('NO SIMULATED POSE');
    expect(html).not.toContain('LIVE SENSOR ATTITUDE');
    expect(html).not.toContain('0.0°');
    expect((html.match(/Not received/g) ?? []).length).toBe(4);
    expect(html).toContain('<dt>Voltage</dt><dd>Unknown</dd>');
    expect(html).toContain('<dt>GPS coordinates</dt><dd>Unknown</dd>');
    expect(html).not.toContain('<button');
    expect(input).toEqual(telemetry());
  });

  it('uses measured roll/pitch/yaw and marks each channel stale independently', () => {
    const input = telemetry();
    input.attitude = { receivedAt: 99_000, rollDeg: -14.25, pitchDeg: 7.5, yawDeg: 181.2 };
    input.gps = {
      receivedAt: 96_000,
      fix: '3D fix',
      fixType: 3,
      satellites: 11,
      latitude: 40.71234,
      longitude: -74.12345,
      hdop: 1.2,
    };
    const html = renderToStaticMarkup(<AircraftTelemetryDetails aircraft={input} now={101_000} />);
    expect(html).toContain('Measured roll -14.3 degrees, pitch 7.5 degrees');
    expect(html).toContain('rotate(14.25 160 122)');
    expect(html).toContain('translate(0 12)');
    expect(html).toContain('181.2°');
    expect(html).toContain('LIVE SENSOR ATTITUDE');
    expect(html).toContain('2s ago');
    expect(html).toContain('Stale · 5s ago');
    expect(html).toContain('3D fix');
    expect(html).toContain('40.712340, -74.123450');
    expect(html).toContain('Heartbeat received');
    expect(html).not.toContain('Heartbeat lost / stale');
  });

  it('retains historical values with a prominent lost heartbeat and last-attitude label', () => {
    const input = telemetry();
    input.heartbeat.armed = true;
    input.attitude = { receivedAt: 100_000, rollDeg: 11.5, pitchDeg: -9, yawDeg: 20 };
    const html = renderToStaticMarkup(<AircraftTelemetryDetails aircraft={input} now={107_000} />);
    expect(html).toContain('Heartbeat lost / stale');
    expect(html).toContain('Last arming state');
    expect(html).toContain('Armed');
    expect(html).toContain('LAST RECEIVED ATTITUDE');
    expect(html).toContain('Stale · 7s ago');
    expect(html).toContain('11.5°');
    expect(html).not.toContain('LIVE SENSOR ATTITUDE');
  });

  it('does not invent battery values or use position as a fallback for a missing GPS message', () => {
    const input = telemetry();
    input.position = {
      receivedAt: 100_000,
      latitude: 0,
      longitude: 0,
      relativeAltitudeM: 0,
      altitudeMslM: 120.4,
      groundSpeedMps: 0,
    };
    input.battery = {
      receivedAt: 100_000,
      voltageV: 16.42,
      currentA: null,
      remainingPercent: null,
    };
    const html = renderToStaticMarkup(<AircraftTelemetryDetails aircraft={input} now={100_200} />);
    expect(html).toContain('<dt>GPS coordinates</dt><dd>Unknown</dd>');
    expect(html).toContain('<dt>Position coordinates</dt><dd>0.000000, 0.000000</dd>');
    expect(html).toContain('<dt>Altitude above home · estimate</dt><dd>0.0 m</dd>');
    expect(html).toContain('<dt>Voltage</dt><dd>16.42 V</dd>');
    expect(html).toContain('<dt>Current</dt><dd>Unknown</dd>');
    expect(html).toContain('<dt>Remaining</dt><dd>Unknown</dd>');
    expect(html).not.toContain('100%');
  });

  it('marks signed packets unverified and escapes received status text', () => {
    const input = telemetry();
    input.signing = 'unverified';
    input.messages = [{ receivedAt: 100_000, severity: 4, text: '<script>ARM</script>' }];
    const html = renderToStaticMarkup(<AircraftTelemetryDetails aircraft={input} now={100_200} />);
    expect(html).toContain('Signature unverified');
    expect(html).toContain('&lt;script&gt;ARM&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(input.messages[0].text).toBe('<script>ARM</script>');
  });
});

describe('telemetry freshness', () => {
  it('turns stale at the five-second boundary and keeps unknown timestamps distinct', () => {
    expect(aircraftFreshness(1000, 5999)).toEqual({ stale: false, label: '4s ago' });
    expect(aircraftFreshness(1000, 6000)).toEqual({ stale: true, label: '5s ago' });
    expect(aircraftFreshness(null, 6000)).toEqual({ stale: true, label: 'Not received' });
    expect(aircraftFreshness(undefined, 6000)).toEqual({ stale: true, label: 'Not received' });
    expect(aircraftFreshness(Number.NaN, 6000)).toEqual({ stale: true, label: 'Not received' });
    expect(aircraftFreshness(6000, 6000)).toEqual({ stale: false, label: 'Just received' });
  });
});
