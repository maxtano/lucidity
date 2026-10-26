import { describe, expect, it } from 'vitest';
import { MavLinkProtocolV2, common } from 'node-mavlink';
import { decodeMissionPacket, missionFrame } from './mission-wire';
import type { MissionItem, MissionOutbound } from './mission-protocol';

const item: MissionItem = {
  seq: 2, frame: 6, command: 19, current: 0, autocontinue: 1,
  param1: 5, param2: 0, param3: 0, param4: 0, x: 0, y: 0, z: 2.5,
};

describe('MAVLink 2 mission wire fixture, no hardware', () => {
  it.each([
    [{ kind: 'requestList' }, common.MissionRequestList.MSG_ID, common.MissionRequestList],
    [{ kind: 'requestInt', seq: 2 }, common.MissionRequestInt.MSG_ID, common.MissionRequestInt],
    [{ kind: 'count', count: 4 }, common.MissionCount.MSG_ID, common.MissionCount],
    [{ kind: 'itemInt', item }, common.MissionItemInt.MSG_ID, common.MissionItemInt],
    [{ kind: 'ack', result: 0 }, common.MissionAck.MSG_ID, common.MissionAck],
  ] as const)('encodes %s with exact system, component, and mission type', (outbound, id, messageClass) => {
    const frame = missionFrame(1, 1, 42, outbound as MissionOutbound);
    const protocol = new MavLinkProtocolV2();
    const header = protocol.header(frame);
    expect(header).toMatchObject({ msgid: id, sysid: 254, compid: 190, seq: 42 });
    const decoded = protocol.data(protocol.payload(frame), messageClass);
    expect(decoded).toMatchObject({ targetSystem: 1, targetComponent: 1, missionType: 0 });
    if (outbound.kind === 'requestInt') expect((decoded as InstanceType<typeof common.MissionRequestInt>).seq).toBe(2);
    if (outbound.kind === 'count') expect((decoded as InstanceType<typeof common.MissionCount>).count).toBe(4);
    if (outbound.kind === 'itemInt') expect(decoded).toMatchObject(item);
    if (outbound.kind === 'ack') expect((decoded as InstanceType<typeof common.MissionAck>).type).toBe(0);
  });

  it('decodes aircraft-origin mission traffic and keeps source/target identity explicit', () => {
    const inputs = [
      [common.MissionCount.MSG_ID, { count: 4 }, 'count'],
      [common.MissionRequest.MSG_ID, { seq: 2 }, 'requestInt'],
      [common.MissionRequestInt.MSG_ID, { seq: 2 }, 'requestInt'],
      [common.MissionItemInt.MSG_ID, item, 'itemInt'],
      [common.MissionAck.MSG_ID, { type: 0 }, 'ack'],
    ] as const;
    for (const [id, fields, kind] of inputs) {
      const packet = decodeMissionPacket(id, {
        targetSystem: 254, targetComponent: 190, missionType: 0, ...fields,
      }, 1, 1, 7);
      expect(packet).toMatchObject({
        id: 7, kind, sourceSystem: 1, sourceComponent: 1,
        targetSystem: 254, targetComponent: 190, missionType: 0,
      });
    }
  });

  it('rejects invalid target IDs before serializing', () => {
    expect(() => missionFrame(254, 1, 0, { kind: 'requestList' })).toThrow(/target/i);
    expect(() => missionFrame(1, 0, 0, { kind: 'requestList' })).toThrow(/target/i);
  });
});
