import { compileStoryboardBenchPlan, createBenchStoryboard } from '../core/bench-storyboard';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MavLinkProtocolV2, minimal, common, standard } from 'node-mavlink';
import { AircraftService, type AircraftSerialPort, type AircraftPortOptions } from './service';

const path = '/dev/cu.usbmodemTEST';
class FakePort extends EventEmitter {
  isOpen = false;
  openCallback?: (error: Error | null) => void;
  closeCallback?: (error: Error | null) => void;
  autoClose = true;
  write = vi.fn((_buffer: Buffer, callback: (error: Error | null) => void) => {
    callback(null);
    return true;
  });
  open = vi.fn((callback: (error: Error | null) => void) => {
    this.openCallback = callback;
  });
  close = vi.fn((callback: (error: Error | null) => void) => {
    this.closeCallback = callback;
    if (this.autoClose) this.finishClose();
  });
  finishOpen(error: Error | null = null) {
    this.isOpen = !error;
    this.openCallback?.(error);
  }
  finishClose(error: Error | null = null) {
    if (!error) {
      this.isOpen = false;
      this.emit('close');
    }
    this.closeCallback?.(error);
  }
}
function fixture() {
  let now = 1000;
  const ports: FakePort[] = [];
  const listPorts = vi.fn(async () => [{ path, manufacturer: 'USB', serialNumber: 'abc' }]);
  const createPort = vi.fn((_options: AircraftPortOptions) => {
    const port = new FakePort();
    ports.push(port);
    return port as unknown as AircraftSerialPort;
  });
  const service = new AircraftService({ listPorts, createPort, now: () => now });
  const start = async () => {
    const pending = service.connect(path);
    await Promise.resolve();
    await Promise.resolve();
    return { pending, port: ports[ports.length - 1] };
  };
  return {
    service,
    ports,
    listPorts,
    createPort,
    start,
    time: (value: number) => {
      now = value;
    },
  };
}
function heartbeat() {
  return new MavLinkProtocolV2(1, 1).serialize(
    Object.assign(new minimal.Heartbeat(), {
      type: 2,
      autopilot: 3,
      baseMode: 0,
      customMode: 0,
      systemStatus: 3,
      mavlinkVersion: 3,
    }),
    0
  );
}
afterEach(() => vi.useRealTimers());

it('checks fresh receiver input without requiring battery or GPS reporting', async () => {
  const f = fixture();
  const { pending, port } = await f.start();
  port.finishOpen();
  await pending;
  port.emit('data', heartbeat());
  const id = f.service.snapshot().aircraft[0].id;
  const result = f.service.requestRadioChannels(id);
  await Promise.resolve();
  const sent = port.write.mock.calls[0]?.[0] as Buffer;
  const protocol = new MavLinkProtocolV2();
  const command = protocol.data(protocol.payload(sent), common.CommandLong);
  expect([command.command, command._param1, command._param2]).toEqual([511, 65, 200000]);
  f.time(1100);
  port.emit('data', new MavLinkProtocolV2(1, 1).serialize(Object.assign(new common.RcChannels(), {
    chancount: 6, chan1Raw: 1500, chan2Raw: 1500, chan3Raw: 1000,
    chan4Raw: 1500, chan5Raw: 1815, chan6Raw: 1900, rssi: 90,
  }), 0));
  expect((await result).aircraft[0].receiver?.channels.slice(0, 6)).toEqual([1500, 1500, 1000, 1500, 1815, 1900]);
  await f.service.dispose();
});

