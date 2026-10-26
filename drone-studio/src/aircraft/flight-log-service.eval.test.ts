import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { MavLinkProtocolV2, common, minimal } from 'node-mavlink';
import { AircraftService, type AircraftPortOptions, type AircraftSerialPort } from './service';

const path = '/dev/cu.usbmodemLOGTEST';
const onboard = Uint8Array.from({ length: 194 }, (_, index) => index % 251);

class LogPort extends EventEmitter {
  isOpen = false;
  sent: number[] = [];
  respondToData = true;
  open(callback: (error: Error | null) => void) { this.isOpen = true; callback(null); }
  close(callback: (error: Error | null) => void) { this.isOpen = false; this.emit('close'); callback(null); }
  write(frame: Buffer, callback: (error: Error | null) => void) {
    const wire = new MavLinkProtocolV2();
    const id = wire.header(frame).msgid;
    this.sent.push(id);
    callback(null);
    if (id === common.LogRequestList.MSG_ID) {
      const entry = new common.LogEntry();
      entry.id = 7; entry.numLogs = 1; entry.lastLogNum = 7; entry.size = onboard.length;
      entry.timeUtc = 1_700_000_000;
      queueMicrotask(() => this.emit('data', new MavLinkProtocolV2(1, 1).serialize(entry, 1)));
    } else if (id === common.LogRequestData.MSG_ID && this.respondToData) {
      const request = wire.data(wire.payload(frame), common.LogRequestData);
      for (let offset = request.ofs; offset < request.ofs + request.count; offset += 90) {
        const bytes = onboard.subarray(offset, Math.min(onboard.length, offset + 90));
        const data = new common.LogData();
        data.id = request.id; data.ofs = offset; data.count = bytes.length;
        data.data = Array.from({ length: 90 }, (_, index) => bytes[index] ?? 0);
        queueMicrotask(() => this.emit('data', new MavLinkProtocolV2(1, 1).serialize(data, offset % 256)));
      }
    }
    return true;
  }
}

const heartbeat = (armed = false) => new MavLinkProtocolV2(1, 1).serialize(
  Object.assign(new minimal.Heartbeat(), {
    type: 2, autopilot: 3, baseMode: armed ? 128 : 0, customMode: 0,
    systemStatus: 3, mavlinkVersion: 3,
  }), 0,
);

async function connected(armed = false) {
  const port = new LogPort();
  const service = new AircraftService({
    listPorts: async () => [{ path }],
    createPort: (_options: AircraftPortOptions) => port as unknown as AircraftSerialPort,
    now: () => 1_000,
  });
  await service.connect(path);
  port.emit('data', heartbeat(armed));
  return { port, service, id: service.snapshot().aircraft[0].id };
}

async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Log fixture timed out');
}

describe('read-only onboard log service', () => {
  it('lists and downloads complete bytes from the source-bound aircraft', async () => {
    const { port, service, id } = await connected();
    try {
      expect(service.listLogs(id).state).toBe('listing');
      await until(() => service.logStatus().entries.length === 1 && service.logStatus().state === 'idle');
      expect(service.logStatus().entries[0]).toMatchObject({ id: 7, size: onboard.length });
      expect(service.downloadLog(id, 7).state).toBe('downloading');
      await until(() => service.logStatus().state === 'complete');
      const artifact = service.logStatus().artifact!;
      expect(Buffer.from(service.logFile(artifact.name))).toEqual(Buffer.from(onboard));
      expect(artifact.analysis).toBeNull();
      expect(artifact.analysisError).toMatch(/DataFlash|short|FMT/i);
      expect(port.sent.filter(msgid => msgid === common.LogRequestEnd.MSG_ID)).toHaveLength(2);
      expect(port.sent).not.toContain(common.LogErase.MSG_ID);
    } finally { await service.dispose(); }
  });

  it('refuses armed log reads and lets the operator cancel an incomplete transfer', async () => {
    const armed = await connected(true);
    try { expect(() => armed.service.listLogs(armed.id)).toThrow(/disarm/i); }
    finally { await armed.service.dispose(); }

    const { port, service, id } = await connected();
    try {
      service.listLogs(id);
      await until(() => service.logStatus().entries.length === 1);
      port.respondToData = false;
      service.downloadLog(id, 7);
      await until(() => port.sent.includes(common.LogRequestData.MSG_ID));
      const cancelled = service.cancelLogTransfer();
      expect(cancelled.state).toBe('error');
      await until(() => port.sent.filter(msgid => msgid === common.LogRequestEnd.MSG_ID).length >= 2);
      expect(service.logStatus().artifact).toBeNull();
    } finally { await service.dispose(); }
  });

  it('keeps an already downloaded original when a later list refresh is cancelled', async () => {
    const { service, id } = await connected();
    try {
      service.listLogs(id);
      await until(() => service.logStatus().entries.length === 1);
      service.downloadLog(id, 7);
      await until(() => service.logStatus().state === 'complete');
      const original = service.logStatus().artifact!;
      service.listLogs(id);
      service.cancelLogTransfer();
      expect(service.logStatus().artifact?.name).toBe(original.name);
      expect(Buffer.from(service.logFile(original.name))).toEqual(Buffer.from(onboard));
    } finally { await service.dispose(); }
  });
});
