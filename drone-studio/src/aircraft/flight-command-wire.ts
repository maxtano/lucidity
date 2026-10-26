import { MavLinkProtocolV2, common } from 'node-mavlink';
import { GROUND_COMPONENT_ID, GROUND_SYSTEM_ID } from './read-requests';

/** The physical mission runner can issue only these four fixed commands. */
export type FlightCommandCode = 224 | 400 | 300 | 176;

export interface FlightCommand {
  command: FlightCommandCode;
  targetSystem: number;
  targetComponent: number;
  params: readonly [number, number, number, number, number, number, number];
}

const ALLOWED = new Map<FlightCommandCode, readonly number[]>([
  [224, [1, 0, 0, 0, 0, 0, 0]], // DO_SET_MISSION_CURRENT: first executable item while disarmed
  [400, [1, 0, 0, 0, 0, 0, 0]], // normal ARM; no force-arming magic value
  [300, [0, 0, 0, 0, 0, 0, 0]], // MISSION_START, whole reviewed mission
  [176, [1, 9, 0, 0, 0, 0, 0]], // DO_SET_MODE -> LAND, never in-air DISARM
]);

export function flightCommandFrame(value: FlightCommand, sequence: number): Buffer {
  const allowed = ALLOWED.get(value.command);
  if (!allowed || !allowed.every((param, index) => value.params[index] === param) ||
      value.params.length !== 7 ||
      !Number.isInteger(value.targetSystem) || value.targetSystem < 1 || value.targetSystem > 253 ||
      !Number.isInteger(value.targetComponent) || value.targetComponent < 1 || value.targetComponent > 255 ||
      !Number.isInteger(sequence) || sequence < 0 || sequence > 255)
    throw new Error('Physical mission command is not on the fixed allowlist.');
  const frame = new common.CommandLong();
  frame.targetSystem = value.targetSystem;
  frame.targetComponent = value.targetComponent;
  frame.command = value.command;
  frame.confirmation = 0;
  [frame._param1, frame._param2, frame._param3, frame._param4,
    frame._param5, frame._param6, frame._param7] = [...value.params];
  return new MavLinkProtocolV2(GROUND_SYSTEM_ID, GROUND_COMPONENT_ID).serialize(frame, sequence);
}
