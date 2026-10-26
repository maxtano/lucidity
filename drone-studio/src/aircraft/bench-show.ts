import type { StoryboardBenchPlan } from '../core/bench-storyboard';
import {
  BENCH_SHOW_LEASE_MS,
  type BenchShowStatus,
} from './bench-show-plan';
import { MotorTestError, type MotorTestChecks } from './motor-test';
import { HEARTBEAT_STALE_MS, type AircraftSnapshot, type AircraftTelemetry } from './types';

const TICK_MS = 100;
const MAX_CUE_LATENESS_MS = 750;
const MAX_TICK_GAP_MS = 1000;
const PENDING_LIMIT_MS = 2250;
const DISARM_GRACE_MS = 1500;
const STOP_LIMIT_MS = 2000;

export type BenchShowDependencies = {
  snapshot: () => AircraftSnapshot;
  startMotor: (aircraftId: string, motor: number, checks: MotorTestChecks) => Promise<void>;
  stopMotor: (aircraftId: string) => Promise<void>;
  motorPending: () => boolean;
  pulseDeadline: () => number | undefined;
  /** Other work only; excludes this scheduler and its own motor-test request. */
  busy: () => boolean;
};

type Run = {
  linkKey: string;
  systemId: number;
  componentId: number;
  checks: MotorTestChecks;
  leaseAt: number;
  lastNow: number;
  lastTick: number;
  hostStartedAt: number;
  dispatched: boolean;
  stopAttempted: boolean;
  pulse?: { index: number; handoffAt: number; startedAt?: number; deadline?: number };
};

/** A live browser lease permits the validated storyboard’s bounded pulses. Nothing is replayed or retried. */
export class BenchShowController {
  private value?: BenchShowStatus;
  private run?: Run;
  private timer?: ReturnType<typeof setInterval>;
  private generation = 0;
  private usedRunIds = new Set<string>();
  private stopping?: { promise: Promise<void>; finish: () => void };

  constructor(private readonly dependencies: BenchShowDependencies) {}

  /** Must not read snapshot: AircraftService includes this status in its own snapshot. */
  get status(): BenchShowStatus | undefined {
    return this.value ? { ...this.value, source: { ...this.value.source }, cues: this.value.cues.map((cue) => ({ ...cue })) } : undefined;
  }

  get active(): boolean {
    return this.value?.state === 'running' || this.value?.state === 'stopping';
  }

  private linkKey(snapshot: AircraftSnapshot): string {
    return JSON.stringify([snapshot.link.path, snapshot.link.connectedAt]);
  }

  private sameLink(snapshot: AircraftSnapshot): boolean {
    const aircraft = snapshot.aircraft.find((item) => item.id === this.value?.aircraftId);
    return Boolean(
      this.run && snapshot.link.state === 'listening' && this.linkKey(snapshot) === this.run.linkKey &&
      snapshot.aircraft.length === 1 && aircraft && aircraft.systemId === this.run.systemId &&
      aircraft.componentId === this.run.componentId && aircraft.signing === 'unsigned'
    );
  }