describe('explicit receive-only aircraft link', () => {
  it('does not enumerate or open automatically and filters owned USB port metadata', async () => {
    const f = fixture();
    expect(f.service.snapshot().link).toMatchObject({
      state: 'disconnected',
      path: null,
      transmittedBytes: 0,
    });
    expect(f.listPorts).not.toHaveBeenCalled();
    expect(f.createPort).not.toHaveBeenCalled();
    f.listPorts.mockResolvedValue([
      { path: '/dev/cu.Bluetooth-Incoming-Port', manufacturer: 'x', serialNumber: 'x' },
      { path: '/tmp/cu.usbmodem1', manufacturer: 'x', serialNumber: 'x' },
      { path, manufacturer: 'x'.repeat(200), serialNumber: 's'.repeat(200) },
      { path, manufacturer: 'duplicate', serialNumber: '' },
    ]);
    const result = await f.service.ports();
    expect(result).toEqual([
      { path, manufacturer: 'x'.repeat(120), serialNumber: 's'.repeat(120) },
    ]);
    result[0].path = 'mutated';
    expect((await f.service.ports())[0].path).toBe(path);
  });

  it('opens only an enumerated port with fixed exclusive receive-only options and sends no bytes', async () => {
    const f = fixture();
    const { pending, port } = await f.start();
    expect(f.service.snapshot().link.state).toBe('connecting');
    expect(f.createPort).toHaveBeenCalledExactlyOnceWith({
      path,
      baudRate: 115200,
      autoOpen: false,
      lock: true,
      hupcl: false,
      highWaterMark: 16384,
    });
    port.finishOpen();
    expect((await pending).link).toMatchObject({
      state: 'listening',
      connectedAt: 1000,
      transmittedBytes: 0,
    });
    port.emit('data', heartbeat());
    const snapshot = f.service.snapshot();
    expect(snapshot.aircraft).toHaveLength(1);
    expect(snapshot.link).toMatchObject({
      packetsReceived: 1,
      bytesReceived: heartbeat().length,
      lastPacketAt: 1000,
      transmittedBytes: 0,
    });
    snapshot.aircraft[0].heartbeat.armed = true;
    expect(f.service.snapshot().aircraft[0].heartbeat.armed).toBe(false);
    await f.service.disconnect();
    expect(port.close).toHaveBeenCalledTimes(1);
    expect(port.write).not.toHaveBeenCalled();
  });

  it('normalizes enumerated macOS tty USB aliases to their cu call-out path', async () => {
    const f = fixture();
    f.listPorts.mockResolvedValue([
      { path: '/dev/tty.usbmodemTEST', manufacturer: 'USB', serialNumber: 'abc' },
    ]);
    expect((await f.service.ports()).map((port) => port.path)).toEqual([path]);
    const first = await f.start();
    first.port.finishOpen();
    await first.pending;
    expect(f.createPort.mock.calls[0][0]).toMatchObject({ path });
    await f.service.dispose();
  });

  it('retains original telemetry timestamps on disconnect and clears them on an explicit reconnect', async () => {
    const f = fixture();
    const first = await f.start();
    first.port.finishOpen();
    await first.pending;
    first.port.emit('data', heartbeat());
    const oldId = f.service.snapshot().aircraft[0].id;
    f.time(9000);
    await f.service.disconnect();
    expect(f.service.snapshot()).toMatchObject({
      now: 9000,
      link: { state: 'disconnected', lastPacketAt: 1000 },
      aircraft: [{ heartbeat: { receivedAt: 1000 } }],
    });
    first.port.emit('data', heartbeat());
    const second = await f.start();
    expect(f.service.snapshot().aircraft).toEqual([]);
    second.port.finishOpen();
    await second.pending;
    second.port.emit('data', heartbeat());
    expect(f.service.snapshot().aircraft[0].id).not.toBe(oldId);
    expect(f.service.snapshot().link.packetsReceived).toBe(1);
    first.port.emit('data', heartbeat());
    first.port.emit('error', new Error('late error'));
    expect(f.service.snapshot().link.state).toBe('listening');
    expect(f.service.snapshot().link.packetsReceived).toBe(1);
    await f.service.dispose();
  });

  it('rejects arbitrary paths, unsupported baud and unavailable enumerated ports', async () => {
    const f = fixture();
    for (const bad of [
      '/etc/passwd',
      '/dev/tty.usbmodemTEST',
      '/dev/cu.usbmodem../bad',
      path + '\n',
    ])
      await expect(f.service.connect(bad)).rejects.toThrow(/listed USB/);
    await expect(f.service.connect(path, 9600)).rejects.toThrow(/115200/);
    await expect(f.service.connect('/dev/cu.usbserialmissing')).rejects.toThrow(
      /no longer available/
    );
    expect(f.createPort).not.toHaveBeenCalled();
  });

  it('rejects simultaneous connects during enumeration and opening', async () => {
    const f = fixture();
    const first = f.service.connect(path);
    await expect(f.service.connect(path)).rejects.toMatchObject({ status: 409 });
    await Promise.resolve();
    await Promise.resolve();
    await expect(f.service.connect(path)).rejects.toMatchObject({ status: 409 });
    f.ports[0].finishOpen();
    await first;
    await expect(f.service.connect(path)).rejects.toMatchObject({ status: 409 });
    expect(f.createPort).toHaveBeenCalledTimes(1);
    await f.service.dispose();
  });

  it('cancels enumeration without opening a device after disconnect', async () => {
    const f = fixture();
    let finish!: (ports: { path: string; manufacturer: string; serialNumber: string }[]) => void;
    f.listPorts.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const pending = f.service.connect(path);
    const assertion = expect(pending).rejects.toThrow(/cancelled/);
    await f.service.disconnect();
    finish([{ path, manufacturer: 'USB', serialNumber: '' }]);
    await assertion;
    expect(f.createPort).not.toHaveBeenCalled();
    expect(f.service.snapshot().link.state).toBe('disconnected');
  });

  it('retains ownership through a cancelled pending native open and closes its late handle', async () => {
    const f = fixture();
    const { pending, port } = await f.start();
    const assertion = expect(pending).rejects.toThrow(/cancelled/);
    await f.service.disconnect();
    await assertion;
    await expect(f.service.connect(path)).rejects.toMatchObject({ status: 409 });
    expect(port.close).not.toHaveBeenCalled();
    port.finishOpen();
    expect(port.close).toHaveBeenCalledTimes(1);
    expect(port.isOpen).toBe(false);
    expect(f.service.snapshot().link.state).toBe('disconnected');
    const second = await f.start();
    second.port.finishOpen();
    await second.pending;
    await f.service.dispose();
  });

  it('holds ownership until asynchronous close completes and ignores late data', async () => {
    const f = fixture();
    const first = await f.start();
    first.port.finishOpen();
    await first.pending;
    first.port.autoClose = false;
    const closing = f.service.disconnect();
    await expect(f.service.connect(path)).rejects.toMatchObject({ status: 409 });
    first.port.emit('data', heartbeat());
    expect(f.service.snapshot().link.packetsReceived).toBe(0);
    first.port.finishClose();
    await closing;
    const next = await f.start();
    next.port.finishOpen();
    await next.pending;
    await f.service.dispose();
  });

  it('cleans up failed opens and device errors without retaining a ghost connection', async () => {
    const f = fixture();
    const first = await f.start();
    const rejected = expect(first.pending).rejects.toThrow(/occupied/);
    first.port.finishOpen(new Error('occupied by another process'));
    await rejected;
    expect(f.service.snapshot().link.state).toBe('error');
    const second = await f.start();
    second.port.finishOpen();
    await second.pending;
    second.port.emit('data', heartbeat());
    second.port.emit('error', new Error('USB removed'));
    expect(second.port.close).toHaveBeenCalledTimes(1);
    expect(f.service.snapshot()).toMatchObject({
      link: { state: 'error', error: 'USB removed' },
      aircraft: [{ heartbeat: { receivedAt: 1000 } }],
    });
    expect(second.port.listenerCount('data')).toBe(0);
    const third = await f.start();
    third.port.finishOpen();
    await third.pending;
    await f.service.dispose();
  });

  it('surfaces a physical close and keeps the last telemetry stale instead of inventing zero values', async () => {
    const f = fixture();
    const first = await f.start();
    first.port.finishOpen();
    await first.pending;
    first.port.emit('data', heartbeat());
    first.port.isOpen = false;
    first.port.emit('close');
    expect(f.service.snapshot()).toMatchObject({
      link: { state: 'disconnected', lastPacketAt: 1000 },
      aircraft: [{ battery: null }],
    });
  });

  it('bounds open and close waits while retaining ownership until late native cleanup', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const first = await f.start();
    const rejected = expect(first.pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(f.service.snapshot().link.state).toBe('error');
    await expect(f.service.connect(path)).rejects.toMatchObject({ status: 409 });
    first.port.finishOpen();
    expect(first.port.close).toHaveBeenCalledTimes(1);
    const second = await f.start();
    second.port.finishOpen();
    await second.pending;
    second.port.autoClose = false;
    const closeRejected = expect(f.service.disconnect()).rejects.toThrow(/Closing.*timed out/);
    await vi.advanceTimersByTimeAsync(5000);
    await closeRejected;
    await expect(f.service.connect(path)).rejects.toMatchObject({ status: 409 });
    second.port.finishClose();
    await f.service.dispose();
  });

  it('disposes an open or pending link once, prevents reuse and never writes', async () => {
    const f = fixture();
    const open = await f.start();
    open.port.finishOpen();
    await open.pending;
    await f.service.dispose();
    await f.service.dispose();
    expect(open.port.close).toHaveBeenCalledTimes(1);
    expect(open.port.write).not.toHaveBeenCalled();
    await expect(f.service.ports()).rejects.toMatchObject({ status: 503 });
    await expect(f.service.connect(path)).rejects.toMatchObject({ status: 503 });
    const g = fixture();
    const waiting = await g.start();
    const rejected = expect(waiting.pending).rejects.toThrow(/cancelled/);
    await g.service.dispose();
    await rejected;
    waiting.port.finishOpen();
    expect(waiting.port.isOpen).toBe(false);
    expect(waiting.port.write).not.toHaveBeenCalled();
  });
});

