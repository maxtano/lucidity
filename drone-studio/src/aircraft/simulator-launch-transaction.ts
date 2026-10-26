import { beginFlightProgress, observeFlightProgress, type FlightProgress } from './flight-progress';
import type { MissionPrelaunchVerification } from './service';
import type { AircraftCommandAckEvent, AircraftSnapshot, AircraftTelemetry } from './types';

/**
 * Simulator-only command orchestration. This module has no serial transport,
 * HTTP route, or physical-aircraft entry point. An injected SITL adapter is
 * required, and fixture assertions here are not evidence about a real quad.
 */
export interface SimulatorCommand {
  command: 224 | 400 | 300 | 176;
  targetSystem: number;
  targetComponent: number;
  params: readonly [number, number, number, number, number, number, number];
}

export interface SimulatorLaunchSample {
  now: number;
  linkGeneration: number;
  linkState: AircraftSnapshot['link']['state'];
  aircraft: AircraftTelemetry[];
}

export interface SimulatorLaunchAdapter {
  readonly kind: 'injected-sitl';
  readonly transport: 'loopback-tcp';
  readonly endpoint: '127.0.0.1:5760';
  readonly groundSystemId: number;
  readonly groundComponentId: number;
  sample(): SimulatorLaunchSample;
  commandAckCursor(): number;
  commandAcks(afterId: number, aircraftId: string): AircraftCommandAckEvent[];
  sendCommand(command: SimulatorCommand): Promise<void>;
  waitForUpdate(timeoutMs: number): Promise<void>;
}

export interface SimulatorPreflightEvidence {
  kind: 'sitl-fixture';
  verificationId: string;
  aircraftId: string;
  linkGeneration: number;
  observedAt: number;
  expiresAt: number;
  gpsHomeEkfHealthy: true;
  batteryHealthy: true;
  receiverAndFailsafesChecked: true;
  pilotTakeoverRouteChecked: true;
}

export interface SimulatorLaunchGate {
  proof: MissionPrelaunchVerification;
  review: { planId: string; storyboardId: string; revision: number };
  preflight: SimulatorPreflightEvidence;
}

export type SimulatorLaunchState =
  'idle' | 'resetting' | 'arming' | 'starting' | 'active' | 'takeover' | 'landing' | 'landed' | 'rejected' | 'unknown';

export interface SimulatorLaunchStatus {
  state: SimulatorLaunchState;
  reason: string;
  issuedCommands: number[];
  progress: FlightProgress | null;
}

interface SentCommand {
  cursor: number;
  sentAt: number;
  baselineHeartbeatAt: number;
  baselineCurrentAt: number;
  baselineEkfAt: number;
}

const HEARTBEAT_AGE_MS = 3000;
const TELEMETRY_AGE_MS = 3000;
const ACK_TIMEOUT_MS = 3000;
const TELEMETRY_TIMEOUT_MS = 4000;
const START_TIMEOUT_MS = 15_000;
const LAND_TIMEOUT_MS = 90_000;
const PILOT_ARMABLE_MODES = new Set(['Stabilize', 'AltHold', 'Loiter', 'PosHold']);
// ArduPilotMega EKF_STATUS_FLAGS: a predicted position (512) is not an
// absolute position fix (16). This is a conservative prerequisite, not
// Copter's complete internal position_ok / pre-arm decision.
// https://mavlink.io/en/messages/ardupilotmega.html#EKF_STATUS_FLAGS
const EKF_REQUIRED = 4 | 16 | 32; // vertical velocity, absolute horizontal and vertical position
const EKF_FORBIDDEN = 128 | 1024 | 32768; // constant-position, uninitialized, GPS glitching
// Copter 4.7.1 stores HOME plus three executable items but reports
// MISSION_CURRENT.total=3: its sender explicitly excludes HOME.
const validCurrentTotal = (total: number) => total === 3;

const fresh = (at: number | undefined, now: number, after: number, ageMs: number) =>
  at !== undefined && Number.isFinite(at) && at >= after && at <= now && now - at <= ageMs;

