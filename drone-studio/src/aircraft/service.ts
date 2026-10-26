import { EscTransport, EscAckError, escSettingsAddress, decodeEscSettings } from './esc-protocol';
import type { EscInspection } from './esc-types';
import type { EscStartupPlan, EscStartupStatus } from './esc-startup-types';
import { BLUEJAY, digest, loadBluejayImage, startupImage, readEscImage, installEscImage } from './esc-startup';
import { encodeBluejayMelody } from '../platform/bluejay-melody';
import { hasInstalledMelody } from './esc-melody-capability';
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tuneFrame } from './tune';
import { validateTune, tuneSeconds, type Tune } from '../platform/music-model';
import { compileStoryboardBenchPlan } from '../core/bench-storyboard';
import { compileHoverMission, MissionPlanError, type HoverMissionDraft } from './mission-plan';
import { MissionProtocol, MissionProtocolError, compareMissionReadback, type MissionIo, type MissionItem, type MissionOutbound } from './mission-protocol';
import { missionFrame } from './mission-wire';
import { flightCommandFrame, type FlightCommand } from './flight-command-wire';
import {
  PhysicalLaunchTransaction,
  type PhysicalLaunchAdapter,
  type PhysicalLaunchStatus,
  type PhysicalPreflightEvidence,
} from './physical-launch-transaction';
import { randomUUID } from 'node:crypto';
import { SerialPort } from 'serialport';
import { MavLinkProtocolV2, minimal } from 'node-mavlink';
import { AircraftDecoder } from './decoder';
import { LogProtocol, logFrame, type LogEntry, type LogOutbound } from './log-protocol';
import { analyzeDataFlash } from './dataflash-analysis';
import { diagnosticFrames, telemetryRequestFrames, radioRequestFrame, GROUND_SYSTEM_ID, GROUND_COMPONENT_ID } from './read-requests';
import { MotorTestController, type MotorTestChecks } from './motor-test';
import { BenchShowController } from './bench-show';
import { ZorroStopController, type ZorroStopChecks } from './zorro-stop';
import type { Project } from '../core/model';
import { parameterFrame, parameterName, summarizeParameters, validateParameterValue } from './parameters';
import { levelAttitudeRequestFrame, levelCalibrationFrame, type LevelCalibrationReading, type LevelCalibrationResult } from './level-calibration';
import {
  HEARTBEAT_STALE_MS,
  TELEMETRY_STALE_MS,
  type AircraftPort,
  type AircraftSnapshot,
} from './types';

export const AIRCRAFT_BAUD_RATE = 115200;
const OPEN_TIMEOUT_MS = 10_000;
const CLOSE_TIMEOUT_MS = 5000;
const MISSION_VERIFICATION_TTL_MS = 15_000;
const USB_PATH = /^\/dev\/cu\.usb(?:modem|serial)[A-Za-z0-9._-]{0,180}$/;

/** Writes are restricted to fixed telemetry requests and bounded bench motor tests. */
export type AircraftSerialPort = Pick<
  SerialPort,
  'isOpen' | 'open' | 'close' | 'on' | 'removeListener' | 'write'
>;
export type AircraftPortOptions = {
  path: string;
  baudRate: 115200;
  autoOpen: false;
  lock: true;
  hupcl: false;
  highWaterMark: number;
};
type Decoder = Pick<AircraftDecoder, 'push' | 'snapshot'> &
  Partial<Pick<AircraftDecoder,
    'parameterSnapshot' | 'resetParameters' | 'missionCursor' | 'missionPackets' |
    'commandAckCursor' | 'commandAcks' | 'logCursor' | 'logPackets'
  >>;
export type AircraftServiceDependencies = {
  listPorts?: () => Promise<AircraftPort[]>;
  createPort?: (options: AircraftPortOptions) => AircraftSerialPort;
  createDecoder?: (linkId: string) => Decoder;
  now?: () => number;
  levelCalibrationWait?: (ms: number) => Promise<void>;
  escBackupDirectory?: string;
  missionBackupDirectory?: string;
  flightJournalPath?: string;
};
export class AircraftServiceError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = 'AircraftServiceError';
  }
}
type Connection = {
  port: AircraftSerialPort;
  generation: number;
  pendingOpen: boolean;
  released: boolean;
  cancelOpen: (error: Error) => void;
  removeListeners: () => void;
  closePromise?: Promise<void>;
  finishClose?: (error?: Error) => void;
};
type PendingEscStartup = { plan: EscStartupPlan; generation: number; originals: Buffer[]; images: Buffer[] };
type ReviewedMission = { planId: string; aircraftId: string; generation: number; draft: HoverMissionDraft };
type FlightRunJournal = {
  aircraftId: string;
  runId: string;
  startedAt: number;
  systemId: number;
  componentId: number;
  uid: string | null;
  state: 'outcome-unknown-until-landed';
};
type FlightLogStatus = {
  state: 'idle' | 'listing' | 'downloading' | 'complete' | 'error';
  entries: LogEntry[];
  progress: { received: number; total: number } | null;
  error: string | null;
  artifact: { name: string; downloadUrl: string; analysis: ReturnType<typeof analyzeDataFlash> | null; analysisError?: string } | null;
};
export type MissionPrelaunchVerification = {
  verificationId: string;
  planId: string;
  aircraftId: string;
  storyboardId: string;
  revision: number;
  connectionGeneration: number;
  verifiedAt: number;
  expiresAt: number;
  missionCount: 4;
  heightM: number;
  holdSeconds: number;
  message: string;
};
// For this one-drone vertical rehearsal, a disarmed mission HOME farther
// than 10 m from fresh aircraft position is too ambiguous to treat as the
// launch field. This is a conservative proximity gate, not GPS accuracy,
// terrain clearance, EKF health, or proof that Copter will retain this HOME.
const MISSION_HOME_MAX_SEPARATION_M = 10;
const MEAN_EARTH_RADIUS_M = 6_371_008.8;
const ignoredLateError = () => {};
const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message.slice(0, 240) : fallback;

/** One explicit USB link, independent of creative projects and agent runs. */
export class AircraftService {
  private readonly listPorts;
  private readonly createPort;
  private readonly createDecoder;
  private readonly now;
  private readonly levelCalibrationWait;
  private readonly motorTests: MotorTestController;
  private readonly benchShows: BenchShowController;
  private readonly zorroStops: ZorroStopController;
  private generation = 0;
  private disposed = false;
  private connection?: Connection;
  private decoder?: Decoder;
  private request?: AircraftSnapshot['request'];
  private activeRequest?: { controller: AbortController; generation: number };
  private sequence = 0;
  private parameterReads = new Map<string, number>();
  private parameterBusy = false;
  private radioBusy = false;
  private tuneAvailableAt = 0;
  private escBusy = false;
  private escRecoveryRequired = false;
  private escTransport?: EscTransport;
  private escInspection?: EscInspection;
  private escStartup?: EscStartupStatus;
  private startupPlan?: PendingEscStartup;
  private escBackupDirectory = resolve('artifacts', 'esc-backups');
  private missionBackupDirectory = resolve('artifacts', 'mission-backups');
  private missionBusy = false;
  private logBusy = false;
  private logAbort?: AbortController;
  private logStatusData: FlightLogStatus = { state: 'idle', entries: [], progress: null, error: null, artifact: null };
  private logArtifact?: { name: string; bytes: Buffer };
  private missionRecoveryRequired = false;
  private missionAbort?: AbortController;
  private preparedMission?: ReviewedMission;
  private reviewedMission?: ReviewedMission;
  private prelaunchVerification?: MissionPrelaunchVerification;
  private missionStatus?: AircraftSnapshot['mission'];
  private flightRun?: PhysicalLaunchTransaction;
  private flightStarting = false;
  private flightPreflight?: { verificationId: string; aircraftId: string; generation: number; observedAt: number; expiresAt: number };
  private readonly flightJournalPath: string;
  private flightRecoveryRequired = false;
  private flightObservationTimer?: NodeJS.Timeout;

  private flightLocked() {
    // The on-disk journal is the durable lock. A landed observation may arrive
    // before the cleanup timer runs, so an in-memory status alone is too early
    // to permit a new launch on the same journal path.
    if (this.flightStarting || this.flightRecoveryRequired || existsSync(this.flightJournalPath)) return true;
    if (!this.flightRun) return false;
    const status = this.flightRun.observe();
    return ['resetting', 'arming', 'starting', 'active', 'takeover', 'landing', 'unknown'].includes(status.state) ||
      (status.state === 'rejected' && status.issuedCommands.length > 0);
  }

  flightRunStatus(): PhysicalLaunchStatus {
    // A journal may be created immediately before adapter construction fails.
    // Its existence must be visible as an uncertain run in this process too,
    // not just after a server restart.
    if (!this.flightRun && (this.flightRecoveryRequired || existsSync(this.flightJournalPath))) return {
      runId: null, aircraftId: null, planId: null, state: 'unknown', issuedCommands: [], progress: null,
      reason: 'A physical run has an unresolved journal, possibly after an interrupted launch or server restart. Confirm disarmed/on-ground status and reconcile explicitly before another launch.',
    };
    return this.flightRun?.observe() ?? {
      runId: null, aircraftId: null, planId: null, state: 'idle',
      reason: 'No physical mission launch has been requested.', issuedCommands: [], progress: null,
    };
  }

