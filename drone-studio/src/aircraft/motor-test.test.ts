import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MavLinkProtocolV2, common, x25crc } from 'node-mavlink';
import { MotorTestController, motorTestFrame, type MotorTestChecks } from './motor-test';
import type { AircraftSnapshot, AircraftTelemetry } from './types';

const checks: MotorTestChecks = { propsRemoved: true, areaClear: true, hardwareCool: true };
const protocol = new MavLinkProtocolV2();
const decode = (frame: Buffer) => protocol.data(protocol.payload(frame), common.CommandLong);

function fixture() {
  const aircraft: AircraftTelemetry = {
    id: 'link:7:1', systemId: 7, componentId: 1, protocolVersion: 2, signing: 'unsigned',
    heartbeat: {
      receivedAt: 10_000, armed: false, mode: 'Stabilize', customMode: 0,
      systemStatus: 'Standby', autopilot: 3, vehicleType: 2,
    },
    attitude: null, gps: null, position: null, battery: null, messages: [],
    version: { receivedAt: 9500, flightVersion: '4.7.1', releaseType: 255 },
  };
  const snapshot: AircraftSnapshot = {
    now: 10_000,
    link: {
      state: 'listening', path: '/dev/cu.usbmodem1', baudRate: 115200, connectedAt: 9000,
      error: null, bytesReceived: 100, packetsReceived: 2, invalidFrames: 0,
      lastPacketAt: 10_000, transmittedBytes: 0,
    },
    aircraft: [aircraft],
    request: { state: 'verified', aircraftId: aircraft.id, startedAt: 9200, message: 'Confirmed' },
  };
  let now = 10_000;
  let sequence = 254;
  const write = vi.fn<(frame: Buffer) => Promise<void>>().mockResolvedValue();
  const busy = vi.fn(() => false);
  const controller = new MotorTestController({
    snapshot: () => ({ ...snapshot, now }),
    write,
    nextSequence: () => { const value = sequence; sequence = (sequence + 1) % 256; return value; },
    telemetryBusy: busy,
  });
  const ack = (overrides: Partial<NonNullable<AircraftTelemetry['lastMotorAck']>> = {}) => {
    aircraft.lastMotorAck = {
      receivedAt: now + 1, command: 209, result: 0,
      targetSystem: 254, targetComponent: 190, ...overrides,
    };
  };
  const advance = async (ms: number) => { now += ms; await vi.advanceTimersByTimeAsync(ms); };
  return { aircraft, snapshot, write, busy, controller, ack, advance, now: () => now };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('fixed motor-test frames', () => {
  it('encodes only one 5%/one-second sequence pulse or a zero-duration stop, with valid CRC', () => {
    for (const motor of [1, 2, 3, 4]) {
      for (const stop of [false, true]) {
        const frame = motorTestFrame(7, 1, motor, 255, stop);
        expect(protocol.header(frame)).toMatchObject({ sysid: 254, compid: 190, msgid: 76, seq: 255 });
        expect(protocol.crc(frame)).toBe(x25crc(frame, 1, 2, common.CommandLong.MAGIC_NUMBER));
        expect(decode(frame)).toMatchObject({
          targetSystem: 7, targetComponent: 1, command: 209, confirmation: 0,
          _param1: motor, _param2: 0, _param3: stop ? 0 : 5, _param4: stop ? 0 : 1,
          _param5: 1, _param6: 0, _param7: 0,
        });
      }
    }
  });

  it('rejects invalid identity, sequence, and motor inputs instead of truncating them', () => {
    for (const system of [0, -1, 1.5, 256, 254, NaN])
      expect(() => motorTestFrame(system, 1, 1, 0)).toThrow();
    for (const component of [0, 2, 256, NaN])
      expect(() => motorTestFrame(7, component, 1, 0)).toThrow();
    for (const motor of [0, 5, 1.1, NaN])
      expect(() => motorTestFrame(7, 1, motor, 0)).toThrow();
    for (const sequence of [-1, 256, 1.1, NaN])
      expect(() => motorTestFrame(7, 1, 1, sequence)).toThrow();
  });
});

describe('motor-test start gates', () => {
  const guards: [string, (f: ReturnType<typeof fixture>) => void][] = [
    ['disconnected', f => { f.snapshot.link.state = 'disconnected'; }],
    ['connecting', f => { f.snapshot.link.state = 'connecting'; }],
    ['error', f => { f.snapshot.link.state = 'error'; }],
    ['missing link path', f => { f.snapshot.link.path = null; }],
    ['missing connection time', f => { f.snapshot.link.connectedAt = null; }],
    ['unknown aircraft', f => { f.snapshot.aircraft = []; }],
    ['multiple aircraft', f => { f.snapshot.aircraft.push({ ...f.aircraft, id: 'other' }); }],
    ['wrong autopilot', f => { f.aircraft.heartbeat.autopilot = 12; }],
    ['wrong frame', f => { f.aircraft.heartbeat.vehicleType = 1; }],
    ['wrong component', f => { f.aircraft.componentId = 2; }],
    ['signed', f => { f.aircraft.signing = 'unverified'; }],
    ['stale heartbeat', f => { f.aircraft.heartbeat.receivedAt = 4999; }],
    ['future heartbeat', f => { f.aircraft.heartbeat.receivedAt = 10_001; }],
    ['invalid heartbeat time', f => { f.aircraft.heartbeat.receivedAt = NaN; }],
    ['armed', f => { f.aircraft.heartbeat.armed = true; }],
    ['busy telemetry', f => { f.busy.mockReturnValue(true); }],
    ['unknown firmware', f => { f.aircraft.version = undefined; }],
    ['other firmware', f => { f.aircraft.version!.flightVersion = '4.7.0'; }],
    ['prerelease firmware', f => { f.aircraft.version!.releaseType = 192; }],
    ['old firmware evidence', f => { f.aircraft.version!.receivedAt = 8999; }],
    ['future firmware evidence', f => { f.aircraft.version!.receivedAt = 10_001; }],
    ['no bidirectional evidence', f => { f.snapshot.request = undefined; }],
    ['failed bidirectional evidence', f => { f.snapshot.request!.state = 'failed'; }],
    ['other target evidence', f => { f.snapshot.request!.aircraftId = 'other'; }],
    ['previous link evidence', f => { f.snapshot.request!.startedAt = 8999; }],
  ];
  it.each(guards)('blocks %s without sending any frame', async (_name, change) => {
    const f = fixture(); change(f);
    await expect(f.controller.start(f.aircraft.id, 1, checks)).rejects.toMatchObject({ status: 409 });
    expect(f.write).not.toHaveBeenCalled();
    expect(f.controller.pending).toBe(false);
  });

  it.each(['propsRemoved', 'areaClear', 'hardwareCool'] as const)('requires explicit %s confirmation', async key => {
    const f = fixture();
    await expect(f.controller.start(f.aircraft.id, 1, { ...checks, [key]: false }))
      .rejects.toMatchObject({ status: 400 });
    expect(f.write).not.toHaveBeenCalled();
  });

  it('rejects malformed choices before writing', async () => {
    const f = fixture();
    for (const motor of [0, 5, NaN, 1.5])
      await expect(f.controller.start(f.aircraft.id, motor, checks)).rejects.toMatchObject({ status: 400 });
    for (const id of ['', 'x'.repeat(121)])
      await expect(f.controller.start(id, 1, checks)).rejects.toMatchObject({ status: 400 });
    await expect(f.controller.start('unknown', 1, checks)).rejects.toMatchObject({ status: 409 });
    expect(f.write).not.toHaveBeenCalled();
  });
});

describe('bounded pulse acknowledgement', () => {
  it('accepts a matching ACK while armed without claiming measured movement, and cleans up', async () => {
    const f = fixture();
    f.snapshot.request!.state = 'partial';
    const pending = f.controller.start(f.aircraft.id, 3, checks);
    expect(f.controller.pending).toBe(true);
    expect(f.controller.status).toMatchObject({ state: 'pending', motor: 3, startedAt: 10_000, availableAt: 15_000 });
    await expect(f.controller.start(f.aircraft.id, 2, checks)).rejects.toMatchObject({ status: 409 });
    f.aircraft.heartbeat.armed = true;
    f.ack();
    await f.advance(25);
    await pending;
    expect(f.controller.status?.state).toBe('accepted');
    expect(f.controller.status?.message).toMatch(/Confirm.*visually/);
    expect(f.controller.pending).toBe(false);
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(decode(f.write.mock.calls[0][0])._param1).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([1, 2, 3, 4, 6, 7, 8, 9])('reports ACK result %s as rejected with no retry', async result => {
    const f = fixture();
    const pending = f.controller.start(f.aircraft.id, 1, checks);
    f.ack({ result });
    await f.advance(25); await pending;
    expect(f.controller.status?.state).toBe('rejected');
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps an uncertain write fenced after late completion while allowing its owned stop', async () => {
    const f = fixture();
    let completeWrite!: () => void;
    f.write.mockImplementation(() => new Promise(resolve => { completeWrite = resolve; }));
    const pulse = f.controller.start(f.aircraft.id, 1, checks);
    await f.advance(2000); await pulse;
    completeWrite();
    await f.advance(4000);
    f.aircraft.heartbeat.receivedAt = f.now();
    await expect(f.controller.start(f.aircraft.id, 2, checks)).rejects.toThrow(/reconnect/);
    f.write.mockResolvedValue();
    await f.controller.stop(f.aircraft.id);
    expect(f.write).toHaveBeenCalledTimes(2);
    expect(decode(f.write.mock.calls[1][0])).toMatchObject({ _param3: 0, _param4: 0 });
    expect(f.controller.status?.state).toBe('stop-requested');
    await f.advance(5000);
    f.aircraft.heartbeat.receivedAt = f.now();
    await expect(f.controller.start(f.aircraft.id, 2, checks)).rejects.toThrow(/reconnect/);
    expect(f.write).toHaveBeenCalledTimes(2);
  });

  it.each(['none', 'old', 'same-time', 'future', 'wrong-command', 'wrong-system', 'wrong-component', 'progress', 'other-message'])(
    'leaves %s ACK evidence unconfirmed after two seconds without retry', async kind => {
      const f = fixture();
      const pending = f.controller.start(f.aircraft.id, 1, checks);
      if (kind !== 'none') f.ack();
      if (kind === 'old') f.ack({ receivedAt: 9999 });
      if (kind === 'same-time') f.ack({ receivedAt: 10_000 });
      if (kind === 'future') f.ack({ receivedAt: 20_000 });
      if (kind === 'wrong-command') f.ack({ command: 512 });
      if (kind === 'wrong-system') f.ack({ targetSystem: 10 });
      if (kind === 'wrong-component') f.ack({ targetComponent: 1 });
      if (kind === 'progress') f.ack({ result: 5 });
      if (kind === 'other-message') { f.aircraft.lastAck = f.aircraft.lastMotorAck; f.aircraft.lastMotorAck = undefined; }
      await f.advance(2000); await pending;
      expect(f.controller.status?.state).toBe('unconfirmed');
      expect(f.controller.pending).toBe(false);
      expect(f.write).toHaveBeenCalledTimes(1);
      await f.advance(20_000);
      expect(f.write).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('accepts MAVLink1-style zero target extension fields', async () => {
    const f = fixture();
    const pending = f.controller.start(f.aircraft.id, 1, checks);
    f.ack({ targetSystem: 0, targetComponent: 0 });
    await f.advance(25); await pending;
    expect(f.controller.status?.state).toBe('accepted');
  });

  it.each(['reject', 'throw', 'stall'])('treats a %s write as unknown and never retries', async kind => {
    const f = fixture();
    if (kind === 'reject') f.write.mockRejectedValue(new Error('USB failure'));
    if (kind === 'throw') f.write.mockImplementation(() => { throw new Error('USB failure'); });
    if (kind === 'stall') f.write.mockImplementation(() => new Promise(() => {}));
    const pending = f.controller.start(f.aircraft.id, 1, checks);
    await f.advance(2000); await pending;
    expect(f.controller.status?.state).toBe('unconfirmed');
    expect(f.controller.pending).toBe(false);
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await f.advance(4000);
    f.aircraft.heartbeat.receivedAt = f.now();
    await expect(f.controller.start(f.aircraft.id, 2, checks)).rejects.toThrow(/reconnect/);
    expect(f.write).toHaveBeenCalledTimes(1);
  });

  it('requires both cooldown and post-pulse fresh disarmed telemetry before another pulse', async () => {
    const f = fixture();
    const first = f.controller.start(f.aircraft.id, 1, checks);
    f.ack(); await f.advance(25); await first;
    await expect(f.controller.start(f.aircraft.id, 2, checks)).rejects.toThrow(/five seconds/);
    await f.advance(4975);
    await expect(f.controller.start(f.aircraft.id, 2, checks)).rejects.toThrow(/after the previous pulse/);
    f.aircraft.heartbeat.receivedAt = f.now();
    f.aircraft.heartbeat.armed = true;
    await expect(f.controller.start(f.aircraft.id, 2, checks)).rejects.toThrow(/Disarm/);
    f.aircraft.heartbeat.armed = false;
    const second = f.controller.start(f.aircraft.id, 2, checks);
    f.ack(); await f.advance(25); await second;
    expect(f.write).toHaveBeenCalledTimes(2);
    expect(f.write.mock.calls.map(([frame]) => protocol.header(frame).seq)).toEqual([254, 255]);
  });
});

describe('stop and link cancellation', () => {
  it('supersedes the pulse immediately and ignores late start/stop ACKs', async () => {
    const f = fixture();
    const pulse = f.controller.start(f.aircraft.id, 4, checks);
    let completeStop!: () => void;
    f.write.mockImplementation(() => new Promise(resolve => { completeStop = resolve; }));
    f.aircraft.heartbeat.armed = true;
    f.aircraft.heartbeat.receivedAt = 1;
    const stop = f.controller.stop(f.aircraft.id);
    await pulse;
    expect(f.controller.pending).toBe(true);
    expect(f.controller.status?.state).toBe('stop-requested');
    expect(decode(f.write.mock.calls[1][0])).toMatchObject({ _param1: 4, _param3: 0, _param4: 0, _param5: 1 });
    await expect(f.controller.stop(f.aircraft.id)).rejects.toMatchObject({ status: 409 });
    await expect(f.controller.start(f.aircraft.id, 1, checks)).rejects.toMatchObject({ status: 409 });
    f.ack(); await f.advance(25);
    completeStop(); await stop;
    expect(f.controller.status?.state).toBe('stop-requested');
    expect(f.controller.pending).toBe(false);
    expect(f.write).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows a best-effort stop after invalidation on the same listening identity only', async () => {
    const f = fixture();
    const pulse = f.controller.start(f.aircraft.id, 1, checks);
    f.controller.invalidate('Telemetry changed'); await pulse;
    await expect(f.controller.start(f.aircraft.id, 1, checks)).rejects.toMatchObject({ status: 409 });
    await f.controller.stop(f.aircraft.id);
    expect(f.write).toHaveBeenCalledTimes(2);
    expect(f.controller.status?.state).toBe('stop-requested');
    f.snapshot.link.connectedAt = 10_001;
    await expect(f.controller.stop(f.aircraft.id)).rejects.toThrow(/belongs/);
    expect(f.write).toHaveBeenCalledTimes(2);
  });

  it.each(['none', 'other-aircraft', 'other-link', 'disconnected'])('never sends a stop for %s ownership', async kind => {
    const f = fixture();
    if (kind !== 'none') {
      const pulse = f.controller.start(f.aircraft.id, 1, checks);
      await f.advance(2000); await pulse;
    }
    if (kind === 'other-aircraft') f.aircraft.id = 'new:7:1';
    if (kind === 'other-link') f.snapshot.link.path = '/dev/cu.usbmodem2';
    if (kind === 'disconnected') f.snapshot.link.state = 'disconnected';
    const writes = f.write.mock.calls.length;
    await expect(f.controller.stop(f.aircraft.id)).rejects.toMatchObject({ status: 409 });
    expect(f.write).toHaveBeenCalledTimes(writes);
  });

  it.each(['reject', 'stall'])('bounds a %s stop write and leaves motor state unknown', async kind => {
    const f = fixture();
    const pulse = f.controller.start(f.aircraft.id, 1, checks);
    f.write.mockImplementation(() => kind === 'reject' ? Promise.reject(new Error('USB')) : new Promise(() => {}));
    const stop = f.controller.stop(f.aircraft.id);
    await f.advance(1500); await Promise.all([pulse, stop]);
    expect(f.controller.status?.state).toBe('unconfirmed');
    expect(f.controller.pending).toBe(false);
    expect(f.write).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    await f.advance(4000);
    f.aircraft.heartbeat.receivedAt = f.now();
    await expect(f.controller.start(f.aircraft.id, 2, checks)).rejects.toThrow(/reconnect/);
    expect(f.write).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending write wait on disconnect and ignores its late completion and ACK', async () => {
    const f = fixture();
    let completeWrite!: () => void;
    f.write.mockImplementation(() => new Promise(resolve => { completeWrite = resolve; }));
    const pulse = f.controller.start(f.aircraft.id, 1, checks);
    f.snapshot.link.state = 'disconnected';
    f.controller.invalidate('USB disconnected'); await pulse;
    expect(f.controller.pending).toBe(false);
    expect(f.controller.status?.state).toBe('unconfirmed');
    completeWrite(); f.ack(); await f.advance(10_000);
    expect(f.controller.status?.state).toBe('unconfirmed');
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['extra-aircraft', 'identity', 'signed', 'connection'])('invalidates ACK wait when %s changes', async kind => {
    const f = fixture();
    const pulse = f.controller.start(f.aircraft.id, 1, checks);
    if (kind === 'extra-aircraft') f.snapshot.aircraft.push({ ...f.aircraft, id: 'other' });
    if (kind === 'identity') f.aircraft.systemId = 8;
    if (kind === 'signed') f.aircraft.signing = 'unverified';
    if (kind === 'connection') f.snapshot.link.connectedAt = 9001;
    f.ack(); await f.advance(25); await pulse;
    expect(f.controller.status?.state).toBe('unconfirmed');
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never replays on reconnect; only a new manually confirmed request can write', async () => {
    const f = fixture();
    const first = f.controller.start(f.aircraft.id, 1, checks);
    f.controller.invalidate('Disconnected'); await first;
    await f.advance(6000);
    f.aircraft.id = 'new-link:7:1';
    f.aircraft.heartbeat.receivedAt = f.now();
    f.aircraft.version!.receivedAt = f.now();
    f.aircraft.lastMotorAck = undefined;
    f.snapshot.link.connectedAt = f.now();
    f.snapshot.request = { state: 'partial', aircraftId: f.aircraft.id, startedAt: f.now(), message: 'Confirmed' };
    await f.advance(25);
    expect(f.write).toHaveBeenCalledTimes(1);
    const second = f.controller.start(f.aircraft.id, 2, checks);
    f.ack(); await f.advance(25); await second;
    expect(f.controller.status?.state).toBe('accepted');
    expect(f.write).toHaveBeenCalledTimes(2);
  });
});