export class SimulatorLaunchTransaction {
  private status: SimulatorLaunchStatus = {
    state: 'idle', reason: 'No simulator launch has been requested.', issuedCommands: [], progress: null,
  };
  private aircraftId: string | null = null;
  private generation: number | null = null;
  private targetSystem: number | null = null;
  private targetComponent: number | null = null;
  private landSentAt: number | null = null;
  private landBusy = false;

  constructor(private readonly adapter: SimulatorLaunchAdapter) {
    if (typeof process === 'undefined' || process.env.NODE_ENV === 'production' ||
        adapter.kind !== 'injected-sitl' || adapter.transport !== 'loopback-tcp' ||
        adapter.endpoint !== '127.0.0.1:5760')
      throw new Error('Simulator launch is disabled outside the explicit loopback SITL test runtime.');
    if (!Number.isInteger(adapter.groundSystemId) || adapter.groundSystemId < 1 || adapter.groundSystemId > 255 ||
        !Number.isInteger(adapter.groundComponentId) || adapter.groundComponentId < 1 || adapter.groundComponentId > 255)
      throw new Error('A specific ground MAVLink identity is required.');
  }

  snapshot(): SimulatorLaunchStatus { return structuredClone(this.status); }

  private change(state: SimulatorLaunchState, reason: string): SimulatorLaunchStatus {
    this.status = { ...this.status, state, reason };
    return this.snapshot();
  }

  private expected(sample: SimulatorLaunchSample): AircraftTelemetry | null {
    if (sample.linkGeneration !== this.generation || sample.linkState !== 'listening') return null;
    const candidates = sample.aircraft.filter(item => item.heartbeat.autopilot === 3 &&
      fresh(item.heartbeat.receivedAt, sample.now, sample.now - HEARTBEAT_AGE_MS, HEARTBEAT_AGE_MS));
    if (candidates.length !== 1 || candidates[0].id !== this.aircraftId) return null;
    const aircraft = candidates[0];
    if (aircraft.systemId !== this.targetSystem || aircraft.componentId !== this.targetComponent ||
        aircraft.heartbeat.vehicleType !== 2 || aircraft.protocolVersion !== 2 || aircraft.signing !== 'unsigned') return null;
    return aircraft;
  }

  private startupSensorsFresh(aircraft: AircraftTelemetry, now: number): boolean {
    return !!aircraft.gps && aircraft.gps.fixType >= 3 && aircraft.gps.hdop !== null && aircraft.gps.hdop <= 1.4 &&
      fresh(aircraft.gps.receivedAt, now, now - TELEMETRY_AGE_MS, TELEMETRY_AGE_MS) &&
      !!aircraft.position && Number.isFinite(aircraft.position.latitude) &&
      Number.isFinite(aircraft.position.longitude) && Number.isFinite(aircraft.position.relativeAltitudeM) &&
      fresh(aircraft.position.receivedAt, now, now - TELEMETRY_AGE_MS, TELEMETRY_AGE_MS) &&
      !!aircraft.battery && aircraft.battery.voltageV !== null && Number.isFinite(aircraft.battery.voltageV) &&
      aircraft.battery.voltageV > 0 &&
      fresh(aircraft.battery.receivedAt, now, now - TELEMETRY_AGE_MS, TELEMETRY_AGE_MS) &&
      !!aircraft.receiver && aircraft.receiver.channels.length >= 4 &&
      aircraft.receiver.channels.slice(0, 4).every(channel => channel !== null && Number.isFinite(channel)) &&
      fresh(aircraft.receiver.receivedAt, now, now - TELEMETRY_AGE_MS, TELEMETRY_AGE_MS) &&
      !!aircraft.version && aircraft.version.flightVersion.startsWith('4.7.1') &&
      fresh(aircraft.version.receivedAt, now, now - 15_000, 15_000) &&
      this.ekfReady(aircraft, now);
  }

