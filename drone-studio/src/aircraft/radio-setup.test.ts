import { describe, expect, it } from 'vitest';
import {
  channelPercent, channelValue, configuredFlightModes, flightModeSlot, radioAssignments,
  receiverIsFresh,
} from './radio-setup';
import type { AircraftParameter } from './parameters';
import type { AircraftTelemetry } from './types';

const parameter = (name: string, value: number) => ({ name, value }) as AircraftParameter;
const receiver = { receivedAt: 1000, channels: [1500, 1700, 1000, 1400, 1815, 1900], rssi: 88 };
const aircraft = { receiver } as AircraftTelemetry;

describe('aircraft-reported radio configuration', () => {
  it('uses standard provisional mapping, then honors ArduPilot RCMAP and mode channel', () => {
    expect(radioAssignments([])).toMatchObject({ roll: 1, pitch: 2, throttle: 3, yaw: 4, mode: 5, reported: false });
    expect(radioAssignments([
      parameter('RCMAP_ROLL', 4), parameter('RCMAP_PITCH', 3), parameter('RCMAP_THROTTLE', 2),
      parameter('RCMAP_YAW', 1), parameter('FLTMODE_CH', 8), parameter('RC6_OPTION', 31),
    ])).toMatchObject({ roll: 4, pitch: 3, throttle: 2, yaw: 1, mode: 8, stop: 6, reported: true });
    expect(radioAssignments([parameter('FLTMODE_CH', 0)]).mode).toBeNull();
  });
  it('does not present stale or invalid channel values as live input', () => {
    expect(receiverIsFresh(aircraft, 3999)).toBe(true);
    expect(receiverIsFresh(aircraft, 4000)).toBe(false);
    expect(channelValue(aircraft, 2)).toBe(1700);
    expect(channelValue(aircraft, 8)).toBeNull();
    expect(channelValue(aircraft, null)).toBeNull();
    expect(channelPercent(1500)).toBe(50);
    expect(channelPercent(null)).toBe(0);
  });
  it('maps exact ArduCopter flight-mode boundaries and rejects missing PWM', () => {
    expect([1000, 1230, 1231, 1360, 1361, 1490, 1491, 1620, 1621, 1749, 1750, 2000]
      .map(flightModeSlot)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
    expect(flightModeSlot(null)).toBeNull();
    expect(flightModeSlot(Number.NaN)).toBeNull();
    expect(flightModeSlot(0)).toBeNull();
  });
  it('shows reported modes only, including unknown numeric modes', () => {
    expect(configuredFlightModes([
      parameter('FLTMODE1', 0), parameter('FLTMODE4', 5),
      parameter('FLTMODE6', 3), parameter('FLTMODE2', 99),
    ])).toEqual([
      { slot: 1, code: 0, name: 'Stabilize' },
      { slot: 2, code: 99, name: 'Mode 99' },
      { slot: 3, code: null, name: 'Not read' },
      { slot: 4, code: 5, name: 'Loiter' },
      { slot: 5, code: null, name: 'Not read' },
      { slot: 6, code: 3, name: 'AUTO' },
    ]);
  });
});