  private eligible(snapshot: AircraftSnapshot, aircraftId: string, requireDisarmed: boolean): AircraftTelemetry {
    if (
      snapshot.link.state !== 'listening' || !snapshot.link.path ||
      snapshot.link.connectedAt === null || !Number.isFinite(snapshot.link.connectedAt) ||
      !Number.isFinite(snapshot.now) || snapshot.link.connectedAt > snapshot.now
    ) throw new MotorTestError('A current listening aircraft link is required.');
    const aircraft = snapshot.aircraft.find((item) => item.id === aircraftId);
    if (snapshot.aircraft.length !== 1 || !aircraft)
      throw new MotorTestError('The bench rehearsal requires exactly one selected aircraft.');
    if (
      aircraft.heartbeat.autopilot !== 3 || aircraft.heartbeat.vehicleType !== 2 ||
      aircraft.componentId !== 1 || aircraft.signing !== 'unsigned'
    ) throw new MotorTestError('The bench rehearsal requires an unsigned ArduPilot quadrotor flight controller.');
    if (
      aircraft.version?.flightVersion !== '4.7.1' || aircraft.version.releaseType !== 255 ||
      !Number.isFinite(aircraft.version.receivedAt) ||
      aircraft.version.receivedAt < snapshot.link.connectedAt || aircraft.version.receivedAt > snapshot.now
    ) throw new MotorTestError('Confirm stable ArduCopter 4.7.1 firmware on this connection.');
    if (
      snapshot.request?.aircraftId !== aircraftId || !['verified', 'partial'].includes(snapshot.request.state) ||
      !Number.isFinite(snapshot.request.startedAt) || snapshot.request.startedAt < snapshot.link.connectedAt ||
      snapshot.request.startedAt > snapshot.now
    ) throw new MotorTestError('Request and confirm bidirectional telemetry before the bench rehearsal.');
    const heartbeat = aircraft.heartbeat;
    if (
      !Number.isFinite(heartbeat.receivedAt) || heartbeat.receivedAt < snapshot.link.connectedAt ||
      heartbeat.receivedAt > snapshot.now || snapshot.now - heartbeat.receivedAt > HEARTBEAT_STALE_MS
    ) throw new MotorTestError('A fresh aircraft heartbeat is required for the bench rehearsal.');
    if (requireDisarmed && heartbeat.armed)
      throw new MotorTestError('Disarm the aircraft before the next bench pulse.');
    return aircraft;
  }