  private ekfReady(aircraft: AircraftTelemetry, now: number): boolean {
    const report = aircraft.ekfStatus;
    return !!report && fresh(report.receivedAt, now, now - TELEMETRY_AGE_MS, TELEMETRY_AGE_MS) &&
      Number.isInteger(report.flags) && (report.flags & EKF_REQUIRED) === EKF_REQUIRED &&
      (report.flags & EKF_FORBIDDEN) === 0;
  }

  private precheck(gate: SimulatorLaunchGate): string | null {
    const sample = this.adapter.sample();
    const { proof, review, preflight } = gate;
    if (sample.linkState !== 'listening' || !Number.isFinite(sample.now)) return 'SITL link is not listening.';
    if (proof.connectionGeneration !== sample.linkGeneration || proof.aircraftId !== preflight.aircraftId ||
        proof.connectionGeneration !== preflight.linkGeneration || proof.verificationId !== preflight.verificationId ||
        proof.planId !== review.planId || proof.storyboardId !== review.storyboardId || proof.revision !== review.revision ||
        proof.missionCount !== 4 || !Number.isFinite(proof.heightM) || proof.heightM < 2 || proof.heightM > 10 ||
        !Number.isFinite(proof.holdSeconds) || proof.holdSeconds <= 0 ||
        proof.verifiedAt > sample.now || proof.expiresAt < sample.now ||
        sample.now - proof.verifiedAt > 15_000 || proof.expiresAt - proof.verifiedAt > 15_000 ||
        preflight.kind !== 'sitl-fixture' || preflight.observedAt > sample.now || preflight.expiresAt < sample.now ||
        sample.now - preflight.observedAt > TELEMETRY_AGE_MS ||
        !preflight.gpsHomeEkfHealthy || !preflight.batteryHealthy || !preflight.receiverAndFailsafesChecked ||
        !preflight.pilotTakeoverRouteChecked)
      return 'Reviewed mission readback or simulator preflight evidence is missing, stale, or mismatched.';
    this.aircraftId = proof.aircraftId;
    this.generation = proof.connectionGeneration;
    const candidate = sample.aircraft.find(item => item.id === proof.aircraftId);
    if (!candidate) return 'The reviewed SITL aircraft is absent.';
    this.targetSystem = candidate.systemId;
    this.targetComponent = candidate.componentId;
    const aircraft = this.expected(sample);
    if (!aircraft) return 'Exactly one fresh, matching ArduCopter quad is required.';
    if (aircraft.heartbeat.armed || !PILOT_ARMABLE_MODES.has(aircraft.heartbeat.mode))
      return 'SITL aircraft must be disarmed in a pilot-armable mode.';
    if (!aircraft.extendedState || aircraft.extendedState.landedState !== 1 ||
        !fresh(aircraft.extendedState.receivedAt, sample.now, sample.now - TELEMETRY_AGE_MS, TELEMETRY_AGE_MS))
      return 'Fresh on-ground landed-state telemetry is required.';
    if (!aircraft.position || Math.abs(aircraft.position.relativeAltitudeM) > 0.75)
      return 'The SITL aircraft must be near its home altitude before launch.';
    if (!this.startupSensorsFresh(aircraft, sample.now))
      return 'Fresh Copter 4.7.1 identity, 3D GPS/position, healthy EKF, battery and receiver telemetry are required.';
    return null;
  }

  private command(command: SimulatorCommand['command'], params: SimulatorCommand['params']): SimulatorCommand {
    return { command, targetSystem: this.targetSystem!, targetComponent: this.targetComponent!, params };
  }

  private async send(command: SimulatorCommand): Promise<SentCommand | null> {
    const cursor = this.adapter.commandAckCursor();
    const sample = this.adapter.sample();
    const aircraft = this.expected(sample);
    if (!aircraft) {
      this.change('unknown', `SITL identity or link was lost before command ${command.command}; nothing was sent.`);
      return null;
    }
    const sentAt = sample.now;
    const baselineHeartbeatAt = aircraft.heartbeat.receivedAt;
    const baselineCurrentAt = aircraft.missionCurrent?.receivedAt ?? -Infinity;
    const baselineEkfAt = aircraft.ekfStatus?.receivedAt ?? -Infinity;
    // Record before write: a thrown write may still have reached the aircraft.
    this.status.issuedCommands.push(command.command);
    try { await this.adapter.sendCommand(command); }
    catch { this.change('unknown', `Sending MAVLink command ${command.command} failed; its effect is unknown. Do not retry blindly.`); return null; }
    return { cursor, sentAt, baselineHeartbeatAt, baselineCurrentAt, baselineEkfAt };
  }

