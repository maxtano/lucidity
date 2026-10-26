import { MavLinkProtocolV2, common } from 'node-mavlink';
import { GROUND_COMPONENT_ID, GROUND_SYSTEM_ID } from './read-requests';
import type { MissionOutbound, MissionPacket } from './mission-protocol';

export function missionFrame(
  targetSystem: number,
  targetComponent: number,
  sequence: number,
  outbound: MissionOutbound,
): Buffer {
  if (!Number.isInteger(targetSystem) || !Number.isInteger(targetComponent) ||
      targetSystem < 1 || targetSystem > 253 || targetComponent < 1 || targetComponent > 255)
    throw new Error('Invalid mission target.');
  const protocol = new MavLinkProtocolV2(GROUND_SYSTEM_ID, GROUND_COMPONENT_ID);
  let message: InstanceType<typeof common.MissionRequestList> | InstanceType<typeof common.MissionRequestInt> |
    InstanceType<typeof common.MissionCount> | InstanceType<typeof common.MissionItemInt> | InstanceType<typeof common.MissionAck>;
  switch (outbound.kind) {
    case 'requestList': message = new common.MissionRequestList(); break;
    case 'requestInt': {
      const value = new common.MissionRequestInt();
      value.seq = outbound.seq;
      message = value;
      break;
    }
    case 'count': {
      const value = new common.MissionCount();
      value.count = outbound.count;
      message = value;
      break;
    }
    case 'itemInt': {
      const item = outbound.item;
      const value = new common.MissionItemInt();
      value.seq = item.seq;
      value.frame = item.frame;
      value.command = item.command;
      value.current = item.current;
      value.autocontinue = item.autocontinue;
      value.param1 = item.param1;
      value.param2 = item.param2;
      value.param3 = item.param3;
      value.param4 = item.param4;
      value.x = item.x;
      value.y = item.y;
      value.z = item.z;
      message = value;
      break;
    }
    case 'ack': {
      const value = new common.MissionAck();
      value.type = outbound.result;
      message = value;
      break;
    }
  }
  message.targetSystem = targetSystem;
  message.targetComponent = targetComponent;
  message.missionType = 0;
  return protocol.serialize(message, sequence % 256);
}

export function decodeMissionPacket(
  messageId: number,
  data: unknown,
  sourceSystem: number,
  sourceComponent: number,
  id: number,
): MissionPacket | null {
  const value = data as Record<string, number>;
  const base = {
    id, sourceSystem, sourceComponent,
    targetSystem: value.targetSystem ?? 0,
    targetComponent: value.targetComponent ?? 0,
    missionType: Number(value.missionType ?? 0),
  };
  if (messageId === common.MissionCount.MSG_ID)
    return { ...base, kind: 'count', count: value.count };
  // Copter 4.7 still requests uploaded items with legacy MISSION_REQUEST (40).
  // It accepts MISSION_ITEM_INT for that request, keeping location precision intact.
  if (messageId === common.MissionRequestInt.MSG_ID || messageId === common.MissionRequest.MSG_ID)
    return { ...base, kind: 'requestInt', seq: value.seq };
  if (messageId === common.MissionAck.MSG_ID)
    return { ...base, kind: 'ack', result: Number(value.type) };
  if (messageId === common.MissionItemInt.MSG_ID) {
    return {
      ...base, kind: 'itemInt', seq: value.seq,
      item: {
        seq: value.seq,
        frame: Number(value.frame),
        command: Number(value.command),
        current: value.current,
        autocontinue: value.autocontinue,
        param1: value.param1,
        param2: value.param2,
        param3: value.param3,
        param4: value.param4,
        x: value.x,
        y: value.y,
        z: value.z,
      },
    };
  }
  return null;
}