const protocol = new MavLinkProtocolV2(1, 1);
const ackFrame = (result = 0, targetSystem = 254) =>
  protocol.serialize(
    Object.assign(new common.CommandAck(), {
      command: 512,
      result,
      targetSystem,
      targetComponent: 190,
    }),
    0
  );
const versionFrame = () =>
  protocol.serialize(
    Object.assign(new standard.AutopilotVersion(), {
      flightSwVersion: 0x040506ff,
      capabilities: 0n,
    }),
    0
  );
async function requestFixture() {
  vi.useFakeTimers();
  const f = fixture(),
    first = await f.start();
  first.port.finishOpen();
  await first.pending;
  first.port.emit('data', heartbeat());
  return { ...f, port: first.port, id: f.service.snapshot().aircraft[0].id };
}
async function flushWrites() {
  for (let i = 0; i < 32; i++) await Promise.resolve();
}

async function benchFixture() {
  const f = await requestFixture();
  const information = f.service.requestTelemetry(f.id);
  await flushWrites();
  f.time(1100);
  f.port.emit(
    'data',
    Buffer.concat([
      ackFrame(),
      protocol.serialize(
        Object.assign(new standard.AutopilotVersion(), {
          flightSwVersion: 0x040701ff,
          capabilities: 0n,
        }),
        0
      ),
    ])
  );
  f.time(6000);
  f.port.emit('data', heartbeat());
  await vi.advanceTimersByTimeAsync(5000);
  await information;
  f.port.write.mockClear();
  return f;
}

