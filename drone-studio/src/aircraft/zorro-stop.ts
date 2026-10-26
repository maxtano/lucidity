import { MavLinkProtocolV2, common } from 'node-mavlink';
import type { Project } from '../core/model';
import { zorroStopPlanError } from '../core/zorro-test';
import type { AircraftParameter } from './parameters';
import { GROUND_COMPONENT_ID, GROUND_SYSTEM_ID } from './read-requests';
import { HEARTBEAT_STALE_MS, type AircraftSnapshot, type ZorroStopStatus } from './types';

const RUN_MS = 20_000;
const LEASE_MS = 2_000;
const ARM_CONFIRM_MS = 4_000;
const DISARM_CONFIRM_MS = 3_000;

export class ZorroStopError extends Error {
  constructor(message: string, readonly status = 409) { super(message); this.name = 'ZorroStopError'; }
}

/** Normal arm/disarm only: no motor-test, RC override, throttle, or force-arm message. */
export function armFrame(systemId: number, componentId: number, sequence: number, arm: boolean): Buffer {
  if (!Number.isInteger(systemId) || systemId < 1 || systemId > 255 || systemId === GROUND_SYSTEM_ID ||
      componentId !== 1 || !Number.isInteger(sequence) || sequence < 0 || sequence > 255)
    throw new ZorroStopError('Invalid aircraft target or MAVLink sequence.', 400);
  const command = new common.CommandLong();
  command.targetSystem = systemId;
  command.targetComponent = componentId;
  command.command = 400; // MAV_CMD_COMPONENT_ARM_DISARM
  command.confirmation = 0;
  command._param1 = arm ? 1 : 0;
  command._param2 = 0; // Always respect ArduPilot pre-arm and disarm checks.
  command._param3 = command._param4 = command._param5 = command._param6 = command._param7 = 0;
  return new MavLinkProtocolV2(GROUND_SYSTEM_ID, GROUND_COMPONENT_ID).serialize(command, sequence);
}

export type ZorroStopChecks = {
  propsRemoved: boolean;
  areaClear: boolean;
  hardwareCool: boolean;
  radioReady: boolean;
};
type Dependencies = {
  snapshot: () => AircraftSnapshot;
  parameters: (aircraftId: string) => AircraftParameter[];
  write: (frame: Buffer) => Promise<void>;
  nextSequence: () => number;
  busy: () => boolean;
};
type Run = {
  link: string;
  systemId: number;
  componentId: number;
  armSentAt: number;
  leaseAt: number;
  lastTick: number;
  hostStartedAt: number;
  ending: 'completed' | 'cancelled' | 'failed';
  disarmSentAt?: number;
};

/** One owned props-off armed-idle window. Server timer disarms even if the browser disappears. */
export class ZorroStopController {
  private value?: ZorroStopStatus;
  private run?: Run;
  private timer?: ReturnType<typeof setInterval>;
  private usedIds = new Set<string>();
  private ending?: Promise<void>;

  constructor(private readonly deps: Dependencies) {}
  get status(): ZorroStopStatus | undefined { return this.value ? { ...this.value } : undefined; }
  get active() { return ['arming', 'running', 'stopping'].includes(this.value?.state ?? ''); }

  private link(snapshot: AircraftSnapshot) { return JSON.stringify([snapshot.link.path, snapshot.link.connectedAt]); }
  private target(snapshot: AircraftSnapshot, requireStabilize = true) {
    const aircraft = snapshot.aircraft.find(item => item.id === this.value?.aircraftId);
    if (snapshot.link.state !== 'listening' || this.link(snapshot) !== this.run?.link ||
        snapshot.aircraft.length !== 1 || !aircraft || aircraft.systemId !== this.run.systemId ||
        aircraft.componentId !== this.run.componentId || aircraft.signing !== 'unsigned')
      throw new ZorroStopError('Aircraft link or identity changed. Motor state is unconfirmed.');
    if (snapshot.now < aircraft.heartbeat.receivedAt || snapshot.now - aircraft.heartbeat.receivedAt >= HEARTBEAT_STALE_MS)
      throw new ZorroStopError('Heartbeat is stale. Motor state is unconfirmed.');
    if (requireStabilize && aircraft.heartbeat.mode !== 'Stabilize')
      throw new ZorroStopError('Flight mode changed. Ending the props-off test.');
    return aircraft;
  }

