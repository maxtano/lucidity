import {
  MavLinkProtocolV1,
  MavLinkProtocolV2,
  minimal,
  common,
  standard,
  ardupilotmega,
  x25crc,
} from 'node-mavlink';
import type { AircraftCommandAckEvent, AircraftTelemetry } from './types';
import { parameterName, type AircraftParameter } from './parameters';
import { decodeMissionPacket } from './mission-wire';
import type { MissionPacket } from './mission-protocol';
import { decodeLogPacket, type LogPacket } from './log-protocol';

const registry = {
  ...minimal.REGISTRY,
  ...standard.REGISTRY,
  ...common.REGISTRY,
  ...ardupilotmega.REGISTRY,
};
const modes: Record<number, string> = {
  0: 'Stabilize',
  1: 'Acro',
  2: 'AltHold',
  3: 'Auto',
  4: 'Guided',
  5: 'Loiter',
  6: 'RTL',
  7: 'Circle',
  9: 'Land',
  11: 'Drift',
  13: 'Sport',
  14: 'Flip',
  15: 'AutoTune',
  16: 'PosHold',
  17: 'Brake',
  18: 'Throw',
  19: 'Avoid ADSB',
  20: 'Guided No GPS',
  21: 'Smart RTL',
  22: 'FlowHold',
  23: 'Follow',
  24: 'ZigZag',
  25: 'SystemID',
  26: 'AutoRotate',
  27: 'Auto RTL',
  28: 'Turtle',
};
const states = [
  'Uninitialized',
  'Booting',
  'Calibrating',
  'Standby',
  'Active',
  'Critical',
  'Emergency',
  'Power off',
  'Flight termination',
];
const fixes = [
  'No GPS',
  'No fix',
  '2D fix',
  '3D fix',
  'DGPS',
  'RTK float',
  'RTK fixed',
  'Static',
  'PPP',
];
const deg = (r: number) => (r * 180) / Math.PI;
const percent = (n: number) => (n >= 0 && n <= 100 ? n : null);
const coordinates = (lat: number, lon: number) =>
  Math.abs(lat) <= 900000000 && Math.abs(lon) <= 1800000000;

/** Bounded wire framing; node-mavlink supplies dialect CRC_EXTRA and typed decoding.
 * At most one partial MAVLink frame survives a push (maximum 280 bytes).
 * CRC detects corruption, not authenticity. Signed frames are explicitly unverified.
 */
export class AircraftDecoder {
  private pending: Buffer = Buffer.alloc(0);
  private aircraft = new Map<string, AircraftTelemetry>();
  private parameters = new Map<string, Map<string, AircraftParameter>>();
  private primaryBatteryAt = new Map<string, number>();
  private missionInbox: MissionPacket[] = [];
  private missionMessageId = 0;
  private logInbox: LogPacket[] = [];
  private logMessageId = 0;
  private commandAckInbox: AircraftCommandAckEvent[] = [];
  private commandAckMessageId = 0;
  private commandAckAt = new Map<string, number>();
  private packetsReceived = 0;
  private invalidFrames = 0;
  private lastPacketAt: number | null = null;
  constructor(private readonly linkId: string) {}

  push(chunk: Buffer, now: number): void {
    for (let offset = 0; offset < chunk.length; offset += 4096) {
      this.pending = Buffer.concat([this.pending, chunk.subarray(offset, offset + 4096)]);
      this.consume(now);
    }
  }

