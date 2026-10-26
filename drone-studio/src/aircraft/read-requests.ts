import { MavLinkProtocolV2, common } from 'node-mavlink';

export const GROUND_SYSTEM_ID = 254;
export const GROUND_COMPONENT_ID = 190;

/** Request only RC_CHANNELS for direct-USB radio setup; no battery or GPS dependency. */
export function radioRequestFrame(systemId: number, componentId: number, sequence = 0): Buffer {
  if (![systemId, componentId].every(id => Number.isInteger(id) && id > 0 && id < 256) || systemId === GROUND_SYSTEM_ID)
    throw new Error('Invalid radio diagnostic target.');
  const request = new common.CommandLong();
  request.targetSystem = systemId; request.targetComponent = componentId;
  request.command = 511; request.confirmation = 0;
  request._param1 = 65; request._param2 = 200000;
  request._param3 = request._param4 = request._param5 = request._param6 = request._param7 = 0;
  return new MavLinkProtocolV2(GROUND_SYSTEM_ID, GROUND_COMPONENT_ID).serialize(request, sequence % 256);
}

/** Only pre-arm checks and temporary receiver/power reporting; never arms or changes settings. */
export function diagnosticFrames(systemId: number, componentId: number, sequence = 0): Buffer[] {
  if (![systemId, componentId].every(id => Number.isInteger(id) && id > 0 && id < 256) || systemId === GROUND_SYSTEM_ID)
    throw new Error('Invalid diagnostic target.');
  return [[401, 0, 0], [511, 65, 1000000], [511, 125, 1000000]].map(([command, message, interval], i) => {
    const request = new common.CommandLong();
    request.targetSystem = systemId; request.targetComponent = componentId;
    request.command = command; request.confirmation = 0;
    request._param1 = message; request._param2 = interval;
    request._param3 = request._param4 = request._param5 = request._param6 = request._param7 = 0;
    return new MavLinkProtocolV2(GROUND_SYSTEM_ID, GROUND_COMPONENT_ID).serialize(request, (sequence + i) % 256);
  });
}

/** Fixed telemetry-reporting frames. No caller-supplied commands/parameters. */
export function telemetryRequestFrames(
  systemId: number,
  componentId: number,
  startSequence = 0
): Buffer[] {
  if (
    ![systemId, componentId].every((id) => Number.isInteger(id) && id > 0 && id < 256) ||
    systemId === GROUND_SYSTEM_ID
  )
    throw new Error('Invalid or conflicting aircraft identity.');
  const protocol = new MavLinkProtocolV2(GROUND_SYSTEM_ID, GROUND_COMPONENT_ID);
  // Modest per-link streams, followed by a one-shot version request for a distinct ACK.
  // These affect reporting rates only; no persistent SRx parameters are changed.
  const requests = [
    [511, 30, 200000], // ATTITUDE, 5 Hz
    [511, 33, 500000], // GLOBAL_POSITION_INT, 2 Hz
    [511, 24, 1000000], // GPS_RAW_INT, 1 Hz
    [511, 1, 1000000], // SYS_STATUS, 1 Hz
    [511, 147, 1000000], // BATTERY_STATUS, 1 Hz
    [511, 65, 200000], // RC_CHANNELS, 5 Hz for the receiver setup monitor
    [511, 193, 500000], // EKF_STATUS_REPORT, 2 Hz (ArduPilotMega)
    [511, 245, 500000], // EXTENDED_SYS_STATE, 2 Hz for landed state
    [511, 42, 500000], // MISSION_CURRENT, 2 Hz for mission progress
    // HOME_POSITION should be requested one-shot when needed;
    // MISSION_ITEM_REACHED is emitted as a waypoint event. Neither belongs
    // in periodic streams. https://mavlink.io/en/services/mission.html
    [512, 148, 0], // AUTOPILOT_VERSION, one shot
  ];
  return requests.map(([command, message, interval], index) => {
    const request = new common.CommandLong();
    request.targetSystem = systemId;
    request.targetComponent = componentId;
    request.command = command;
    request.confirmation = 0;
    request._param1 = message;
    request._param2 = interval;
    request._param3 = request._param4 = request._param5 = request._param6 = request._param7 = 0;
    return protocol.serialize(request, (startSequence + index) % 256);
  });
}
