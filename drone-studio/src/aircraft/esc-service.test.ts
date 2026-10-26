import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { common, minimal, MavLinkProtocolV2 } from 'node-mavlink';
import { AircraftService, type AircraftSerialPort } from './service';
import { fourReply, mspReply, settings } from './esc-test-fixtures';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as realTimeout } from 'node:timers';
import { motifs } from '../platform/music-model';
import { loadBluejayImage, startupImage } from './esc-startup';
import { decodeEscSettings } from './esc-protocol';
import { encodeBluejayMelody } from '../platform/bluejay-melody';
const wire = new MavLinkProtocolV2(1, 1), path = '/dev/cu.usbmodemESC';
class Port extends EventEmitter {
  isOpen = false;
  bluejay = false;
  negativeChannel = -1;
  selected = 0;
  silent = false;
  restore = true;
  awaitingMavlink = false;
  streamTelemetry = true;
  memory?: Buffer[];
  failWrites = false;
  open(cb: (e: null) => void) { this.isOpen = true; cb(null); }
  close(cb: (e: null) => void) { this.isOpen = false; this.emit('close'); cb(null); }
  write = vi.fn((b: Buffer, cb: (e: null) => void) => {
    cb(null);
    if (b[0] === 0xfd) {
      if (this.awaitingMavlink && this.restore && wire.header(b).msgid === common.ParamRequestRead.MSG_ID) setTimeout(() => this.heartbeat(), 100);
      return true;
    }
    if (this.silent) return true;
    if (b[0] === 0x24) {
      this.streamTelemetry = false;
      this.emit('data', mspReply(b[4], b[4] === 1 ? [0, 1, 42] : b[4] === 2 ? [65, 82, 68, 85] : [4]));
    } else {
      let response: number[] | Buffer = [0]; let ack = 0;
      if (b[1] === 0x37) { this.selected = b[5]; response = [0xb2, 0xe8, 0, 1]; if (this.selected === this.negativeChannel) ack = 0x0f; }
      if (b[1] === 0x3a) {
        if (this.memory) response = b.readUInt16BE(2) === 0xfbff ? Buffer.of(255) : this.memory[this.selected].subarray(b.readUInt16BE(2), b.readUInt16BE(2) + (b[5] || 256));
        else { response = settings(this.bluejay).subarray(0, b[5]); response[0x0b] = this.selected === 1 ? 2 : 1; }
      }
      if (b[1] === 0x39 && this.memory) this.memory[this.selected].fill(255, b[5] * 512, (b[5] + 1) * 512);
      if (b[1] === 0x3b && this.memory) {
        if (this.failWrites) return true; // Ambiguous timeout: erase already happened.
        b.subarray(5, 5 + (b[4] || 256)).forEach((byte, i) => { this.memory![this.selected][b.readUInt16BE(2) + i] &= byte; });
      }
      this.emit('data', fourReply(b[1], response, b.readUInt16BE(2), ack));
      if (b[1] === 0x34) { this.awaitingMavlink = true; this.streamTelemetry = true; }
    }
    return true;
  });
  heartbeat(armed = false) {
    const h = new minimal.Heartbeat(); h.type = 2; h.autopilot = 3; h.baseMode = (armed ? 128 : 0) as minimal.MavModeFlag;
    this.emit('data', wire.serialize(h, 0));
  }
  battery(voltage = 24000) { const b = new common.SysStatus(); b.voltageBattery = voltage; this.emit('data', wire.serialize(b, 0)); }
  parameters() {
    for (const [index, name, value] of [[0, 'SERVO_BLH_AUTO', 1], [1, 'SERVO_BLH_PORT', 0]] as const) {
      const p = new common.ParamValue(); p.paramId = name; p.paramValue = value; p.paramType = 2; p.paramCount = 2; p.paramIndex = index;
      this.emit('data', wire.serialize(p, 0));
    }
  }
}
const services: AircraftService[] = [];
const directories: string[] = [];
const checks = { propsRemoved: true, directUsb: true };
async function fixture(manufacturer = 'ArduPilot', maintenance = false) {
  const escBackupDirectory = maintenance ? await mkdtemp(join(tmpdir(), 'lucidity-esc-test-')) : undefined;
  if (escBackupDirectory) directories.push(escBackupDirectory);
  vi.useFakeTimers(); vi.setSystemTime(1000);
  const port = new Port();
  if (maintenance) {
    port.memory = Array.from({ length: 4 }, (_, index) => {
      const image = Buffer.alloc(8192, 0xa5), bytes = settings();
      bytes[0x0b] = index === 1 ? 2 : 1;
      bytes.copy(image, 0x1a00);
      return image;
    });
    // Model continuing telemetry during asynchronous backup I/O.
    // Passthrough interrupts the stream; production freshness checks are unchanged.
    setInterval(() => { if (port.streamTelemetry && port.restore) { port.heartbeat(); port.battery(); } }, 500);
  }
  const service = new AircraftService({ escBackupDirectory, listPorts: async () => [{ path, manufacturer, serialNumber: 'test' }], createPort: () => port as unknown as AircraftSerialPort });
  services.push(service); await service.connect(path); port.heartbeat(); port.battery(); port.parameters();
  return { service, port, id: service.snapshot().aircraft[0].id };
}
afterEach(async () => { for (const s of services.splice(0)) await s.dispose(); vi.clearAllTimers(); vi.useRealTimers(); for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
async function settle<T>(promise: Promise<T>) {
  let done = false, value: T | undefined, error: unknown;
  void promise.then(result => { value = result; done = true; }, e => { error = e; done = true; });
  for (let i = 0; i < 80 && !done; i++) {
    await new Promise(resolve => realTimeout(resolve, 2));
    await vi.advanceTimersByTimeAsync(1000);
  }
  if (!done) throw new Error('Simulated ESC operation did not settle.');
  if (error) throw error;
  return value!;
}
const installChecks = { ...checks, confirmed: true, firmwareChangeConfirmed: true };
describe('reviewed startup installation', () => {
  it('backs up all four original firmwares without writing, then installs and verifies the reviewed image', async () => {
    const { service, port, id } = await fixture('ArduPilot', true);
    const original = port.memory!.map(b => Buffer.from(b));
    const plan = await settle(service.prepareEscStartup(id, motifs[0], checks));
    const backup = JSON.parse(await readFile(plan.backupPath, 'utf8'));
    expect(backup.escs.map((e: { flashHex: string }) => e.flashHex)).toEqual(original.map(b => b.toString('hex')));
    expect(plan.escs.map(e => e.direction)).toEqual(['Normal', 'Reversed', 'Normal', 'Normal']);
    expect(port.write.mock.calls.some(([b]) => b[0] === 0x2f && [0x39, 0x3b].includes(b[1]))).toBe(false);
    port.heartbeat(); port.battery(); port.parameters();
    const result = await settle(service.installEscStartup(id, plan.id, installChecks));
    expect(result).toMatchObject({ state: 'verified', verifiedEscs: [1, 2, 3, 4] });
    expect(service.snapshot().esc?.escs.every(e => e.firmware === 'Bluejay')).toBe(true);
    port.memory!.forEach((image, i) => {
      expect(image[0x1a0b]).toBe(original[i][0x1a0b]);
      expect(image.subarray(0x1a70, 0x1af0).toString('hex')).toBe(plan.melodyHex);
      expect(image.subarray(0x1c00)).toEqual(original[i].subarray(0x1c00));
    });
    await expect(service.installEscStartup(id, plan.id, installChecks)).rejects.toThrow('plan');
  });
  it('refuses to turn a melody-only action into a firmware upgrade', async () => {
    const { service, port, id } = await fixture('ArduPilot', true);
    await expect(settle(service.prepareEscStartup(id, motifs[1], { ...checks, melodyOnly: true }))).rejects.toThrow('firmware setup first');
    expect(port.write.mock.calls.some(([b]) => b[0] === 0x2f && [0x39, 0x3b].includes(b[1]))).toBe(false);
  });
  it('changes only the saved melody after setup, then replays without flash writes', async () => {
    const { service, port, id } = await fixture('ArduPilot', true);
    const firmware = await loadBluejayImage();
    port.memory = port.memory!.map((image, i) => startupImage(image, decodeEscSettings(i + 1, 0xe8b2, 1, image.subarray(0x1a00, 0x1a70)), firmware, encodeBluejayMelody(motifs[0])).image);
    const originals = port.memory.map(b => Buffer.from(b));
    const plan = await settle(service.prepareEscStartup(id, motifs[1], { ...checks, melodyOnly: true }));
    expect(plan.requiresFirmwareChange).toBe(false);
    port.heartbeat(); port.battery(); port.parameters();
    await settle(service.installEscStartup(id, plan.id, { ...installChecks, firmwareChangeConfirmed: false }));
    port.memory.forEach((image, i) => {
      expect(image.subarray(0, 0x1a70)).toEqual(originals[i].subarray(0, 0x1a70));
      expect(image.subarray(0x1af0)).toEqual(originals[i].subarray(0x1af0));
    });
    port.heartbeat(); port.battery(); port.parameters(); port.write.mockClear();
    await expect(service.replayEscStartup(id, motifs[0], checks)).rejects.toThrow('Set this sound as startup');
    expect(port.write).not.toHaveBeenCalled();
    const result = await settle(service.replayEscStartup(id, motifs[1], checks));
    expect(result.state).toBe('sent');
    expect(port.write.mock.calls.some(([b]) => b[0] === 0x2f && [0x39, 0x3b].includes(b[1]))).toBe(false);
    expect(port.write.mock.calls.filter(([b]) => b[0] === 0x2f && b[1] === 0x35)).toHaveLength(4);
  });
  it('requires separate firmware approval and refuses a different or expired plan', async () => {
    const { service, port, id } = await fixture('ArduPilot', true);
    const plan = await settle(service.prepareEscStartup(id, motifs[0], checks));
    port.heartbeat(); port.battery(); port.parameters();
    await expect(service.installEscStartup(id, plan.id, { ...installChecks, firmwareChangeConfirmed: false })).rejects.toThrow('explicitly confirm');
    await expect(service.installEscStartup(id, 'different', installChecks)).rejects.toThrow('plan');
    vi.setSystemTime(plan.expiresAt + 1); port.heartbeat(); port.battery(); port.parameters();
    await expect(service.installEscStartup(id, plan.id, installChecks)).rejects.toThrow('expired');
    expect(port.write.mock.calls.some(([b]) => b[0] === 0x2f && [0x39, 0x3b].includes(b[1]))).toBe(false);
  });
  it('compares every ESC before writing any: a changed fourth device stops the whole install', async () => {
    const { service, port, id } = await fixture('ArduPilot', true);
    const plan = await settle(service.prepareEscStartup(id, motifs[0], checks));
    port.memory![3][0x100] ^= 1; port.heartbeat(); port.battery(); port.parameters();
    await expect(settle(service.installEscStartup(id, plan.id, installChecks))).rejects.toThrow('ESC 4 changed');
    expect(port.write.mock.calls.some(([b]) => b[0] === 0x2f && [0x39, 0x3b].includes(b[1]))).toBe(false);
  });
  it('fails closed on a lost write ACK and leaves the incomplete ESC in its bootloader', async () => {
    const { service, port, id } = await fixture('ArduPilot', true);
    const plan = await settle(service.prepareEscStartup(id, motifs[0], checks));
    port.failWrites = true; port.heartbeat(); port.battery(); port.parameters();
    await expect(settle(service.installEscStartup(id, plan.id, installChecks))).rejects.toThrow('Do not fly');
    expect(service.snapshot().escStartup).toMatchObject({ state: 'failed', recoveryRequired: true, verifiedEscs: [] });
    const frames = port.write.mock.calls.map(([b]) => b).filter(b => b[0] === 0x2f);
    const firstWrite = frames.findIndex(b => b[1] === 0x3b);
    expect(frames.slice(firstWrite + 1).some(b => b[1] === 0x35 || b[1] === 0x37)).toBe(false);
  });
});
describe('ESC service ownership and readback', () => {
  it('keeps decoding fresh heartbeats during the four-second outbound quiet interval', async () => {
    const { service, port, id } = await fixture();
    await vi.advanceTimersByTimeAsync(1500);
    const promise = service.readEscs(id, checks);
    await vi.advanceTimersByTimeAsync(3000); port.heartbeat();
    await vi.advanceTimersByTimeAsync(10000);
    expect(await promise).toMatchObject({ state: 'complete', telemetryRestored: true });
  });
  it('observes arming during the quiet interval and never enters passthrough', async () => {
    const { service, port, id } = await fixture();
    const promise = service.readEscs(id, checks);
    await vi.advanceTimersByTimeAsync(3000); port.heartbeat(true);
    await vi.advanceTimersByTimeAsync(12000);
    expect((await promise).state).toBe('failed');
    expect(port.write.mock.calls.every(([frame]) => frame[0] === 0xfd)).toBe(true);
  });
  it('reads all four ESCs, preserves direction and restores telemetry without writes or motor commands', async () => {
    const { service, port, id } = await fixture();
    const promise = service.readEscs(id, checks); await vi.advanceTimersByTimeAsync(10000);
    const report = await promise;
    expect(report).toMatchObject({ state: 'complete', count: 4, telemetryRestored: true });
    expect(report.escs.map(e => e.direction)).toEqual(['Normal', 'Reversed', 'Normal', 'Normal']);
    expect(report.escs.every(e => e.firmware === 'BLHeli_S' && e.version === '16.7')).toBe(true);
    expect(port.write.mock.calls.every(([b]) => b[0] === 0xfd ? wire.header(b).msgid === common.ParamRequestRead.MSG_ID : b[0] === 0x24 ? [1, 2, 245].includes(b[4]) : [0x37, 0x3a, 0x35, 0x34].includes(b[1]))).toBe(true);
    expect(service.escStatus('other-aircraft')).toBeNull();
  });
  it('reads full Bluejay melody memory only after identifying Bluejay', async () => {
    const { service, port, id } = await fixture(); port.bluejay = true;
    const promise = service.readEscs(id, checks); await vi.advanceTimersByTimeAsync(10000);
    expect((await promise).escs.every(e => e.startupMelody === 'supported' && e.settingsHex?.length === 510)).toBe(true);
  });
  it('reports partial results for an unpowered/unresponsive ESC with an explicit negative ACK', async () => {
    const { service, port, id } = await fixture(); port.negativeChannel = 1;
    const promise = service.readEscs(id, checks); await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;
    expect(result.state).toBe('partial'); expect(result.escs[1].error).toContain('ACK'); expect(result.escs[3].firmware).toBe('BLHeli_S');
  });
  it('blocks reads without operator checks, power, fresh heartbeat or disarmed status', async () => {
    const { service, port, id } = await fixture();
    await expect(service.readEscs(id, { ...checks, propsRemoved: false })).rejects.toThrow('Confirm');
    port.battery(220); await expect(service.readEscs(id, checks)).rejects.toThrow('battery');
    port.battery(); port.heartbeat(true); await expect(service.readEscs(id, checks)).rejects.toThrow('disarmed');
    port.heartbeat(); await vi.advanceTimersByTimeAsync(6000); await expect(service.readEscs(id, checks)).rejects.toThrow('fresh');
    expect(port.write).not.toHaveBeenCalled();
  });
  it('rejects a ground radio even when its serial path looks like a flight controller', async () => {
    const { service, port, id } = await fixture('Espressif');
    await expect(service.readEscs(id, checks)).rejects.toThrow('direct ArduPilot USB'); expect(port.write).not.toHaveBeenCalled();
  });
  it('owns the connection exclusively during passthrough, including motor stops and parameter writes', async () => {
    const { service, port, id } = await fixture(); port.silent = true;
    const promise = service.readEscs(id, checks); await vi.advanceTimersByTimeAsync(0);
    await expect(service.readParameters(id)).rejects.toThrow('ESC');
    await expect(service.setParameter(id, 'SERVO_BLH_AUTO', 0, 1)).rejects.toThrow('ESC');
    await expect(service.requestTelemetry(id)).rejects.toThrow('ESC');
    await expect(service.readEscs(id, checks)).rejects.toThrow('ESC');
    await expect(service.playTune(id, { name: 'x', bpm: 120, notes: [{ midi: 72, beats: 1 }] }, true)).rejects.toThrow('ESC');
    const count = port.write.mock.calls.length;
    await service.disconnect(); await vi.advanceTimersByTimeAsync(5000);
    expect((await promise).state).toBe('failed'); expect(port.write.mock.calls).toHaveLength(count);
  });
  it('fails closed when passthrough cannot exit or telemetry does not return', async () => {
    const { service, port, id } = await fixture(); port.restore = false;
    const promise = service.readEscs(id, checks); await vi.advanceTimersByTimeAsync(15000);
    expect(await promise).toMatchObject({ state: 'failed', telemetryRestored: false });
    expect(service.snapshot().link.state).toBe('error'); expect(port.isOpen).toBe(false);
  });
  it('times out boundedly, attempts exit and never labels an incomplete read successful', async () => {
    const { service, port, id } = await fixture(); port.silent = true;
    const promise = service.readEscs(id, checks); await vi.advanceTimersByTimeAsync(19000);
    expect(await promise).toMatchObject({ state: 'failed', escs: [] });
    expect(port.write.mock.calls.filter(([b]) => b[0] !== 0xfd).map(([b]) => b[0] === 0x24 ? b[4] : b[1])).toEqual([1]);
  });
});