describe('serial bench motor integration', () => {
  const checks = { propsRemoved: true, areaClear: true, hardwareCool: true };
  it('sends one fixed pulse after verified telemetry and stores its real decoded ACK separately', async () => {
    const f = await benchFixture();
    const pending = f.service.motorTest(f.id, 1, checks);
    await flushWrites();
    expect(f.port.write).toHaveBeenCalledTimes(1);
    const frame = f.port.write.mock.calls[0][0];
    expect(protocol.data(protocol.payload(frame), common.CommandLong)).toMatchObject({
      command: 209,
      targetSystem: 1,
      targetComponent: 1,
      _param1: 1,
      _param2: 0,
      _param3: 5,
      _param4: 1,
      _param5: 1,
      _param6: 0,
    });
    await expect(f.service.requestTelemetry(f.id)).rejects.toThrow(/motor test/);
    f.time(6100);
    f.port.emit(
      'data',
      protocol.serialize(
        Object.assign(new common.CommandAck(), {
          command: 209,
          result: 0,
          targetSystem: 254,
          targetComponent: 190,
        }),
        0
      )
    );
    await vi.advanceTimersByTimeAsync(25);
    expect((await pending).motorTest?.state).toBe('accepted');
    expect(f.service.snapshot().aircraft[0].lastAck?.command).toBe(512);
    expect(f.service.snapshot().aircraft[0].lastMotorAck?.command).toBe(209);
    await f.service.stopMotorTest(f.id);
    const stop = f.port.write.mock.calls[1][0];
    expect(protocol.data(protocol.payload(stop), common.CommandLong)).toMatchObject({
      command: 209,
      _param3: 0,
      _param4: 0,
    });
    expect(f.service.snapshot().motorTest?.state).toBe('stop-requested');
    await f.service.dispose();
  });

  it('cancels pending confirmation on disconnect and never replays a motor command on reconnect', async () => {
    const f = await benchFixture();
    const pending = f.service.motorTest(f.id, 1, checks);
    await flushWrites();
    await f.service.disconnect();
    await pending;
    expect(f.service.snapshot().motorTest?.state).toBe('unconfirmed');
    expect(f.port.write).toHaveBeenCalledTimes(1);
    const reopen = await f.start();
    reopen.port.finishOpen();
    await reopen.pending;
    reopen.port.emit('data', heartbeat());
    expect(reopen.port.write).not.toHaveBeenCalled();
    const newId = f.service.snapshot().aircraft[0].id;
    await expect(f.service.motorTest(newId, 1, checks)).rejects.toThrow();
    await expect(f.service.stopMotorTest(newId)).rejects.toThrow();
    await f.service.dispose();
  });
});