  private async waitForCommand(
    command: SimulatorCommand['command'],
    sent: SentCommand,
    evidence: (aircraft: AircraftTelemetry, now: number) => boolean,
    evidenceTimeoutMs = TELEMETRY_TIMEOUT_MS,
  ): Promise<boolean> {
    let accepted = false;
    const ackDeadline = sent.sentAt + ACK_TIMEOUT_MS;
    const evidenceDeadline = sent.sentAt + Math.max(ACK_TIMEOUT_MS, evidenceTimeoutMs);
    let cursor = sent.cursor;
    let spins = 0;
    while (spins++ < 10_000) {
      const sample = this.adapter.sample();
      const aircraft = this.expected(sample);
      if (!aircraft) {
        this.change('unknown', 'SITL link or aircraft identity changed during a command; outcome is unknown.');
        return false;
      }
      let events: AircraftCommandAckEvent[];
      try { events = this.adapter.commandAcks(cursor, this.aircraftId!); }
      catch {
        this.change('unknown', 'Command ACK history expired or could not be read; outcome is unknown.');
        return false;
      }
      for (const event of events) {
        cursor = Math.max(cursor, event.id);
        if (event.command !== command || event.receivedAt < sent.sentAt ||
            event.sourceSystem !== this.targetSystem || event.sourceComponent !== this.targetComponent ||
            event.targetSystem !== this.adapter.groundSystemId || event.targetComponent !== this.adapter.groundComponentId)
          continue;
        if (event.result === 5) continue; // IN_PROGRESS is not final acceptance.
        if (event.result !== 0) {
          const prearm = [...aircraft.messages].reverse().find(item => item.receivedAt >= sent.sentAt && /prearm|arm/i.test(item.text));
          this.change(command === 224 || command === 400 ? 'rejected' : 'unknown',
            `Command ${command} rejected with MAV_RESULT ${event.result}.${prearm ? ` ${prearm.text}` : ''}`);
          return false;
        }
        accepted = true;
      }
      if (accepted && evidence(aircraft, sample.now)) return true;
      if (!accepted && sample.now >= ackDeadline) {
        this.change('unknown', `Command ${command} has no correlated ACK within its deadline; outcome is unknown. Do not retry blindly.`);
        return false;
      }
      if (sample.now >= evidenceDeadline) {
        this.change('unknown', `Command ${command} ACK was accepted but fresh state evidence did not arrive; outcome is unknown. Do not retry blindly.`);
        return false;
      }
      try { await this.adapter.waitForUpdate(Math.min(100, evidenceDeadline - sample.now)); }
      catch {
        this.change('unknown', `Observation failed after command ${command}; outcome is unknown.`);
        return false;
      }
    }
    this.change('unknown', `Observation did not advance after command ${command}; outcome is unknown.`);
    return false;
  }

  private async waitForPostArmEkf(sent: SentCommand): Promise<boolean> {
    const deadline = sent.sentAt + TELEMETRY_TIMEOUT_MS;
    for (let spins = 0; spins < 10_000; spins++) {
      const sample = this.adapter.sample();
      const aircraft = this.expected(sample);
      if (!aircraft || !aircraft.heartbeat.armed || !PILOT_ARMABLE_MODES.has(aircraft.heartbeat.mode)) {
        this.change('unknown', 'SITL link, identity, or pilot-armable mode changed after ARM; no START command sent.');
        return false;
      }
      const report = aircraft.ekfStatus;
      if (report && report.receivedAt > sent.baselineEkfAt && report.receivedAt >= sent.sentAt) {
        if (this.ekfReady(aircraft, sample.now)) return true;
        this.change('unknown', 'A new unhealthy EKF report arrived after ARM; no START command sent.');
        return false;
      }
      if (sample.now >= deadline) {
        this.change('unknown', 'No new healthy EKF report arrived after ARM; no START command sent.');
        return false;
      }
      try { await this.adapter.waitForUpdate(Math.min(100, deadline - sample.now)); }
      catch {
        this.change('unknown', 'SITL observation failed while awaiting post-ARM EKF status; no START command sent.');
        return false;
      }
    }
    this.change('unknown', 'Post-ARM EKF observation did not advance; no START command sent.');
    return false;
  }

