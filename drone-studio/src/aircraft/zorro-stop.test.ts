import { afterEach, describe, expect, it, vi } from 'vitest';
import { common, MavLinkProtocolV2 } from 'node-mavlink';
import { createZorroStopStoryboard } from '../core/zorro-test';
import type { AircraftParameter } from './parameters';
import type { AircraftSnapshot } from './types';
import { armFrame, ZorroStopController } from './zorro-stop';

const first = 10_000;
const aircraftId = 'link:1:1';
const checks = { propsRemoved: true, areaClear: true, hardwareCool: true, radioReady: true };
const project = createZorroStopStoryboard('idle-test');
const records = Object.entries({ RC6_OPTION: 31, DISARM_DELAY: 30, MOT_SPIN_ARM: 0.1, ARMING_SKIPCHK: 0 })
  .map(([name, value]) => ({ name, value, receivedAt: first, type: 9, index: 0, count: 4, revision: 1 })) as AircraftParameter[];

function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(first);
  let armed = false;
  let ack: number | undefined;
  let heartbeatAt = first;
  let mode = 'Stabilize';
  let link = 'listening' as AircraftSnapshot['link']['state'];
  const write = vi.fn(async (_frame: Buffer) => {});
  const snapshot = (): AircraftSnapshot => ({
    now: Date.now(),
    link: { state: link, path: '/dev/cu.usbmodemTEST', baudRate: 115200, connectedAt: first - 100,
      error: null, bytesReceived: 1, packetsReceived: 1, invalidFrames: 0, lastPacketAt: heartbeatAt, transmittedBytes: 0 },
    request: { aircraftId, state: 'verified', startedAt: first - 50, message: 'Bidirectional' },
    aircraft: [{ id: aircraftId, systemId: 1, componentId: 1, protocolVersion: 2, signing: 'unsigned',
      heartbeat: { receivedAt: heartbeatAt, armed, mode, customMode: 0, systemStatus: 'Standby', autopilot: 3, vehicleType: 2 },
      attitude: null, gps: null, position: null,
      battery: { receivedAt: heartbeatAt, voltageV: 16, currentA: null, remainingPercent: 80 },
      version: { receivedAt: first - 50, flightVersion: '4.7.1', releaseType: 255 },
      messages: [],
      ...(ack === undefined ? {} : { lastArmAck: { receivedAt: first + 50, command: 400, result: ack,
        targetSystem: 254, targetComponent: 190 } }),
    }],
  });
  let sequence = 0;
  const controller = new ZorroStopController({ snapshot, parameters: () => records,
    write, nextSequence: () => sequence++, busy: () => false });
  return { controller, write, snapshot,
    setArmed: (value: boolean) => { armed = value; heartbeatAt = Date.now(); },
    setAck: (value: number) => { ack = value; },
    heartbeat: () => { heartbeatAt = Date.now(); },
    setMode: (value: string) => { mode = value; },
    setLink: (value: AircraftSnapshot['link']['state']) => { link = value; },
  };
}
afterEach(() => vi.useRealTimers());

describe('props-off armed-idle controller', () => {
  it('encodes only normal arm and disarm, never force-arm or throttle', () => {
    const protocol = new MavLinkProtocolV2();
    for (const arm of [true, false]) {
      const frame = armFrame(1, 1, 0, arm);
      const command = protocol.data(protocol.payload(frame), common.CommandLong);
      expect(command.command).toBe(400);
      expect(command._param1).toBe(arm ? 1 : 0);
      expect(command._param2).toBe(0);
      expect(command._param3).toBe(0);
    }
  });

  it('refuses stale or incompatible setup before any write', async () => {
    const f = fixture();
    records.find(p => p.name === 'DISARM_DELAY')!.value = 10;
    await expect(f.controller.start(aircraftId, crypto.randomUUID(), project, checks)).rejects.toThrow(/DISARM_DELAY/);
    expect(f.write).not.toHaveBeenCalled();
    records.find(p => p.name === 'DISARM_DELAY')!.value = 30;
    records.find(p => p.name === 'ARMING_SKIPCHK')!.value = 1;
    await expect(f.controller.start(aircraftId, crypto.randomUUID(), project, checks)).rejects.toThrow(/ARMING_SKIPCHK/);
    expect(f.write).not.toHaveBeenCalled();
    records.find(p => p.name === 'ARMING_SKIPCHK')!.value = 0;
  });

  it('arms once, times the armed-idle window, then disarms and waits for a disarmed heartbeat', async () => {
    const f = fixture();
    const runId = crypto.randomUUID();
    await f.controller.start(aircraftId, runId, project, checks);
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(f.controller.status?.state).toBe('arming');
    await vi.advanceTimersByTimeAsync(50);
    f.setAck(0);
    f.setArmed(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(f.controller.status?.state).toBe('running');
    for (let step = 0; step < 40; step++) {
      f.heartbeat();
      f.controller.renew(runId);
      await vi.advanceTimersByTimeAsync(500);
    }
    await vi.advanceTimersByTimeAsync(200);
    expect(f.controller.status?.state).toBe('stopping');
    expect(f.write).toHaveBeenCalledTimes(2);
    f.setArmed(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.controller.status?.state).toBe('completed');
  });

  it('requests disarm if the browser stops renewing the lease', async () => {
    const f = fixture();
    await f.controller.start(aircraftId, crypto.randomUUID(), project, checks);
    await vi.advanceTimersByTimeAsync(50);
    f.setAck(0); f.setArmed(true);
    await vi.advanceTimersByTimeAsync(2100);
    expect(f.controller.status?.state).toBe('stopping');
    expect(f.write).toHaveBeenCalledTimes(2);
  });

  it('keeps reporting a stopping run until a fresh disarmed heartbeat arrives, even after a mode change', async () => {
    const f = fixture();
    const runId = crypto.randomUUID();
    await f.controller.start(aircraftId, runId, project, checks);
    f.setAck(0); f.setArmed(true);
    await vi.advanceTimersByTimeAsync(100);
    await f.controller.stop(runId);
    f.setMode('Loiter');
    expect(() => f.controller.renew(runId)).not.toThrow();
    await vi.advanceTimersByTimeAsync(100);
    expect(f.controller.status?.state).toBe('stopping');
    f.setArmed(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.controller.status?.state).toBe('cancelled');
  });

  it('reports unconfirmed disarm when the link fails during stopping', async () => {
    const f = fixture();
    const runId = crypto.randomUUID();
    await f.controller.start(aircraftId, runId, project, checks);
    f.setAck(0); f.setArmed(true);
    await vi.advanceTimersByTimeAsync(100);
    await f.controller.stop(runId);
    f.setLink('error');
    await vi.advanceTimersByTimeAsync(100);
    expect(f.controller.status?.state).toBe('failed');
    expect(f.controller.status?.message).toMatch(/unconfirmed/);
  });

  it('does not claim a run if ArduPilot rejects arming', async () => {
    const f = fixture();
    await f.controller.start(aircraftId, crypto.randomUUID(), project, checks);
    f.setAck(4);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.controller.status?.state).toBe('stopping');
    expect(f.write).toHaveBeenCalledTimes(2);
  });
});