  start(aircraftId: string, runId: string, checks: MotorTestChecks, plan: StoryboardBenchPlan): void {
    this.validatePlan(plan);
    if (typeof runId !== 'string' || !runId.trim() || runId.length > 120)
      throw new MotorTestError('A new bench rehearsal run ID is required.', 400);
    if (typeof aircraftId !== 'string' || !aircraftId.length || aircraftId.length > 120)
      throw new MotorTestError('Choose the connected aircraft.', 400);
    if (this.active || this.dependencies.motorPending() || this.dependencies.busy())
      throw new MotorTestError('Another aircraft operation is still active.');
    if (this.usedRunIds.has(runId)) throw new MotorTestError('This rehearsal run ID has already been used. Start a new rehearsal.');
    if (checks?.propsRemoved !== true || checks?.areaClear !== true || checks?.hardwareCool !== true)
      throw new MotorTestError('Confirm removed props, a clear area, and cool, undamaged hardware.', 400);
    const snapshot = this.dependencies.snapshot();
    const aircraft = this.eligible(snapshot, aircraftId, true);
    if (snapshot.motorTest && snapshot.now < snapshot.motorTest.availableAt)
      throw new MotorTestError('Wait for the previous motor-test cooldown.');
    const previousDeadline = this.dependencies.pulseDeadline();
    if (previousDeadline !== undefined && aircraft.heartbeat.receivedAt <= previousDeadline)
      throw new MotorTestError('Wait for a fresh disarmed heartbeat after the previous pulse.');
    this.usedRunIds.add(runId);
    ++this.generation;
    this.run = {
      linkKey: this.linkKey(snapshot), systemId: aircraft.systemId, componentId: aircraft.componentId,
      checks: { ...checks }, leaseAt: snapshot.now, lastNow: snapshot.now, lastTick: snapshot.now,
      hostStartedAt: Date.now(), dispatched: false, stopAttempted: false,
    };
    this.value = {
      runId, aircraftId, state: 'running', startedAt: snapshot.now, elapsedMs: 0,
      source: { ...plan.source }, durationMs: plan.durationMs,
      message: `Storyboard “${plan.source.name}” running: ${plan.cues.length} bounded 5% / one-second pulses; no flight commands.`,
      cues: plan.cues.map((cue) => ({ ...cue, state: 'waiting' })),
    };
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Defense in depth for internal callers; the service compiles the full project first. */
  private validatePlan(plan: StoryboardBenchPlan): void {
    if (!plan || !plan.source || typeof plan.source.id !== 'string' || !plan.source.id ||
      typeof plan.source.name !== 'string' || !plan.source.name ||
      !Number.isInteger(plan.source.revision) || plan.source.revision < 0 ||
      typeof plan.source.planKey !== 'string' || !plan.source.planKey ||
      !Number.isFinite(plan.durationMs) || plan.durationMs > 120_000 ||
      !Array.isArray(plan.cues) || plan.cues.length < 1 || plan.cues.length > 4)
      throw new MotorTestError('A reviewed, compiled storyboard is required. No built-in sequence is available.', 400);
    const motors = new Set<number>();
    let previous = -3000;
    for (const cue of plan.cues) {
      if (!cue || !Number.isInteger(cue.motor) || cue.motor < 1 || cue.motor > 4 || motors.has(cue.motor) ||
        !Number.isFinite(cue.atMs) || cue.atMs < 3000 || cue.atMs - previous < 6000 ||
        typeof cue.sceneId !== 'string' || !cue.sceneId || typeof cue.sceneName !== 'string' || !cue.sceneName)
        throw new MotorTestError('The storyboard pulse timing or motor assignment is invalid.', 400);
      motors.add(cue.motor);
      previous = cue.atMs;
    }
    if (plan.durationMs - previous < 3000)
      throw new MotorTestError('The storyboard must leave three seconds after its last pulse.', 400);
  }

  private clock(snapshot: AircraftSnapshot, tick = false): void {
    const run = this.run!;
    const elapsed = snapshot.now - this.value!.startedAt;
    if (
      !Number.isFinite(snapshot.now) || snapshot.now < run.lastNow ||
      Math.abs(elapsed - (Date.now() - run.hostStartedAt)) > MAX_CUE_LATENESS_MS ||
      snapshot.now - run.lastTick > MAX_TICK_GAP_MS
    ) throw new MotorTestError('The rehearsal clock paused or changed. No remaining cues will run.');
    run.lastNow = snapshot.now;
    if (tick) run.lastTick = snapshot.now;
    this.value!.elapsedMs = Math.min(this.value!.durationMs, Math.max(0, elapsed));
    if (snapshot.now - run.leaseAt >= BENCH_SHOW_LEASE_MS)
      throw new MotorTestError('The rehearsal control lease expired. No remaining cues will run.');
  }

  renew(runId: string): void {
    if (this.value?.runId !== runId || this.value.state !== 'running')
      throw new MotorTestError('This bench rehearsal is no longer running.');
    try {
      const snapshot = this.dependencies.snapshot();
      this.clock(snapshot);
      if (!this.sameLink(snapshot)) {
        this.invalidate('The aircraft link or identity changed.');
        throw new MotorTestError('The aircraft link or identity changed.');
      }
      this.run!.leaseAt = snapshot.now;
    } catch (error) {
      if (this.value.state === 'running') void this.end('failed', this.reason(error));
      throw error;
    }
  }

  private reason(error: unknown): string {
    return error instanceof Error ? error.message.slice(0, 240) : 'The bench rehearsal could not continue.';
  }

  private tick(): void {
    if (this.value?.state !== 'running') return;
    try {
      const snapshot = this.dependencies.snapshot();
      this.clock(snapshot, true);
      if (!this.sameLink(snapshot)) { this.invalidate('The aircraft link or identity changed.'); return; }
      const aircraft = this.eligible(snapshot, this.value.aircraftId, false);
      if (this.dependencies.busy()) throw new MotorTestError('Another aircraft operation interrupted the rehearsal.');
      const pulse = this.run!.pulse;
      if (pulse) {
        const cue = this.value.cues[pulse.index];
        if (cue.state === 'pending' && snapshot.now - pulse.handoffAt > PENDING_LIMIT_MS)
          throw new MotorTestError('The motor pulse did not finish its acknowledgement wait. No retry was sent.');
        if (cue.state === 'accepted') {
          const motor = snapshot.motorTest;
          if (
            motor?.state !== 'accepted' || motor.aircraftId !== this.value.aircraftId ||
            motor.motor !== cue.motor || motor.startedAt !== pulse.startedAt ||
            this.dependencies.pulseDeadline() !== pulse.deadline
          ) throw new MotorTestError('The current motor pulse status became unconfirmed.');
          if (!this.dependencies.motorPending() && !aircraft.heartbeat.armed && aircraft.heartbeat.receivedAt > pulse.deadline!) {
            cue.state = 'confirmed';
            cue.message = 'Pulse acknowledged; a later disarmed heartbeat was received. Movement still requires visual confirmation.';
          } else if (snapshot.now > pulse.deadline! + DISARM_GRACE_MS) {
            throw new MotorTestError('No fresh disarmed heartbeat followed the pulse. Remaining cues were cancelled.');
          }
        }
        const armedUntil = cue.state === 'pending' ? pulse.handoffAt + PENDING_LIMIT_MS : pulse.deadline! + DISARM_GRACE_MS;
        if (aircraft.heartbeat.armed && (cue.state === 'confirmed' || snapshot.now > armedUntil))
          throw new MotorTestError('The aircraft remains armed outside the bounded motor-test interval.');
      } else if (aircraft.heartbeat.armed) {
        throw new MotorTestError('The aircraft armed before the first bench pulse.');
      }
      const nextIndex = this.value.cues.findIndex((cue) => cue.state === 'waiting');
      if (nextIndex >= 0) {
        const cue = this.value.cues[nextIndex];
        const dueAt = this.value.startedAt + cue.atMs;
        if (snapshot.now >= dueAt) {
          if (snapshot.now - dueAt > MAX_CUE_LATENESS_MS)
            throw new MotorTestError('A rehearsal cue missed its deadline. No catch-up pulse was sent.');
          if (nextIndex > 0 && this.value.cues[nextIndex - 1].state !== 'confirmed')
            throw new MotorTestError('The preceding pulse was not confirmed by a later disarmed heartbeat.');
          this.eligible(snapshot, this.value.aircraftId, true);
          if (this.dependencies.motorPending() || (snapshot.motorTest && snapshot.now < snapshot.motorTest.availableAt))
            throw new MotorTestError('The preceding pulse or its cooldown is still active.');
          const deadline = this.dependencies.pulseDeadline();
          if (deadline !== undefined && aircraft.heartbeat.receivedAt <= deadline)
            throw new MotorTestError('A fresh disarmed heartbeat is required after the preceding pulse.');
          this.dispatch(nextIndex, snapshot.now);
        }
      } else if (this.value.cues.every((cue) => cue.state === 'confirmed') && snapshot.now >= this.value.startedAt + this.value.durationMs) {
        clearInterval(this.timer);
        this.timer = undefined;
        this.value.state = 'completed';
        this.value.elapsedMs = this.value.durationMs;
        this.value.message = `Storyboard timeline completed: ${this.value.cues.length} pulse requests acknowledged, each followed by a disarmed heartbeat. Confirm movement and stops visually; flight was not tested.`;
      }
    } catch (error) {
      void this.end('failed', this.reason(error));
    }
  }

  private dispatch(index: number, now: number): void {
    const generation = this.generation;
    const value = this.value!;
    const cue = value.cues[index];
    cue.state = 'pending';
    cue.message = 'Sending the fixed 5% / one-second pulse; awaiting acknowledgement.';
    this.run!.pulse = { index, handoffAt: now };
    // A thrown or rejected write cannot prove non-delivery, so cancellation may send one owned stop.
    this.run!.dispatched = true;
    try {
      void Promise.resolve(this.dependencies.startMotor(value.aircraftId, cue.motor, this.run!.checks)).then(() => {
        if (generation !== this.generation || this.value?.state !== 'running') return;
        try {
          const snapshot = this.dependencies.snapshot();
          this.clock(snapshot);
          if (!this.sameLink(snapshot)) { this.invalidate('The aircraft link or identity changed.'); return; }
          const motor = snapshot.motorTest;
          const deadline = this.dependencies.pulseDeadline();
          if (
            motor?.state !== 'accepted' || motor.aircraftId !== value.aircraftId || motor.motor !== cue.motor ||
            !Number.isFinite(motor.startedAt) || motor.startedAt < now || motor.startedAt > snapshot.now ||
            !Number.isFinite(motor.availableAt) || motor.availableAt < now + 5000 ||
            deadline === undefined || !Number.isFinite(deadline) || deadline < now + 1000 || deadline > snapshot.now + 1000
          ) throw new MotorTestError('The pulse was rejected or its acknowledgement was unconfirmed. No retry was sent.');
          this.run!.pulse = { index, handoffAt: now, startedAt: motor.startedAt, deadline };
          cue.state = 'accepted';
          cue.message = 'Aircraft accepted the pulse; waiting for a later disarmed heartbeat. Acceptance does not prove movement.';
        } catch (error) { void this.end('failed', this.reason(error)); }
      }, (error: unknown) => {
        if (generation === this.generation && this.value?.state === 'running') void this.end('failed', this.reason(error));
      });
    } catch (error) { void this.end('failed', this.reason(error)); }
  }

  async stop(runId: string, reason = 'Bench rehearsal cancelled by the operator.'): Promise<void> {
    if (this.value?.runId !== runId) throw new MotorTestError('This bench rehearsal run was not found.');
    if (this.value.state === 'stopping') return this.stopping?.promise;
    if (this.value.state !== 'running') return;
    return this.end('cancelled', reason.slice(0, 240));
  }

  private end(state: 'cancelled' | 'failed', reason: string): Promise<void> {
    if (this.value?.state !== 'running') return this.stopping?.promise ?? Promise.resolve();
    const generation = ++this.generation;
    clearInterval(this.timer);
    this.timer = undefined;
    const value = this.value;
    value.message = reason;
    for (const cue of value.cues) if (cue.state === 'pending' || cue.state === 'accepted') {
      cue.state = 'failed';
      cue.message = 'Rehearsal ended. Motor movement and stop are not verified.';
    }
    let canStop = false;
    try { canStop = this.sameLink(this.dependencies.snapshot()); } catch { /* No trustworthy link to write to. */ }
    if (!this.run!.dispatched || this.run!.stopAttempted || !canStop) {
      value.state = state;
      return Promise.resolve();
    }
    this.run!.stopAttempted = true;
    value.state = 'stopping';
    value.message = `${reason} Sending one best-effort stop; check the motors visually.`;
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (generation === this.generation) {
        value.state = state;
        value.message = `${reason} A best-effort stop was requested; no motor stop is verified.`;
      }
      if (this.stopping?.promise === promise) this.stopping = undefined;
      resolve();
    };
    const timeout = setTimeout(finish, STOP_LIMIT_MS);
    this.stopping = { promise, finish };
    try { void Promise.resolve(this.dependencies.stopMotor(value.aircraftId)).then(finish, finish); }
    catch { finish(); }
    return promise;
  }

  /** Link loss cancels scheduling immediately; never writes to a replacement connection. */
  invalidate(reason: string): void {
    if (!this.active) return;
    ++this.generation;
    clearInterval(this.timer);
    this.timer = undefined;
    this.value!.state = 'failed';
    this.value!.message = `${reason.slice(0, 240)} Rehearsal cancelled; no motor stop is verified.`;
    for (const cue of this.value!.cues) if (cue.state === 'pending' || cue.state === 'accepted') {
      cue.state = 'failed';
      cue.message = 'Aircraft connection lost; pulse outcome is unconfirmed.';
    }
    this.stopping?.finish();
  }
}
