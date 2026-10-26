import { compileStoryboardBenchPlan, createBenchStoryboard } from '../core/bench-storyboard';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BenchShowController } from './bench-show';
import { MotorTestError, type MotorTestChecks } from './motor-test';
import type { AircraftSnapshot, AircraftTelemetry } from './types';

const checks: MotorTestChecks = { propsRemoved: true, areaClear: true, hardwareCool: true };
const runId = 'bench-run-1';
const plan = compileStoryboardBenchPlan(createBenchStoryboard());

function fixture(compiledPlan = plan) {
  const aircraft: AircraftTelemetry = {
    id: 'link:7:1', systemId: 7, componentId: 1, protocolVersion: 2, signing: 'unsigned',
    heartbeat: {
      receivedAt: Date.now(), armed: false, mode: 'Stabilize', customMode: 0,
      systemStatus: 'Standby', autopilot: 3, vehicleType: 2,
    },
    attitude: null, gps: null, position: null, battery: null, messages: [],
    version: { receivedAt: 9500, flightVersion: '4.7.1', releaseType: 255 },
  };
  const snapshot: AircraftSnapshot = {
    now: Date.now(),
    link: {
      state: 'listening', path: '/dev/cu.usbmodem1', baudRate: 115200, connectedAt: 9000,
      error: null, bytesReceived: 100, packetsReceived: 2, invalidFrames: 0,
      lastPacketAt: Date.now(), transmittedBytes: 0,
    },
    aircraft: [aircraft],
    request: { state: 'verified', aircraftId: aircraft.id, startedAt: 9200, message: 'Confirmed' },
  };
  let pending = false;
  let deadline: number | undefined;
  let defer = false;
  let release: (() => void) | undefined;
  let outcome: NonNullable<AircraftSnapshot['motorTest']>['state'] = 'accepted';
  const startsAt: number[] = [];
  const startMotor = vi.fn<(id: string, motor: number, confirmations: MotorTestChecks) => Promise<void>>()
    .mockImplementation(async (aircraftId, motor) => {
      startsAt.push(Date.now());
      const pulse = {
        state: 'pending' as const, aircraftId, motor, startedAt: Date.now(),
        availableAt: Date.now() + 5000, message: 'Awaiting ACK',
      };
      snapshot.motorTest = pulse;
      pending = true;
      deadline = Date.now() + 1000;
      if (defer) await new Promise<void>(resolve => { release = resolve; });
      else await Promise.resolve();
      pending = false;
      deadline = Date.now() + 1000;
      snapshot.motorTest = { ...pulse, state: outcome, message: 'Pulse result' };
    });
  const stopMotor = vi.fn<(id: string) => Promise<void>>().mockImplementation(async () => {
    pending = false;
    if (snapshot.motorTest) snapshot.motorTest = { ...snapshot.motorTest, state: 'stop-requested' };
  });
  const busy = vi.fn(() => false);
  const motorPending = vi.fn(() => pending);
  const readSnapshot = vi.fn(() => ({ ...snapshot, now: Date.now() }));
  const controller = new BenchShowController({
    snapshot: readSnapshot,
    startMotor, stopMotor, busy, motorPending, pulseDeadline: () => deadline,
  });
  const heartbeat = (armed = false) => {
    aircraft.heartbeat.receivedAt = Date.now();
    aircraft.heartbeat.armed = armed;
  };
  const keepHeartbeats = () => {
    const timer = setInterval(() => heartbeat(), 500);
    return () => clearInterval(timer);
  };
  const keepLease = () => {
    const timer = setInterval(() => {
      if (controller.status?.state === 'running') controller.renew(runId);
    }, 500);
    return () => clearInterval(timer);
  };
  return {
    aircraft, snapshot, controller, startMotor, stopMotor, busy, motorPending, readSnapshot, startsAt,
    heartbeat, keepHeartbeats, keepLease,
    advance: (ms: number) => vi.advanceTimersByTimeAsync(ms),
    start: () => controller.start(aircraft.id, runId, checks, compiledPlan),
    deferPulse: () => { defer = true; },
    settlePulse: () => release?.(),
    outcome: (state: typeof outcome) => { outcome = state; },
    deadline: () => deadline,
  };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('storyboard bench rehearsal', () => {
  it('reads status without calling the snapshot dependency, avoiding recursive service snapshots', () => {
    const f = fixture(); f.start(); f.readSnapshot.mockClear();
    f.readSnapshot.mockImplementation(() => { throw new Error('Recursive snapshot'); });
    expect(f.controller.status).toMatchObject({ state: 'running', elapsedMs: 0 });
    expect(f.controller.active).toBe(true);
    expect(f.readSnapshot).not.toHaveBeenCalled();
  });

  it('sends nothing before the first cue and distinguishes ACK acceptance from later disarm evidence', async () => {
    const f = fixture(); f.start(); f.keepLease(); f.keepHeartbeats();
    await f.advance(2999);
    expect(f.startMotor).not.toHaveBeenCalled();
    expect(f.controller.status?.cues.map(cue => cue.state)).toEqual(['waiting', 'waiting', 'waiting', 'waiting']);
    await f.advance(1);
    expect(f.startMotor).toHaveBeenCalledExactlyOnceWith(f.aircraft.id, 1, checks);
    expect(f.controller.status?.cues[0].state).toBe('accepted');
    expect(f.aircraft.heartbeat.receivedAt).toBeLessThanOrEqual(f.deadline()!);
    await f.advance(1600);
    expect(f.controller.status?.cues[0].state).toBe('confirmed');
    expect(f.aircraft.heartbeat.receivedAt).toBeGreaterThan(f.deadline()!);
  });

  it('completes exactly four separated pulses at 3, 9, 15 and 21 seconds with independent fresh heartbeats', async () => {
    const f = fixture(); f.start(); const lease = f.keepLease(); const heartbeats = f.keepHeartbeats();
    await f.advance(24_000);
    expect(f.startsAt).toEqual([13_000, 19_000, 25_000, 31_000]);
    expect(f.startMotor.mock.calls.map(([id, motor, confirmations]) => [id, motor, confirmations]))
      .toEqual([1, 2, 3, 4].map(motor => [f.aircraft.id, motor, checks]));
    expect(f.controller.status).toMatchObject({ state: 'completed', elapsedMs: 24_000, durationMs: 24_000 });
    expect(f.controller.status?.cues.map(cue => cue.state)).toEqual(['confirmed', 'confirmed', 'confirmed', 'confirmed']);
    expect(f.controller.active).toBe(false);
    expect(f.stopMotor).not.toHaveBeenCalled();
    lease(); heartbeats();
    await f.advance(30_000);
    expect(f.startMotor).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs a one-scene storyboard to its authored end instead of requiring four fixed cues', async () => {
    const project = createBenchStoryboard('Single pulse');
    project.cues = project.cues.slice(0, 1);
    project.cues[0].benchCue!.motor = 3;
    const authoredPlan = compileStoryboardBenchPlan(project);
    const f = fixture(authoredPlan);
    f.start(); f.keepLease(); f.keepHeartbeats();
    await f.advance(6000);
    expect(f.startMotor).toHaveBeenCalledExactlyOnceWith(f.aircraft.id, 3, checks);
    expect(f.controller.status).toMatchObject({
      source: authoredPlan.source, state: 'completed', elapsedMs: 6000, durationMs: 6000,
      cues: [{ ...authoredPlan.cues[0], state: 'confirmed' }],
    });
    await f.advance(24000);
    expect(f.startMotor).toHaveBeenCalledTimes(1);
  });

  it.each(['rejected', 'unconfirmed'] as const)('aborts a %s pulse without retrying or dispatching later cues', async outcome => {
    const f = fixture(); f.outcome(outcome); f.start(); f.keepLease(); f.keepHeartbeats();
    await f.advance(3000);
    expect(f.controller.status?.state).toBe('failed');
    expect(f.controller.status?.cues[0].state).toBe('failed');
    expect(f.stopMotor).toHaveBeenCalledExactlyOnceWith(f.aircraft.id);
    await f.advance(30_000);
    expect(f.startMotor).toHaveBeenCalledTimes(1);
    expect(f.stopMotor).toHaveBeenCalledTimes(1);
  });

  it('does not send a second cue without a disarmed heartbeat strictly after the pulse deadline', async () => {
    const f = fixture(); f.start(); f.keepLease(); const heartbeats = f.keepHeartbeats();
    await f.advance(4000); heartbeats();
    expect(f.aircraft.heartbeat.receivedAt).toBe(f.deadline());
    expect(f.controller.status?.cues[0].state).toBe('accepted');
    await f.advance(5000);
    expect(f.controller.status?.state).toBe('failed');
    expect(f.startMotor).toHaveBeenCalledTimes(1);
    expect(f.stopMotor).toHaveBeenCalledTimes(1);
  });

  it('cancels when accepted pulse evidence is replaced by a different motor result', async () => {
    const f = fixture(); f.start(); f.keepLease(); f.keepHeartbeats();
    await f.advance(3000);
    f.snapshot.motorTest = { ...f.snapshot.motorTest!, motor: 2 };
    await f.advance(100);
    expect(f.controller.status?.state).toBe('failed');
    await f.advance(10_000);
    expect(f.startMotor).toHaveBeenCalledTimes(1);
    expect(f.stopMotor).toHaveBeenCalledTimes(1);
  });

  it('allows the firmware armed heartbeat during the pulse but cancels if it never disarms', async () => {
    const f = fixture(); f.start(); f.keepLease(); const heartbeats = f.keepHeartbeats();
    await f.advance(3000); heartbeats(); f.heartbeat(true);
    await f.advance(1000);
    expect(f.controller.status?.state).toBe('running');
    expect(f.stopMotor).not.toHaveBeenCalled();
    await f.advance(1600);
    expect(f.controller.status?.state).toBe('failed');
    expect(f.startMotor).toHaveBeenCalledTimes(1);
    expect(f.stopMotor).toHaveBeenCalledTimes(1);
  });
});

describe('cancellation and lease ownership', () => {
  it('stops a pending pulse once, ignores its late acceptance, and never resumes remaining cues', async () => {
    const f = fixture(); f.deferPulse(); f.start(); f.keepLease(); f.keepHeartbeats();
    await f.advance(3000);
    expect(f.controller.status?.cues[0].state).toBe('pending');
    await Promise.all([f.controller.stop(runId), f.controller.stop(runId)]);
    expect(f.controller.status?.state).toBe('cancelled');
    expect(f.stopMotor).toHaveBeenCalledExactlyOnceWith(f.aircraft.id);
    f.settlePulse(); await f.advance(30_000);
    expect(f.controller.status?.state).toBe('cancelled');
    expect(f.controller.active).toBe(false);
    expect(f.startMotor).toHaveBeenCalledTimes(1);
    expect(f.stopMotor).toHaveBeenCalledTimes(1);
    expect(f.controller.status?.cues[0].state).toBe('failed');
  });

  it('bounds an unresolved pulse, even while lease renewals continue', async () => {
    const f = fixture(); f.deferPulse(); f.start(); f.keepLease(); f.keepHeartbeats();
    await f.advance(5400);
    expect(f.controller.status?.state).toBe('failed');
    expect(f.startMotor).toHaveBeenCalledTimes(1);
    expect(f.stopMotor).toHaveBeenCalledTimes(1);
    f.settlePulse(); await f.advance(10_000);
    expect(f.startMotor).toHaveBeenCalledTimes(1);
  });

  it('expires an unattended countdown without sending a pulse or an unowned stop', async () => {
    const f = fixture(); f.start();
    await f.advance(2500);
    expect(f.controller.status?.state).toBe('failed');
    expect(() => f.controller.renew(runId)).toThrow(MotorTestError);
    await f.advance(24_000);
    expect(f.startMotor).not.toHaveBeenCalled();
    expect(f.stopMotor).not.toHaveBeenCalled();
  });

  it('sends one owned best-effort stop when the lease expires after a pulse', async () => {
    const f = fixture(); f.start(); const lease = f.keepLease(); f.keepHeartbeats();
    await f.advance(3000); lease();
    await f.advance(2500);
    expect(f.controller.status?.state).toBe('failed');
    expect(f.stopMotor).toHaveBeenCalledExactlyOnceWith(f.aircraft.id);
    expect(() => f.controller.renew(runId)).toThrow(MotorTestError);
    await f.advance(24_000);
    expect(f.startMotor).toHaveBeenCalledTimes(1);
    expect(f.stopMotor).toHaveBeenCalledTimes(1);
  });

  it.each(['path', 'connection', 'disconnected', 'identity'] as const)('never writes a stop after %s changes', async kind => {
    const f = fixture(); f.deferPulse(); f.start(); f.keepLease(); f.keepHeartbeats();
    await f.advance(3000);
    if (kind === 'path') f.snapshot.link.path = '/dev/cu.usbmodem2';
    if (kind === 'connection') f.snapshot.link.connectedAt = 13_000;
    if (kind === 'disconnected') f.snapshot.link.state = 'disconnected';
    if (kind === 'identity') f.aircraft.systemId = 8;
    await f.advance(100);
    expect(f.controller.status?.state).toBe('failed');
    f.settlePulse(); await f.advance(24_000);
    expect(f.startMotor).toHaveBeenCalledTimes(1);
    expect(f.stopMotor).not.toHaveBeenCalled();
  });

  it('invalidates directly without writing and ignores a late pending result', async () => {
    const f = fixture(); f.deferPulse(); f.start(); f.keepLease(); f.keepHeartbeats();
    await f.advance(3000);
    f.controller.invalidate('USB disconnected');
    f.settlePulse(); await f.advance(24_000);
    expect(f.controller.status?.state).toBe('failed');
    expect(f.controller.active).toBe(false);
    expect(f.startMotor).toHaveBeenCalledTimes(1);
    expect(f.stopMotor).not.toHaveBeenCalled();
  });

  it('does not catch up a first cue missed by more than 750 ms during a clock jump', async () => {
    const f = fixture(); f.start(); const lease = f.keepLease();
    await f.advance(2500); lease();
    vi.setSystemTime(13_800); f.heartbeat();
    await f.advance(100);
    expect(f.controller.status?.state).toBe('failed');
    await f.advance(24_000);
    expect(f.startMotor).not.toHaveBeenCalled();
    expect(f.stopMotor).not.toHaveBeenCalled();
  });

  it('cannot extend its lease by moving the clock backwards', async () => {
    const f = fixture(); f.start();
    await f.advance(1000);
    vi.setSystemTime(10_500);
    expect(() => f.controller.renew(runId)).toThrow(/clock/);
    expect(f.controller.status?.state).toBe('failed');
    const elapsed = f.controller.status?.elapsedMs;
    await f.advance(24_000);
    expect(f.controller.status?.elapsedMs).toBe(elapsed);
    expect(f.startMotor).not.toHaveBeenCalled();
  });

  it('cancels if the snapshot clock stops advancing while the scheduler clock continues', async () => {
    const f = fixture(); f.start();
    f.readSnapshot.mockImplementation(() => ({ ...f.snapshot, now: 10_000 }));
    await f.advance(800);
    expect(f.controller.status?.state).toBe('failed');
    expect(f.controller.status?.message).toMatch(/clock/);
    await f.advance(24_000);
    expect(f.startMotor).not.toHaveBeenCalled();
    expect(f.stopMotor).not.toHaveBeenCalled();
  });

  it('bounds a stalled stop and prevents further pulses after the stop promise later settles', async () => {
    const f = fixture(); f.start(); f.keepLease(); f.keepHeartbeats();
    await f.advance(3000);
    let finishStop!: () => void;
    f.stopMotor.mockImplementation(() => new Promise(resolve => { finishStop = resolve; }));
    const stopping = f.controller.stop(runId);
    expect(f.controller.status?.state).toBe('stopping');
    await f.advance(2000); await stopping;
    expect(f.controller.status?.state).toBe('cancelled');
    finishStop(); await f.advance(24_000);
    expect(f.startMotor).toHaveBeenCalledTimes(1);
    expect(f.stopMotor).toHaveBeenCalledTimes(1);
  });

  it('settles an interrupted stop immediately and preserves invalidation after the stop resolves late', async () => {
    const f = fixture(); f.start(); f.keepLease(); f.keepHeartbeats();
    await f.advance(3000);
    let finishStop!: () => void;
    f.stopMotor.mockImplementation(() => new Promise(resolve => { finishStop = resolve; }));
    const stopping = f.controller.stop(runId);
    expect(f.controller.status?.state).toBe('stopping');
    f.controller.invalidate('USB disconnected while stopping');
    await stopping;
    expect(f.controller.status?.state).toBe('failed');
    expect(f.controller.active).toBe(false);
    finishStop(); await f.advance(24_000);
    expect(f.controller.status?.state).toBe('failed');
    expect(f.startMotor).toHaveBeenCalledTimes(1);
    expect(f.stopMotor).toHaveBeenCalledTimes(1);
  });
});

describe('bench start guards', () => {
  const guards: [string, (f: ReturnType<typeof fixture>) => void][] = [
    ['busy work', f => { f.busy.mockReturnValue(true); }],
    ['pending motor operation', f => { f.motorPending.mockReturnValue(true); }],
    ['disconnected link', f => { f.snapshot.link.state = 'disconnected'; }],
    ['unknown aircraft', f => { f.snapshot.aircraft = []; }],
    ['multiple aircraft', f => { f.snapshot.aircraft.push({ ...f.aircraft, id: 'other' }); }],
    ['armed aircraft', f => { f.aircraft.heartbeat.armed = true; }],
    ['stale heartbeat', f => { f.aircraft.heartbeat.receivedAt = 4999; }],
    ['future heartbeat', f => { f.aircraft.heartbeat.receivedAt = 10_001; }],
    ['unverified signature', f => { f.aircraft.signing = 'unverified'; }],
    ['unconfirmed firmware', f => { f.aircraft.version = undefined; }],
    ['other firmware', f => { f.aircraft.version!.flightVersion = '4.7.0'; }],
    ['missing bidirectional evidence', f => { f.snapshot.request = undefined; }],
  ];
  it.each(guards)('rejects %s before starting a schedule', async (_name, change) => {
    const f = fixture(); change(f);
    expect(f.start).toThrow(MotorTestError);
    await f.advance(24_000);
    expect(f.controller.active).toBe(false);
    expect(f.startMotor).not.toHaveBeenCalled();
    expect(f.stopMotor).not.toHaveBeenCalled();
  });

  it('has no fallback schedule and rejects malformed compiled timing before any command', () => {
    const f = fixture();
    const invalid = [undefined, {}, { ...plan, cues: [] },
      { ...plan, cues: [{ ...plan.cues[0], atMs: 2000 }] },
      { ...plan, cues: [plan.cues[0], { ...plan.cues[1], motor: plan.cues[0].motor }] },
      { ...plan, cues: [plan.cues[0], { ...plan.cues[1], atMs: 6000 }] },
      { ...plan, durationMs: 22000 }];
    for (const value of invalid)
      expect(() => f.controller.start(f.aircraft.id, runId, checks, value as typeof plan)).toThrow(MotorTestError);
    expect(f.startMotor).not.toHaveBeenCalled();
    expect(f.controller.status).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['propsRemoved', 'areaClear', 'hardwareCool'] as const)('requires explicit %s confirmation', key => {
    const f = fixture();
    expect(() => f.controller.start(f.aircraft.id, runId, { ...checks, [key]: false }, plan))
      .toThrow(MotorTestError);
    expect(f.controller.active).toBe(false);
    expect(f.startMotor).not.toHaveBeenCalled();
  });

  it('rejects empty or oversized identities and run IDs without scheduling commands', () => {
    const f = fixture();
    for (const id of ['', 'x'.repeat(121)]) {
      expect(() => f.controller.start(id, runId, checks, plan)).toThrow(MotorTestError);
      expect(() => f.controller.start(f.aircraft.id, id, checks, plan)).toThrow(MotorTestError);
    }
    expect(() => f.controller.start(f.aircraft.id, '   ', checks, plan)).toThrow(MotorTestError);
    expect(f.controller.active).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects overlapping starts and permanently rejects a used run ID after cancellation', async () => {
    const f = fixture(); f.start();
    expect(f.start).toThrow(MotorTestError);
    expect(() => f.controller.start(f.aircraft.id, 'different-run', checks, plan)).toThrow(MotorTestError);
    await f.controller.stop(runId);
    expect(f.start).toThrow(MotorTestError);
    expect(() => f.controller.renew(runId)).toThrow(MotorTestError);
    expect(f.startMotor).not.toHaveBeenCalled();
    expect(f.stopMotor).not.toHaveBeenCalled();
  });
});
