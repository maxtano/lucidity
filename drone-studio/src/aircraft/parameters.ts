import { common, MavLinkProtocolV2 } from 'node-mavlink';
import { GROUND_COMPONENT_ID, GROUND_SYSTEM_ID } from './read-requests';

export interface AircraftParameter {
  name: string;
  value: number;
  type: number;
  index: number;
  count: number;
  receivedAt: number;
  revision: number;
}
export interface ParameterSnapshot {
  aircraftId: string;
  startedAt: number | null;
  state: 'idle' | 'reading' | 'complete' | 'partial';
  expected: number;
  received: number;
  parameters: AircraftParameter[];
}
export const parameterName = (name: string) => /^[A-Z][A-Z0-9_]{0,15}$/.test(name);
export function validateParameterValue(type: number, value: number) {
  const ranges: Record<number, [number, number]> = {
    2: [-128, 127],
    4: [-32768, 32767],
    6: [-2147483648, 2147483647],
  };
  if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
    throw new Error('Enter a finite 32-bit value.');
  if (type === 9) return Math.fround(value);
  const range = ranges[type];
  if (
    !range ||
    !Number.isInteger(value) ||
    value < range[0] ||
    value > range[1] ||
    Math.fround(value) !== value
  )
    throw new Error('This value cannot be represented by the reported ArduPilot parameter type.');
  return value;
}
export function parameterFrame(
  system: number,
  component: number,
  sequence: number,
  operation: 'list' | 'read' | 'set',
  name = '',
  value = 0,
  type = 9
) {
  if (
    ![system, component].every((n) => Number.isInteger(n) && n > 0 && n < 256) ||
    system === GROUND_SYSTEM_ID
  )
    throw new Error('Invalid parameter target.');
  if (operation !== 'list' && !parameterName(name)) throw new Error('Invalid parameter name.');
  const request =
    operation === 'list'
      ? new common.ParamRequestList()
      : operation === 'read'
        ? new common.ParamRequestRead()
        : new common.ParamSet();
  request.targetSystem = system;
  request.targetComponent = component;
  if (request instanceof common.ParamRequestRead) {
    request.paramId = name;
    request.paramIndex = -1;
  }
  if (request instanceof common.ParamSet) {
    request.paramId = name;
    request.paramValue = validateParameterValue(type, value);
    request.paramType = type;
  }
  return new MavLinkProtocolV2(GROUND_SYSTEM_ID, GROUND_COMPONENT_ID).serialize(
    request,
    sequence % 256
  );
}
export function summarizeParameters(
  aircraftId: string,
  parameters: AircraftParameter[],
  startedAt: number | null,
  now: number
): ParameterSnapshot {
  const received = startedAt == null ? [] : parameters.filter((p) => p.receivedAt >= startedAt);
  const expected = received.length
    ? received.reduce((last, p) => (p.receivedAt >= last.receivedAt ? p : last)).count
    : 0;
  const indexes = new Set(
    received
      .filter((p) => p.count === expected && p.index >= 0 && p.index < expected)
      .map((p) => p.index)
  );
  const complete = expected > 0 && indexes.size === expected;
  return {
    aircraftId,
    startedAt,
    state:
      startedAt == null
        ? 'idle'
        : complete
          ? 'complete'
          : now - startedAt < 30000
            ? 'reading'
            : 'partial',
    expected,
    received: indexes.size,
    parameters,
  };
}
