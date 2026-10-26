/**
 * Exercise Lucidity's guarded transaction against ArduCopter SITL ONLY.
 * The adapter is hardcoded to 127.0.0.1:5760 and has no serial-port target.
 * This script can arm and fly a simulated quad; never use as physical evidence.
 */
import { EventEmitter } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MavLinkProtocolV2, common } from 'node-mavlink';
import { AircraftService, type AircraftSerialPort } from '../src/aircraft/service';
import { AircraftDecoder } from '../src/aircraft/decoder';
import { GROUND_COMPONENT_ID, GROUND_SYSTEM_ID } from '../src/aircraft/read-requests';
import { SimulatorLaunchTransaction, type SimulatorCommand, type SimulatorLaunchAdapter, type SimulatorLaunchGate } from '../src/aircraft/simulator-launch-transaction';
import { createFirstLiveHoverStoryboard } from '../src/core/first-live-show';

if (process.argv.some(arg => arg === '--help' || arg === '-h')) {
  process.stdout.write('Hardcoded localhost SITL only. Requires --execute-sitl-only and --case=normal|land|takeover|missing-start-ack|link-loss|repeat. Uploads the 2m/5s mission and flies only in ArduCopter simulation.\n');
  process.exit(0);
}
const scenario = process.argv.find(arg => arg.startsWith('--case='))?.slice('--case='.length);
if (process.argv.length !== 4 || process.argv[2] !== '--execute-sitl-only' ||
    !['normal', 'land', 'takeover', 'missing-start-ack', 'link-loss', 'repeat'].includes(scenario ?? ''))
  throw new Error('Explicit --execute-sitl-only and one supported --case are required.');
const fakeUsbPath = '/dev/cu.usbmodemSITLONLY';

class SitlTcpPort extends EventEmitter {
  isOpen = false;
  private socket: Socket | null = null;

  open(callback: (error: Error | null) => void) {
    const socket = createConnection({ host: '127.0.0.1', port: 5760 });
    this.socket = socket;
    let settled = false;
    socket.on('data', data => this.emit('data', data));
    socket.on('close', () => { this.isOpen = false; this.emit('close'); });
    socket.on('error', error => {
      if (!settled) { settled = true; callback(error); }
      this.emit('error', error);
    });
    socket.once('connect', () => {
      if (!settled) { settled = true; this.isOpen = true; callback(null); }
    });
  }

  write(buffer: Buffer, callback: (error: Error | null) => void) {
    if (!this.socket || !this.isOpen) { callback(new Error('SITL TCP socket is closed.')); return false; }
    return this.socket.write(buffer, error => callback(error ?? null));
  }

  close(callback: (error: Error | null) => void) {
    if (!this.socket || !this.isOpen) { callback(null); return; }
    this.socket.once('close', () => callback(null));
    this.socket.end();
  }

  /** Fault injection for a loopback telemetry outage; never opens another endpoint. */
  dropLink() { this.socket?.destroy(); }
}

const backupDirectory = await mkdtemp(join(tmpdir(), 'lucidity-sitl-guarded-mission-'));
let sitlPort: SitlTcpPort | undefined;
let decoder: AircraftDecoder | undefined;
const service = new AircraftService({
  listPorts: async () => [{ path: fakeUsbPath }],
  createPort: () => (sitlPort = new SitlTcpPort()) as unknown as AircraftSerialPort,
  createDecoder: linkId => (decoder = new AircraftDecoder(linkId)),
  missionBackupDirectory: backupDirectory,
});
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const wire = new MavLinkProtocolV2(GROUND_SYSTEM_ID, GROUND_COMPONENT_ID);
let sequence = 0;
async function sendMavlink(message: common.CommandLong | common.SetMode) {
  if (!sitlPort?.isOpen) throw new Error('SITL TCP closed.');
  const buffer = wire.serialize(message, sequence++ % 256);
  await new Promise<void>((resolve, reject) => sitlPort!.write(buffer, error => error ? reject(error) : resolve()));
}
function commandLong(command: number, params: readonly number[]) {
  const message = new common.CommandLong();
  message.targetSystem = 1; message.targetComponent = 1;
  message.command = command; message.confirmation = 0;
  [message._param1, message._param2, message._param3, message._param4,
   message._param5, message._param6, message._param7] = params;
  return message;
}
function aircraft() { return service.snapshot().aircraft.find(item => item.systemId === 1 && item.componentId === 1); }
async function until(label: string, predicate: () => boolean, timeoutMs: number) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (predicate()) return;
    await sleep(100);
  }
  const current = aircraft();
  throw new Error(`${label} timed out; ${JSON.stringify({ mode: current?.heartbeat.mode,
    armed: current?.heartbeat.armed, altitudeM: current?.position?.relativeAltitudeM,
    gpsFix: current?.gps?.fixType, ekfFlags: current?.ekfStatus?.flags,
    ekfAgeMs: current?.ekfStatus ? Date.now() - current.ekfStatus.receivedAt : null })}`);
}

