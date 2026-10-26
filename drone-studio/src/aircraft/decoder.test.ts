import { describe, expect, it } from 'vitest';
import {
  MavLinkProtocolV1,
  MavLinkProtocolV2,
  common,
  minimal,
  x25crc,
  type MavLinkData,
} from 'node-mavlink';
import { AircraftDecoder } from './decoder';

function packet(message: MavLinkData, system = 1, version = 2) {
  return (
    version === 2 ? new MavLinkProtocolV2(system, 1) : new MavLinkProtocolV1(system, 1)
  ).serialize(message, 0);
}
const heartbeat = (armed = false) =>
  Object.assign(new minimal.Heartbeat(), {
    type: 2,
    autopilot: 3,
    baseMode: armed ? 128 : 0,
    customMode: 0,
    systemStatus: 3,
    mavlinkVersion: 3,
  });

describe('bounded physical telemetry decoding', () => {
  it('keeps motor-test ACK evidence separate from firmware requests and unrelated commands', () => {
    const decoder = new AircraftDecoder('bench');
    decoder.push(packet(heartbeat()), 100);
    const ack = (command: number) =>
      packet(
        Object.assign(new common.CommandAck(), {
          command,
          result: 0,
          targetSystem: 254,
          targetComponent: 190,
        })
      );
    decoder.push(ack(512), 110);
    decoder.push(ack(209), 120);
    decoder.push(ack(400), 130);
    const aircraft = decoder.snapshot().aircraft[0];
    expect(aircraft.lastAck).toMatchObject({ command: 512, receivedAt: 110 });
    expect(aircraft.lastMotorAck).toMatchObject({
      command: 209,
      receivedAt: 120,
      result: 0,
      targetSystem: 254,
      targetComponent: 190,
    });
  });
  it('decodes fragmented MAVLink2 and MAVLink1, with distinct system identities', () => {
    const decoder = new AircraftDecoder('usb');
    const frame = packet(heartbeat());
    for (const byte of frame) decoder.push(Buffer.from([byte]), 1000);
    decoder.push(packet(heartbeat(true), 2, 1), 1200);
    expect(
      decoder.snapshot().aircraft.map((a) => [a.id, a.protocolVersion, a.heartbeat.armed])
    ).toEqual([
      ['usb:1:1', 2, false],
      ['usb:2:1', 1, true],
    ]);
    expect(decoder.snapshot().aircraft[0].heartbeat.mode).toBe('Stabilize');
  });

  it('does not invent aircraft from a bridge, GCS, or attitude without an autopilot heartbeat', () => {
    const decoder = new AircraftDecoder('usb');
    decoder.push(
      Buffer.concat([
        packet(Object.assign(heartbeat(), { autopilot: 8, type: 30 })),
        packet(Object.assign(heartbeat(), { type: 6 })),
        packet(new common.Attitude()),
      ]),
      0
    );
    expect(decoder.snapshot().aircraft).toEqual([]);
  });

  it('rejects corrupt CRC and unsupported flags and recovers from megabytes of console noise', () => {
    const decoder = new AircraftDecoder('usb');
    const corrupt = packet(heartbeat());
    corrupt[10] ^= 32;
    const flags = packet(heartbeat());
    flags[2] = 2;
    decoder.push(Buffer.alloc(2_000_000, 65), 0);
    decoder.push(Buffer.concat([corrupt, flags, Buffer.alloc(300), packet(heartbeat())]), 100);
    expect(decoder.snapshot().aircraft).toHaveLength(1);
    expect(decoder.snapshot().packetsReceived).toBe(1);
    expect(decoder.snapshot().invalidFrames).toBeGreaterThanOrEqual(2);
  });

  it('converts aircraft units and preserves received times without mixing other components', () => {
    const decoder = new AircraftDecoder('usb');
    decoder.push(packet(heartbeat()), 10);
    decoder.push(
      Buffer.concat([
        packet(
          Object.assign(new common.Attitude(), {
            roll: Math.PI / 6,
            pitch: -Math.PI / 12,
            yaw: -Math.PI / 2,
          })
        ),
        packet(
          Object.assign(new common.GpsRawInt(), {
            fixType: 3,
            lat: 405000000,
            lon: -735000000,
            satellitesVisible: 12,
            eph: 130,
          })
        ),
        packet(
          Object.assign(new common.GlobalPositionInt(), {
            lat: 405000000,
            lon: -735000000,
            alt: 12000,
            relativeAlt: 3000,
            vx: 300,
            vy: 400,
          })
        ),
        packet(
          Object.assign(new common.SysStatus(), {
            voltageBattery: 15700,
            currentBattery: 235,
            batteryRemaining: 80,
          })
        ),
      ]),
      20
    );
    decoder.push(
      new MavLinkProtocolV2(1, 200).serialize(Object.assign(new common.Attitude(), { roll: 2 }), 0),
      30
    );
    const a = decoder.snapshot().aircraft[0];
    expect(a.attitude?.rollDeg).toBeCloseTo(30, 4);
    expect(a.attitude?.pitchDeg).toBeCloseTo(-15, 4);
    expect(a.attitude?.yawDeg).toBeCloseTo(270, 4);
    expect(a.attitude?.receivedAt).toBe(20);
    expect(a.gps).toMatchObject({ latitude: 40.5, longitude: -73.5, satellites: 12, hdop: 1.3 });
    expect(a.position).toMatchObject({ relativeAltitudeM: 3, altitudeMslM: 12, groundSpeedMps: 5 });
    expect(a.battery).toMatchObject({ voltageV: 15.7, currentA: 2.35, remainingPercent: 80 });
  });

  it('preserves unknown sentinels and never uses no-fix GPS as coordinates', () => {
    const decoder = new AircraftDecoder('usb');
    decoder.push(
      Buffer.concat([
        packet(heartbeat()),
        packet(
          Object.assign(new common.GpsRawInt(), { fixType: 1, satellitesVisible: 255, eph: 65535 })
        ),
        packet(
          Object.assign(new common.SysStatus(), {
            voltageBattery: 65535,
            currentBattery: -1,
            batteryRemaining: -1,
          })
        ),
        packet(Object.assign(new common.Attitude(), { roll: NaN })),
      ]),
      5
    );
    const a = decoder.snapshot().aircraft[0];
    expect(a.gps).toMatchObject({ latitude: null, longitude: null, satellites: null, hdop: null });
    expect(a.battery).toMatchObject({ voltageV: null, currentA: null, remainingPercent: null });
    expect(a.attitude).toBeNull();
    expect(a.position).toBeNull();
  });

  it('sums battery cells, supports packed voltage and ignores secondary batteries', () => {
    const decoder = new AircraftDecoder('usb');
    decoder.push(
      Buffer.concat([
        packet(heartbeat()),
        packet(
          Object.assign(new common.BatteryStatus(), {
            id: 0,
            voltages: [4100, 4200, 4150, 4180, ...Array(6).fill(65535)],
            voltagesExt: [0, 0, 0, 0],
            currentBattery: -1,
            batteryRemaining: -1,
          })
        ),
      ]),
      0
    );
    expect(decoder.snapshot().aircraft[0].battery?.voltageV).toBe(16.63);
    decoder.push(packet(Object.assign(new common.BatteryStatus(), { id: 1 })), 1);
    expect(decoder.snapshot().aircraft[0].battery?.voltageV).toBe(16.63);
    decoder.push(
      packet(
        Object.assign(new common.SysStatus(), {
          voltageBattery: 65535,
          currentBattery: -1,
          batteryRemaining: -1,
        })
      ),
      2
    );
    expect(decoder.snapshot().aircraft[0].battery?.voltageV).toBe(16.63);
    decoder.push(
      packet(
        Object.assign(new common.SysStatus(), {
          voltageBattery: 15000,
          currentBattery: 200,
          batteryRemaining: 60,
        })
      ),
      6000
    );
    expect(decoder.snapshot().aircraft[0].battery?.voltageV).toBe(15);
  });

  it('rejects a CRC-valid but invalid-length V1 attitude rather than zero-padding a fake level pose', () => {
    const decoder = new AircraftDecoder('usb');
    decoder.push(packet(heartbeat()), 0);
    const frame = Buffer.from([0xfe, 0, 1, 1, 1, 30, 0, 0]);
    frame.writeUInt16LE(x25crc(frame, 1, 2, common.Attitude.MAGIC_NUMBER), 6);
    decoder.push(frame, 1);
    expect(decoder.snapshot().aircraft[0].attitude).toBeNull();
    expect(decoder.snapshot().invalidFrames).toBe(1);
  });

  it('labels signed messages unverified and bounds warnings/identities', () => {
    const decoder = new AircraftDecoder('usb');
    const protocol = new MavLinkProtocolV2(1, 1, 1);
    decoder.push(
      protocol.sign(protocol.serialize(heartbeat(), 0), 1, Buffer.alloc(32), Date.now()),
      0
    );
    expect(decoder.snapshot().aircraft[0].signing).toBe('unverified');
    for (let i = 0; i < 100; i++)
      decoder.push(
        packet(Object.assign(new common.StatusText(), { text: 'PreArm: check', severity: 4 })),
        i
      );
    expect(decoder.snapshot().aircraft[0].messages).toHaveLength(20);
    for (let i = 2; i < 60; i++) decoder.push(packet(heartbeat(), i), i);
    expect(decoder.snapshot().aircraft).toHaveLength(32);
    const copy = decoder.snapshot();
    copy.aircraft[0].heartbeat.armed = true;
    expect(decoder.snapshot().aircraft[0].heartbeat.armed).toBe(false);
  });
});

