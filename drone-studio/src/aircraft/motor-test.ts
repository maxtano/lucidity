import { MavLinkProtocolV2, common } from 'node-mavlink';
import { GROUND_COMPONENT_ID, GROUND_SYSTEM_ID } from './read-requests';
import { HEARTBEAT_STALE_MS, type AircraftSnapshot, type AircraftTelemetry } from './types';

const ACK_TIMEOUT_MS = 2000;
const STOP_WRITE_TIMEOUT_MS = 1500;
const PULSE_MS = 1000;
const COOLDOWN_MS = 5000;

export type MotorTestChecks = {
  propsRemoved: boolean;
  areaClear: boolean;
  hardwareCool: boolean;
};

export type MotorTestDependencies = {
  snapshot: () => AircraftSnapshot;
  write: (frame: Buffer) => Promise<void>;
  nextSequence: () => number;
  telemetryBusy: () => boolean;
};

export class MotorTestError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
    this.name = 'MotorTestError';
  }
}

/** Copter 4.7.1 ignores test-order param6: these are test sequences A-D, not board outputs.
 * https://github.com/ArduPilot/ardupilot/blob/Copter-4.7.1/ArduCopter/GCS_MAVLink_Copter.cpp#L679
 * Only a fixed 5%/one-second pulse or zero-duration stop can be constructed here.
 */
export function motorTestFrame(
  systemId: number,
  componentId: number,
  motor: number,
  sequence: number,
  stop = false
): Buffer {
  if (
    !Number.isInteger(systemId) || systemId < 1 || systemId > 255 ||
    systemId === GROUND_SYSTEM_ID || componentId !== 1 ||
    !Number.isInteger(motor) || motor < 1 || motor > 4 ||
    !Number.isInteger(sequence) || sequence < 0 || sequence > 255 ||
    typeof stop !== 'boolean'
  ) throw new MotorTestError('Invalid motor-test target or sequence.', 400);
  const command = new common.CommandLong();
  command.targetSystem = systemId;
  command.targetComponent = componentId;
  command.command = 209;
  command.confirmation = 0;
  command._param1 = motor;
  command._param2 = 0;
  command._param3 = stop ? 0 : 5;
  command._param4 = stop ? 0 : 1;
  command._param5 = 1;
  command._param6 = command._param7 = 0;
  return new MavLinkProtocolV2(GROUND_SYSTEM_ID, GROUND_COMPONENT_ID).serialize(command, sequence);
}

type Owner = {
  aircraftId: string;
  systemId: number;
  componentId: number;
  linkKey: string;
  pulseDeadline: number;
  availableAt: number;
  motor: number;
};
type Wait = { cancel: () => void };
type MotorStatus = NonNullable<AircraftSnapshot['motorTest']>;

/** Explicit bench pulses only. No retry, automatic stop transmission, or reconnect replay. */
export class MotorTestController {
  private value?: MotorStatus;
  private owner?: Owner;
  private active?: Wait;
  private stopping?: Wait;
  private generation = 0;
  private invalidLink?: string;

  constructor(private readonly dependencies: MotorTestDependencies) {}

  get status(): AircraftSnapshot['motorTest'] {
    return this.value ? { ...this.value } : undefined;
  }

  get pending(): boolean {
    return Boolean(this.active || this.stopping);
  }

  /** Conservative end: includes the one-second interval following the acceptance ACK. */
  get pulseDeadline(): number | undefined {
    return this.owner?.pulseDeadline;
  }

  private linkKey(snapshot: AircraftSnapshot, aircraftId: string): string {
    return JSON.stringify([snapshot.link.path, snapshot.link.connectedAt, aircraftId]);
  }

  private target(snapshot: AircraftSnapshot, aircraftId: string, allowInvalidated = false): AircraftTelemetry {
    if (typeof aircraftId !== 'string' || !aircraftId.length || aircraftId.length > 120)
      throw new MotorTestError('Choose the connected aircraft identity.', 400);
    if (
      snapshot.link.state !== 'listening' || snapshot.link.path === null ||
      snapshot.link.connectedAt === null || !Number.isFinite(snapshot.link.connectedAt) ||
      !Number.isFinite(snapshot.now)
    ) throw new MotorTestError('A current listening aircraft link is required.');
    if (!allowInvalidated && this.invalidLink === this.linkKey(snapshot, aircraftId))
      throw new MotorTestError('The motor-test connection was invalidated. Disconnect and reconnect before another pulse.');
    const aircraft = snapshot.aircraft.find((item) => item.id === aircraftId);
    if (!aircraft) throw new MotorTestError('The selected aircraft is no longer on this link.');
    return aircraft;
  }