  private checkParameters(aircraftId: string, connectedAt: number, now: number) {
    const records = this.deps.parameters(aircraftId);
    const value = (name: string) => records.find(p => p.name === name &&
      p.receivedAt >= connectedAt && p.receivedAt <= now && now - p.receivedAt < 300_000)?.value;
    if (value('RC6_OPTION') !== 31) throw new ZorroStopError('Read setup: RC6_OPTION must be Motor Emergency Stop (31).');
    const delay = value('DISARM_DELAY');
    if (delay === undefined || delay < 25 || delay > 45)
      throw new ZorroStopError('Read setup: DISARM_DELAY must be 25–45 seconds for this 20-second idle test.');
    const spin = value('MOT_SPIN_ARM');
    if (spin === undefined || spin < 0.05 || spin > 0.15)
      throw new ZorroStopError('Read setup: MOT_SPIN_ARM must be 0.05–0.15 for the four motors to idle.');
    if (value('ARMING_SKIPCHK') !== 0)
      throw new ZorroStopError('Read setup: ARMING_SKIPCHK must be 0 so no pre-arm checks are skipped.');
  }

  async start(aircraftId: string, runId: string, project: Project, checks: ZorroStopChecks) {
    const planError = zorroStopPlanError(project);
    if (planError) throw new ZorroStopError(planError);
    if (!/^[0-9a-f-]{36}$/i.test(runId) || this.usedIds.has(runId))
      throw new ZorroStopError('Use a new test run ID.', 400);
    if (this.active || this.deps.busy()) throw new ZorroStopError('Another aircraft operation is active.');
    if (checks?.propsRemoved !== true || checks.areaClear !== true || checks.hardwareCool !== true || checks.radioReady !== true)
      throw new ZorroStopError('Confirm props off, clear area, cool hardware, and linked Zorro at minimum throttle.', 400);
    const snapshot = this.deps.snapshot();
    const aircraft = snapshot.aircraft.find(item => item.id === aircraftId);
    if (snapshot.link.state !== 'listening' || !snapshot.link.path || snapshot.link.connectedAt == null ||
      snapshot.aircraft.length !== 1 || !aircraft || aircraft.signing !== 'unsigned' || aircraft.componentId !== 1 ||
      aircraft.heartbeat.autopilot !== 3 || aircraft.heartbeat.vehicleType !== 2)
      throw new ZorroStopError('Connect exactly one unsigned ArduPilot quadrotor.');
    if (aircraft.version?.flightVersion !== '4.7.1' || aircraft.version.releaseType !== 255 ||
      aircraft.version.receivedAt < snapshot.link.connectedAt)
      throw new ZorroStopError('Confirm stable ArduCopter 4.7.1 on this connection.');
    if (snapshot.request?.aircraftId !== aircraftId || !['verified', 'partial'].includes(snapshot.request.state) ||
      snapshot.request.startedAt < snapshot.link.connectedAt)
      throw new ZorroStopError('Request bidirectional telemetry first.');
    if (aircraft.heartbeat.armed || aircraft.heartbeat.mode !== 'Stabilize' ||
      snapshot.now - aircraft.heartbeat.receivedAt >= HEARTBEAT_STALE_MS)
      throw new ZorroStopError('Start disarmed with a fresh Stabilize heartbeat.');
    if (!aircraft.battery || snapshot.now - aircraft.battery.receivedAt >= HEARTBEAT_STALE_MS ||
      (aircraft.battery.voltageV ?? 0) < 8)
      throw new ZorroStopError('Fresh flight-battery telemetry is required.');
    this.checkParameters(aircraftId, snapshot.link.connectedAt, snapshot.now);
    this.usedIds.add(runId);
    this.run = {
      link: this.link(snapshot), systemId: aircraft.systemId, componentId: aircraft.componentId,
      armSentAt: snapshot.now, leaseAt: snapshot.now, lastTick: snapshot.now,
      hostStartedAt: Date.now(), ending: 'failed',
    };
    this.value = {
      runId, aircraftId, storyboardId: project.id, revision: project.revision,
      state: 'arming', startedAt: null, elapsedMs: 0,
      message: 'Requesting normal arm; waiting for aircraft acknowledgement and armed heartbeat.',
    };
    this.timer = setInterval(() => this.tick(), 100);
    try {
      await this.deps.write(armFrame(aircraft.systemId, aircraft.componentId, this.deps.nextSequence(), true));
    } catch (error) {
      await this.end('failed', 'Arm write was unconfirmed; requesting disarm.');
      throw error;
    }
  }

  renew(runId: string) {
    if (this.value?.runId !== runId || !['arming', 'running', 'stopping'].includes(this.value.state))
      throw new ZorroStopError('This test is no longer running.');
    if (this.value.state === 'stopping') return;
    const snapshot = this.deps.snapshot();
    this.target(snapshot);
    this.run!.leaseAt = snapshot.now;
  }