describe('bench show serial integration', () => {
  const storyboard = createBenchStoryboard();
  const reviewedPlanKey = compileStoryboardBenchPlan(storyboard).source.planKey;
  const checks = { propsRemoved: true, areaClear: true, hardwareCool: true };
  const runId = '460f29dc-32a8-4916-a620-06cb6fb09ff7';

  it('runs four fixed cues through the real motor controller and blocks competing operations', async () => {
    const f = await benchFixture();
    f.port.write.mockImplementation((buffer, callback) => {
      callback(null);
      const command = protocol.data(protocol.payload(buffer), common.CommandLong);
      if (command.command === 209 && command._param3 === 5) setTimeout(() => {
        f.port.emit('data', protocol.serialize(Object.assign(new common.CommandAck(), {
          command: 209, result: 0, targetSystem: 254, targetComponent: 190,
        }), 0));
      }, 1);
      return true;
    });
    expect(f.service.startBenchShow(f.id, runId, checks, storyboard, reviewedPlanKey).benchShow?.state).toBe('running');
    expect(f.port.write).not.toHaveBeenCalled();
    await expect(f.service.motorTest(f.id, 1, checks)).rejects.toThrow(/show/);
    await expect(f.service.stopMotorTest(f.id)).rejects.toThrow(/Stop show/);
    await expect(f.service.requestTelemetry(f.id)).rejects.toThrow();
    await expect(f.service.readParameters(f.id)).rejects.toThrow();
    for (let elapsed = 50; elapsed <= 24200; elapsed += 50) {
      f.time(6000 + elapsed);
      f.port.emit('data', heartbeat());
      if (elapsed % 500 === 0 && f.service.snapshot().benchShow?.state === 'running')
        f.service.renewBenchShow(runId);
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(f.service.snapshot().benchShow?.state).toBe('completed');
    expect(f.service.snapshot().benchShow?.cues.map((cue) => cue.state)).toEqual(Array(4).fill('confirmed'));
    expect(f.port.write).toHaveBeenCalledTimes(4);
    const commands = f.port.write.mock.calls.map(([frame]) => protocol.data(protocol.payload(frame), common.CommandLong));
    expect(commands.map((command) => command._param1)).toEqual([1, 2, 3, 4]);
    for (const command of commands) expect(command).toMatchObject({
      command: 209, targetSystem: 1, targetComponent: 1, _param2: 0,
      _param3: 5, _param4: 1, _param5: 1, _param6: 0, _param7: 0,
    });
    await f.service.dispose();
  });

  it('compiles edited scene timing and motor assignments into the actual serial schedule, retaining its source', async () => {
    const f = await benchFixture();
    const edited = createBenchStoryboard('My authored motor show', 'authored-show');
    edited.revision = 7;
    edited.cues[0].duration = 8;
    ([4, 2, 1, 3] as const).forEach((motor, index) => { edited.cues[index].benchCue!.motor = motor; });
    const plan = compileStoryboardBenchPlan(edited);
    const sent: { atMs: number; motor: number }[] = [];
    const beganAt = Date.now();
    f.port.write.mockImplementation((buffer, callback) => {
      callback(null);
      const command = protocol.data(protocol.payload(buffer), common.CommandLong);
      expect(command).toMatchObject({ command: 209, _param2: 0, _param3: 5, _param4: 1, _param5: 1 });
      sent.push({ atMs: Date.now() - beganAt, motor: command._param1 });
      setTimeout(() => f.port.emit('data', protocol.serialize(Object.assign(new common.CommandAck(), {
        command: 209, result: 0, targetSystem: 254, targetComponent: 190,
      }), 0)), 1);
      return true;
    });
    const started = f.service.startBenchShow(f.id, runId, checks, edited, plan.source.planKey);
    expect(started.benchShow).toMatchObject({ source: plan.source, durationMs: 26000 });
    // Neither project mutations nor returned status mutations may alter the captured run.
    edited.cues[0].duration = 60;
    edited.name = 'Later edit';
    started.benchShow!.source.name = 'Mutated response';
    for (let elapsed = 50; elapsed <= 26200; elapsed += 50) {
      f.time(6000 + elapsed);
      f.port.emit('data', heartbeat());
      if (elapsed % 500 === 0 && f.service.snapshot().benchShow?.state === 'running')
        f.service.renewBenchShow(runId);
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(sent).toEqual([
      { atMs: 3000, motor: 4 }, { atMs: 11000, motor: 2 },
      { atMs: 17000, motor: 1 }, { atMs: 23000, motor: 3 },
    ]);
    expect(f.service.snapshot().benchShow).toMatchObject({
      state: 'completed', source: plan.source, durationMs: 26000, elapsedMs: 26000,
      cues: plan.cues.map(cue => ({ ...cue, state: 'confirmed' })),
    });
    await f.service.dispose();
  });

  it('requires an authored valid project and exact reviewed key before accessing the motor controller', async () => {
    const f = await benchFixture();
    const edited = createBenchStoryboard();
    const oldKey = compileStoryboardBenchPlan(edited).source.planKey;
    edited.cues[0].duration = 8;
    for (const [project, key] of [[undefined, oldKey], [edited, oldKey], [edited, '']] as const) {
      expect(() => f.service.startBenchShow(f.id, runId, checks, project, key)).toThrow();
      expect(f.service.snapshot().benchShow).toBeUndefined();
    }
    edited.cues[0].altitude = 5;
    expect(() => f.service.startBenchShow(f.id, runId, checks, edited, oldKey)).toThrow(/fixed at the origin/);
    expect(f.port.write).not.toHaveBeenCalled();
    await f.service.dispose();
  });

  it('rejects show start while a parameter request is still writing', async () => {
    const f = await benchFixture();
    let finish!: (error: Error | null) => void;
    f.port.write.mockImplementation((_buffer, callback) => { finish = callback; return true; });
    const reading = f.service.readParameters(f.id);
    expect(() => f.service.startBenchShow(f.id, runId, checks, storyboard, reviewedPlanKey)).toThrow(/telemetry request/);
    expect(f.service.snapshot().benchShow).toBeUndefined();
    finish(null);
    await reading;
    await f.service.dispose();
  });

  it('disconnecting during the lead-in cancels the schedule and reconnect cannot replay it', async () => {
    const f = await benchFixture();
    f.service.startBenchShow(f.id, runId, checks, storyboard, reviewedPlanKey);
    await f.service.disconnect();
    const state = f.service.snapshot().benchShow?.state;
    expect(['cancelled', 'failed']).toContain(state);
    const reopen = await f.start();
    reopen.port.finishOpen();
    await reopen.pending;
    for (let elapsed = 500; elapsed <= 25000; elapsed += 500) {
      f.time(6000 + elapsed);
      reopen.port.emit('data', heartbeat());
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(f.port.write).not.toHaveBeenCalled();
    expect(reopen.port.write).not.toHaveBeenCalled();
    expect(f.service.snapshot().benchShow?.state).toBe(state);
    await f.service.dispose();
  });
});

describe('explicit fixed telemetry request', () => {
  it('sends only the ten fixed targeted reporting frames and requires fresh ACK/version/all groups', async () => {
    const f = await requestFixture();
    const pending = f.service.requestTelemetry(f.id);
    await flushWrites();
    expect(f.port.write).toHaveBeenCalledTimes(10);
    const commands = f.port.write.mock.calls.map(([frame]) => {
      const header = protocol.header(frame);
      expect(header).toMatchObject({ sysid: 254, compid: 190, msgid: 76 });
      const command = protocol.data(protocol.payload(frame), common.CommandLong);
      expect(command).toMatchObject({ targetSystem: 1, targetComponent: 1, confirmation: 0 });
      return [command.command, command._param1, command._param2];
    });
    expect(commands).toEqual([
      [511, 30, 200000],
      [511, 33, 500000],
      [511, 24, 1000000],
      [511, 1, 1000000],
      [511, 147, 1000000],
      [511, 65, 200000],
      [511, 193, 500000],
      [511, 245, 500000],
      [511, 42, 500000],
      [512, 148, 0],
    ]);
    expect(f.service.snapshot().request?.state).toBe('pending');
    f.time(1100);
    f.port.emit(
      'data',
      Buffer.concat([
        ackFrame(),
        versionFrame(),
        protocol.serialize(Object.assign(new common.Attitude(), { roll: 0.1 }), 0),
        protocol.serialize(Object.assign(new common.GpsRawInt(), { fixType: 1 }), 0),
        protocol.serialize(Object.assign(new common.GlobalPositionInt(), { lat: 405000000 }), 0),
        protocol.serialize(Object.assign(new common.SysStatus(), { voltageBattery: 15000 }), 0),
      ])
    );
    f.time(6000);
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;
    expect(result.request?.state).toBe('verified');
    expect(result.link.transmittedBytes).toBe(
      f.port.write.mock.calls.reduce((sum, [frame]) => sum + frame.length, 0)
    );
    expect(f.port.write).toHaveBeenCalledTimes(10);
    await f.service.dispose();
  });

  it('reports confirmed bidirectional telemetry as partial when reporting groups are missing', async () => {
    const f = await requestFixture();
    const pending = f.service.requestTelemetry(f.id);
    await flushWrites();
    f.time(1100);
    f.port.emit('data', Buffer.concat([ackFrame(0, 0), versionFrame()]));
    f.time(6000);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).request).toMatchObject({ state: 'partial', aircraftId: f.id });
    await f.service.dispose();
  });

  it.each(['none', 'ack-only', 'version-only', 'wrong-target', 'rejected', 'old-evidence'])(
    'does not claim confirmation from %s evidence',
    async (kind) => {
      const f = await requestFixture();
      if (kind === 'old-evidence') f.port.emit('data', Buffer.concat([ackFrame(), versionFrame()]));
      const pending = f.service.requestTelemetry(f.id);
      await flushWrites();
      f.time(1100);
      if (kind === 'ack-only') f.port.emit('data', ackFrame());
      if (kind === 'version-only') f.port.emit('data', versionFrame());
      if (kind === 'wrong-target')
        f.port.emit('data', Buffer.concat([ackFrame(0, 200), versionFrame()]));
      if (kind === 'rejected') f.port.emit('data', Buffer.concat([ackFrame(2), versionFrame()]));
      f.time(6000);
      await vi.advanceTimersByTimeAsync(5000);
      expect((await pending).request?.state).toBe('failed');
      expect(f.port.write).toHaveBeenCalledTimes(10);
      await f.service.dispose();
    }
  );

  it.each(['unknown', 'stale', 'armed', 'signed'])(
    'rejects a %s aircraft before writing',
    async (kind) => {
      const f = await requestFixture();
      if (kind === 'stale') f.time(6001);
      if (kind === 'armed')
        f.port.emit(
          'data',
          protocol.serialize(
            Object.assign(new minimal.Heartbeat(), {
              type: 2,
              autopilot: 3,
              baseMode: 128,
              mavlinkVersion: 3,
            }),
            0
          )
        );
      if (kind === 'signed') {
        const signed = new MavLinkProtocolV2(1, 1, 1);
        f.port.emit(
          'data',
          signed.sign(
            signed.serialize(
              Object.assign(new minimal.Heartbeat(), {
                type: 2,
                autopilot: 3,
                baseMode: 0,
                mavlinkVersion: 3,
              }),
              0
            ),
            1,
            Buffer.alloc(32),
            Date.now()
          )
        );
      }
      await expect(
        f.service.requestTelemetry(kind === 'unknown' ? 'wrong' : f.id)
      ).rejects.toMatchObject({ status: 409 });
      expect(f.port.write).not.toHaveBeenCalled();
      await f.service.dispose();
    }
  );

  it('rejects a second pending request and cancels remaining writes immediately on disconnect', async () => {
    const f = await requestFixture();
    let completeWrite!: (error: Error | null) => void;
    f.port.write.mockImplementation((_buffer, callback) => {
      completeWrite = callback;
      return true;
    });
    const pending = f.service.requestTelemetry(f.id);
    const rejected = expect(pending).rejects.toThrow(/disconnected/);
    await expect(f.service.requestTelemetry(f.id)).rejects.toMatchObject({ status: 409 });
    await f.service.disconnect();
    await rejected;
    completeWrite(null);
    await flushWrites();
    expect(f.port.write).toHaveBeenCalledTimes(1);
    expect(f.service.snapshot().request?.state).toBe('failed');
  });

  it('rechecks armed state after incoming telemetry before any further write', async () => {
    const f = await requestFixture();
    f.port.write.mockImplementation((_buffer, callback) => {
      f.port.emit(
        'data',
        protocol.serialize(
          Object.assign(new minimal.Heartbeat(), {
            type: 2,
            autopilot: 3,
            baseMode: 128,
            mavlinkVersion: 3,
          }),
          0
        )
      );
      callback(null);
      return true;
    });
    await expect(f.service.requestTelemetry(f.id)).rejects.toThrow(/disarmed/);
    expect(f.port.write).toHaveBeenCalledTimes(1);
    expect(f.service.snapshot().request?.state).toBe('failed');
    await f.service.dispose();
  });

  it('bounds a stalled write with no retry and clears the pending request', async () => {
    const f = await requestFixture();
    f.port.write.mockImplementation(() => true);
    const pending = f.service.requestTelemetry(f.id);
    const rejected = expect(pending).rejects.toThrow(/Writing.*timed out/);
    await vi.advanceTimersByTimeAsync(1500);
    await rejected;
    expect(f.port.write).toHaveBeenCalledTimes(1);
    expect(f.service.snapshot().request?.state).toBe('failed');
    await f.service.dispose();
  });

  it('fails a stale heartbeat while awaiting evidence instead of approving a late response', async () => {
    const f = await requestFixture();
    const pending = f.service.requestTelemetry(f.id);
    await flushWrites();
    const rejected = expect(pending).rejects.toThrow(/fresh aircraft heartbeat/);
    f.time(6001);
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(f.service.snapshot().request?.state).toBe('failed');
    await f.service.dispose();
  });
});

it('guards the diagnostic endpoint and sends no arm or configuration commands', async () => {
  const f = fixture();
  await expect(f.service.runPrearmChecks('missing')).rejects.toThrow('Connect');
  const { pending, port } = await f.start(); port.finishOpen(); await pending;
  port.emit('data', heartbeat());
  const id = f.service.snapshot().aircraft[0].id;
  const result = await f.service.runPrearmChecks(id);
  expect(result.requestedAt).toBe(1000);
  const protocol = new MavLinkProtocolV2();
  expect(port.write.mock.calls.map(([frame]) => protocol.data(protocol.payload(frame), common.CommandLong).command)).toEqual([401, 511, 511]);
  const count = port.write.mock.calls.length;
  port.emit('data', new MavLinkProtocolV2(1, 1).serialize(Object.assign(new minimal.Heartbeat(), { type: 2, autopilot: 3, baseMode: 128, mavlinkVersion: 3 }), 0));
  await expect(f.service.runPrearmChecks(id)).rejects.toThrow('disarmed');
  expect(port.write.mock.calls.length).toBe(count);
  await f.service.dispose();
});
