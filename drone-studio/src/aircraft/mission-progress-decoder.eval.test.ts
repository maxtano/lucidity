import { describe, expect, it } from 'vitest';
import { MavLinkProtocolV2, common, minimal, x25crc, type MavLinkData } from 'node-mavlink';
import { AircraftDecoder } from './decoder';

function packet(message: MavLinkData, system = 1, component = 1) {
  return new MavLinkProtocolV2(system, component).serialize(message, 0);
}

function heartbeat(autopilot = 3, type = 2) {
  return Object.assign(new minimal.Heartbeat(), {
    autopilot,
    type,
    baseMode: 0,
    customMode: 0,
    systemStatus: 3,
    mavlinkVersion: 3,
  });
}

function missionCurrent(seq: number, total = 4) {
  return Object.assign(new common.MissionCurrent(), {
    seq,
    total,
    missionState: 1,
    missionMode: 1,
    missionId: 17,
  });
}

function reached(seq: number) {
  return Object.assign(new common.MissionItemReached(), { seq });
}

function landed(landedState: number) {
  return Object.assign(new common.ExtendedSysState(), { landedState, vtolState: 0 });
}

function ack(command: number, result = 0, targetSystem = 254, targetComponent = 190) {
  return Object.assign(new common.CommandAck(), {
    command,
    result,
    progress: 42,
    resultParam2: 7,
    targetSystem,
    targetComponent,
  });
}

describe('source-correlated mission progress and command results', () => {
  it('attaches progress and landed state only to a matching vehicle source', () => {
    const decoder = new AircraftDecoder('radio');
    decoder.push(packet(missionCurrent(3)), 1); // no vehicle heartbeat yet
    decoder.push(packet(reached(3)), 1);
    decoder.push(packet(landed(2)), 1);
    decoder.push(packet(heartbeat(8, 30), 255, 190), 2); // ground radio/GCS
    decoder.push(packet(heartbeat()), 3);
    decoder.push(packet(heartbeat(), 2), 3);
    decoder.push(packet(missionCurrent(3), 1, 200), 4);
    decoder.push(packet(reached(3), 1, 200), 4);
    decoder.push(packet(landed(2), 1, 200), 4);
    decoder.push(packet(missionCurrent(1), 1), 5);
    decoder.push(packet(reached(1), 1), 6);
    decoder.push(packet(landed(2), 1), 7);
    decoder.push(packet(missionCurrent(2), 2), 8);
    decoder.push(packet(landed(1), 2), 9);

    const aircraft = decoder.snapshot().aircraft;
    expect(aircraft.map(item => item.id)).toEqual(['radio:1:1', 'radio:2:1']);
    expect(aircraft[0].missionCurrent).toEqual({
      receivedAt: 5, seq: 1, total: 4, state: 1, mode: 1, missionId: 17,
    });
    expect(aircraft[0].missionItemReached).toEqual({ receivedAt: 6, seq: 1 });
    expect(aircraft[0].extendedState).toEqual({ receivedAt: 7, landedState: 2, vtolState: 0 });
    expect(aircraft[1].missionCurrent?.seq).toBe(2);
    expect(aircraft[1].missionItemReached).toBeUndefined();
    expect(aircraft[1].extendedState?.landedState).toBe(1);
  });

  it('does not replace newer mission and ACK evidence with older receive timestamps', () => {
    const decoder = new AircraftDecoder('usb');
    decoder.push(packet(heartbeat()), 100);
    decoder.push(packet(missionCurrent(2)), 200);
    decoder.push(packet(reached(2)), 200);
    decoder.push(packet(landed(2)), 200);
    decoder.push(packet(ack(400, 0)), 200);
    const cursor = decoder.commandAckCursor();
    decoder.push(packet(missionCurrent(1)), 150);
    decoder.push(packet(reached(1)), 150);
    decoder.push(packet(landed(1)), 150);
    decoder.push(packet(ack(400, 1)), 150);

    const aircraft = decoder.snapshot().aircraft[0];
    expect(aircraft.missionCurrent?.seq).toBe(2);
    expect(aircraft.missionCurrent?.receivedAt).toBe(200);
    expect(aircraft.missionItemReached?.seq).toBe(2);
    expect(aircraft.extendedState?.landedState).toBe(2);
    expect(aircraft.lastArmAck).toMatchObject({ receivedAt: 200, result: 0 });
    expect(decoder.commandAckCursor()).toBe(cursor);
    expect(decoder.commandAcks(cursor)).toEqual([]);
  });

  it('retains source, target, command and result so a caller can correlate a fresh ACK', () => {
    const decoder = new AircraftDecoder('serial');
    decoder.push(packet(ack(400)), 1); // unknown source must not create evidence
    decoder.push(packet(heartbeat()), 2);
    decoder.push(packet(heartbeat(), 2), 2);
    const cursor = decoder.commandAckCursor();
    decoder.push(packet(ack(400, 0), 2), 3); // another aircraft
    decoder.push(packet(ack(400, 0), 1, 200), 4); // another component, no heartbeat
    decoder.push(packet(ack(512, 0)), 5); // unrelated command
    decoder.push(packet(ack(400, 0, 9, 9)), 6); // wrong command target
    decoder.push(packet(ack(400, 4)), 7); // matching command, negative result

    const events = decoder.commandAcks(cursor, 'serial:1:1');
    expect(events).toHaveLength(3);
    expect(events.map(event => [event.command, event.result, event.targetSystem])).toEqual([
      [512, 0, 254],
      [400, 0, 9],
      [400, 4, 254],
    ]);
    expect(events[2]).toMatchObject({
      aircraftId: 'serial:1:1',
      sourceSystem: 1,
      sourceComponent: 1,
      receivedAt: 7,
      command: 400,
      result: 4,
      progress: 42,
      resultParam2: 7,
      targetSystem: 254,
      targetComponent: 190,
    });
    expect(events[0].id).toBeGreaterThan(cursor);
    expect(events[2].id).toBeGreaterThan(events[0].id);
    expect(decoder.commandAcks(cursor, 'serial:2:1')).toHaveLength(1);
    events[2].result = 0;
    expect(decoder.commandAcks(cursor, 'serial:1:1')[2].result).toBe(4);
  });

  it('bounds the ACK stream and preserves zero target fields from legacy MAVLink1', () => {
    const decoder = new AircraftDecoder('serial');
    decoder.push(packet(heartbeat()), 0);
    // MAVLink1 COMMAND_ACK carries only command/result; extension target IDs
    // do not exist on the wire. Build the 3-byte base payload explicitly.
    const legacy = Buffer.from([0xfe, 3, 0, 1, 1, common.CommandAck.MSG_ID, 0x90, 0x01, 0, 0, 0]);
    legacy.writeUInt16LE(x25crc(legacy, 1, 2, common.CommandAck.MAGIC_NUMBER), 9);
    decoder.push(legacy, 1);
    expect(decoder.commandAcks(0)[0]).toMatchObject({ targetSystem: 0, targetComponent: 0 });
    for (let i = 0; i < 150; i++) decoder.push(packet(ack(300 + i)), i + 2);
    expect(() => decoder.commandAcks(0)).toThrow('Command ACK history expired');
    const events = decoder.commandAcks(decoder.commandAckCursor() - 128);
    expect(events).toHaveLength(128);
    expect(events[0].id).toBe(24);
    expect(events[127].id).toBe(decoder.commandAckCursor());
    expect(decoder.commandAcks(decoder.commandAckCursor())).toEqual([]);
    expect(() => decoder.commandAcks(Number.NaN)).toThrow('Invalid command ACK cursor');
  });
});