  async launch(gate: SimulatorLaunchGate): Promise<SimulatorLaunchStatus> {
    if (this.status.state !== 'idle') throw new Error('This simulator transaction cannot be launched twice.');
    const blocked = this.precheck(gate);
    if (blocked) return this.change('rejected', blocked);

    this.change('resetting', 'Resetting the disarmed SITL mission to first executable item.');
    let sent = await this.send(this.command(224, [1, 0, 0, 0, 0, 0, 0]));
    if (!sent) return this.snapshot();
    if (!await this.waitForCommand(224, sent, (aircraft, now) =>
      !aircraft.heartbeat.armed && aircraft.extendedState?.landedState === 1 &&
      fresh(aircraft.missionCurrent?.receivedAt, now, sent!.sentAt, TELEMETRY_AGE_MS) &&
      aircraft.missionCurrent!.receivedAt > sent!.baselineCurrentAt &&
      aircraft.missionCurrent?.seq === 1 && validCurrentTotal(aircraft.missionCurrent.total))) return this.snapshot();

    const beforeArm = this.adapter.sample();
    const aircraft = this.expected(beforeArm);
    if (!aircraft || aircraft.heartbeat.armed || aircraft.extendedState?.landedState !== 1 ||
        !fresh(aircraft.extendedState?.receivedAt, beforeArm.now, beforeArm.now - TELEMETRY_AGE_MS, TELEMETRY_AGE_MS) ||
        !this.startupSensorsFresh(aircraft, beforeArm.now) ||
        !PILOT_ARMABLE_MODES.has(aircraft.heartbeat.mode))
      return this.change('unknown', 'SITL aircraft changed state before arming. No further command sent.');
    this.change('arming', 'Sending normal, non-forced ARM in a pilot-armable mode.');
    sent = await this.send(this.command(400, [1, 0, 0, 0, 0, 0, 0]));
    if (!sent) return this.snapshot();
    if (!await this.waitForCommand(400, sent, (item, now) =>
      item.heartbeat.armed && PILOT_ARMABLE_MODES.has(item.heartbeat.mode) &&
      fresh(item.heartbeat.receivedAt, now, sent!.sentAt, HEARTBEAT_AGE_MS) &&
      item.heartbeat.receivedAt > sent!.baselineHeartbeatAt)) return this.snapshot();

    const armSent = sent;
    if (!await this.waitForPostArmEkf(armSent)) return this.snapshot();
    const beforeStart = this.adapter.sample();
    const armedAircraft = this.expected(beforeStart);
    if (!armedAircraft || !armedAircraft.heartbeat.armed || !PILOT_ARMABLE_MODES.has(armedAircraft.heartbeat.mode) ||
        !this.startupSensorsFresh(armedAircraft, beforeStart.now))
      return this.change('unknown', 'SITL telemetry or pilot-armable mode changed after ARM; no START command sent.');

    this.change('starting', 'ARM confirmed; requesting reviewed mission start.');
    sent = await this.send(this.command(300, [0, 0, 0, 0, 0, 0, 0]));
    if (!sent) return this.snapshot();
    if (!await this.waitForCommand(300, sent, (item, now) =>
      item.heartbeat.armed && item.heartbeat.mode === 'Auto' &&
      fresh(item.heartbeat.receivedAt, now, sent!.sentAt, HEARTBEAT_AGE_MS) &&
      item.heartbeat.receivedAt > sent!.baselineHeartbeatAt &&
      fresh(item.missionCurrent?.receivedAt, now, sent!.sentAt, TELEMETRY_AGE_MS) &&
      item.missionCurrent!.receivedAt > sent!.baselineCurrentAt &&
      item.missionCurrent!.seq >= 1 && item.missionCurrent!.seq <= 3 &&
      validCurrentTotal(item.missionCurrent!.total), START_TIMEOUT_MS)) return this.snapshot();

    const started = this.adapter.sample();
    this.status.progress = observeFlightProgress(
      beginFlightProgress(this.aircraftId!, this.generation!, sent.sentAt),
      { ...started, aircraft: this.expected(started) },
    );
    if (this.status.progress.state !== 'active')
      return this.change('unknown', `Start evidence did not satisfy mission progress observer: ${this.status.progress.reason}`);
    return this.change('active', 'SITL AUTO mission started; observe progress until landing or takeover.');
  }