  private async journalFlightAttempt(aircraftId: string, runId: string): Promise<void> {
    const aircraft = this.missionTarget(aircraftId);
    const journal: FlightRunJournal = {
      aircraftId, runId, startedAt: this.now(), systemId: aircraft.systemId,
      componentId: aircraft.componentId, uid: aircraft.version?.uid ?? null,
      state: 'outcome-unknown-until-landed',
    };
    await mkdir(dirname(this.flightJournalPath), { recursive: true });
    const file = await open(this.flightJournalPath, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(journal));
      await file.sync();
    } finally { await file.close(); }
  }

  private watchFlightRun() {
    if (this.flightObservationTimer) clearInterval(this.flightObservationTimer);
    this.flightObservationTimer = setInterval(() => {
      const status = this.flightRun?.observe();
      if (!status || !['landed', 'rejected', 'unknown'].includes(status.state)) return;
      if (this.flightObservationTimer) clearInterval(this.flightObservationTimer);
      this.flightObservationTimer = undefined;
      if (status.state === 'landed' || (status.state === 'rejected' && status.issuedCommands.length === 0)) {
        this.flightRecoveryRequired = true;
        void unlink(this.flightJournalPath).then(() => {
          this.flightRecoveryRequired = false;
        }).catch(() => {
          // A leftover journal must block a fresh run after a process restart.
        });
      }
    }, 200);
    this.flightObservationTimer.unref();
  }

  escStatus(aircraftId: string) {
    return this.escInspection?.aircraftId === aircraftId ? structuredClone(this.escInspection) : null;
  }

  private externalBusy = () => false;
  setExternalBusy(check: () => boolean) {
    this.externalBusy = check;
  }
  private link: AircraftSnapshot['link'] = {
    state: 'disconnected',
    path: null,
    baudRate: AIRCRAFT_BAUD_RATE,
    connectedAt: null,
    error: null,
    bytesReceived: 0,
    packetsReceived: 0,
    invalidFrames: 0,
    lastPacketAt: null,
    transmittedBytes: 0,
  };

  constructor(dependencies: AircraftServiceDependencies = {}) {
    this.flightJournalPath = resolve(dependencies.flightJournalPath ?? 'artifacts/flight-run-active.json');
    this.flightRecoveryRequired = existsSync(this.flightJournalPath);
    if (dependencies.escBackupDirectory) this.escBackupDirectory = dependencies.escBackupDirectory;
    if (dependencies.missionBackupDirectory) this.missionBackupDirectory = dependencies.missionBackupDirectory;
    this.listPorts = dependencies.listPorts ?? (() => SerialPort.list());
    this.createPort = dependencies.createPort ?? ((options) => new SerialPort(options));
    this.createDecoder = dependencies.createDecoder ?? ((id) => new AircraftDecoder(id));
    this.now = dependencies.now ?? Date.now;
    this.levelCalibrationWait = dependencies.levelCalibrationWait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.motorTests = new MotorTestController({
      snapshot: () => this.snapshot(),
      write: (frame) => this.writeMotorFrame(frame),
      nextSequence: () => {
        const sequence = this.sequence;
        this.sequence = (sequence + 1) % 256;
        return sequence;
      },
      telemetryBusy: () => Boolean(this.activeRequest) || this.parameterBusy || this.radioBusy || this.missionBusy || this.logBusy || this.escBusy || this.escRecoveryRequired || this.externalBusy(),
    });
    this.benchShows = new BenchShowController({
      snapshot: () => this.snapshot(),
      startMotor: (id, motor, checks) => this.motorTests.start(id, motor, checks),
      stopMotor: (id) => this.motorTests.stop(id),
      motorPending: () => this.motorTests.pending,
      pulseDeadline: () => this.motorTests.pulseDeadline,
      busy: () => Boolean(this.activeRequest) || this.parameterBusy || this.radioBusy || this.missionBusy || this.logBusy || this.escBusy || this.escRecoveryRequired || this.externalBusy(),
    });
    this.zorroStops = new ZorroStopController({
      snapshot: () => this.snapshot(),
      parameters: (id) => this.parameters(id).parameters,
      write: (frame) => this.writeMotorFrame(frame, false, true),
      nextSequence: () => { const sequence = this.sequence; this.sequence = (sequence + 1) % 256; return sequence; },
      busy: () => this.benchShows.active || this.motorTests.pending || Boolean(this.activeRequest) ||
        this.parameterBusy || this.radioBusy || this.missionBusy || this.logBusy || this.escBusy || this.escRecoveryRequired || this.externalBusy(),
    });
  }

  async ports(): Promise<AircraftPort[]> {
    if (this.disposed) throw new AircraftServiceError('Aircraft service is closed.', 503);
    const ports = await this.listPorts();
    if (this.disposed) throw new AircraftServiceError('Aircraft service is closed.', 503);
    const unique = new Map<string, AircraftPort>();
    for (const port of ports) {
      // macOS enumeration may expose the dial-in alias; this client opens its call-out peer.
      const path = port.path.replace(/^\/dev\/tty\.(usb(?:modem|serial))/, '/dev/cu.$1');
      if (!USB_PATH.test(path) || unique.has(path)) continue;
      unique.set(path, {
        path,
        ...(typeof port.manufacturer === 'string'
          ? { manufacturer: port.manufacturer.slice(0, 120) }
          : {}),
        ...(typeof port.serialNumber === 'string'
          ? { serialNumber: port.serialNumber.slice(0, 120) }
          : {}),
      });
    }
    return [...unique.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Read-only onboard DataFlash log operations. Results stay in memory until server restart. */
  logStatus(): FlightLogStatus {
    return structuredClone(this.logStatusData);
  }

  logFile(name: string): Buffer {
    if (!this.logArtifact || name !== this.logArtifact.name ||
        this.logStatusData.artifact?.name !== name)
      throw new AircraftServiceError('This flight log is no longer available. Download it again.', 404);
    return Buffer.from(this.logArtifact.bytes);
  }

  private logTarget(aircraftId: string) {
    const target = this.missionTarget(aircraftId);
    if (target.heartbeat.armed)
      throw new AircraftServiceError('Disarm the aircraft before reading onboard logs.', 409);
    return target;
  }

  private logOperationAvailable(aircraftId: string) {
    if (this.logBusy || this.flightLocked() || this.missionBusy || this.activeRequest ||
        this.parameterBusy || this.radioBusy || this.escBusy || this.escRecoveryRequired ||
        this.benchShows.active || this.zorroStops.active || this.motorTests.pending ||
        this.externalBusy())
      throw new AircraftServiceError('Wait for the current aircraft operation before reading logs.', 409);
    return this.logTarget(aircraftId);
  }

  private logProtocol(aircraftId: string, generation: number): LogProtocol {
    const target = this.logTarget(aircraftId);
    return new LogProtocol({
      cursor: () => this.decoder?.logCursor?.() ?? 0,
      send: async (outbound: LogOutbound) => {
        if (this.generation !== generation)
          throw new AircraftServiceError('Aircraft link changed during log transfer.', 409);
        this.logTarget(aircraftId);
        const frame = logFrame(target.systemId, target.componentId, this.sequence, outbound);
        this.sequence = (this.sequence + 1) % 256;
        await this.writeMotorFrame(frame, false, false, false, false, true);
      },
      receive: async (afterId, timeoutMs, signal) => {
        const deadline = performance.now() + timeoutMs;
        while (performance.now() < deadline) {
          signal.throwIfAborted();
          if (this.generation !== generation)
            throw new AircraftServiceError('Aircraft link changed during log transfer.', 409);
          this.logTarget(aircraftId);
          const packet = this.decoder?.logPackets?.(afterId)[0];
          if (packet) return packet;
          await new Promise<void>(resolve => setTimeout(resolve, 25));
        }
        return null;
      },
    }, { systemId: target.systemId, componentId: target.componentId });
  }

  private async sendLogHeartbeat(generation: number): Promise<void> {
    if (this.generation !== generation || !this.logBusy) return;
    const heartbeat = new minimal.Heartbeat();
    heartbeat.type = 6; // MAV_TYPE_GCS
    heartbeat.autopilot = 8; // MAV_AUTOPILOT_INVALID
    heartbeat.baseMode = 0 as typeof heartbeat.baseMode;
    heartbeat.customMode = 0;
    heartbeat.systemStatus = 4;
    heartbeat.mavlinkVersion = 3;
    const frame = new MavLinkProtocolV2(GROUND_SYSTEM_ID, GROUND_COMPONENT_ID)
      .serialize(heartbeat, this.sequence);
    this.sequence = (this.sequence + 1) % 256;
    await this.writeMotorFrame(frame, false, false, false, false, true);
  }

  private startLogOperation(aircraftId: string, kind: 'listing' | 'downloading', entry?: LogEntry): FlightLogStatus {
    this.logOperationAvailable(aircraftId);
    const generation = this.generation;
    const controller = new AbortController();
    this.logAbort = controller;
    this.logBusy = true;
    this.logStatusData = {
      state: kind, entries: kind === 'listing' ? [] : this.logStatusData.entries,
      progress: entry ? { received: 0, total: entry.size } : null,
      error: null, artifact: kind === 'listing' ? this.logStatusData.artifact : null,
    };
    if (kind === 'downloading') this.logArtifact = undefined;
    const protocol = this.logProtocol(aircraftId, generation);
    const keepalive = setInterval(() => {
      void this.sendLogHeartbeat(generation).catch(() => {});
    }, 1000);
    keepalive.unref();
    void (async () => {
      try {
        await this.sendLogHeartbeat(generation);
        if (kind === 'listing') {
          const entries = await protocol.list(controller.signal);
          this.logStatusData = { ...this.logStatusData, state: 'idle', entries, progress: null };
        } else if (entry) {
          const bytes = await protocol.download(entry, controller.signal, (received, total) => {
            if (this.logAbort === controller)
              this.logStatusData = { ...this.logStatusData, progress: { received, total } };
          });
          controller.signal.throwIfAborted();
          if (this.generation !== generation)
            throw new AircraftServiceError('Aircraft link changed before the log was complete.', 409);
          const name = `arducopter-s${this.logTarget(aircraftId).systemId}-log${entry.id}-${Date.now()}.bin`;
          let analysis: ReturnType<typeof analyzeDataFlash> | null = null;
          let analysisError: string | undefined;
          try { analysis = analyzeDataFlash(bytes); }
          catch (error) { analysisError = message(error, 'This .BIN could not be analyzed.'); }
          this.logArtifact = { name, bytes: Buffer.from(bytes) };
          this.logStatusData = {
            ...this.logStatusData, state: 'complete', progress: { received: bytes.length, total: entry.size },
            artifact: { name, downloadUrl: `/api/aircraft/logs/file?name=${encodeURIComponent(name)}`, analysis, ...(analysisError ? { analysisError } : {}) },
          };
        }
      } catch (error) {
        if (this.logAbort === controller)
          this.logStatusData = {
            ...this.logStatusData, state: 'error', progress: null,
            error: controller.signal.aborted
              ? `${message(controller.signal.reason, 'Log transfer cancelled.')} No partial file was saved.`
              : message(error, 'Onboard log transfer failed.'),
          };
      } finally {
        clearInterval(keepalive);
        if (this.logAbort === controller) {
          this.logAbort = undefined;
          this.logBusy = false;
        }
      }
    })();
    return this.logStatus();
  }

  listLogs(aircraftId: string): FlightLogStatus {
    return this.startLogOperation(aircraftId, 'listing');
  }

  downloadLog(aircraftId: string, logId: number): FlightLogStatus {
    const entry = this.logStatusData.entries.find(item => item.id === logId);
    if (!entry) throw new AircraftServiceError('Select a listed onboard log first.', 404);
    return this.startLogOperation(aircraftId, 'downloading', entry);
  }

  cancelLogTransfer(): FlightLogStatus {
    if (!this.logBusy || !this.logAbort)
      throw new AircraftServiceError('No onboard log transfer is active.', 409);
    this.logAbort.abort(new AircraftServiceError('Log transfer cancelled.', 409));
    this.logStatusData = { ...this.logStatusData, state: 'error', progress: null,
      error: 'Log transfer cancelled. No partial file was saved.' };
    return this.logStatus();
  }

  private abortLogTransfer(reason: string) {
    if (!this.logBusy || !this.logAbort) return;
    this.logAbort.abort(new AircraftServiceError(reason, 409));
    this.logStatusData = { ...this.logStatusData, state: 'error', progress: null, error: reason };
  }

  snapshot(): AircraftSnapshot {
    const decoded = this.decoder?.snapshot();
    return structuredClone({
      now: this.now(),
      link: {
        ...this.link,
        packetsReceived: decoded?.packetsReceived ?? 0,
        invalidFrames: decoded?.invalidFrames ?? 0,
        lastPacketAt: decoded?.lastPacketAt ?? null,
      },
      aircraft: decoded?.aircraft ?? [],
      ...(this.escInspection ? { esc: this.escInspection } : {}),
      ...(this.escStartup ? { escStartup: this.escStartup } : {}),
      ...(this.request ? { request: this.request } : {}),
      ...(this.benchShows?.status ? { benchShow: this.benchShows.status } : {}),
      ...(this.zorroStops?.status ? { zorroStop: this.zorroStops.status } : {}),
      ...(this.motorTests.status ? { motorTest: this.motorTests.status } : {}),
      ...(this.missionStatus ? { mission: this.missionStatus } : {}),
      flightRun: this.flightRunStatus(),
    });
  }

  async connect(path: string, baudRate: number = AIRCRAFT_BAUD_RATE): Promise<AircraftSnapshot> {
    if (this.escBusy) throw new AircraftServiceError('Wait for the ESC read to finish.', 409);
    if (this.externalBusy())
      throw new AircraftServiceError(
        'Wait for the local terminal or flashing process to finish before connecting.',
        409
      );
    if (this.disposed) throw new AircraftServiceError('Aircraft service is closed.', 503);
    if (typeof path !== 'string' || !USB_PATH.test(path) || baudRate !== AIRCRAFT_BAUD_RATE)
      throw new AircraftServiceError('Choose a listed USB serial port at 115200 baud.');
    if (this.connection || this.link.state === 'connecting')
      throw new AircraftServiceError(
        'An aircraft link is already open or closing. Disconnect it first.',
        409
      );
    const generation = ++this.generation;
    this.preparedMission = undefined;
    this.reviewedMission = undefined;
    this.prelaunchVerification = undefined;
    this.request = undefined;
    this.logAbort = undefined;
    this.logBusy = false;
    this.logStatusData = { state: 'idle', entries: [], progress: null, error: null, artifact: null };
    this.logArtifact = undefined;
    this.parameterReads.clear();
    this.decoder = this.createDecoder(randomUUID());
    this.link = {
      state: 'connecting',
      path,
      baudRate,
      connectedAt: null,
      error: null,
      bytesReceived: 0,
      packetsReceived: 0,
      invalidFrames: 0,
      lastPacketAt: null,
      transmittedBytes: 0,
    };
    try {
      const ports = await this.ports();
      if (generation !== this.generation || this.disposed)
        throw new AircraftServiceError('Aircraft connection was cancelled.', 409);
      if (!ports.some((port) => port.path === path))
        throw new AircraftServiceError(
          'This USB port is no longer available. Refresh the port list.'
        );
      const port = this.createPort({
        path,
        baudRate: AIRCRAFT_BAUD_RATE,
        autoOpen: false,
        lock: true,
        hupcl: false,
        highWaterMark: 16_384,
      });
      const connection: Connection = {
        port,
        generation,
        pendingOpen: true,
        released: false,
        cancelOpen: () => {},
        removeListeners: () => {},
      };
      this.connection = connection;
      const current = () =>
        this.connection === connection && generation === this.generation && !this.disposed;
      const onData = (chunk: Buffer) => {
        if (!current() || connection.pendingOpen || !Buffer.isBuffer(chunk)) return;
        this.link.bytesReceived = Math.min(
          Number.MAX_SAFE_INTEGER,
          this.link.bytesReceived + chunk.length
        );
        try {
          if (this.escTransport) { this.escTransport.push(chunk); return; }
          this.decoder!.push(chunk, this.now());
          if (this.activeRequest && this.request) {
            try {
              this.requestTarget(this.request.aircraftId);
            } catch (error) {
              this.cancelRequest(message(error, 'Telemetry request was cancelled.'));
            }
          }
        } catch {
          this.fail(
            connection,
            'Aircraft telemetry could not be decoded. Disconnect and reconnect.'
          );
        }
      };
      const onError = (error: Error) => {
        if (current()) this.fail(connection, message(error, 'USB serial connection failed.'));
      };
      const onClose = () => {
        connection.cancelOpen(
          new AircraftServiceError('USB serial connection closed while opening.', 409)
        );
        if (current()) {
          this.escTransport?.cancel('USB disconnected during ESC read. Power-cycle before retrying.');
          ++this.generation;
          this.abortMission('USB serial link closed during mission exchange.');
          this.abortLogTransfer('USB serial link closed during log transfer.');
          this.benchShows.invalidate('Serial link closed. Remaining cues cancelled.');
          void this.zorroStops.abort('Serial link closed.');
          this.motorTests.invalidate('Serial link closed. Motor stop is not confirmed.');
          this.cancelRequest('USB serial connection closed during the telemetry request.');
          this.link.state = 'disconnected';
          this.link.error =
            'USB serial connection closed. Last telemetry is retained with its original timestamps.';
        }
        if (!connection.pendingOpen) this.release(connection);
      };
      port.on('data', onData);
      port.on('error', onError);
      port.on('close', onClose);
      connection.removeListeners = () => {
        port.removeListener('data', onData);
        port.removeListener('error', onError);
        port.removeListener('close', onClose);
        // A late native callback must not turn a disconnected port error into an unhandled exception.
        port.on('error', ignoredLateError);
      };
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) reject(error);
          else resolve();
        };
        connection.cancelOpen = (error) => settle(error);
        const timer = setTimeout(() => {
          if (current())
            this.fail(connection, 'Opening the USB port timed out. Disconnect before retrying.');
          settle(new AircraftServiceError('Opening the USB port timed out.', 504));
        }, OPEN_TIMEOUT_MS);
        try {
          port.open((error) => {
            connection.pendingOpen = false;
            if (error) {
              this.release(connection);
              settle(
                new AircraftServiceError(
                  `Could not open USB port: ${message(error, 'port unavailable')}`,
                  409
                )
              );
              return;
            }
            if (!current() || connection.released) {
              // Disconnect cannot cancel a native open. Close its eventual handle before reuse.
              void this.close(connection).catch(() => {});
              settle(new AircraftServiceError('Aircraft connection was cancelled.', 409));
              return;
            }
            this.link.state = 'listening';
            this.link.connectedAt = this.now();
            settle();
          });
        } catch (error) {
          connection.pendingOpen = false;
          this.release(connection);
          settle(new AircraftServiceError(message(error, 'Could not open USB port.'), 409));
        }
      });
      return this.snapshot();
    } catch (error) {
      if (generation === this.generation && !this.disposed) {
        this.link.state = 'error';
        this.link.error = message(error, 'Could not connect the USB port.');
      }
      throw error;
    }
  }

  private fail(connection: Connection, error: string) {
    if (this.connection !== connection || connection.generation !== this.generation) return;
    this.escTransport?.cancel('USB failed during ESC read. Power-cycle before retrying.');
    ++this.generation;
    this.abortMission(`Serial link failed: ${error}`);
    this.abortLogTransfer(`Serial link failed during log transfer: ${error}`);
    this.benchShows.invalidate('Serial link failed. Remaining cues cancelled.');
    void this.zorroStops.abort('Serial link failed.');
    this.motorTests.invalidate('Serial link failed. Motor stop is not confirmed.');
    this.cancelRequest(error);
    this.link.state = 'error';
    this.link.error = error;
    connection.cancelOpen(new AircraftServiceError(error, 503));
    void this.close(connection).catch(() => {});
  }

  private release(connection: Connection) {
    if (!connection.released) {
      connection.released = true;
      connection.removeListeners();
    }
    if (this.connection === connection) this.connection = undefined;
    connection.finishClose?.();
  }

  private close(connection: Connection): Promise<void> {
    // Retain ownership while native open is pending. Its callback will close a late handle.
    if (connection.pendingOpen) return Promise.resolve();
    if (connection.closePromise) return connection.closePromise;
    if (!connection.port.isOpen) {
      this.release(connection);
      return Promise.resolve();
    }
    connection.closePromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        connection.finishClose = undefined;
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => {
        const error = new AircraftServiceError(
          'Closing the USB port timed out. Restart the local studio server before retrying.',
          504
        );
        if (this.connection === connection) {
          this.link.state = 'error';
          this.link.error = error.message;
        }
        finish(error);
      }, CLOSE_TIMEOUT_MS);
      connection.finishClose = finish;
      try {
        connection.port.close((error) => {
          if (error && connection.port.isOpen) {
            this.link.state = 'error';
            this.link.error = message(error, 'Could not close the USB port.');
            finish(new AircraftServiceError(this.link.error, 503));
          } else {
            this.release(connection);
            finish();
          }
        });
      } catch (error) {
        if (!connection.port.isOpen) this.release(connection);
        finish(new AircraftServiceError(message(error, 'Could not close the USB port.'), 503));
      }
    });
    return connection.closePromise;
  }

  async disconnect(): Promise<AircraftSnapshot> {
    const run = this.flightRunStatus();
    if (!this.disposed && ['resetting', 'arming', 'starting', 'active', 'landing', 'takeover'].includes(run.state))
      throw new AircraftServiceError('Do not intentionally disconnect during a physical run. Use LAND or pilot takeover, then confirm on-ground disarm.', 409);
    if (this.zorroStops.active && !this.disposed)
      throw new AircraftServiceError('Stop the props-off show and confirm disarm before disconnecting.', 409);
    this.escTransport?.cancel('Disconnected during ESC read. Power-cycle the controller and ESCs before reconnecting.');
    this.benchShows.invalidate('Link disconnected. Remaining cues cancelled; motor stop is not verified.');
    ++this.generation;
    this.abortMission('Aircraft link disconnected during mission exchange.');
    this.abortLogTransfer('Aircraft link disconnected during log transfer.');
    this.motorTests.invalidate(
      'Link disconnected. The test has a one-second aircraft timeout; motor stop is not confirmed.'
    );
    this.cancelRequest('Telemetry request cancelled because the aircraft link disconnected.');
    this.link.state = 'disconnected';
    this.link.error = null;
    const connection = this.connection;
    if (connection) {
      connection.cancelOpen(new AircraftServiceError('Aircraft connection was cancelled.', 409));
      await this.close(connection);
    }
    return this.snapshot();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    if (this.flightObservationTimer) clearInterval(this.flightObservationTimer);
    await this.zorroStops.abort('Studio server is closing.');
    this.disposed = true;
    await this.disconnect();
  }

  /** No arbitrary bytes are exposed through the HTTP API. These frames come from MotorTestController. */
  private async writeMotorFrame(frame: Buffer, escFrame = false, zorroFrame = false, missionFrameWrite = false, flightFrameWrite = false, logFrameWrite = false): Promise<void> {
    if (this.flightLocked() && !flightFrameWrite)
      throw new AircraftServiceError('A physical mission run owns the aircraft link; other commands are disabled.', 409);
    if (!flightFrameWrite) this.flightPreflight = undefined;
    if (this.zorroStops.active && !zorroFrame)
      throw new AircraftServiceError('Wait for the props-off show to disarm.', 409);
    if (this.escBusy && !escFrame) throw new AircraftServiceError('ESC inspection owns the USB link.', 409);
    if (this.missionBusy && !missionFrameWrite) throw new AircraftServiceError('Mission exchange owns the USB link.', 409);
    if (this.logBusy && !logFrameWrite) throw new AircraftServiceError('Onboard log transfer owns the USB link.', 409);
    const connection = this.connection;
    const generation = this.generation;
    if (this.disposed || this.link.state !== 'listening' || !connection?.port.isOpen)
      throw new AircraftServiceError('No listening serial link for this device command.', 409);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else if (generation !== this.generation || this.connection !== connection)
          reject(new AircraftServiceError('The link changed; motor response is unknown.', 409));
        else resolve();
      };
      const timer = setTimeout(
        () =>
          finish(
            new AircraftServiceError(
              'Device write timed out; the command result is unconfirmed.',
              504
            )
          ),
        1500
      );
      try {
        connection.port.write(frame, finish);
        this.link.transmittedBytes += frame.length;
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Device write failed.'));
      }
    });
  }

  async motorTest(
    aircraftId: string,
    motor: number,
    checks: { propsRemoved: boolean; areaClear: boolean; hardwareCool: boolean }
  ): Promise<AircraftSnapshot> {
    if (this.zorroStops.active) throw new AircraftServiceError('Stop the props-off show first.', 409);
    if (this.benchShows.active)
      throw new AircraftServiceError('Stop the bench show before an individual motor test.', 409);
    await this.motorTests.start(aircraftId, motor, checks);
    return this.snapshot();
  }

  async stopMotorTest(aircraftId: string): Promise<AircraftSnapshot> {
    if (this.benchShows.active)
      throw new AircraftServiceError('Use Stop show to cancel all remaining cues.', 409);
    await this.motorTests.stop(aircraftId);
    return this.snapshot();
  }

  startBenchShow(aircraftId: string, runId: string, checks: MotorTestChecks, storyboard: unknown, reviewedPlanKey: string): AircraftSnapshot {
    if (this.zorroStops.active) throw new AircraftServiceError('Stop the props-off show first.', 409);
    if (this.disposed) throw new AircraftServiceError('Aircraft service is closed.', 503);
    const plan = compileStoryboardBenchPlan(storyboard);
    if (typeof reviewedPlanKey !== 'string' || reviewedPlanKey !== plan.source.planKey)
      throw new AircraftServiceError('The storyboard changed after review. Review the current storyboard before starting.', 409);
    this.motorTests.assertReady(aircraftId, plan.cues[0].motor, checks);
    this.benchShows.start(aircraftId, runId, checks, plan);
    return this.snapshot();
  }

  renewBenchShow(runId: string): AircraftSnapshot {
    this.benchShows.renew(runId);
    return this.snapshot();
  }

  async stopBenchShow(runId: string): Promise<AircraftSnapshot> {
    await this.benchShows.stop(runId);
    return this.snapshot();
  }

  async startZorroStop(aircraftId: string, runId: string, storyboard: Project, checks: ZorroStopChecks): Promise<AircraftSnapshot> {
    await this.zorroStops.start(aircraftId, runId, storyboard, checks);
    return this.snapshot();
  }

  renewZorroStop(runId: string): AircraftSnapshot {
    this.zorroStops.renew(runId);
    return this.snapshot();
  }

  async stopZorroStop(runId: string): Promise<AircraftSnapshot> {
    await this.zorroStops.stop(runId);
    return this.snapshot();
  }

  async playTune(aircraftId: string, input: Tune, propsRemoved: boolean) {
    if (propsRemoved !== true) throw new AircraftServiceError('Remove propellers before a drone sound test.');
    if (this.parameterBusy || this.radioBusy || this.missionBusy || this.logBusy || this.externalBusy() || this.now() < this.tuneAvailableAt)
      throw new AircraftServiceError('Wait for the current operation or sound to finish.', 409);
    const target = this.parameterTarget(aircraftId);
    const tune = validateTune(input);
    const frame = tuneFrame(target.systemId, target.componentId, this.sequence, tune);
    this.sequence = (this.sequence + 1) % 256;
    this.tuneAvailableAt = this.now() + tuneSeconds(tune) * 1000 + 1000;
    await this.writeMotorFrame(frame);
    return { state: 'sent', message: 'Tune sent to the flight-controller buzzer. MAVLink does not acknowledge playback; listen to confirm. Startup settings were not changed.' };
  }

  /** Read-only entry point; maintenance is a separate reviewed operation. */
  async readEscs(aircraftId: string, checks: { propsRemoved: boolean; directUsb: boolean }) {
    return this.escSession(aircraftId, checks);
  }

  /** Reboots ESCs to replay their installed tune. This path has no flash-write capability. */
  async replayEscStartup(aircraftId: string, input: Tune, checks: { propsRemoved: boolean; directUsb: boolean }) {
    this.parameterTarget(aircraftId);
    const tune = validateTune(input);
    if (this.escRecoveryRequired || this.escInspection?.aircraftId !== aircraftId ||
        this.escInspection.state !== 'complete' || !hasInstalledMelody(this.escInspection, tune))
      throw new AircraftServiceError('Set this sound as startup before playing it on the drone. Check motor setup if the connection changed.', 409);
    const report = await this.escSession(aircraftId, checks);
    if (report.state !== 'complete' || !report.telemetryRestored) throw new AircraftServiceError(report.message, 409);
    if (!hasInstalledMelody(report, tune))
      throw new AircraftServiceError('The installed sound changed. The motors replayed their saved startup sounds; check setup before trying again.', 409);
    return { state: 'sent', message: `The motor controllers restarted with “${tune.name}”. Listen to confirm playback. Your startup sound and motor settings are unchanged.` };
  }

  private async escSession(aircraftId: string, checks: { propsRemoved: boolean; directUsb: boolean }, operation?: {
    write: boolean;
    hasWritten?: () => boolean;
    run: (transport: EscTransport, report: EscInspection, select: (index: number | undefined) => void) => Promise<void>;
  }) {
    if (this.zorroStops.active) throw new AircraftServiceError('Stop the props-off show first.', 409);
    if (checks.propsRemoved !== true || checks.directUsb !== true)
      throw new AircraftServiceError('Confirm props removed and direct flight-controller USB.');
    this.parameterTarget(aircraftId);
    if (this.parameterBusy || this.radioBusy || this.missionBusy || this.logBusy || this.externalBusy() || this.now() < this.tuneAvailableAt)
      throw new AircraftServiceError('Wait for the current device operation to finish.', 409);
    const connection = this.connection!;
    const generation = this.generation;
    const port = (await this.ports()).find(p => p.path === this.link.path);
    const target = this.parameterTarget(aircraftId);
    if (connection !== this.connection || generation !== this.generation || this.parameterBusy || this.missionBusy || this.logBusy || this.externalBusy())
      throw new AircraftServiceError('The connection or device operation changed. Try again.', 409);
    // A radio can have the same path as a previously attached FC. Re-enumerate its identity.
    if (!port || !/ardupilot/i.test(port.manufacturer ?? ''))
      throw new AircraftServiceError('Use the direct ArduPilot USB device; radio passthrough is not supported.', 409);
    const battery = target.battery;
    if (!battery || battery.voltageV === null || battery.voltageV < 2 || this.now() - battery.receivedAt > 5000)
      throw new AircraftServiceError('Fresh battery voltage is required. Power the ESCs with the flight battery and refresh telemetry.', 409);
    const params = this.parameters(aircraftId).parameters;
    const recent = (p: { receivedAt: number }) => this.now() >= p.receivedAt && this.now() - p.receivedAt < 60_000;
    if (!params.some(p => p.name === 'SERVO_BLH_AUTO' && p.value === 1 && recent(p)) ||
        !params.some(p => p.name === 'SERVO_BLH_PORT' && p.value === 0 && recent(p)))
      throw new AircraftServiceError('Read parameters first. USB passthrough requires SERVO_BLH_AUTO=1 and SERVO_BLH_PORT=0.', 409);
    this.escBusy = true;
    const report: EscInspection = {
      aircraftId, path: port.path, serialNumber: port.serialNumber, startedAt: this.now(),
      state: 'reading', message: 'Reading ESC identities over direct USB…', count: 0, escs: [], telemetryRestored: false,
    };
    this.escInspection = report;
    const transport = new EscTransport(async frame => {
      if (generation !== this.generation || this.connection !== connection)
        throw new Error('The USB connection changed during ESC inspection.');
      await this.writeMotorFrame(frame, true);
    }, 4000, operation?.write === true);
    let failure = '';
    let cleanupFailure = '';
    let selected: number | undefined;
    let passthroughRequested = false;
    try {
      // ArduPilot only recognizes its alternate protocol after four seconds without inbound MAVLink.
      await new Promise(resolve => setTimeout(resolve, 4100));
      const heartbeat = this.decoder?.snapshot().aircraft.find(a => a.id === aircraftId)?.heartbeat;
      if (!heartbeat || heartbeat.armed || this.now() - heartbeat.receivedAt > HEARTBEAT_STALE_MS)
        throw new Error('Fresh disarmed telemetry was lost before entering ESC passthrough.');
      // The quiet interval suppresses our transmissions, not incoming telemetry.
      // Keep decoding heartbeats until this point so freshness/arming can be checked.
      this.escTransport = transport;
      const api = await transport.msp(1);
      if (api.length !== 3 || api[0] !== 0 || api[1] !== 1) throw new Error('Unsupported MSP API for ESC inspection.');
      const variant = await transport.msp(2);
      if (variant.toString('ascii') !== 'ARDU') throw new Error('Expected ArduPilot ESC passthrough.');
      passthroughRequested = true;
      const response = await transport.msp(245);
      if (response.length !== 1 || response[0] < 1 || response[0] > 8) throw new Error('Controller did not report a valid ESC count.');
      report.count = response[0];
      // Entering passthrough interrupts the motor signal; allow ESC boot/melody completion.
      // ESC Configurator uses the same 1.2-second settling interval.
      await new Promise(resolve => setTimeout(resolve, 1200));
      for (let index = 0; index < report.count; index++) {
        selected = index;
        report.message = `Reading ESC ${index + 1} of ${report.count}…`;
        try {
          let info: Buffer | undefined;
          for (let attempt = 0; attempt < 3; attempt++) {
            try { info = await transport.four(0x37, index); break; }
            catch (error) {
              if (!(error instanceof EscAckError) || attempt === 2) throw error;
              await new Promise(resolve => setTimeout(resolve, 250));
            }
          }
          if (!info) throw new Error('No ESC identity response.');
          if (info.length !== 4) throw new Error('Incomplete ESC identity response.');
          const signature = info.readUInt16LE(0), mode = info[3];
          const address = escSettingsAddress(signature, mode);
          if (address === null) {
            report.escs.push({ index: index + 1, signature: `0x${signature.toString(16).toUpperCase()}`, interfaceMode: mode,
              firmware: 'Unknown', startupMelody: 'unknown', error: 'This ESC MCU/interface is not supported by the read-only adapter.' });
          } else {
            let bytes = await transport.four(0x3a, 0x70, address);
            let esc = decodeEscSettings(index + 1, signature, mode, bytes);
            if (esc.firmware === 'Bluejay') {
              bytes = await transport.four(0x3a, 0xff, address);
              esc = decodeEscSettings(index + 1, signature, mode, bytes);
            }
            report.escs.push(esc);
          }
        } catch (error) {
          report.escs.push({ index: index + 1, error: message(error, 'ESC read failed.') });
          // Only an explicit negative ACK leaves response ordering certain enough to continue.
          if (!(error instanceof EscAckError)) throw error;
        }
        await transport.four(0x35, index);
        selected = undefined;
      }
      if (operation) {
        if (report.escs.some(esc => esc.error || esc.firmware === 'Unknown')) throw new Error('Every ESC must be identified before startup installation.');
        await new Promise(resolve => setTimeout(resolve, 1200));
        await operation.run(transport, report, index => { selected = index; });
      }
    } catch (error) {
      failure = message(error, 'ESC read failed.');
    } finally {
      if (selected !== undefined && !(failure && operation?.hasWritten?.())) {
        try { await transport.four(0x35, selected); } catch { cleanupFailure = 'ESC restart was not confirmed. '; }
      }
      if (passthroughRequested) {
        try { await transport.four(0x34); } catch { cleanupFailure += 'Passthrough exit was not confirmed. '; }
      }
      this.escTransport = undefined;
      transport.cancel();
      // Require a heartbeat received after leaving passthrough before allowing device commands again.
      const exitedAt = this.now();
      if (!cleanupFailure && generation === this.generation && !this.disposed) {
        // Exiting 4-way releases the UART lock, but GCS_MAVLink keeps outbound telemetry
        // suppressed until it parses a MAVLink packet after its four-second alternate timeout.
        await new Promise(resolve => setTimeout(resolve, 4100));
        try {
          if (generation !== this.generation || this.connection !== connection) throw new Error('USB connection changed.');
          const frame = parameterFrame(target.systemId, target.componentId, this.sequence, 'read', 'SERVO_BLH_AUTO');
          this.sequence = (this.sequence + 1) % 256;
          await this.writeMotorFrame(frame, true);
        } catch { cleanupFailure += 'Telemetry resume request failed. '; }
      }
      for (let i = 0; i < 50 && generation === this.generation && !this.disposed; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const h = this.decoder?.snapshot().aircraft.find(a => a.id === aircraftId)?.heartbeat;
        if (h && h.receivedAt > exitedAt && !h.armed) { report.telemetryRestored = true; break; }
      }
      if (!report.telemetryRestored || cleanupFailure) {
        cleanupFailure += 'Power-cycle the controller and ESCs, then reconnect before further device operations.';
        if (generation === this.generation) this.fail(connection, cleanupFailure);
      }
      report.finishedAt = this.now();
      report.state = failure || cleanupFailure ? 'failed' : report.escs.some(e => e.error || e.firmware === 'Unknown') ? 'partial' : 'complete';
      report.message = [failure, cleanupFailure].filter(Boolean).join(' ') ||
        (operation?.write ? 'Startup installation readback verified; telemetry restored. Listen after a power cycle to confirm sound.' : report.state === 'complete' ? `Read ${report.count} ESCs. Settings unchanged; telemetry restored.` : 'ESC read finished with unsupported or unreadable devices. Settings unchanged; telemetry restored.');
      this.escBusy = false;
    }
    return structuredClone(report);
  }

  /** Preparation is read-only and saves a durable full-flash backup before review. */
  async prepareEscStartup(aircraftId: string, input: Tune, checks: { propsRemoved: boolean; directUsb: boolean; melodyOnly?: boolean }) {
    this.parameterTarget(aircraftId);
    const tune = validateTune(input), melody = encodeBluejayMelody(tune);
    const firmware = await loadBluejayImage();
    // Recheck ownership after file I/O, before replacing another operation's status.
    this.parameterTarget(aircraftId);
    this.startupPlan = undefined;
    const status: EscStartupStatus = { aircraftId, state: 'preparing', message: 'Reading ESC firmware and saving backups…', verifiedEscs: [] };
    this.escStartup = status;
    let prepared: PendingEscStartup | undefined;
    try {
      const report = await this.escSession(aircraftId, checks, { write: false, run: async (transport, report, select) => {
        if (report.count !== 4 || !report.serialNumber) throw new Error('This installer requires four supported ESCs and an identified direct USB controller.');
        const originals: Buffer[] = [], images: Buffer[] = [];
        const escs: EscStartupPlan['escs'] = [];
        for (const esc of report.escs) {
          select(esc.index - 1);
          const info = await transport.four(0x37, esc.index - 1);
          if (info.length !== 4 || info.readUInt16LE(0) !== 0xe8b2 || info[3] !== 1) throw new Error('ESC MCU changed or is unsupported.');
          status.message = report.message = `Backing up ESC ${esc.index} of ${report.count}…`;
          const current = await readEscImage(transport);
          const identity = decodeEscSettings(esc.index, 0xe8b2, 1, current.subarray(0x1a00, 0x1aff));
          const { image, action } = startupImage(current, identity, firmware, melody);
          if (checks.melodyOnly && action !== 'melody') throw new Error('This drone needs firmware setup first. No settings were changed. Open Motor melody setup at the top of Music.');
          if ((await transport.readMemory(0xfbff, 1))[0] !== 255) throw new Error(`ESC ${esc.index} flash is locked. Installation is unavailable.`);
          if (current.subarray(0x1c00).every(byte => byte === 255)) throw new Error('ESC bootloader backup is empty.');
          originals.push(current); images.push(image);
          escs.push({ index: esc.index, from: `${identity.firmware} ${identity.version}`, direction: identity.direction!, action,
            beforeSha256: digest(current), afterSha256: digest(image) });
          await transport.four(0x35, esc.index - 1); select(undefined);
        }
        const id = randomUUID();
        await mkdir(this.escBackupDirectory, { recursive: true, mode: 0o700 });
        const backupPath = resolve(this.escBackupDirectory, `${id}.json`);
        const plan: EscStartupPlan = { id, aircraftId, createdAt: this.now(), expiresAt: this.now() + 10 * 60_000,
          tuneName: tune.name, melodyHex: Buffer.from(melody).toString('hex'), firmware: BLUEJAY.name,
          firmwareUrl: BLUEJAY.url, firmwareSha256: BLUEJAY.sha256, backupPath,
          requiresFirmwareChange: escs.some(esc => esc.action === 'upgrade'), escs };
        const file = await open(backupPath, 'wx', 0o600);
        try {
          await file.writeFile(JSON.stringify({ plan, readback: report, tune,
            escs: originals.map((image, i) => ({ index: i + 1, sha256: digest(image), flashHex: image.toString('hex') })) }, null, 2));
          await file.sync();
        } finally { await file.close(); }
        prepared = { plan, generation: this.generation, originals, images };
      } });
      if (report.state !== 'complete' || !report.telemetryRestored || !prepared) throw new Error(report.message);
      this.startupPlan = prepared;
      status.state = 'ready'; status.plan = prepared.plan;
      status.message = 'Backup saved. Review the installation plan; no ESC settings have changed.';
      return structuredClone(prepared.plan);
    } catch (error) {
      status.state = 'failed'; status.message = message(error, 'Startup preparation failed.');
      throw new AircraftServiceError(status.message, 409);
    }
  }

  async installEscStartup(aircraftId: string, planId: string, checks: { propsRemoved: boolean; directUsb: boolean; confirmed: boolean; firmwareChangeConfirmed: boolean }) {
    this.parameterTarget(aircraftId);
    const pending = this.startupPlan;
    if (!pending || pending.plan.id !== planId || pending.plan.aircraftId !== aircraftId || pending.generation !== this.generation ||
        this.now() >= pending.plan.expiresAt || this.now() < pending.plan.createdAt)
      throw new AircraftServiceError('Prepare a new startup installation; this plan is missing, expired or belongs to another connection.', 409);
    if (!checks.confirmed || pending.plan.requiresFirmwareChange && !checks.firmwareChangeConfirmed)
      throw new AircraftServiceError('Review and explicitly confirm the firmware and startup changes.');
    if (checks.propsRemoved !== true || checks.directUsb !== true) throw new AircraftServiceError('Confirm props removed and direct USB.');
    this.startupPlan = undefined; // Single use, including failed attempts.
    const status: EscStartupStatus = { aircraftId, state: 'installing', message: 'Checking every ESC against the saved backup…', plan: pending.plan, verifiedEscs: [] };
    this.escStartup = status;
    let modified = false;
    let writingIndex: number | undefined;
    try {
      const report = await this.escSession(aircraftId, checks, { write: true, hasWritten: () => modified, run: async (transport, report, select) => {
        if (report.count !== pending.originals.length) throw new Error('ESC count changed. Nothing was written.');
        // Validate ALL devices before the first erase. Do not write one motor before checking the rest.
        for (let index = 0; index < report.count; index++) {
          select(index);
          const info = await transport.four(0x37, index);
          if (info.length !== 4 || info.readUInt16LE(0) !== 0xe8b2 || info[3] !== 1 ||
              (await transport.readMemory(0xfbff, 1))[0] !== 255 || !(await readEscImage(transport)).equals(pending.originals[index]))
            throw new Error(`ESC ${index + 1} changed since review. Nothing was written; prepare again.`);
          await transport.four(0x35, index); select(undefined);
        }
        for (let index = 0; index < report.count; index++) {
          select(index);
          const info = await transport.four(0x37, index);
          if (info.length !== 4 || info.readUInt16LE(0) !== 0xe8b2 || info[3] !== 1) throw new Error('ESC identity changed before writing.');
          modified = true;
          writingIndex = index;
          await installEscImage(transport, pending.originals[index], pending.images[index], pending.plan.escs[index].action,
            text => { status.message = report.message = `ESC ${index + 1} of ${report.count}: ${text}…`; });
          report.escs[index] = decodeEscSettings(index + 1, 0xe8b2, 1, pending.images[index].subarray(0x1a00, 0x1aff));
          status.verifiedEscs.push(index + 1);
          await transport.four(0x35, index); select(undefined);
          writingIndex = undefined;
        }
      } });
      if (report.state !== 'complete' || !report.telemetryRestored) throw new Error(report.message);
      status.state = 'verified';
      this.escRecoveryRequired = false;
      status.message = `“${pending.plan.tuneName}” is installed and read back on all four ESCs. Power-cycle with props removed and listen to confirm the startup sound. Motor direction settings were preserved. Flight operation has not been tested.`;
      return structuredClone(status);
    } catch (error) {
      status.state = 'failed'; status.recoveryRequired = modified;
      if (modified) this.escRecoveryRequired = true;
      if (writingIndex !== undefined && this.escInspection?.aircraftId === aircraftId)
        this.escInspection.escs[writingIndex] = { index: writingIndex + 1, firmware: 'Unknown', error: 'Installation incomplete; recover and read this ESC before use.' };
      status.message = message(error, 'Startup installation failed.') + (modified ? ' Firmware/settings may be incomplete. Do not fly; recover and verify every ESC before use. Backup: ' + pending.plan.backupPath : ' No flash writes were started.');
      throw new AircraftServiceError(status.message, 409);
    }
  }

  async runPrearmChecks(aircraftId: string) {
    if (this.parameterBusy || this.radioBusy || this.missionBusy || this.logBusy) throw new AircraftServiceError('Another aircraft operation is in progress.', 409);
    const target = this.parameterTarget(aircraftId);
    if (this.snapshot().aircraft.length !== 1) throw new AircraftServiceError('Power only one aircraft for this check.', 409);
    const generation = this.generation;
    const requestedAt = this.now();
    this.parameterBusy = true;
    try {
      const frames = diagnosticFrames(target.systemId, target.componentId, this.sequence);
      this.sequence = (this.sequence + frames.length) % 256;
      for (const frame of frames) {
        if (generation !== this.generation) throw new AircraftServiceError('Connection changed during checks.', 409);
        this.requestTarget(aircraftId);
        await this.writeMotorFrame(frame);
      }
      return { requestedAt };
    } finally { this.parameterBusy = false; }
  }

  parameters(aircraftId: string) {
    return summarizeParameters(
      aircraftId,
      this.decoder?.parameterSnapshot?.(aircraftId) ?? [],
      this.parameterReads.get(aircraftId) ?? null,
      this.now()
    );
  }

  private parameterTarget(aircraftId: string) {
    const target = this.requestTarget(aircraftId);
    if (target.heartbeat.autopilot !== 3 || target.componentId !== 1)
      throw new AircraftServiceError(
        'Parameter tools currently support the ArduPilot autopilot component.',
        409
      );
    if (
      this.activeRequest ||
      this.benchShows.active ||
      this.motorTests.pending ||
      (this.motorTests.status && this.now() < this.motorTests.status.availableAt)
    )
      throw new AircraftServiceError(
        'Wait for the current telemetry or motor operation to finish.',
        409
      );
    return target;
  }

  private async sendParameter(
    aircraftId: string,
    operation: 'list' | 'read' | 'set',
    name = '',
    value = 0,
    type = 9
  ) {
    const target = this.parameterTarget(aircraftId);
    const sequence = this.sequence;
    this.sequence = (sequence + 1) % 256;
    await this.writeMotorFrame(
      parameterFrame(target.systemId, target.componentId, sequence, operation, name, value, type)
    );
  }

  async readParameters(aircraftId: string, names?: string[]) {
    if (this.parameterBusy || this.radioBusy || this.missionBusy || this.logBusy)
      throw new AircraftServiceError('A parameter change is in progress.', 409);
    this.parameterTarget(aircraftId);
    if (names && (!names.length || names.length > 16 || names.some((name) => !parameterName(name))))
      throw new AircraftServiceError('Request up to 16 valid parameter names.', 400);
    const generation = this.generation;
    this.parameterBusy = true;
    try {
      if (names) {
        for (const name of names) {
          const previousRevision = this.parameters(aircraftId).parameters.find((p) => p.name === name)?.revision ?? 0;
          await this.sendParameter(aircraftId, 'read', name);
          let received = false;
          for (let attempt = 0; attempt < 30; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            if (generation !== this.generation) throw new AircraftServiceError('The aircraft connection changed.', 409);
            this.parameterTarget(aircraftId);
            if (this.parameters(aircraftId).parameters.some((p) => p.name === name && p.revision > previousRevision)) {
              received = true;
              break;
            }
          }
          if (!received) throw new AircraftServiceError(`${name} did not answer the setup read. Try again.`, 504);
        }
        return this.parameters(aircraftId);
      }
      const startedAt = this.now();
      this.decoder?.resetParameters?.(aircraftId);
      this.parameterReads.set(aircraftId, startedAt);
      await this.sendParameter(aircraftId, 'list');
      return this.parameters(aircraftId);
    } finally { this.parameterBusy = false; }
  }

  async setParameter(aircraftId: string, name: string, value: number, expected: number) {
    if (this.parameterBusy || this.radioBusy || this.missionBusy || this.logBusy)
      throw new AircraftServiceError('Another parameter change is in progress.', 409);
    this.parameterTarget(aircraftId);
    const generation = this.generation;
    const check = () => {
      if (generation !== this.generation)
        throw new AircraftServiceError(
          'The aircraft connection changed. Read parameters again.',
          409
        );
      this.parameterTarget(aircraftId);
    };
    const readFresh = async () => {
      check();
      const previousRevision =
        this.parameters(aircraftId).parameters.find((p) => p.name === name)?.revision ?? 0;
      await this.sendParameter(aircraftId, 'read', name);
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        check();
        const p = this.parameters(aircraftId).parameters.find(
          (p) => p.name === name && p.revision > previousRevision
        );
        if (p) return p;
      }
      throw new AircraftServiceError(
        'No parameter readback arrived. The value is unconfirmed; read it again before retrying.',
        504
      );
    };
    this.parameterBusy = true;
    try {
      const before = await readFresh();
      if (before.value !== expected)
        throw new AircraftServiceError(
          'This setting changed since you reviewed it. Refresh and review the new value.',
          409
        );
      const normalized = validateParameterValue(before.type, value);
      await this.sendParameter(aircraftId, 'set', name, normalized, before.type);
      // Allow transient PARAM_SET echoes (including read-only rejection echoes) to settle before an explicit read.
      await new Promise((resolve) => setTimeout(resolve, 500));
      const after = await readFresh();
      if (after.value !== normalized || after.type !== before.type)
        throw new AircraftServiceError(
          `The aircraft read back ${after.value}; the requested value was not verified.`,
          409
        );
      return {
        name,
        before: before.value,
        after: after.value,
        verifiedAt: after.receivedAt,
        aircraftId,
      };
    } finally {
      this.parameterBusy = false;
    }
  }

  /** One guarded Copter board-level trim. The ACK reports command outcome, not a level airframe or corrected drift. */
  async calibrateLevel(aircraftId: string, checks: {
    propsRemoved: true; batteryDisconnected: true; physicallyLevel: true;
    still: true; directUsb: true; confirmed: true;
  }): Promise<LevelCalibrationResult> {
    if (!checks || checks.propsRemoved !== true || checks.batteryDisconnected !== true ||
        checks.physicallyLevel !== true || checks.still !== true || checks.directUsb !== true ||
        checks.confirmed !== true)
      throw new AircraftServiceError('Confirm props removed, battery disconnected, a still level airframe, direct FC USB, and the calibration action.', 400);
    this.missionOperationAvailable();
    const target = this.missionTarget(aircraftId);
    if (this.snapshot().aircraft.length !== 1 || target.componentId !== 1)
      throw new AircraftServiceError('Level calibration requires one directly connected ArduCopter flight controller.', 409);
    const connection = this.connection;
    const generation = this.generation;
    const path = this.link.path;
    if (!connection || !path) throw new AircraftServiceError('The flight-controller USB link is unavailable.', 409);
    this.parameterBusy = true;
    try {
      // The ground ESP32 has previously appeared at the same serial path. Re-enumerate
      // the device rather than trusting the path or a relayed Copter heartbeat.
      const port = (await this.ports()).find(item => item.path === path);
      if (!port || !/ardupilot/i.test(port.manufacturer ?? ''))
        throw new AircraftServiceError('Use the direct ArduPilot USB device; ESP32 radio passthrough is not supported.', 409);
      const checkLink = () => {
        if (generation !== this.generation || connection !== this.connection || path !== this.link.path)
          throw new AircraftServiceError('The flight-controller USB connection changed during calibration.', 409);
        if (this.externalBusy()) throw new AircraftServiceError('Another local device process owns the aircraft link.', 409);
        const current = this.missionTarget(aircraftId);
        const battery = current.battery;
        if (battery && battery.receivedAt <= this.now() && this.now() - battery.receivedAt <= 5000 &&
            battery.voltageV !== null && battery.voltageV >= 2)
          throw new AircraftServiceError('Fresh aircraft telemetry reports flight-battery voltage. Disconnect the flight battery before level calibration.', 409);
        return current;
      };
      const readTrim = async (name: 'AHRS_TRIM_X' | 'AHRS_TRIM_Y'): Promise<number | null> => {
        checkLink();
        const previous = this.parameters(aircraftId).parameters.find(item => item.name === name)?.revision ?? 0;
        await this.sendParameter(aircraftId, 'read', name);
        for (let attempt = 0; attempt < 20; attempt++) {
          await this.levelCalibrationWait(100);
          checkLink();
          const value = this.parameters(aircraftId).parameters.find(item => item.name === name && item.revision > previous);
          if (value && Number.isFinite(value.value)) return value.value;
        }
        return null;
      };
      const attitude = (newerThan = -Infinity): LevelCalibrationReading['attitude'] => {
        const sample = this.decoder?.snapshot().aircraft.find(item => item.id === aircraftId)?.attitude;
        const now = this.now();
        return sample && sample.receivedAt > newerThan && sample.receivedAt <= now && now - sample.receivedAt <= 3000
          ? { rollDeg: sample.rollDeg, pitchDeg: sample.pitchDeg, receivedAt: sample.receivedAt }
          : null;
      };
      const before: LevelCalibrationReading = {
        AHRS_TRIM_X: await readTrim('AHRS_TRIM_X'),
        AHRS_TRIM_Y: await readTrim('AHRS_TRIM_Y'),
        attitude: attitude(),
      };
      const current = checkLink();
      const cursor = this.decoder?.commandAckCursor?.();
      if (cursor === undefined || !this.decoder?.commandAcks)
        throw new AircraftServiceError('This connection cannot verify calibration acknowledgements.', 409);
      const commandAt = this.now();
      const frame = levelCalibrationFrame(current.systemId, current.componentId, this.sequence);
      this.sequence = (this.sequence + 1) % 256;
      let writeProblem: string | null = null;
      try {
        await this.writeMotorFrame(frame);
      } catch (error) {
        writeProblem = message(error, 'The calibration write could not be confirmed.');
      }
      let ack: LevelCalibrationResult['ack'] = null;
      let ackReadProblem = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (generation !== this.generation || connection !== this.connection) break;
        let matched;
        try {
          matched = this.decoder.commandAcks(cursor, aircraftId).find(item =>
            item.command === 241 && item.result !== 5 && item.receivedAt >= commandAt &&
            item.sourceSystem === current.systemId && item.sourceComponent === 1 &&
            item.targetSystem === GROUND_SYSTEM_ID && item.targetComponent === GROUND_COMPONENT_ID);
        } catch { ackReadProblem = true; break; }
        if (matched) { ack = { result: matched.result, receivedAt: matched.receivedAt }; break; }
        await this.levelCalibrationWait(100);
      }
      const tryAfter = async (name: 'AHRS_TRIM_X' | 'AHRS_TRIM_Y') => {
        try { return await readTrim(name); } catch { return null; }
      };
      const postAfter = Math.max(before.attitude?.receivedAt ?? -Infinity, ack?.receivedAt ?? commandAt);
      let postAttitude: LevelCalibrationReading['attitude'] = attitude(postAfter);
      if (!postAttitude) {
        try {
          checkLink();
          await this.writeMotorFrame(levelAttitudeRequestFrame(current.systemId, current.componentId, this.sequence));
          this.sequence = (this.sequence + 1) % 256;
          for (let attempt = 0; attempt < 15 && !postAttitude; attempt++) {
            await this.levelCalibrationWait(100);
            postAttitude = attitude(postAfter);
          }
        } catch { /* A missing fresh attitude is reported as null. */ }
      }
      const after: LevelCalibrationReading = {
        AHRS_TRIM_X: await tryAfter('AHRS_TRIM_X'),
        AHRS_TRIM_Y: await tryAfter('AHRS_TRIM_Y'),
        attitude: postAttitude,
      };
      const state = ack === null ? 'unconfirmed' : ack.result === 0 ? 'accepted' : 'rejected';
      const readbackIncomplete = [before.AHRS_TRIM_X, before.AHRS_TRIM_Y, after.AHRS_TRIM_X, after.AHRS_TRIM_Y, after.attitude]
        .some(value => value === null);
      const outcome = state === 'accepted'
        ? 'ArduPilot acknowledged the board-level trim calibration.'
        : state === 'rejected'
          ? `ArduPilot rejected level calibration (MAV_RESULT ${ack!.result}).`
          : `No matching final calibration acknowledgement arrived; the command outcome is unknown.${writeProblem ? ` ${writeProblem}` : ''}${ackReadProblem ? ' The acknowledgement stream could not be read.' : ''}`;
      return {
        aircraftId, state, ack, before, after,
        message: `${outcome}${readbackIncomplete ? ' Some fresh trim or attitude readbacks were unavailable.' : ''} An ACK or level display does not prove physical level or that left drift is corrected.`,
      };
    } finally {
      this.parameterBusy = false;
    }
  }

  private requestTarget(aircraftId: string) {
    if (this.escBusy) throw new AircraftServiceError('ESC inspection owns the USB link.', 409);
    if (this.disposed || this.link.state !== 'listening' || !this.connection?.port.isOpen)
      throw new AircraftServiceError(
        'Connect a listening aircraft link before requesting telemetry.',
        409
      );
    const aircraft = this.decoder?.snapshot().aircraft.find((item) => item.id === aircraftId);
    const now = this.now();
    if (
      !aircraft ||
      aircraft.heartbeat.receivedAt > now ||
      now - aircraft.heartbeat.receivedAt > HEARTBEAT_STALE_MS
    )
      throw new AircraftServiceError(
        'A fresh aircraft heartbeat is required. Wait for telemetry and try again.',
        409
      );
    if (aircraft.heartbeat.armed)
      throw new AircraftServiceError('Telemetry requests require a disarmed aircraft.', 409);
    if (aircraft.signing !== 'unsigned')
      throw new AircraftServiceError(
        'Signed telemetry cannot be verified by this connection. Requests are disabled.',
        409
      );
    return aircraft;
  }

  private cancelRequest(reason: string) {
    const active = this.activeRequest;
    if (!active) return;
    if (this.request?.state === 'pending')
      this.request = { ...this.request, state: 'failed', message: reason };
    active.controller.abort(new AircraftServiceError(reason, 409));
  }

  /** Explicit, bounded reporting requests only. No generic command API or automatic retry. */
  async requestTelemetry(aircraftId: string): Promise<AircraftSnapshot> {
    if (this.flightLocked())
      throw new AircraftServiceError('A physical mission run owns the aircraft link.', 409);
    if (typeof aircraftId !== 'string' || !aircraftId.length || aircraftId.length > 120)
      throw new AircraftServiceError('Choose the connected aircraft identity.');
    if (this.activeRequest || this.parameterBusy || this.radioBusy || this.missionBusy || this.logBusy)
      throw new AircraftServiceError('A telemetry request is already pending.', 409);
    if (
      this.benchShows.active ||
      this.motorTests.pending ||
      (this.motorTests.status && this.now() < this.motorTests.status.availableAt)
    )
      throw new AircraftServiceError(
        'Wait for the bench motor test to finish before requesting telemetry.',
        409
      );
    const aircraft = this.requestTarget(aircraftId);
    const connection = this.connection!;
    const startedAt = this.now();
    const active = { controller: new AbortController(), generation: this.generation };
    const signal = active.controller.signal;
    const frames = telemetryRequestFrames(aircraft.systemId, aircraft.componentId, this.sequence);
    this.sequence = (this.sequence + frames.length) % 256;
    this.activeRequest = active;
    this.request = {
      state: 'pending',
      aircraftId,
      startedAt,
      message: 'Requesting reporting streams and awaiting a matching version acknowledgement.',
    };
    const check = () => {
      signal.throwIfAborted();
      if (this.flightLocked()) throw new AircraftServiceError('A physical mission run interrupted telemetry requests.', 409);
      if (this.connection !== connection || this.generation !== active.generation)
        throw new AircraftServiceError('The aircraft link changed during the request.', 409);
      return this.requestTarget(aircraftId);
    };
    const deadline = setTimeout(() => this.cancelRequest('Telemetry request timed out.'), 8000);
    try {
      for (const frame of frames) {
        check();
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const finish = (error?: Error | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            if (error) reject(error);
            else resolve();
          };
          const abort = () =>
            finish(
              signal.reason instanceof Error
                ? signal.reason
                : new AircraftServiceError('Telemetry request cancelled.', 409)
            );
          const timer = setTimeout(
            () => finish(new AircraftServiceError('Writing the telemetry request timed out.', 504)),
            1500
          );
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) {
            abort();
            return;
          }
          try {
            connection.port.write(frame, (error) => finish(error));
            // Counts serialized bytes handed to the local serial driver, not aircraft acknowledgement.
            this.link.transmittedBytes += frame.length;
          } catch (error) {
            finish(
              new AircraftServiceError(
                message(error, 'Could not write the telemetry request.'),
                503
              )
            );
          }
        });
      }
      check();
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          clearInterval(timer);
          signal.removeEventListener('abort', abort);
          if (error) reject(error);
          else resolve();
        };
        const abort = () =>
          finish(
            signal.reason instanceof Error
              ? signal.reason
              : new AircraftServiceError('Telemetry request cancelled.', 409)
          );
        const timer = setInterval(() => {
          try {
            check();
            if (this.now() - startedAt >= 5000) finish();
          } catch (error) {
            finish(error instanceof Error ? error : new Error('Telemetry request failed.'));
          }
        }, 50);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
      const current = check();
      const fresh = (value: { receivedAt: number } | null | undefined) =>
        Boolean(
          value &&
          value.receivedAt > startedAt &&
          value.receivedAt <= this.now() &&
          this.now() - value.receivedAt <= TELEMETRY_STALE_MS
        );
      const ack = current.lastAck;
      const confirmed =
        fresh(ack) &&
        ack?.command === 512 &&
        ack.result === 0 &&
        (ack.targetSystem === 0 || ack.targetSystem === GROUND_SYSTEM_ID) &&
        (ack.targetComponent === 0 || ack.targetComponent === GROUND_COMPONENT_ID) &&
        fresh(current.version);
      const allGroups = [current.attitude, current.gps, current.position, current.battery].every(
        fresh
      );
      this.request = {
        state: confirmed ? (allGroups ? 'verified' : 'partial') : 'failed',
        aircraftId,
        startedAt,
        message: confirmed
          ? allGroups
            ? 'Bidirectional telemetry confirmed by a matching accepted acknowledgement, fresh version response, and all four reporting groups.'
            : 'Bidirectional telemetry confirmed by a matching accepted acknowledgement and fresh version response. Some reporting groups are missing or stale.'
          : 'No matching accepted acknowledgement and fresh version response arrived. Sent bytes alone do not confirm bidirectional telemetry.',
      };
      return this.snapshot();
    } catch (error) {
      if (this.request?.startedAt === startedAt && this.request.aircraftId === aircraftId)
        this.request = {
          ...this.request,
          state: 'failed',
          message: message(error, 'Telemetry request failed.'),
        };
      throw error;
    } finally {
      clearTimeout(deadline);
      if (this.activeRequest === active) this.activeRequest = undefined;
    }
  }

  /** Receiver-only check for battery-disconnected, props-off FC USB setup. */
  async requestRadioChannels(aircraftId: string): Promise<AircraftSnapshot> {
    if (this.radioBusy || this.parameterBusy || this.missionBusy || this.logBusy || this.activeRequest || this.benchShows.active ||
        this.zorroStops.active || this.motorTests.pending)
      throw new AircraftServiceError('Wait for the current aircraft operation to finish.', 409);
    const target = this.parameterTarget(aircraftId);
    const generation = this.generation;
    const startedAt = this.now();
    this.radioBusy = true;
    try {
      const sequence = this.sequence;
      this.sequence = (sequence + 1) % 256;
      await this.writeMotorFrame(radioRequestFrame(target.systemId, target.componentId, sequence));
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (generation !== this.generation) throw new AircraftServiceError('The aircraft connection changed.', 409);
        const current = this.requestTarget(aircraftId);
        if (current.receiver && current.receiver.receivedAt > startedAt &&
            current.receiver.receivedAt <= this.now() && this.now() - current.receiver.receivedAt < 3000)
          return this.snapshot();
      }
      throw new AircraftServiceError('No fresh RC channels arrived. Check Zorro power, receiver link and USB power to the receiver.', 504);
    } finally {
      this.radioBusy = false;
    }
  }

  private missionTarget(aircraftId: string) {
    const aircraft = this.requestTarget(aircraftId);
    if (aircraft.heartbeat.autopilot !== 3 || aircraft.heartbeat.vehicleType !== 2 || aircraft.protocolVersion !== 2)
      throw new AircraftServiceError('Mission preparation requires one live ArduCopter quadrotor speaking MAVLink 2.', 409);
    const now = this.now();
    const liveArduPilot = this.snapshot().aircraft.filter(item =>
      item.heartbeat.autopilot === 3 && item.heartbeat.receivedAt <= now &&
      now - item.heartbeat.receivedAt <= HEARTBEAT_STALE_MS);
    if (liveArduPilot.length !== 1)
      throw new AircraftServiceError('Mission preparation requires exactly one live ArduPilot aircraft.', 409);
    return aircraft;
  }

  private missionOperationAvailable() {
    if (this.flightLocked() || this.missionBusy || this.logBusy || this.activeRequest || this.parameterBusy || this.radioBusy ||
        this.escBusy || this.escRecoveryRequired || this.benchShows.active || this.zorroStops.active ||
        this.motorTests.pending ||
        (this.motorTests.status && this.now() < this.motorTests.status.availableAt) ||
        this.now() < this.tuneAvailableAt || this.externalBusy())
      throw new AircraftServiceError('Wait for the current aircraft operation before mission exchange.', 409);
  }

  /** Planning never writes to the aircraft and binds this exact review to this USB generation. */
  prepareMission(aircraftId: string, storyboard: Project) {
    let draft: HoverMissionDraft;
    try {
      draft = compileHoverMission(storyboard);
    } catch (error) {
      if (error instanceof MissionPlanError)
        return { eligible: false as const, reason: error.message };
      throw error;
    }
    this.missionOperationAvailable();
    if (this.missionRecoveryRequired)
      throw new AircraftServiceError('A previous mission upload is uncertain. Read back the complete mission before preparing another upload.', 409);
    this.missionTarget(aircraftId);
    const planId = randomUUID();
    this.preparedMission = { planId, aircraftId, generation: this.generation, draft };
    this.reviewedMission = this.preparedMission;
    this.prelaunchVerification = undefined;
    this.missionStatus = { state: 'planned', aircraftId, planId, message: 'Mission preview prepared. No aircraft mission has been changed.' };
    return { eligible: true as const, plan: { planId, ...draft } };
  }

  private abortMission(reason: string) {
    this.preparedMission = undefined;
    this.reviewedMission = undefined;
    this.prelaunchVerification = undefined;
    if (this.missionStatus?.state === 'uploading')
      this.missionStatus = { ...this.missionStatus, state: 'unknown', message: `${reason} Mission state may be partial; download and inspect before flight.` };
    else if (this.missionStatus?.state === 'verified')
      this.missionStatus = { ...this.missionStatus, state: 'failed', message: `${reason} Previous readback is stale; re-plan and verify on the current link.` };
    this.missionAbort?.abort(new AircraftServiceError(reason, 409));
  }

  cancelMission(planId: string) {
    if (!this.missionBusy || this.missionStatus?.planId !== planId)
      throw new AircraftServiceError('No matching mission exchange is active.', 409);
    this.abortMission('Mission exchange cancelled by the operator.');
    return this.snapshot();
  }

  private missionProtocol(aircraftId: string, generation: number): MissionProtocol {
    const target = this.missionTarget(aircraftId);
    const io: MissionIo = {
      cursor: () => this.decoder?.missionCursor?.() ?? 0,
      send: async (outbound: MissionOutbound) => {
        if (this.generation !== generation) throw new AircraftServiceError('Aircraft link changed during mission exchange.', 409);
        this.missionTarget(aircraftId);
        const frame = missionFrame(target.systemId, target.componentId, this.sequence, outbound);
        this.sequence = (this.sequence + 1) % 256;
        await this.writeMotorFrame(frame, false, false, true);
      },
      receive: async (afterId, timeoutMs, signal) => {
        const deadline = performance.now() + timeoutMs;
        while (performance.now() < deadline) {
          signal.throwIfAborted();
          if (this.generation !== generation) throw new AircraftServiceError('Aircraft link changed during mission exchange.', 409);
          this.missionTarget(aircraftId);
          const packet = this.decoder?.missionPackets?.(afterId)[0];
          if (packet) return packet;
          await new Promise<void>((resolve) => setTimeout(resolve, 25));
        }
        return null;
      },
    };
    return new MissionProtocol(io, {
      systemId: target.systemId,
      componentId: target.componentId,
      groundSystemId: GROUND_SYSTEM_ID,
      groundComponentId: GROUND_COMPONENT_ID,
    });
  }

  private hoverMissionItems(home: MissionItem, draft: HoverMissionDraft): MissionItem[] {
    // Copter 4.7 stores relative-alt frame 6 as frame 3 and serializes the
    // non-counterclockwise sign as +1 for LOITER_TIME and LAND. Send those
    // canonical values so the full readback can remain an exact comparison.
    const base = { frame: 3, current: 0, autocontinue: 1, param1: 0, param2: 0, param3: 0, param4: 0, x: 0, y: 0 };
    return [
      { ...home, seq: 0 },
      { ...base, seq: 1, command: 22, z: draft.heightM },
      { ...base, seq: 2, command: 19, param1: draft.holdSeconds, param3: 1, z: draft.heightM },
      { ...base, seq: 3, command: 21, param4: 1, z: 0 },
    ];
  }

  private freshHomeFromPosition(aircraftId: string): MissionItem {
    const target = this.missionTarget(aircraftId);
    const now = this.now();
    const gps = target.gps;
    const position = target.position;
    if (!gps || !position || gps.fixType < 3 || gps.hdop === null || gps.hdop > 1.4 ||
        gps.receivedAt > now || position.receivedAt > now ||
        now - gps.receivedAt > TELEMETRY_STALE_MS || now - position.receivedAt > TELEMETRY_STALE_MS ||
        !Number.isFinite(position.latitude) || !Number.isFinite(position.longitude) ||
        !Number.isFinite(position.altitudeMslM) || Math.abs(position.latitude) > 90 || Math.abs(position.longitude) > 180)
      throw new AircraftServiceError('The empty ArduPilot mission needs a fresh 3D GPS fix, HDOP at most 1.4, and fresh global position before a seq-0 home entry can be prepared.', 409);
    return {
      seq: 0, frame: 0, command: 16, current: 1, autocontinue: 1,
      param1: 0, param2: 0, param3: 0, param4: 0,
      x: Math.round(position.latitude * 1e7),
      y: Math.round(position.longitude * 1e7),
      z: position.altitudeMslM,
    };
  }

  private validMissionHome(home: MissionItem | undefined): home is MissionItem {
    return !!home && home.seq === 0 && home.command === 16 && [0, 3, 6].includes(home.frame) &&
      Number.isInteger(home.x) && Math.abs(home.x) <= 900_000_000 &&
      Number.isInteger(home.y) && Math.abs(home.y) <= 1_800_000_000 && Number.isFinite(home.z);
  }

  private missionHomeNearPosition(home: MissionItem, position: MissionItem): boolean {
    // Copter 4.7.1 AP_Mission::read_cmd_from_storage(0) exposes AHRS HOME,
    // which may be unset or changed independently of executable mission items.
    // Compare its global coordinates with a newly sampled, source-bound
    // GLOBAL_POSITION_INT; never accept 0,0 as a plausible launch-field HOME.
    if (home.x === 0 && home.y === 0) return false;
    const toRadians = Math.PI / 180 / 1e7;
    const latitudeDelta = (home.x - position.x) * toRadians;
    const longitudeDelta = (home.y - position.y) * toRadians;
    const homeLatitude = home.x * toRadians;
    const positionLatitude = position.x * toRadians;
    const haversine = Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(homeLatitude) * Math.cos(positionLatitude) * Math.sin(longitudeDelta / 2) ** 2;
    const distanceM = 2 * MEAN_EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(haversine)));
    return Number.isFinite(distanceM) && distanceM <= MISSION_HOME_MAX_SEPARATION_M;
  }

  /** Props-off mission storage test. Never arms, changes flight mode, or starts AUTO. */
  async uploadMission(aircraftId: string, planId: string, storyboard: Project, checks: { propsRemoved: true; confirmed: true }) {
    if (checks.propsRemoved !== true || checks.confirmed !== true)
      throw new AircraftServiceError('Confirm propellers removed and review the mission before upload.', 409);
    this.missionOperationAvailable();
    if (this.missionRecoveryRequired)
      throw new AircraftServiceError('A previous mission upload is uncertain. Read back the complete mission before retrying.', 409);
    const pending = this.preparedMission;
    if (!pending || pending.planId !== planId || pending.aircraftId !== aircraftId || pending.generation !== this.generation)
      throw new AircraftServiceError('This mission preview is stale. Re-plan against the live aircraft.', 409);
    let currentDraft: HoverMissionDraft;
    try { currentDraft = compileHoverMission(storyboard); }
    catch { throw new AircraftServiceError('The storyboard changed or is no longer eligible. Re-plan before upload.', 409); }
    if (JSON.stringify(currentDraft) !== JSON.stringify(pending.draft))
      throw new AircraftServiceError('The storyboard changed after mission review. Re-plan before upload.', 409);
    this.missionTarget(aircraftId);
    this.prelaunchVerification = undefined;
    const generation = this.generation;
    const abort = new AbortController();
    this.missionAbort = abort;
    this.missionBusy = true;
    this.missionStatus = { state: 'uploading', aircraftId, planId, message: 'Reading the existing mission before any write.' };
    let writeStarted = false;
    try {
      const protocol = this.missionProtocol(aircraftId, generation);
      const before = await protocol.download(abort.signal, 1);
      if (before.length > 1 || (before.length === 1 && before[0]?.seq !== 0))
        throw new AircraftServiceError('An existing mission is present or home-only state could not be confirmed. Lucidity will not overwrite it. Back it up and clear it through an established ground station before retrying.', 409);
      const home = before[0] ?? this.freshHomeFromPosition(aircraftId);
      if (!this.validMissionHome(home))
        throw new AircraftServiceError('The aircraft did not return a valid seq-0 home waypoint. Mission upload is blocked.', 409);
      const backupPath = resolve(this.missionBackupDirectory, `pre-upload-${Date.now()}-${randomUUID()}.json`);
      await mkdir(this.missionBackupDirectory, { recursive: true });
      await writeFile(backupPath, JSON.stringify({ aircraftId, savedAt: new Date().toISOString(), items: before }, null, 2), { flag: 'wx' });
      const items = this.hoverMissionItems(home, pending.draft);
      this.missionStatus = { state: 'uploading', aircraftId, planId, backupPath, message: 'Prior empty or home-only mission saved; uploading four reviewed items.' };
      writeStarted = true;
      await protocol.upload(items, abort.signal);
      this.missionStatus = { ...this.missionStatus, message: 'Upload accepted; downloading every item for comparison.' };
      const after = await protocol.download(abort.signal);
      const mismatch = compareMissionReadback(items, after);
      if (mismatch) throw new MissionProtocolError(`${mismatch} Upload is unverified.`, true);
      this.missionStatus = {
        state: 'verified', aircraftId, planId, missionCount: after.length, backupPath,
        message: 'Four mission items were uploaded and read back. This verifies storage only; launch and flight behavior are untested.',
      };
      this.preparedMission = undefined;
      return structuredClone(this.missionStatus);
    } catch (error) {
      const reason = message(error, 'Mission exchange failed.');
      const uncertain = writeStarted || (error instanceof MissionProtocolError && error.missionMayHaveChanged);
      if (uncertain) {
        this.missionRecoveryRequired = true;
        this.preparedMission = undefined;
        this.reviewedMission = undefined;
      }
      this.missionStatus = {
        ...(this.missionStatus || { aircraftId, planId }),
        state: uncertain ? 'unknown' : 'failed',
        message: uncertain
          ? `${reason} Aircraft mission may be partial. Do not start AUTO; use a ground station to download and inspect it.`
          : reason,
      };
      throw new AircraftServiceError(this.missionStatus.message, uncertain ? 409 : 400);
    } finally {
      if (this.missionAbort === abort) this.missionAbort = undefined;
      this.missionBusy = false;
    }
  }

  /** Fresh, read-only storage proof for a reviewed storyboard on this USB generation. Never authorizes flight. */
  async verifyMissionForLaunch(aircraftId: string, planId: string, storyboard: Project): Promise<MissionPrelaunchVerification> {
    this.prelaunchVerification = undefined;
    this.missionOperationAvailable();
    if (this.missionRecoveryRequired || this.missionStatus?.state === 'unknown')
      throw new AircraftServiceError('An earlier mission upload is uncertain. Inspect and resolve it before prelaunch verification.', 409);
    const reviewed = this.reviewedMission;
    if (!reviewed || reviewed.planId !== planId || reviewed.aircraftId !== aircraftId || reviewed.generation !== this.generation)
      throw new AircraftServiceError('The mission review belongs to an earlier connection. Re-plan on the current link.', 409);
    let currentDraft: HoverMissionDraft;
    try { currentDraft = compileHoverMission(storyboard); }
    catch { throw new AircraftServiceError('The storyboard is no longer eligible. Re-plan before verification.', 409); }
    if (JSON.stringify(currentDraft) !== JSON.stringify(reviewed.draft))
      throw new AircraftServiceError('The storyboard changed after review. Re-plan before verification.', 409);
    this.missionTarget(aircraftId);
    this.freshHomeFromPosition(aircraftId); // Require fresh GPS and position, not only a heartbeat.
    const generation = this.generation;
    const abort = new AbortController();
    this.missionAbort = abort;
    this.missionBusy = true;
    try {
      const items = await this.missionProtocol(aircraftId, generation).download(abort.signal, 4);
      if (items.length !== 4 || !this.validMissionHome(items[0]))
        throw new AircraftServiceError('Fresh readback is not a four-item mission with a valid home waypoint.', 409);
      const mismatch = compareMissionReadback(this.hoverMissionItems(items[0], reviewed.draft), items);
      if (mismatch) throw new AircraftServiceError(`Fresh mission readback differs from the reviewed storyboard: ${mismatch}`, 409);
      if (generation !== this.generation) throw new AircraftServiceError('Aircraft link changed during verification.', 409);
      this.missionTarget(aircraftId);
      const fieldPosition = this.freshHomeFromPosition(aircraftId);
      if (!this.missionHomeNearPosition(items[0], fieldPosition))
        throw new AircraftServiceError('Mission HOME is unset or more than 10 m from this aircraft’s fresh position. Keep it disarmed; inspect HOME at the field and re-read the mission.', 409);
      const proof: MissionPrelaunchVerification = {
        verificationId: randomUUID(), planId, aircraftId,
        storyboardId: reviewed.draft.storyboardId, revision: reviewed.draft.revision,
        connectionGeneration: generation, verifiedAt: this.now(),
        expiresAt: this.now() + MISSION_VERIFICATION_TTL_MS, missionCount: 4,
        heightM: reviewed.draft.heightM, holdSeconds: reviewed.draft.holdSeconds,
        message: 'Storage only: fresh mission readback matches this storyboard and HOME is within 10 m of current position. Battery, RC, failsafe, EKF and pilot checks are separate; no flight is authorized.',
      };
      this.missionStatus = {
        ...(this.missionStatus?.planId === planId ? this.missionStatus : {}),
        state: 'verified', aircraftId, planId, missionCount: 4,
        message: 'Fresh mission storage matches the reviewed storyboard on this link. This is not flight readiness.',
      };
      this.prelaunchVerification = proof;
      return structuredClone(proof);
    } catch (error) {
      if (this.missionStatus?.state === 'verified')
        this.missionStatus = { ...this.missionStatus, state: 'failed',
          message: 'Fresh prelaunch readback was not verified. No flight is authorized; inspect the stored mission.' };
      throw error;
    } finally {
      if (this.missionAbort === abort) this.missionAbort = undefined;
      this.missionBusy = false;
    }
  }

  /** Checks that a prior readback proof still belongs to this review and live link; it does not re-read the mission. */
  currentMissionVerification(verificationId: string, aircraftId: string, storyboard: Project): MissionPrelaunchVerification {
    const proof = this.prelaunchVerification;
    const review = this.reviewedMission;
    const now = this.now();
    if (!proof || proof.verificationId !== verificationId || proof.aircraftId !== aircraftId ||
        proof.connectionGeneration !== this.generation || proof.expiresAt < now ||
        !review || review.planId !== proof.planId || review.generation !== this.generation ||
        this.missionRecoveryRequired)
      throw new AircraftServiceError('Prelaunch mission verification is stale. Review and read back the mission again.', 409);
    let currentDraft: HoverMissionDraft;
    try { currentDraft = compileHoverMission(storyboard); }
    catch { throw new AircraftServiceError('The storyboard is no longer eligible. Re-plan before verification.', 409); }
    if (JSON.stringify(currentDraft) !== JSON.stringify(review.draft))
      throw new AircraftServiceError('The storyboard changed after mission verification. Re-plan and read back again.', 409);
    this.missionTarget(aircraftId);
    this.freshHomeFromPosition(aircraftId);
    return structuredClone(proof);
  }

  private launchTelemetryReady(aircraftId: string, throttleMinimum: number): string | null {
    const sample = this.snapshot();
    const now = sample.now;
    const aircraft = sample.aircraft.filter(item => item.heartbeat.autopilot === 3 &&
      item.heartbeat.receivedAt <= now && now - item.heartbeat.receivedAt <= 3000);
    if (sample.link.state !== 'listening' || aircraft.length !== 1 || aircraft[0].id !== aircraftId ||
        aircraft[0].componentId !== 1 || aircraft[0].heartbeat.vehicleType !== 2 ||
        aircraft[0].protocolVersion !== 2 || aircraft[0].signing !== 'unsigned')
      return 'One fresh, matching ArduCopter 4.7.1 aircraft is required.';
    const item = aircraft[0];
    if (item.heartbeat.armed || !['Stabilize', 'AltHold', 'Loiter'].includes(item.heartbeat.mode))
      return 'The aircraft must be disarmed in the tested pilot mode.';
    if (!item.extendedState || item.extendedState.landedState !== 1 ||
        item.extendedState.receivedAt > now || now - item.extendedState.receivedAt > 3000)
      return 'Fresh on-ground landed-state telemetry is required.';
    if (!item.gps || item.gps.fixType < 3 || item.gps.hdop === null || item.gps.hdop > 1.4 ||
        item.gps.receivedAt > now || now - item.gps.receivedAt > 3000 ||
        !item.position || item.position.receivedAt > now || now - item.position.receivedAt > 3000 ||
        !Number.isFinite(item.position.latitude) || !Number.isFinite(item.position.longitude) ||
        (item.position.latitude === 0 && item.position.longitude === 0) ||
        !Number.isFinite(item.position.relativeAltitudeM) || Math.abs(item.position.relativeAltitudeM) > 0.75)
      return 'Fresh 3D GPS, HDOP at most 1.4, and a near-home position are required.';
    const flags = item.ekfStatus?.flags;
    if (!item.ekfStatus || item.ekfStatus.receivedAt > now || now - item.ekfStatus.receivedAt > 3000 ||
        flags === undefined || (flags & (4 | 16 | 32)) !== (4 | 16 | 32) || (flags & (128 | 1024 | 32768)) !== 0)
      return 'Fresh healthy absolute-position and vertical EKF flags are required.';
    if (!item.battery || item.battery.receivedAt > now || now - item.battery.receivedAt > 3000 ||
        item.battery.voltageV === null || item.battery.voltageV < 15.2 ||
        (item.battery.remainingPercent !== null && item.battery.remainingPercent < 30))
      return 'The fresh 4S battery reading must be at least 15.2 V with no low remaining-capacity report.';
    const channels = item.receiver?.channels;
    if (!item.receiver || item.receiver.receivedAt > now || now - item.receiver.receivedAt > 3000 ||
        !channels || channels.length < 6 || channels.slice(0, 6).some(value => value === null || !Number.isFinite(value)) ||
        channels[2]! > throttleMinimum + 80 || channels[5]! >= 1300)
      return 'Fresh receiver channels, minimum throttle, and inactive RC6 motor stop are required.';
    if (!item.version || !item.version.flightVersion.startsWith('4.7.1') ||
        item.version.receivedAt > now || now - item.version.receivedAt > 15_000)
      return 'A fresh ArduCopter 4.7.1 version response is required.';
    return null;
  }

  /** Read-only field gate. The returned proof is short-lived and belongs to this exact link and review. */
  async checkMissionLaunch(aircraftId: string, planId: string, storyboard: Project) {
    this.flightPreflight = undefined;
    this.missionOperationAvailable();
    this.missionTarget(aircraftId);
    const generation = this.generation;
    const names = [
      'ARMING_SKIPCHK', 'FRAME_CLASS', 'AUTO_OPTIONS', 'FS_THR_ENABLE', 'FS_THR_VALUE',
      'RC_FS_TIMEOUT', 'FS_GCS_ENABLE', 'FS_OPTIONS', 'FS_EKF_ACTION',
      'BATT_MONITOR', 'BATT_CAPACITY', 'BATT_LOW_VOLT', 'BATT_LOW_TIMER', 'BATT_FS_LOW_ACT',
      'RC6_OPTION', 'DISARM_DELAY', 'FENCE_ENABLE', 'MAV_OPTIONS',
      'FLTMODE_CH', 'FLTMODE1', 'FLTMODE2', 'FLTMODE3', 'FLTMODE4',
      'FLTMODE5', 'FLTMODE6', 'RC3_MIN',
    ];
    for (let offset = 0; offset < names.length; offset += 16)
      await this.readParameters(aircraftId, names.slice(offset, offset + 16));
    if (generation !== this.generation) throw new AircraftServiceError('The aircraft link changed during launch checks.', 409);
    const values = new Map(this.parameters(aircraftId).parameters.map(parameter => [parameter.name, parameter]));
    const value = (name: string) => {
      const parameter = values.get(name);
      if (!parameter || !Number.isFinite(parameter.value) ||
          parameter.receivedAt > this.now() || this.now() - parameter.receivedAt > 45_000)
        throw new AircraftServiceError(`${name} has no fresh readback; physical launch is blocked.`, 409);
      return parameter.value;
    };
    if (value('ARMING_SKIPCHK') !== 0)
      throw new AircraftServiceError('ARMING_SKIPCHK must be 0: do not skip ArduPilot arming checks for the first hover.', 409);
    if (value('FRAME_CLASS') !== 1)
      throw new AircraftServiceError('FRAME_CLASS must identify the reviewed Quad frame (1).', 409);
    if (value('AUTO_OPTIONS') !== 0)
      throw new AircraftServiceError('AUTO_OPTIONS differs from the simulator-tested first-hover contract (0).', 409);
    if (value('FS_THR_ENABLE') !== 3) {
      const configured = value('FS_THR_ENABLE');
      const action = configured === 1 ? 'RTL' : configured === 0 ? 'disabled' : 'another action';
      throw new AircraftServiceError(`RC-loss is configured as FS_THR_ENABLE=${configured} (${action}); this first short hover requires LAND (3). Review it with the pilot; Lucidity will not change it.`, 409);
    }
    if (value('FS_THR_VALUE') < 910 || value('FS_THR_VALUE') > 1100 ||
        value('RC3_MIN') <= value('FS_THR_VALUE') + 10 ||
        value('RC_FS_TIMEOUT') < 0.2 || value('RC_FS_TIMEOUT') > 3 ||
        (value('FS_OPTIONS') & 1) !== 0 || ![1, 3].includes(value('FS_EKF_ACTION')))
      throw new AircraftServiceError('Review FS_THR_VALUE, RC3_MIN, RC_FS_TIMEOUT, FS_OPTIONS and FS_EKF_ACTION: the throttle threshold, RC-loss behavior or EKF LAND action differs from this first-hover setup.', 409);
    // Lucidity does not yet emit a GCS HEARTBEAT. Reading this value does not
    // prove GCS-loss protection, even if the aircraft has FS_GCS_ENABLE set.
    if (![0, 1, 3, 4, 5, 6, 7].includes(value('FS_GCS_ENABLE')))
      throw new AircraftServiceError('GCS failsafe configuration could not be reviewed.', 409);
    if (value('BATT_LOW_TIMER') <= 0)
      throw new AircraftServiceError('BATT_LOW_TIMER=0 disables low-voltage errors. Configure and verify a positive delay before this first hover; Lucidity will not change it.', 409);
    if (value('BATT_LOW_TIMER') > 10)
      throw new AircraftServiceError(`BATT_LOW_TIMER=${value('BATT_LOW_TIMER')} seconds is too long for this short show; review a delay of at most 10 seconds with the pilot.`, 409);
    if (value('BATT_MONITOR') <= 0 || value('BATT_CAPACITY') !== 650 ||
        value('BATT_LOW_VOLT') < 13.8 || value('BATT_LOW_VOLT') > 14.2 ||
        value('BATT_FS_LOW_ACT') !== 1)
      throw new AircraftServiceError('The monitored 4S 650 mAh battery must retain its reviewed 14.0 V LAND action with at most a 10-second low-voltage delay.', 409);
    const modes = [1, 2, 3, 4, 5, 6].map(slot => value(`FLTMODE${slot}`));
    if (value('RC6_OPTION') !== 31 || value('DISARM_DELAY') < 5 || value('DISARM_DELAY') > 15 ||
        value('FENCE_ENABLE') !== 0 || (value('MAV_OPTIONS') & 1) !== 0 ||
        value('FLTMODE_CH') !== 5 || ![0, 2, 5].every(mode => modes.includes(mode)))
      throw new AircraftServiceError('The RC stop, programmed flight-mode options, fence or MAVLink command settings differ from the reviewed test setup. Accessible Zorro switch positions require a separate pilot check.', 409);
    // Version is a one-shot response, so refresh it after sequential parameter
    // reads instead of relying on the operator's earlier setup session.
    const telemetry = await this.requestTelemetry(aircraftId);
    if (telemetry.request?.state !== 'verified')
      throw new AircraftServiceError('The fresh bidirectional telemetry request did not verify version and reporting streams. Resolve the link before flight.', 409);
    const prearmCursor = this.decoder?.commandAckCursor?.();
    const prearmAt = this.now();
    await this.runPrearmChecks(aircraftId);
    let prearmAccepted = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (generation !== this.generation) throw new AircraftServiceError('The aircraft link changed during pre-arm checks.', 409);
      const ack = prearmCursor === undefined ? [] : this.decoder?.commandAcks?.(prearmCursor, aircraftId) ?? [];
      const matched = ack.find(item => item.command === 401 && item.receivedAt >= prearmAt &&
        item.targetSystem === GROUND_SYSTEM_ID && item.targetComponent === GROUND_COMPONENT_ID &&
        item.sourceSystem === this.missionTarget(aircraftId).systemId && item.sourceComponent === 1 && item.result !== 5);
      if (matched) { prearmAccepted = matched.result === 0; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!prearmAccepted) throw new AircraftServiceError('No matching accepted pre-arm check acknowledgement arrived.', 409);
    // COMMAND_ACK confirms that Copter processed RUN_PREARM_CHECKS; it is not
    // itself proof that every ArduPilot arming check passed.
    await new Promise(resolve => setTimeout(resolve, 250));
    const warning = this.decoder?.snapshot().aircraft.find(item => item.id === aircraftId)?.messages
      .find(item => item.receivedAt >= prearmAt && /\b(?:PreArm|Arm):/i.test(item.text));
    if (warning) throw new AircraftServiceError(`The aircraft reports ${warning.text}; resolve it before flight.`, 409);
    const beforeReadback = this.launchTelemetryReady(aircraftId, value('RC3_MIN'));
    if (beforeReadback) throw new AircraftServiceError(beforeReadback, 409);
    const proof = await this.verifyMissionForLaunch(aircraftId, planId, storyboard);
    const finalCheck = this.launchTelemetryReady(aircraftId, value('RC3_MIN'));
    if (finalCheck) throw new AircraftServiceError(finalCheck, 409);
    const observedAt = this.now();
    this.flightPreflight = {
      verificationId: proof.verificationId, aircraftId, generation, observedAt,
      expiresAt: Math.min(proof.expiresAt, observedAt + 15_000),
    };
    return {
      ready: true as const, verificationId: proof.verificationId, expiresAt: this.flightPreflight.expiresAt,
      message: 'Fresh mission, RC, EKF, low-battery delay and key Copter settings checked. Accessible Zorro mode positions and pilot qualification remain operator confirmations; GCS-link loss is not verified as an automatic LAND trigger.',
    };
  }

  private physicalLaunchAdapter(aircraftId: string, generation: number): PhysicalLaunchAdapter {
    const target = this.decoder?.snapshot().aircraft.find(item => item.id === aircraftId);
    if (!target || !this.link.path) throw new AircraftServiceError('The reviewed aircraft link is gone.', 409);
    const systemId = target.systemId;
    const componentId = target.componentId;
    return {
      kind: 'physical-serial', transport: 'usb-serial', endpoint: this.link.path,
      groundSystemId: GROUND_SYSTEM_ID, groundComponentId: GROUND_COMPONENT_ID,
      sample: () => ({
        now: this.now(), linkGeneration: this.generation, linkState: this.link.state,
        aircraft: this.decoder?.snapshot().aircraft ?? [],
      }),
      commandAckCursor: () => this.decoder?.commandAckCursor?.() ?? 0,
      commandAcks: (afterId, id) => this.decoder?.commandAcks?.(afterId, id) ?? [],
      sendCommand: async command => {
        if (generation !== this.generation || this.link.state !== 'listening' ||
            command.targetSystem !== systemId || command.targetComponent !== componentId)
          throw new AircraftServiceError('Physical command target or link changed.', 409);
        const frame = flightCommandFrame(command as FlightCommand, this.sequence);
        this.sequence = (this.sequence + 1) % 256;
        await this.writeMotorFrame(frame, false, false, false, true);
      },
      waitForUpdate: async timeoutMs => { await new Promise(resolve => setTimeout(resolve, Math.max(1, Math.min(100, timeoutMs)))); },
    };
  }

  async launchMission(aircraftId: string, storyboard: Project, verificationId: string,
    checks: { propsInstalled: true; areaClear: true; pilotReady: true; modeSwitchReady: true }) {
    if (Object.values(checks).some(value => value !== true))
      throw new AircraftServiceError('Confirm props, clear field, qualified pilot and working mode switch.', 409);
    if (this.flightLocked() || this.missionBusy || this.logBusy || this.activeRequest || this.parameterBusy || this.radioBusy ||
        this.escBusy || this.benchShows.active || this.zorroStops.active || this.motorTests.pending)
      throw new AircraftServiceError('Another aircraft operation or unresolved flight run is active.', 409);
    const preflight = this.flightPreflight;
    const proof = this.currentMissionVerification(verificationId, aircraftId, storyboard);
    if (!preflight || preflight.verificationId !== proof.verificationId ||
        preflight.aircraftId !== aircraftId || preflight.generation !== this.generation ||
        preflight.expiresAt < this.now() || this.now() - preflight.observedAt > 15_000)
      throw new AircraftServiceError('Field launch check expired. Check the mission and aircraft again.', 409);
    const throttleMinimum = this.parameters(aircraftId).parameters.find(item => item.name === 'RC3_MIN')?.value;
    if (throttleMinimum === undefined) throw new AircraftServiceError('Receiver calibration readback is missing.', 409);
    const blocked = this.launchTelemetryReady(aircraftId, throttleMinimum);
    if (blocked) throw new AircraftServiceError(blocked, 409);
    const review = this.reviewedMission!;
    const evidence: PhysicalPreflightEvidence = {
      kind: 'physical-live', verificationId, aircraftId, linkGeneration: this.generation,
      observedAt: this.now(), expiresAt: Math.min(proof.expiresAt, this.now() + 3000),
      gpsHomeEkfHealthy: true, batteryHealthy: true,
      receiverAndFailsafesChecked: true, pilotTakeoverRouteChecked: true,
    };
    this.flightStarting = true;
    this.flightPreflight = undefined; // one launch attempt per proof
    try {
      const runId = randomUUID();
      await this.journalFlightAttempt(aircraftId, runId);
      const runner = new PhysicalLaunchTransaction(this.physicalLaunchAdapter(aircraftId, this.generation));
      this.flightRun = runner;
      this.watchFlightRun();
      return await runner.launch({
        proof, review: { planId: review.planId, storyboardId: review.draft.storyboardId,
          revision: review.draft.revision }, preflight: evidence,
      }, runId);
    } catch (error) {
      // After a durable journal exists, a constructor/adapter exception is an
      // uncertain attempt even if no in-memory transaction survived.
      if (existsSync(this.flightJournalPath)) {
        this.flightRecoveryRequired = true;
        this.flightRun = undefined;
        if (this.flightObservationTimer) clearInterval(this.flightObservationTimer);
        this.flightObservationTimer = undefined;
      }
      throw error;
    } finally { this.flightStarting = false; }
  }

  async landMission(runId: string) {
    const status = this.flightRunStatus();
    if (!this.flightRun || !runId || status.runId !== runId)
      throw new AircraftServiceError('No matching active physical run exists.', 409);
    return this.flightRun.land();
  }

  /** Recovery is observation-only and requires an explicit props-off physical check. */
  async reconcileMissionRun(aircraftId: string, checks: { propsRemoved: true; confirmed: true }) {
    if (checks.propsRemoved !== true || checks.confirmed !== true)
      throw new AircraftServiceError('Remove every propeller and confirm the aircraft is safe before recovery.', 409);
    const previous = this.flightRunStatus();
    if (previous.state !== 'unknown' && !(previous.state === 'rejected' && previous.issuedCommands.length > 0))
      throw new AircraftServiceError('No uncertain physical run needs reconciliation.', 409);
    const aircraft = this.missionTarget(aircraftId);
    const now = this.now();
    if (aircraft.heartbeat.armed || aircraft.heartbeat.receivedAt > now || now - aircraft.heartbeat.receivedAt > 3000 ||
        !aircraft.extendedState || aircraft.extendedState.landedState !== 1 ||
        aircraft.extendedState.receivedAt > now || now - aircraft.extendedState.receivedAt > 3000 ||
        !aircraft.position || aircraft.position.receivedAt > now || now - aircraft.position.receivedAt > 3000 ||
        Math.abs(aircraft.position.relativeAltitudeM) > 0.75)
      throw new AircraftServiceError('Fresh disarmed, on-ground and near-home telemetry is required before recovery.', 409);
    let journal: FlightRunJournal;
    try {
      journal = JSON.parse(await readFile(this.flightJournalPath, 'utf8')) as FlightRunJournal;
    } catch {
      throw new AircraftServiceError('The physical run journal cannot be read. Keep flight launch locked until the interrupted run is inspected.', 409);
    }
    if (!Number.isInteger(journal.systemId) || !Number.isInteger(journal.componentId) ||
        journal.systemId !== aircraft.systemId || journal.componentId !== aircraft.componentId)
      throw new AircraftServiceError('The live flight controller system/component does not match the interrupted run journal.', 409);
    if (journal.uid && (!aircraft.version || aircraft.version.uid !== journal.uid ||
        aircraft.version.receivedAt > now || now - aircraft.version.receivedAt > 15_000))
      throw new AircraftServiceError('A fresh flight-controller UID does not match the interrupted run. Reconnect the original aircraft before recovery.', 409);
    try { await unlink(this.flightJournalPath); }
    catch { throw new AircraftServiceError('The interrupted-run journal could not be cleared; no new launch is allowed.', 409); }
    this.flightRun = undefined;
    this.flightRecoveryRequired = false;
    this.flightPreflight = undefined;
    this.reviewedMission = undefined;
    this.prelaunchVerification = undefined;
    return { recovered: true as const, message: journal.uid
      ? 'Uncertain run closed after matching flight-controller UID and fresh props-off ground observation. Prepare and review a new mission before flight.'
      : 'Uncertain run closed after matching MAVLink system/component and fresh props-off ground observation. This aircraft did not report a stable UID, so physical identity was operator-confirmed rather than cryptographically proven. Prepare and review a new mission before flight.' };
  }

  /** A fresh full readback for recovery; it never claims an uncertain upload is safe to fly. */
  async readMission(aircraftId: string) {
    this.missionOperationAvailable();
    this.missionTarget(aircraftId);
    const generation = this.generation;
    const abort = new AbortController();
    this.missionAbort = abort;
    this.missionBusy = true;
    try {
      const items = await this.missionProtocol(aircraftId, generation).download(abort.signal);
      if (this.missionRecoveryRequired && (items.length === 0 || (items.length === 1 && this.validMissionHome(items[0])))) {
        this.missionRecoveryRequired = false;
        this.missionStatus = { state: 'failed', aircraftId, planId: null, missionCount: items.length,
          message: 'Fresh empty or home-only mission readback recovered the storage state. Re-plan before another upload; no flight is authorized.' };
      }
      if (this.missionStatus?.state === 'verified') {
        const review = this.reviewedMission;
        const matches = review?.aircraftId === aircraftId && review.generation === generation &&
          items.length === 4 && this.validMissionHome(items[0]) &&
          !compareMissionReadback(this.hoverMissionItems(items[0], review.draft), items);
        if (!matches) {
          this.prelaunchVerification = undefined;
          this.missionStatus = { ...this.missionStatus, state: 'failed',
            message: 'Fresh mission readback differs from the reviewed storyboard. Previous verification is stale; no flight is authorized.' };
        }
      }
      return { aircraftId, count: items.length, items, message: 'Mission readback only. Review each item before flight; readback does not validate a flight plan.' };
    } finally {
      if (this.missionAbort === abort) this.missionAbort = undefined;
      this.missionBusy = false;
    }
  }
}