  private consume(now: number) {
    while (this.pending.length) {
      const start = this.pending.findIndex((byte) => byte === 0xfd || byte === 0xfe);
      if (start < 0) {
        this.pending = Buffer.alloc(0);
        return;
      }
      if (start > 0) this.pending = this.pending.subarray(start);
      const v2 = this.pending[0] === 0xfd;
      const headerLength = v2 ? 10 : 6;
      if (this.pending.length < headerLength) return;
      const flags = v2 ? this.pending[2] : 0;
      if (flags & ~1) {
        this.invalidFrames++;
        this.pending = this.pending.subarray(1);
        continue;
      }
      const signed = !!(flags & 1);
      const length = headerLength + this.pending[1] + 2 + (signed ? 13 : 0);
      if (this.pending.length < length) return;
      const frame = this.pending.subarray(0, length);
      const protocol = v2 ? new MavLinkProtocolV2() : new MavLinkProtocolV1();
      const header = protocol.header(frame);
      const clazz = registry[header.msgid];
      if (!clazz) {
        this.pending = this.pending.subarray(length);
        continue;
      }
      const baseLength = Math.max(
        0,
        ...clazz.FIELDS.filter((f) => !f.extension).map((f) => f.offset + f.size * (f.length || 1))
      );
      if (
        (!v2 && header.payloadLength !== baseLength) ||
        (v2 && header.payloadLength === 0 && baseLength > 0)
      ) {
        this.invalidFrames++;
        this.pending = this.pending.subarray(1);
        continue;
      }
      if (protocol.crc(frame) !== x25crc(frame, 1, signed ? 15 : 2, clazz.MAGIC_NUMBER)) {
        this.invalidFrames++;
        this.pending = this.pending.subarray(1);
        continue;
      }
      this.pending = this.pending.subarray(length);
      this.packetsReceived++;
      this.lastPacketAt = now;
      const key = `${this.linkId}:${header.sysid}:${header.compid}`;
      const payload = protocol.payload(frame);
      // Only a vehicle autopilot heartbeat creates an aircraft; radios/GCSs do not.
      if (header.msgid === minimal.Heartbeat.MSG_ID) {
        const h = protocol.data(payload, minimal.Heartbeat);
        if (
          !header.sysid ||
          h.autopilot === 8 ||
          h.type === 6 ||
          h.type === 18 ||
          h.type === 26 ||
          h.type === 27 ||
          h.type === 30 ||
          h.type === 31 ||
          h.type === 32 ||
          h.type === 34
        )
          continue;
        const existing = this.aircraft.get(key);
        if (!existing && this.aircraft.size >= 32) continue;
        const copter = [2, 3, 4, 13, 14, 15, 29, 35].includes(h.type);
        this.aircraft.set(key, {
          ...(existing || {
            id: key,
            systemId: header.sysid,
            componentId: header.compid,
            attitude: null,
            gps: null,
            position: null,
            battery: null,
            messages: [],
          }),
          protocolVersion: v2 ? 2 : 1,
          signing: signed || existing?.signing === 'unverified' ? 'unverified' : 'unsigned',
          heartbeat: {
            receivedAt: now,
            armed: !!(h.baseMode & 128),
            customMode: h.customMode,
            mode:
              h.autopilot === 3 && copter
                ? (modes[h.customMode] ?? `Mode ${h.customMode}`)
                : `Mode ${h.customMode}`,
            systemStatus: states[h.systemStatus] ?? `State ${h.systemStatus}`,
            autopilot: h.autopilot,
            vehicleType: h.type,
          },
        });
        continue;
      }
      const aircraft = this.aircraft.get(key);
      if (!aircraft) continue;
      if (signed) aircraft.signing = 'unverified';
      if (header.msgid === common.MissionCount.MSG_ID ||
          header.msgid === common.MissionRequest.MSG_ID ||
          header.msgid === common.MissionRequestInt.MSG_ID ||
          header.msgid === common.MissionItemInt.MSG_ID ||
          header.msgid === common.MissionAck.MSG_ID) {
        const data = header.msgid === common.MissionCount.MSG_ID
          ? protocol.data(payload, common.MissionCount)
          : header.msgid === common.MissionRequest.MSG_ID
            ? protocol.data(payload, common.MissionRequest)
          : header.msgid === common.MissionRequestInt.MSG_ID
            ? protocol.data(payload, common.MissionRequestInt)
            : header.msgid === common.MissionItemInt.MSG_ID
              ? protocol.data(payload, common.MissionItemInt)
              : protocol.data(payload, common.MissionAck);
        const packet = decodeMissionPacket(header.msgid, data, header.sysid, header.compid, ++this.missionMessageId);
        if (packet) this.missionInbox = [...this.missionInbox, packet].slice(-128);
        continue;
      }
      if (header.msgid === common.LogEntry.MSG_ID || header.msgid === common.LogData.MSG_ID) {
        const data = header.msgid === common.LogEntry.MSG_ID
          ? protocol.data(payload, common.LogEntry)
          : protocol.data(payload, common.LogData);
        const packet = decodeLogPacket(header.msgid, data, header.sysid, header.compid, ++this.logMessageId);
        if (packet) this.logInbox = [...this.logInbox, packet].slice(-512);
        continue;
      }
      switch (header.msgid) {
        case common.ParamValue.MSG_ID: {
          const p = protocol.data(payload, common.ParamValue);
          const name = p.paramId.replace(/\0.*$/, '');
          if (!parameterName(name) || !Number.isFinite(p.paramValue) || p.paramCount > 20000) break;
          let records = this.parameters.get(key);
          if (!records) {
            records = new Map();
            this.parameters.set(key, records);
          }
          if (records.size < 20000 || records.has(name))
            records.set(name, {
              name,
              value: p.paramValue,
              type: p.paramType,
              index: p.paramIndex,
              count: p.paramCount,
              receivedAt: now,
              revision: (records.get(name)?.revision ?? 0) + 1,
            });
          break;
        }
        case standard.AutopilotVersion.MSG_ID: {
          const v = protocol.data(payload, standard.AutopilotVersion);
          aircraft.version = {
            receivedAt: now,
            flightVersion: `${v.flightSwVersion >>> 24}.${(v.flightSwVersion >>> 16) & 255}.${(v.flightSwVersion >>> 8) & 255}`,
            releaseType: v.flightSwVersion & 255,
            uid: v.uid2?.some(byte => byte !== 0)
              ? `uid2:${Buffer.from(v.uid2).toString('hex')}`
              : v.uid && v.uid.toString() !== '0' ? `uid:${v.uid.toString()}` : undefined,
          };
          break;
        }
        case common.CommandAck.MSG_ID: {
          const a = protocol.data(payload, common.CommandAck);
          // The stream keeps every command result (including future launch
          // commands) without overwriting the existing per-purpose ACK fields.
          // A command owner must still match source, target, command and cursor.
          if (now < (this.commandAckAt.get(key) ?? -Infinity)) break;
          this.commandAckAt.set(key, now);
          this.commandAckInbox = [
            ...this.commandAckInbox,
            {
              id: ++this.commandAckMessageId,
              aircraftId: key,
              sourceSystem: header.sysid,
              sourceComponent: header.compid,
              receivedAt: now,
              command: a.command,
              result: a.result,
              progress: a.progress >= 0 && a.progress <= 100 ? a.progress : null,
              resultParam2: a.resultParam2,
              targetSystem: a.targetSystem,
              targetComponent: a.targetComponent,
            },
          ].slice(-128);
          // Keep information and motor-test evidence separate. ACK is not physical completion.
          if (a.command === 512 || a.command === 209 || a.command === 400 || a.command === 401) {
            const ack = {
              receivedAt: now,
              command: a.command,
              result: a.result,
              targetSystem: a.targetSystem,
              targetComponent: a.targetComponent,
            };
            if (a.command === 512) aircraft.lastAck = ack;
            else if (a.command === 209) aircraft.lastMotorAck = ack;
            else if (a.command === 401) aircraft.lastPrearmAck = ack;
            else aircraft.lastArmAck = ack;
          }
          break;
        }
        case common.MissionCurrent.MSG_ID: {
          const current = protocol.data(payload, common.MissionCurrent);
          if ((!aircraft.missionCurrent || now >= aircraft.missionCurrent.receivedAt) &&
              Number.isInteger(current.seq) && Number.isInteger(current.total))
            aircraft.missionCurrent = {
              receivedAt: now,
              seq: current.seq,
              total: current.total,
              state: current.missionState,
              mode: current.missionMode,
              missionId: current.missionId,
            };
          break;
        }
        case common.MissionItemReached.MSG_ID: {
          const reached = protocol.data(payload, common.MissionItemReached);
          if ((!aircraft.missionItemReached || now >= aircraft.missionItemReached.receivedAt) &&
              Number.isInteger(reached.seq))
            aircraft.missionItemReached = { receivedAt: now, seq: reached.seq };
          break;
        }
        case common.ExtendedSysState.MSG_ID: {
          const state = protocol.data(payload, common.ExtendedSysState);
          if (!aircraft.extendedState || now >= aircraft.extendedState.receivedAt)
            aircraft.extendedState = {
              receivedAt: now,
              landedState: state.landedState,
              vtolState: state.vtolState,
            };
          break;
        }
        case ardupilotmega.EkfStatusReport.MSG_ID: {
          const report = protocol.data(payload, ardupilotmega.EkfStatusReport);
          if ((!aircraft.ekfStatus || now >= aircraft.ekfStatus.receivedAt) &&
              Number.isInteger(report.flags) && report.flags >= 0 && report.flags <= 0xffff)
            aircraft.ekfStatus = { receivedAt: now, flags: report.flags };
          break;
        }
        case common.Attitude.MSG_ID: {
          const a = protocol.data(payload, common.Attitude);
          if ([a.roll, a.pitch, a.yaw].every(Number.isFinite))
            aircraft.attitude = {
              receivedAt: now,
              rollDeg: deg(a.roll),
              pitchDeg: deg(a.pitch),
              yawDeg: (deg(a.yaw) + 360) % 360,
            };
          break;
        }
        case common.GpsRawInt.MSG_ID: {
          const g = protocol.data(payload, common.GpsRawInt);
          const valid = g.fixType >= 2 && coordinates(g.lat, g.lon);
          aircraft.gps = {
            receivedAt: now,
            fix: fixes[g.fixType] ?? `Fix ${g.fixType}`,
            fixType: g.fixType,
            satellites: g.satellitesVisible === 255 ? null : g.satellitesVisible,
            latitude: valid ? g.lat / 1e7 : null,
            longitude: valid ? g.lon / 1e7 : null,
            hdop: g.eph === 65535 ? null : g.eph / 100,
          };
          break;
        }
        case common.GlobalPositionInt.MSG_ID: {
          const p = protocol.data(payload, common.GlobalPositionInt);
          if (coordinates(p.lat, p.lon))
            aircraft.position = {
              receivedAt: now,
              latitude: p.lat / 1e7,
              longitude: p.lon / 1e7,
              relativeAltitudeM: p.relativeAlt / 1000,
              altitudeMslM: p.alt / 1000,
              groundSpeedMps: Math.hypot(p.vx, p.vy) / 100,
            };
          break;
        }
        case common.SysStatus.MSG_ID: {
          const b = protocol.data(payload, common.SysStatus);
          aircraft.health = { receivedAt: now, present: b.onboardControlSensorsPresent,
            enabled: b.onboardControlSensorsEnabled, healthy: b.onboardControlSensorsHealth,
            loadPercent: b.load / 10 };
          const primaryAt = this.primaryBatteryAt.get(key);
          if (primaryAt !== undefined && now - primaryAt < 5000) break;
          aircraft.battery = {
            receivedAt: now,
            voltageV: b.voltageBattery === 65535 ? null : b.voltageBattery / 1000,
            currentA: b.currentBattery === -1 ? null : b.currentBattery / 100,
            remainingPercent: percent(b.batteryRemaining),
          };
          break;
        }
        case common.RcChannels.MSG_ID: {
          const rc = protocol.data(payload, common.RcChannels);
          aircraft.receiver = { receivedAt: now,
            channels: Array.from({ length: Math.min(18, rc.chancount) }, (_, i) => {
              const value = rc[`chan${i + 1}Raw` as keyof typeof rc];
              return typeof value === 'number' && value !== 65535 ? value : null;
            }), rssi: rc.rssi === 255 ? null : rc.rssi };
          break;
        }
        case common.PowerStatus.MSG_ID: {
          const p = protocol.data(payload, common.PowerStatus);
          aircraft.power = { receivedAt: now, boardVoltageV: p.Vcc / 1000, flags: p.flags };
          break;
        }
        case common.BatteryStatus.MSG_ID: {
          const b = protocol.data(payload, common.BatteryStatus);
          if (b.id !== 0) break;
          this.primaryBatteryAt.set(key, now);
          const cells = [
            ...b.voltages.filter((v) => v !== 65535),
            ...b.voltagesExt.filter((v) => v > 0 && v !== 65535),
          ];
          aircraft.battery = {
            receivedAt: now,
            voltageV: cells.length ? cells.reduce((sum, v) => sum + v, 0) / 1000 : null,
            currentA: b.currentBattery === -1 ? null : b.currentBattery / 100,
            remainingPercent: percent(b.batteryRemaining),
          };
          break;
        }
        case common.StatusText.MSG_ID: {
          const s = protocol.data(payload, common.StatusText);
          // Preserve bounded chunks visibly; do not claim a partial warning is complete.
          const text = s.text
            .replace(/\0.*$/s, '')
            .replace(/[\x01-\x08\x0b-\x1f\x7f]/g, '')
            .slice(0, 50);
          aircraft.messages = [
            ...aircraft.messages,
            {
              receivedAt: now,
              severity: s.severity,
              text: s.id ? `[${s.id}:${s.chunkSeq}] ${text}` : text,
            },
          ].slice(-20);
          break;
        }
      }
    }
  }