  observe(): SimulatorLaunchStatus {
    if (this.landBusy) return this.snapshot();
    if (this.status.state === 'active' || this.status.state === 'takeover') {
      const sample = this.adapter.sample();
      this.status.progress = observeFlightProgress(this.status.progress!, { ...sample, aircraft: this.expected(sample) });
      const state = this.status.progress.state;
      if (state === 'uncertain') return this.change('unknown', this.status.progress.reason);
      if (state === 'takeover') return this.change('takeover', this.status.progress.reason);
      if (state === 'landed') return this.change('landed', this.status.progress.reason);
      return this.snapshot();
    }
    if (this.status.state === 'landing') {
      const sample = this.adapter.sample();
      const aircraft = this.expected(sample);
      if (!aircraft) return this.change('unknown', 'SITL link or aircraft identity changed while landing.');
      if (sample.now - this.landSentAt! > LAND_TIMEOUT_MS)
        return this.change('unknown', 'LAND did not complete within the bounded observation window.');
      if (!fresh(aircraft.heartbeat.receivedAt, sample.now, this.landSentAt!, HEARTBEAT_AGE_MS))
        return this.change('unknown', 'Heartbeat is stale during LAND.');
      if (!aircraft.heartbeat.armed && aircraft.heartbeat.mode === 'Land' &&
          aircraft.extendedState?.landedState === 1 &&
          fresh(aircraft.extendedState.receivedAt, sample.now, this.landSentAt!, TELEMETRY_AGE_MS) &&
          aircraft.position && fresh(aircraft.position.receivedAt, sample.now, this.landSentAt!, TELEMETRY_AGE_MS) &&
          Math.abs(aircraft.position.relativeAltitudeM) <= 0.75)
        return this.change('landed', 'SITL LAND mode, disarm, on-ground state and near-ground position confirmed.');
    }
    return this.snapshot();
  }

  /** Normal in-air stop is LAND mode, never MAVLink DISARM. Pilot takeover remains external. */
  async land(): Promise<SimulatorLaunchStatus> {
    if (this.status.state !== 'active' || this.landBusy)
      throw new Error('LAND request requires an active AUTO run; pilot takeover is managed outside this transaction.');
    const sample = this.adapter.sample();
    const aircraft = this.expected(sample);
    if (!aircraft || !aircraft.heartbeat.armed || aircraft.heartbeat.mode !== 'Auto')
      return this.change('unknown', 'AUTO aircraft is not fresh and armed; no LAND command sent.');
    this.landBusy = true;
    try {
      const sent = await this.send(this.command(176, [1, 9, 0, 0, 0, 0, 0]));
      if (!sent) return this.snapshot();
      if (!await this.waitForCommand(176, sent, (item, now) =>
        item.heartbeat.mode === 'Land' &&
        fresh(item.heartbeat.receivedAt, now, sent.sentAt, HEARTBEAT_AGE_MS) &&
        item.heartbeat.receivedAt > sent.baselineHeartbeatAt)) return this.snapshot();
      this.landSentAt = sent.sentAt;
      return this.change('landing', 'LAND mode acknowledged; observing landing without disarm command.');
    } finally {
      this.landBusy = false;
    }
  }
}
