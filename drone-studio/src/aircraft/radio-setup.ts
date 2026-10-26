import type { AircraftTelemetry } from './types';
import type { AircraftParameter } from './parameters';

export const RC_STALE_MS = 3000;

/** These are the aircraft's reported assignments, never assumptions about EdgeTX mixes. */
export function radioAssignments(parameters: AircraftParameter[]) {
  const value = (name: string) => parameters.find((p) => p.name === name)?.value;
  const channel = (name: string, fallback: number) => {
    const raw = value(name);
    return raw !== undefined && Number.isInteger(raw) && raw >= 1 && raw <= 18 ? raw : fallback;
  };
  return {
    roll: channel('RCMAP_ROLL', 1),
    pitch: channel('RCMAP_PITCH', 2),
    throttle: channel('RCMAP_THROTTLE', 3),
    yaw: channel('RCMAP_YAW', 4),
    mode: value('FLTMODE_CH') === 0 ? null : channel('FLTMODE_CH', 5),
    stop: (() => {
      const option = parameters.find((p) => /^RC(?:[1-9]|1[0-8])_OPTION$/.test(p.name) && p.value === 31);
      return option ? Number(option.name.slice(2, option.name.indexOf('_'))) : null;
    })(),
    reported: ['RCMAP_ROLL', 'RCMAP_PITCH', 'RCMAP_THROTTLE', 'RCMAP_YAW', 'FLTMODE_CH']
      .every((name) => value(name) !== undefined),
  };
}

export function receiverIsFresh(aircraft: AircraftTelemetry | undefined, now: number) {
  const at = aircraft?.receiver?.receivedAt;
  return at !== undefined && now >= at && now - at < RC_STALE_MS;
}

export function channelValue(aircraft: AircraftTelemetry | undefined, channel: number | null) {
  if (!channel || channel < 1 || channel > 18) return null;
  const value = aircraft?.receiver?.channels[channel - 1];
  return typeof value === 'number' && Number.isFinite(value) && value >= 800 && value <= 2200
    ? value
    : null;
}

export function channelPercent(value: number | null) {
  return value === null ? 0 : Math.max(0, Math.min(100, ((value - 1000) / 1000) * 100));
}

/** ArduCopter FLTMODE1..6 pulse-width boundaries, in microseconds. */
export function flightModeSlot(pwm: number | null): number | null {
  if (pwm === null || !Number.isFinite(pwm) || pwm < 800 || pwm > 2200) return null;
  if (pwm <= 1230) return 1;
  if (pwm <= 1360) return 2;
  if (pwm <= 1490) return 3;
  if (pwm <= 1620) return 4;
  if (pwm <= 1749) return 5;
  return 6;
}

const COPTER_MODE_NAMES: Record<number, string> = {
  0: 'Stabilize', 1: 'Acro', 2: 'AltHold', 3: 'AUTO', 4: 'Guided',
  5: 'Loiter', 6: 'RTL', 7: 'Circle', 9: 'Land', 11: 'Drift',
  13: 'Sport', 14: 'Flip', 15: 'AutoTune', 16: 'PosHold', 17: 'Brake',
  18: 'Throw', 19: 'Avoid ADS-B', 20: 'Guided NoGPS', 21: 'Smart RTL',
  22: 'FlowHold', 23: 'Follow', 24: 'ZigZag', 25: 'SystemID',
  26: 'Heli Autorotate', 27: 'Auto RTL', 28: 'Turtle',
};

export function configuredFlightModes(parameters: AircraftParameter[]) {
  return Array.from({ length: 6 }, (_, index) => {
    const slot = index + 1;
    const value = parameters.find((parameter) => parameter.name === `FLTMODE${slot}`)?.value;
    const code = value !== undefined && Number.isInteger(value) && Number.isFinite(value)
      ? value : null;
    return {
      slot,
      code,
      name: code !== null ? COPTER_MODE_NAMES[code] ?? `Mode ${code}` : 'Not read',
    };
  });
}