const commandTrace: number[] = [];
const observedStates: string[] = [];
const firstTelemetry: Array<{ at: number; currentAt: number; seq: number; heartbeatAt: number;
  mode: string; armed: boolean; landedState: number | undefined; altitudeM: number | undefined;
  reachedSeq: number | undefined; observer: string }> = [];
let lastFirstCurrentAt = 0;
let observerTimer: ReturnType<typeof setInterval> | undefined;
let dropStartAck = scenario === 'missing-start-ack';
const adapter: SimulatorLaunchAdapter = {
  kind: 'injected-sitl', transport: 'loopback-tcp', endpoint: '127.0.0.1:5760',
  groundSystemId: GROUND_SYSTEM_ID, groundComponentId: GROUND_COMPONENT_ID,
  sample: () => {
    const snapshot = service.snapshot();
    return { now: snapshot.now, linkGeneration: 1, linkState: snapshot.link.state, aircraft: snapshot.aircraft };
  },
  commandAckCursor: () => decoder!.commandAckCursor(),
  commandAcks: (afterId, aircraftId) => decoder!.commandAcks(afterId, aircraftId).filter(event =>
    !(dropStartAck && event.command === 300)),
  sendCommand: async (command: SimulatorCommand) => {
    if (command.targetSystem !== 1 || command.targetComponent !== 1) throw new Error('Unexpected SITL target.');
    commandTrace.push(command.command);
    await sendMavlink(commandLong(command.command, command.params));
  },
  waitForUpdate: ms => sleep(Math.max(1, Math.min(ms, 100))),
};