it('decodes hardware UID, independent pre-arm evidence, sensor health and receiver inputs', async () => {
  const { standard } = await import('node-mavlink');
  const decoder = new AircraftDecoder('checks');
  decoder.push(packet(heartbeat()), 100);
  decoder.push(packet(Object.assign(new standard.AutopilotVersion(), { capabilities: 0n, flightSwVersion: (4 << 24) | (7 << 16) | (1 << 8) | 255, uid: 123n })), 110);
  decoder.push(packet(Object.assign(new common.BatteryStatus(), { id: 0, voltages: [22000, ...Array(9).fill(65535)], currentBattery: 0 })), 115);
  decoder.push(packet(Object.assign(new common.SysStatus(), { onboardControlSensorsPresent: 15, onboardControlSensorsEnabled: 15, onboardControlSensorsHealth: 13, load: 250 })), 120);
  decoder.push(packet(Object.assign(new common.RcChannels(), { chancount: 4, chan1Raw: 1500, chan2Raw: 1600, chan3Raw: 1000, chan4Raw: 65535, rssi: 255 })), 125);
  decoder.push(packet(Object.assign(new common.PowerStatus(), { Vcc: 5100, flags: 5 })), 126);
  decoder.push(packet(Object.assign(new common.CommandAck(), { command: 401, result: 0, targetSystem: 254, targetComponent: 190 })), 130);
  const a = decoder.snapshot().aircraft[0];
  expect(a.version?.uid).toBe('uid:123');
  expect(a.health).toEqual({ receivedAt: 120, present: 15, enabled: 15, healthy: 13, loadPercent: 25 });
  expect(a.battery?.receivedAt).toBe(115);
  expect(a.receiver).toEqual({ receivedAt: 125, channels: [1500, 1600, 1000, null], rssi: null });
  expect(a.power).toEqual({ receivedAt: 126, boardVoltageV: 5.1, flags: 5 });
  expect(a.lastPrearmAck?.command).toBe(401); expect(a.lastArmAck).toBeUndefined();
  decoder.push(packet(Object.assign(new standard.AutopilotVersion(), { capabilities: 0n, uid: 123n, uid2: [1, ...Array(17).fill(0)] })), 140);
  expect(decoder.snapshot().aircraft[0].version?.uid).toBe(`uid2:01${'00'.repeat(17)}`);
});