  resetParameters(aircraftId: string) {
    this.parameters.delete(aircraftId);
  }

  missionCursor() { return this.missionMessageId; }

  logCursor() { return this.logMessageId; }

  logPackets(afterId: number): LogPacket[] {
    if (!Number.isSafeInteger(afterId) || afterId < 0 || afterId > this.logMessageId)
      throw new Error('Invalid log cursor');
    if (this.logInbox.length && afterId < this.logInbox[0].id - 1)
      throw new Error('Log response history expired');
    return this.logInbox.filter(packet => packet.id > afterId).map(packet => structuredClone(packet));
  }

  missionPackets(afterId: number): MissionPacket[] {
    return this.missionInbox.filter(packet => packet.id > afterId).map(packet => structuredClone(packet));
  }

  commandAckCursor() { return this.commandAckMessageId; }

  commandAcks(afterId: number, aircraftId?: string): AircraftCommandAckEvent[] {
    if (!Number.isSafeInteger(afterId) || afterId < 0 || afterId > this.commandAckMessageId)
      throw new Error('Invalid command ACK cursor');
    // A caller waiting for a command result must not silently skip an ACK
    // when the bounded inbox wraps. It can then treat the outcome as unknown.
    if (this.commandAckInbox.length && afterId < this.commandAckInbox[0].id - 1)
      throw new Error('Command ACK history expired');
    return this.commandAckInbox
      .filter(event => event.id > afterId && (aircraftId === undefined || event.aircraftId === aircraftId))
      .map(event => structuredClone(event));
  }

  parameterSnapshot(aircraftId: string): AircraftParameter[] {
    return structuredClone([...(this.parameters.get(aircraftId)?.values() ?? [])]);
  }

  snapshot() {
    return {
      aircraft: structuredClone([...this.aircraft.values()]),
      packetsReceived: this.packetsReceived,
      invalidFrames: this.invalidFrames,
      lastPacketAt: this.lastPacketAt,
    };
  }
}