  assertReady(aircraftId: string, motor: number, checks: MotorTestChecks) {
    if (!Number.isInteger(motor) || motor < 1 || motor > 4)
      throw new MotorTestError('Choose motor test A, B, C, or D.', 400);
    if (
      checks?.propsRemoved !== true || checks?.areaClear !== true || checks?.hardwareCool !== true
    ) throw new MotorTestError('Confirm removed props, a clear area, and cool, undamaged hardware.', 400);
    if (this.pending) throw new MotorTestError('A motor-test request is already pending.');
    if (this.dependencies.telemetryBusy())
      throw new MotorTestError('Wait for the telemetry request to finish before testing a motor.');
    const snapshot = this.dependencies.snapshot();
    const aircraft = this.target(snapshot, aircraftId);
    if (snapshot.aircraft.length !== 1)
      throw new MotorTestError('Motor tests require exactly one aircraft on the link.');
    if (
      aircraft.heartbeat.autopilot !== 3 || aircraft.heartbeat.vehicleType !== 2 ||
      aircraft.componentId !== 1
    ) throw new MotorTestError('Motor tests require an ArduPilot quadrotor flight controller.');
    if (aircraft.signing !== 'unsigned')
      throw new MotorTestError('Signed telemetry cannot be verified by this connection.');
    if (
      aircraft.version?.flightVersion !== '4.7.1' || aircraft.version.releaseType !== 255 ||
      !Number.isFinite(aircraft.version.receivedAt) ||
      aircraft.version.receivedAt < snapshot.link.connectedAt! ||
      aircraft.version.receivedAt > snapshot.now
    ) throw new MotorTestError('This bench test requires confirmed stable ArduCopter 4.7.1 firmware on this link.');
    if (
      snapshot.request?.aircraftId !== aircraftId ||
      !['verified', 'partial'].includes(snapshot.request.state) ||
      !Number.isFinite(snapshot.request.startedAt) ||
      snapshot.request.startedAt < snapshot.link.connectedAt! || snapshot.request.startedAt > snapshot.now
    ) throw new MotorTestError('Request and confirm bidirectional telemetry on this link before testing a motor.');
    const heartbeatAt = aircraft.heartbeat.receivedAt;
    if (
      !Number.isFinite(heartbeatAt) || heartbeatAt > snapshot.now ||
      snapshot.now - heartbeatAt > HEARTBEAT_STALE_MS
    ) throw new MotorTestError('A fresh aircraft heartbeat is required before a motor test.');
    if (aircraft.heartbeat.armed)
      throw new MotorTestError('Disarm the aircraft before starting a motor test.');
    const linkKey = this.linkKey(snapshot, aircraftId);
    if (this.owner?.linkKey === linkKey) {
      if (snapshot.now < this.owner.availableAt)
        throw new MotorTestError('Wait five seconds between motor-test requests.');
      if (heartbeatAt <= this.owner.pulseDeadline)
        throw new MotorTestError('Wait for a fresh disarmed heartbeat after the previous pulse.');
    }
    return { snapshot, aircraft, linkKey };
  }

