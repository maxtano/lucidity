import type { EscInspection } from './esc-types';
import type { EscStartupStatus } from './esc-startup-types';
import type { BenchShowStatus } from './bench-show-plan';
import type { PhysicalLaunchStatus } from './physical-launch-transaction';

/** Ephemeral hardware telemetry. Never part of a creative Project or its undo history. */
export interface AircraftTelemetry {
  id: string;
  systemId: number;
  componentId: number;
  protocolVersion: 1 | 2;
  signing: 'unsigned' | 'unverified';
  heartbeat: {
    receivedAt: number;
    armed: boolean;
    mode: string;
    customMode: number;
    systemStatus: string;
    autopilot: number;
    vehicleType: number;
  };
  attitude: { receivedAt: number; rollDeg: number; pitchDeg: number; yawDeg: number } | null;
  gps: {
    receivedAt: number;
    fix: string;
    fixType: number;
    satellites: number | null;
    latitude: number | null;
    longitude: number | null;
    hdop: number | null;
  } | null;
  position: {
    receivedAt: number;
    latitude: number;
    longitude: number;
    relativeAltitudeM: number;
    altitudeMslM: number;
    groundSpeedMps: number;
  } | null;
  battery: {
    receivedAt: number;
    voltageV: number | null;
    currentA: number | null;
    remainingPercent: number | null;
  } | null;
  messages: { receivedAt: number; severity: number; text: string }[];
  version?: { receivedAt: number; flightVersion: string; releaseType: number; uid?: string };
  health?: { receivedAt: number; present: number; enabled: number; healthy: number; loadPercent: number };
  receiver?: { receivedAt: number; channels: (number | null)[]; rssi: number | null };
  power?: { receivedAt: number; boardVoltageV: number; flags: number };
  lastAck?: {
    receivedAt: number;
    command: number;
    result: number;
    targetSystem: number;
    targetComponent: number;
  };
  /** Motor-test ACK is separate from information requests; it is not proof of movement. */
  lastMotorAck?: AircraftTelemetry['lastAck'];
  lastArmAck?: AircraftTelemetry['lastAck'];
  lastPrearmAck?: AircraftTelemetry['lastAck'];
  /** Latest source-bound mission progress; callers must check receivedAt. */
  missionCurrent?: {
    receivedAt: number;
    seq: number;
    total: number;
    state: number;
    mode: number;
    missionId: number;
  };
  missionItemReached?: { receivedAt: number; seq: number };
  extendedState?: { receivedAt: number; landedState: number; vtolState: number };
  /** Source-bound ArduPilot EKF_STATUS_REPORT; callers must check freshness and flags. */
  ekfStatus?: { receivedAt: number; flags: number };
}

/** Bounded decoder event. A matching ACK confirms a command result, not flight completion. */
export interface AircraftCommandAckEvent {
  id: number;
  aircraftId: string;
  sourceSystem: number;
  sourceComponent: number;
  receivedAt: number;
  command: number;
  result: number;
  progress: number | null;
  resultParam2: number;
  targetSystem: number;
  targetComponent: number;
}

export interface ZorroStopStatus {
  runId: string;
  aircraftId: string;
  storyboardId: string;
  revision: number;
  state: 'arming' | 'running' | 'stopping' | 'completed' | 'cancelled' | 'failed';
  startedAt: number | null;
  elapsedMs: number;
  message: string;
}

export interface AircraftSnapshot {
  now: number;
  link: {
    state: 'disconnected' | 'connecting' | 'listening' | 'error';
    path: string | null;
    baudRate: number;
    connectedAt: number | null;
    error: string | null;
    bytesReceived: number;
    packetsReceived: number;
    invalidFrames: number;
    lastPacketAt: number | null;
    transmittedBytes: number;
  };
  aircraft: AircraftTelemetry[];
  request?: {
    state: 'pending' | 'verified' | 'partial' | 'failed';
    aircraftId: string;
    startedAt: number;
    message: string;
  };
  esc?: EscInspection;
  escStartup?: EscStartupStatus;
  benchShow?: BenchShowStatus;
  zorroStop?: ZorroStopStatus;
  motorTest?: {
    state: 'pending' | 'accepted' | 'rejected' | 'unconfirmed' | 'stop-requested';
    aircraftId: string;
    motor: number;
    startedAt: number;
    availableAt: number;
    message: string;
  };
  mission?: {
    state: 'planned' | 'uploading' | 'verified' | 'unknown' | 'failed';
    aircraftId: string;
    planId: string | null;
    message: string;
    missionCount?: number;
    backupPath?: string;
  };
  flightRun?: PhysicalLaunchStatus;
}

export interface AircraftPort {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
}

export const HEARTBEAT_STALE_MS = 5000;
export const TELEMETRY_STALE_MS = 5000;
