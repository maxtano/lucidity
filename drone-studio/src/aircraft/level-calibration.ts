import { common, MavLinkProtocolV2 } from 'node-mavlink';
import { GROUND_COMPONENT_ID, GROUND_SYSTEM_ID } from './read-requests';

export type LevelCalibrationReading = {
  /** Raw ArduPilot trim parameters, in radians. Null means no fresh readback. */
  AHRS_TRIM_X: number | null;
  AHRS_TRIM_Y: number | null;
  attitude: { rollDeg: number; pitchDeg: number; receivedAt: number } | null;
};

export type LevelCalibrationResult = {
  aircraftId: string;
  state: 'accepted' | 'rejected' | 'unconfirmed';
  ack: { result: number; receivedAt: number } | null;
  before: LevelCalibrationReading;
  after: LevelCalibrationReading;
  message: string;
};

/** ArduCopter board-level trim calibration. No caller-supplied command or MAVLink parameters. */
export function levelCalibrationFrame(systemId: number, componentId: number, sequence: number): Buffer {
  if (![systemId, componentId].every(id => Number.isInteger(id) && id > 0 && id < 256) ||
      systemId === GROUND_SYSTEM_ID || componentId !== 1)
    throw new Error('Invalid level-calibration target.');
  const command = new common.CommandLong();
  command.targetSystem = systemId;
  command.targetComponent = componentId;
  command.command = 241; // MAV_CMD_PREFLIGHT_CALIBRATION
  command.confirmation = 0;
  command._param1 = command._param2 = command._param3 = command._param4 = 0;
  command._param5 = 2; // ArduCopter board-level trim (not accelerometer calibration).
  command._param6 = command._param7 = 0;
  return new MavLinkProtocolV2(GROUND_SYSTEM_ID, GROUND_COMPONENT_ID).serialize(command, sequence % 256);
}

/** One ATTITUDE sample request for an independent post-command observation. */
export function levelAttitudeRequestFrame(systemId: number, componentId: number, sequence: number): Buffer {
  if (![systemId, componentId].every(id => Number.isInteger(id) && id > 0 && id < 256) ||
      systemId === GROUND_SYSTEM_ID || componentId !== 1)
    throw new Error('Invalid attitude-request target.');
  const command = new common.CommandLong();
  command.targetSystem = systemId;
  command.targetComponent = componentId;
  command.command = 512; // MAV_CMD_REQUEST_MESSAGE
  command.confirmation = 0;
  command._param1 = 30; // ATTITUDE
  command._param2 = command._param3 = command._param4 = command._param5 = command._param6 = command._param7 = 0;
  return new MavLinkProtocolV2(GROUND_SYSTEM_ID, GROUND_COMPONENT_ID).serialize(command, sequence % 256);
}