try {
  await service.connect(fakeUsbPath);
  let initialAircraft = service.snapshot().aircraft.find(item => item.systemId === 1 && item.componentId === 1);
  for (let attempt = 0; attempt < 100 && !initialAircraft; attempt++) {
    await sleep(100);
    initialAircraft = service.snapshot().aircraft.find(item => item.systemId === 1 && item.componentId === 1);
  }
  if (!initialAircraft || initialAircraft.heartbeat.armed || initialAircraft.heartbeat.autopilot !== 3 || initialAircraft.heartbeat.vehicleType !== 2)
    throw new Error('Expected one disarmed ArduCopter SITL heartbeat.');
  await service.requestTelemetry(initialAircraft.id);
  // requestTelemetry asks for landed, mission-current and EKF streams;
  // check their actual source-bound arrival rather than assuming the writes worked.
  await until('SITL landed-state telemetry', () => aircraft()?.extendedState?.landedState === 1, 10000);
  await until('SITL 3D GPS', () => (aircraft()?.gps?.fixType ?? 0) >= 3, 10000);
  // Freshly wiped Copter SITL can briefly reject normal ARM while its virtual
  // sensors settle. Warm up *before* the bounded EKF readiness check; this
  // neither changes the EKF gate nor retries an ARM or START command.
  await sleep(30000);
  await until('SITL absolute-position EKF readiness', () => {
    const report = aircraft()?.ekfStatus;
    return !!report && Date.now() - report.receivedAt < 3000 &&
      (report.flags & (4 | 16 | 32)) === (4 | 16 | 32) &&
      (report.flags & (128 | 1024 | 32768)) === 0;
  }, 15000);
  const current = aircraft()!;
  process.stdout.write(JSON.stringify({ phase: 'telemetry', gpsFix: current.gps?.fixType,
    hdop: current.gps?.hdop, firmware: current.version?.flightVersion,
    batteryVoltageV: current.battery?.voltageV,
    ekfFlags: current.ekfStatus?.flags,
    receiverChannels: current.receiver?.channels.slice(0, 6),
    landedState: current.extendedState?.landedState }) + '\n');

  const project = createFirstLiveHoverStoryboard('sitl-service-evaluation');
  const prepared = service.prepareMission(initialAircraft.id, project);
  if (!prepared.eligible) throw new Error(`Plan ineligible: ${prepared.reason}`);
  process.stdout.write(JSON.stringify({ phase: 'prepared', commands: prepared.plan.items.map(item => item.command),
    heightM: prepared.plan.heightM, holdSeconds: prepared.plan.holdSeconds }) + '\n');
  const before = await service.readMission(initialAircraft.id);
  process.stdout.write(JSON.stringify({ phase: 'initial-readback', count: before.count, commands: before.items.map(item => item.command) }) + '\n');
  if (before.count > 1) throw new Error('SITL mission is not empty or home-only; restart SITL with --wipe.');
  const status = await service.uploadMission(initialAircraft.id, prepared.plan.planId, project,
    { propsRemoved: true, confirmed: true });
  if (status.state !== 'verified') throw new Error('SITL mission upload was not verified.');
  const verifiedGate = async (): Promise<SimulatorLaunchGate> => {
    // A replay must earn a new storage proof and fresh sensor/firmware samples;
    // the first launch's proof is never carried into a second transaction.
    const verification = await service.verifyMissionForLaunch(initialAircraft.id, prepared.plan.planId, project);
    const oldVersionAt = aircraft()?.version?.receivedAt ?? 0;
    await sendMavlink(commandLong(512, [148, 0, 0, 0, 0, 0, 0]));
    await until('fresh SITL firmware identity', () => (aircraft()?.version?.receivedAt ?? 0) > oldVersionAt, 3000);
    const preflightAt = Date.now();
    const fresh = (at: number | undefined) => at !== undefined && preflightAt - at < 3000;
    const preflight = aircraft()!;
    if (!preflight.version?.flightVersion.startsWith('4.7.1') ||
        !fresh(preflight.version.receivedAt) || !fresh(preflight.gps?.receivedAt) ||
        !fresh(preflight.position?.receivedAt) || !fresh(preflight.battery?.receivedAt) ||
        !fresh(preflight.receiver?.receivedAt) || !fresh(preflight.extendedState?.receivedAt) ||
        !fresh(preflight.ekfStatus?.receivedAt) ||
        (preflight.ekfStatus!.flags & (4 | 16 | 32)) !== (4 | 16 | 32) ||
        (preflight.ekfStatus!.flags & (128 | 1024 | 32768)) !== 0 ||
        preflight.extendedState?.landedState !== 1)
      throw new Error(`Fresh simulator preflight fields were not observed: ${JSON.stringify({
        version: preflight.version?.flightVersion, versionAgeMs: preflightAt - (preflight.version?.receivedAt ?? 0),
        gpsAgeMs: preflightAt - (preflight.gps?.receivedAt ?? 0),
        positionAgeMs: preflightAt - (preflight.position?.receivedAt ?? 0),
        batteryAgeMs: preflightAt - (preflight.battery?.receivedAt ?? 0),
        receiverAgeMs: preflightAt - (preflight.receiver?.receivedAt ?? 0),
        ekfAgeMs: preflightAt - (preflight.ekfStatus?.receivedAt ?? 0), ekfFlags: preflight.ekfStatus?.flags,
        extendedAgeMs: preflightAt - (preflight.extendedState?.receivedAt ?? 0),
      })}`);
    return {
      proof: verification,
      review: { planId: verification.planId, storyboardId: verification.storyboardId, revision: verification.revision },
      preflight: {
        kind: 'sitl-fixture', verificationId: verification.verificationId,
        aircraftId: verification.aircraftId, linkGeneration: verification.connectionGeneration,
        observedAt: preflightAt, expiresAt: preflightAt + 15000,
        gpsHomeEkfHealthy: true, batteryHealthy: true,
        receiverAndFailsafesChecked: true, pilotTakeoverRouteChecked: true,
      },
    };
  };
  const firstGate = await verifiedGate();
  const transaction = new SimulatorLaunchTransaction(adapter);
  const launch = await transaction.launch(firstGate);
  process.stdout.write(JSON.stringify({ phase: 'launch', case: scenario, state: launch.state,
    reason: launch.reason, commands: launch.issuedCommands, mode: aircraft()?.heartbeat.mode,
    armed: aircraft()?.heartbeat.armed,
    missionCurrent: aircraft()?.missionCurrent,
    recentMessages: aircraft()?.messages.slice(-10),
    matchingAcks: decoder?.commandAcks(0, initialAircraft.id).filter(item => [224, 400, 300].includes(item.command)).slice(-4),
  }) + '\n');
  if (scenario === 'missing-start-ack') {
    if (launch.state !== 'unknown' || commandTrace.join(',') !== '224,400,300')
      throw new Error('Missing START ACK must make one attempt unknown without retry.');
    await until('mission side-effect despite lost ACK', () => aircraft()?.heartbeat.mode === 'Auto', 8000);
    dropStartAck = false;
    // An unknown command result is not a stop. Use a separate simulator-only
    // LAND fallback and observe the actual aircraft to completion.
    await sendMavlink(commandLong(176, [1, 9, 0, 0, 0, 0, 0]));
    await until('LAND mode after unknown START', () => aircraft()?.heartbeat.mode === 'Land', 8000);
    await until('disarm after unknown START', () => !aircraft()?.heartbeat.armed, 60000);
    process.stdout.write(JSON.stringify({ phase: 'missing-ack-reconciled', mode: aircraft()?.heartbeat.mode,
      armed: aircraft()?.heartbeat.armed, commands: commandTrace }) + '\n');
  } else {
    if (launch.state !== 'active' || commandTrace.join(',') !== '224,400,300')
      throw new Error(`Expected active simulator mission after ordered commands, got ${launch.state}.`);
    // The reducer needs in-flight samples; a single post-disarm snapshot
    // cannot establish that this mission progressed or became airborne.
    observerTimer = setInterval(() => {
      const state = transaction.observe().state;
      if (observedStates.at(-1) !== state) observedStates.push(state);
      if (scenario === 'repeat') {
        const item = aircraft();
        if (item?.missionCurrent && item.missionCurrent.receivedAt > lastFirstCurrentAt) {
          lastFirstCurrentAt = item.missionCurrent.receivedAt;
          firstTelemetry.push({ at: Date.now(), currentAt: lastFirstCurrentAt,
            seq: item.missionCurrent.seq, heartbeatAt: item.heartbeat.receivedAt,
            mode: item.heartbeat.mode, armed: item.heartbeat.armed,
            landedState: item.extendedState?.landedState,
            altitudeM: item.position?.relativeAltitudeM,
            reachedSeq: item.missionItemReached?.seq, observer: state });
        }
      }
    }, 200);
    if (scenario === 'link-loss') {
      await until('climb for link-loss case', () => (aircraft()?.position?.relativeAltitudeM ?? 0) > 0.7, 30000);
      const lostAt = Date.now();
      const altitudeAtLossM = aircraft()?.position?.relativeAltitudeM;
      sitlPort!.dropLink();
      await until('loopback telemetry outage', () => service.snapshot().link.state === 'disconnected', 3000);
      const lost = transaction.observe();
      if (observerTimer) clearInterval(observerTimer);
      observerTimer = undefined;
      if (lost.state !== 'unknown' || lost.progress?.state !== 'uncertain' ||
          commandTrace.join(',') !== '224,400,300')
        throw new Error('Lost telemetry must make the active run unknown without a command retry.');
      process.stdout.write(JSON.stringify({ phase: 'link-loss', state: lost.state,
        progressState: lost.progress.state, reason: lost.reason, altitudeAtLossM,
        linkState: service.snapshot().link.state, commands: commandTrace }) + '\n');

      // Let the simulated aircraft continue without telemetry, then create a
      // new receive-only connection. The original transaction stays terminal.
      await sleep(2500);
      await service.connect(fakeUsbPath);
      await until('reconnected SITL heartbeat', () => (aircraft()?.heartbeat.receivedAt ?? 0) > lostAt, 10000);
      const reconnectedId = aircraft()!.id;
      // AircraftService intentionally refuses telemetry-rate writes while
      // armed. Inspect the naturally streamed heartbeat first; do not evade
      // that product gate during this simulator-only recovery.
      const actual = aircraft()!;
      const afterReconnect = transaction.observe();
      if (afterReconnect.state !== 'unknown' || commandTrace.join(',') !== '224,400,300')
        throw new Error('Reconnection must not silently resume the old launch transaction.');
      process.stdout.write(JSON.stringify({ phase: 'link-reconnected',
        transactionState: afterReconnect.state, mode: actual.heartbeat.mode,
        armed: actual.heartbeat.armed, altitudeM: actual.position?.relativeAltitudeM,
        missionCurrent: actual.missionCurrent, landedState: actual.extendedState?.landedState,
        newAircraftId: reconnectedId !== initialAircraft.id, commands: commandTrace }) + '\n');
      if (actual.heartbeat.armed) {
        await sendMavlink(commandLong(176, [1, 9, 0, 0, 0, 0, 0]));
        await until('LAND mode after link recovery', () => aircraft()?.heartbeat.mode === 'Land', 8000);
        await until('disarm after link recovery', () => !aircraft()?.heartbeat.armed, 60000);
      }
      await service.requestTelemetry(reconnectedId);
      await until('on-ground after link recovery', () => aircraft()?.extendedState?.landedState === 1 &&
        Math.abs(aircraft()?.position?.relativeAltitudeM ?? Infinity) <= 0.75, 10000);
      process.stdout.write(JSON.stringify({ phase: 'link-loss-reconciled',
        transactionState: transaction.observe().state, mode: aircraft()?.heartbeat.mode,
        armed: aircraft()?.heartbeat.armed, altitudeM: aircraft()?.position?.relativeAltitudeM,
        landedState: aircraft()?.extendedState?.landedState, commands: commandTrace }) + '\n');
    } else {
    if (scenario === 'land') {
      await until('climb for LAND case', () => (aircraft()?.position?.relativeAltitudeM ?? 0) > 0.7, 30000);
      const landed = await transaction.land();
      process.stdout.write(JSON.stringify({ phase: 'land-request', state: landed.state,
        commands: landed.issuedCommands, mode: aircraft()?.heartbeat.mode }) + '\n');
      if (landed.state !== 'landing' || commandTrace.join(',') !== '224,400,300,176')
        throw new Error('Transaction did not issue one normal LAND command.');
    } else if (scenario === 'takeover') {
      await until('climb for takeover case', () => (aircraft()?.position?.relativeAltitudeM ?? 0) > 0.7, 30000);
      const mode = new common.SetMode();
      mode.targetSystem = 1; mode.baseMode = 1 as typeof mode.baseMode; mode.customMode = 5; // LOITER in SITL.
      await sendMavlink(mode);
      await until('simulated LOITER mode', () => aircraft()?.heartbeat.mode === 'Loiter', 8000);
      const takeover = transaction.observe();
      process.stdout.write(JSON.stringify({ phase: 'takeover', state: takeover.state,
        mode: aircraft()?.heartbeat.mode, altitudeM: aircraft()?.position?.relativeAltitudeM }) + '\n');
      if (takeover.state !== 'takeover') throw new Error('Pilot-mode takeover was not recognized.');
      await sendMavlink(commandLong(176, [1, 9, 0, 0, 0, 0, 0]));
      await until('LAND mode after takeover', () => aircraft()?.heartbeat.mode === 'Land', 8000);
    }
    await until('simulated mission landing', () => !aircraft()?.heartbeat.armed, 90000);
    const final = transaction.observe();
    if (observedStates.at(-1) !== final.state) observedStates.push(final.state);
    process.stdout.write(JSON.stringify({ phase: 'final', case: scenario, state: final.state,
      reason: final.reason, mode: aircraft()?.heartbeat.mode, armed: aircraft()?.heartbeat.armed,
      altitudeM: aircraft()?.position?.relativeAltitudeM,
      landedState: aircraft()?.extendedState?.landedState,
      commands: commandTrace, observedStates,
      ...(scenario === 'repeat' ? { firstTelemetry } : {}) }) + '\n');
    if (scenario === 'normal' || scenario === 'land' || scenario === 'repeat') {
      if (final.state !== 'landed') throw new Error(`Expected verified landing; got ${final.state}.`);
    } else if (final.state === 'landed') throw new Error('Pilot takeover must not be reported as autonomous completion.');
    if (scenario === 'repeat') {
      if (observerTimer) clearInterval(observerTimer);
      observerTimer = undefined;
      const mode = new common.SetMode();
      mode.targetSystem = 1; mode.baseMode = 1 as typeof mode.baseMode; mode.customMode = 0; // STABILIZE in SITL.
      await sendMavlink(mode);
      await until('disarmed Stabilize before replay', () =>
        aircraft()?.heartbeat.mode === 'Stabilize' && !aircraft()?.heartbeat.armed, 8000);
      const secondGate = await verifiedGate();
      if (secondGate.proof.verificationId === firstGate.proof.verificationId ||
          secondGate.proof.verifiedAt <= firstGate.proof.verifiedAt)
        throw new Error('Replay requires a newly timed storage readback and verification ID.');
      const beforeResetCurrentAt = aircraft()?.missionCurrent?.receivedAt ?? 0;
      const commandOffset = commandTrace.length;
      const replay = new SimulatorLaunchTransaction(adapter);
      const secondLaunch = await replay.launch(secondGate);
      const replayCommands = commandTrace.slice(commandOffset);
      if (secondLaunch.state !== 'active' || replayCommands.join(',') !== '224,400,300' ||
          (aircraft()?.missionCurrent?.receivedAt ?? 0) <= beforeResetCurrentAt ||
          !secondLaunch.progress || !launch.progress ||
          secondLaunch.progress.startedAt <= launch.progress.startedAt)
        throw new Error('Replay did not establish fresh reset/ARM/START progress.');
      process.stdout.write(JSON.stringify({ phase: 'replay-launch', state: secondLaunch.state,
        firstProofId: firstGate.proof.verificationId, secondProofId: secondGate.proof.verificationId,
        firstStartedAt: launch.progress.startedAt, secondStartedAt: secondLaunch.progress.startedAt,
        beforeResetCurrentAt, afterResetCurrentAt: aircraft()?.missionCurrent?.receivedAt,
        mode: aircraft()?.heartbeat.mode, missionCurrent: aircraft()?.missionCurrent,
        replayCommands }) + '\n');
      const replayStates: string[] = [];
      const replayTelemetry: Array<{ at: number; currentAt: number; seq: number; mode: string;
        armed: boolean; landedState: number | undefined; altitudeM: number | undefined; observer: string }> = [];
      let lastCurrentAt = 0;
      observerTimer = setInterval(() => {
        const state = replay.observe().state;
        if (replayStates.at(-1) !== state) replayStates.push(state);
        const item = aircraft();
        if (item?.missionCurrent && item.missionCurrent.receivedAt > lastCurrentAt) {
          lastCurrentAt = item.missionCurrent.receivedAt;
          replayTelemetry.push({ at: Date.now(), currentAt: lastCurrentAt,
            seq: item.missionCurrent.seq, mode: item.heartbeat.mode,
            armed: item.heartbeat.armed, landedState: item.extendedState?.landedState,
            altitudeM: item.position?.relativeAltitudeM, observer: state });
        }
      }, 200);
      await until('replayed simulated mission landing', () => !aircraft()?.heartbeat.armed, 90000);
      const replayFinal = replay.observe();
      if (replayStates.at(-1) !== replayFinal.state) replayStates.push(replayFinal.state);
      process.stdout.write(JSON.stringify({ phase: 'replay-final', state: replayFinal.state,
        reason: replayFinal.reason, mode: aircraft()?.heartbeat.mode,
        armed: aircraft()?.heartbeat.armed, altitudeM: aircraft()?.position?.relativeAltitudeM,
        landedState: aircraft()?.extendedState?.landedState,
        replayCommands, replayStates, replayTelemetry }) + '\n');
      if (replayFinal.state !== 'landed') throw new Error('Replayed mission did not finish as landed.');
    }
    }
  }
} finally {
  if (observerTimer) clearInterval(observerTimer);
  // Simulator-only cleanup: a denied START can leave motors armed on the
  // ground. Never infer that an unknown command stopped the aircraft.
  if (aircraft()?.heartbeat.armed && sitlPort?.isOpen) {
    const item = aircraft();
    const confirmedOnGround = item?.extendedState?.landedState === 1 &&
      item.position && Date.now() - item.position.receivedAt < 3000 &&
      Math.abs(item.position.relativeAltitudeM) <= 0.3;
    if (confirmedOnGround) {
      await sendMavlink(commandLong(400, [0, 0, 0, 0, 0, 0, 0])).catch(() => {});
    } else {
      await sendMavlink(commandLong(176, [1, 9, 0, 0, 0, 0, 0])).catch(() => {});
    }
    await until('SITL cleanup disarm', () => !aircraft()?.heartbeat.armed, 10000).catch(() => {});
  }
  await service.dispose();
}