  async start(aircraftId: string, motor: number, checks: MotorTestChecks): Promise<void> {
    const { snapshot, aircraft, linkKey } = this.assertReady(aircraftId, motor, checks);
    const frame = motorTestFrame(
      aircraft.systemId, aircraft.componentId, motor, this.dependencies.nextSequence()
    );
    const startedAt = snapshot.now;
    const generation = ++this.generation;
    const owner: Owner = {
      aircraftId, systemId: aircraft.systemId, componentId: aircraft.componentId, linkKey,
      motor, pulseDeadline: startedAt + PULSE_MS, availableAt: startedAt + COOLDOWN_MS,
    };
    this.owner = owner;
    this.value = {
      state: 'pending', aircraftId, motor, startedAt, availableAt: owner.availableAt,
      message: 'Sending one 5% pulse for one second. Awaiting aircraft acknowledgement.',
    };
    await new Promise<void>((resolve) => {
      let settled = false;
      let writeFinished = false;
      const finish = (state?: MotorStatus['state'], message?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        clearInterval(poll);
        if (this.active === wait) this.active = undefined;
        if (state && generation === this.generation && this.value)
          this.value = { ...this.value, state, message: message! };
        resolve();
      };
      const wait: Wait = { cancel: () => finish() };
      const deadline = setTimeout(() => {
        // A timed-out write may still be queued in the native serial driver. Never enqueue
        // another pulse behind it merely because the local timeout and cooldown elapsed.
        if (!writeFinished) this.invalidLink = owner.linkKey;
        finish(
          'unconfirmed',
          writeFinished
            ? 'No matching acknowledgement within two seconds. Delivery and motor movement are unknown; no retry was sent.'
            : 'The pulse write did not complete. Motor state is unknown. Disconnect and reconnect before another pulse; no retry was sent.'
        );
      }, ACK_TIMEOUT_MS);
      const poll = setInterval(() => {
        if (generation !== this.generation) { finish(); return; }
        const current = this.dependencies.snapshot();
        const selected = current.aircraft.find((item) => item.id === aircraftId);
        if (
          current.link.state !== 'listening' || this.linkKey(current, aircraftId) !== linkKey ||
          current.aircraft.length !== 1 || !selected || selected.systemId !== owner.systemId ||
          selected.componentId !== owner.componentId || selected.signing !== 'unsigned'
        ) {
          this.invalidate('The aircraft link or identity changed. Motor movement is unconfirmed.');
          return;
        }
        // The firmware temporarily reports armed during a motor test. That is expected here.
        const ack = selected.lastMotorAck;
        if (
          !ack || !Number.isFinite(ack.receivedAt) || ack.receivedAt <= startedAt ||
          ack.receivedAt > current.now || ack.command !== 209 ||
          ![0, GROUND_SYSTEM_ID].includes(ack.targetSystem) ||
          ![0, GROUND_COMPONENT_ID].includes(ack.targetComponent)
        ) return;
        if (ack.result === 0) {
          // Conservatively require a disarmed heartbeat after a full second following acceptance.
          owner.pulseDeadline = Math.max(owner.pulseDeadline, ack.receivedAt + PULSE_MS);
          finish('accepted', 'Aircraft accepted the pulse request. Confirm the motor movement and stop visually.');
        } else if (ack.result !== 5) {
          finish('rejected', `Aircraft did not accept the pulse (ACK result ${ack.result}). Check aircraft messages; no retry was sent.`);
        }
      }, 25);
      this.active = wait;
      const writeFailed = () => {
        if (settled || generation !== this.generation) return;
        this.invalidLink = owner.linkKey;
        finish(
          'unconfirmed',
          'Writing the pulse failed. Motor state is unknown. Disconnect and reconnect before another pulse; no retry was sent.'
        );
      };
      try {
        // This single call is the handoff. A failure after this point cannot prove non-delivery.
        Promise.resolve(this.dependencies.write(frame)).then(() => { writeFinished = true; }, writeFailed);
      } catch {
        writeFailed();
      }
    });
  }

  async stop(aircraftId: string): Promise<void> {
    if (this.stopping) throw new MotorTestError('A stop request is already being written.');
    const snapshot = this.dependencies.snapshot();
    const aircraft = this.target(snapshot, aircraftId, true);
    const owner = this.owner;
    if (
      !owner || owner.aircraftId !== aircraftId ||
      owner.linkKey !== this.linkKey(snapshot, aircraftId) ||
      owner.systemId !== aircraft.systemId || owner.componentId !== aircraft.componentId
    ) throw new MotorTestError('No Lucidity motor test belongs to this aircraft link.');
    const frame = motorTestFrame(
      owner.systemId, owner.componentId, owner.motor, this.dependencies.nextSequence(), true
    );
    const generation = ++this.generation;
    this.active?.cancel();
    owner.availableAt = Math.max(owner.availableAt, snapshot.now + COOLDOWN_MS);
    owner.pulseDeadline = Math.max(owner.pulseDeadline, snapshot.now);
    this.value = {
      state: 'stop-requested', aircraftId, motor: owner.motor, startedAt: snapshot.now,
      availableAt: owner.availableAt,
      message: 'Sending a best-effort zero-duration stop. This does not confirm the motor stopped; check it visually.',
    };
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (failure = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        if (this.stopping === wait) this.stopping = undefined;
        if (failure && generation === this.generation && this.value) {
          this.invalidLink = owner.linkKey;
          this.value = {
            ...this.value, state: 'unconfirmed',
            message: 'The stop write was not confirmed. Motor state is unknown; use the hardware power disconnect if needed. Reconnect before another pulse.',
          };
        }
        resolve();
      };
      const wait: Wait = { cancel: () => finish() };
      const deadline = setTimeout(() => finish(true), STOP_WRITE_TIMEOUT_MS);
      this.stopping = wait;
      try {
        Promise.resolve(this.dependencies.write(frame)).then(() => finish(), () => finish(true));
      } catch { finish(true); }
      // No ACK wait: a late start ACK and a stop ACK both identify command 209.
    });
  }

  invalidate(reason: string): void {
    ++this.generation;
    this.invalidLink = this.owner?.linkKey;
    this.active?.cancel();
    this.stopping?.cancel();
    if (this.value)
      this.value = { ...this.value, state: 'unconfirmed', message: `${reason.slice(0, 240)} No motor stop is verified.` };
  }
}