  private tick() {
    if (!this.value || !this.run || !this.active) return;
    const snapshot = this.deps.snapshot();
    try {
      if (snapshot.now < this.run.lastTick || snapshot.now - this.run.lastTick > 1000 ||
          Math.abs((snapshot.now - this.run.armSentAt) - (Date.now() - this.run.hostStartedAt)) > 1000)
        throw new ZorroStopError('Test clock paused or changed.');
      this.run.lastTick = snapshot.now;
      const aircraft = this.target(snapshot, this.value.state !== 'stopping');
      if (this.value.state === 'stopping') {
        if (!aircraft.heartbeat.armed && aircraft.heartbeat.receivedAt > (this.run.disarmSentAt ?? 0)) {
          this.terminal(this.run.ending, this.run.ending === 'completed'
            ? '20-second window ended; disarmed heartbeat received. Confirm motor stop visually.'
            : 'Disarmed heartbeat received. Confirm motor stop visually.');
        } else if (snapshot.now - (this.run.disarmSentAt ?? snapshot.now) > DISARM_CONFIRM_MS) {
          this.terminal('failed', 'Disarm unconfirmed. Use RC6 and disconnect battery power if needed.');
        }
        return;
      }
      if (snapshot.now - this.run.leaseAt >= LEASE_MS) throw new ZorroStopError('Run view lost its control lease.');
      if (this.value.state === 'arming') {
        const ack = aircraft.lastArmAck;
        if (ack && ack.command === 400 && ack.receivedAt > this.run.armSentAt &&
            [0, GROUND_SYSTEM_ID].includes(ack.targetSystem) &&
            [0, GROUND_COMPONENT_ID].includes(ack.targetComponent) && ack.result !== 5) {
          if (ack.result !== 0) throw new ZorroStopError(`ArduPilot rejected arming (ACK ${ack.result}).`);
          if (aircraft.heartbeat.armed && aircraft.heartbeat.receivedAt > this.run.armSentAt) {
            this.value.state = 'running';
            this.value.startedAt = snapshot.now;
            this.value.message = 'Armed idle is running. Flip RC6 now and watch all four motors.';
          }
        }
        if (snapshot.now - this.run.armSentAt >= ARM_CONFIRM_MS)
          throw new ZorroStopError('Arm was not confirmed by ACK and heartbeat.');
        return;
      }
      if (!aircraft.heartbeat.armed) {
        this.terminal('cancelled', 'Aircraft disarmed before 20 seconds. Confirm whether RC6 stopped the motors.');
        return;
      }
      this.value.elapsedMs = Math.min(RUN_MS, Math.max(0, snapshot.now - this.value.startedAt!));
      if (this.value.elapsedMs >= RUN_MS) void this.end('completed', '20-second window ended; requesting disarm.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Test interrupted.';
      if (this.value.state === 'stopping')
        this.terminal('failed', `${message} Disarm is unconfirmed; use RC6 and disconnect the battery if needed.`);
      else void this.end('failed', message);
    }
  }

  private terminal(state: 'completed' | 'cancelled' | 'failed', message: string) {
    if (this.value) { this.value.state = state; this.value.message = message; }
    clearInterval(this.timer);
    this.timer = undefined;
    this.run = undefined;
    this.ending = undefined;
  }

  private async end(state: 'completed' | 'cancelled' | 'failed', reason: string) {
    if (!this.run || !this.value || this.value.state === 'stopping') return this.ending;
    const run = this.run;
    run.ending = state;
    this.value.state = 'stopping';
    this.value.message = `${reason} Disarm requested; waiting for confirmation.`;
    run.disarmSentAt = this.deps.snapshot().now;
    this.ending = this.deps.write(armFrame(run.systemId, run.componentId, this.deps.nextSequence(), false))
      .catch(() => this.terminal('failed', 'Disarm write failed. Use RC6 and disconnect battery power.'));
    return this.ending;
  }

  async stop(runId: string) {
    if (this.value?.runId !== runId || !this.run) throw new ZorroStopError('No matching active test.');
    await this.end('cancelled', 'Operator stopped the test.');
  }

  async abort(reason: string) {
    if (!this.active || !this.run) return;
    if (this.deps.snapshot().link.state === 'listening') await this.end('failed', reason);
    else this.terminal('failed', `${reason} Motor state is unconfirmed; use RC6 and disconnect the battery.`);
  }
}
