import type { AircraftSnapshot, AircraftTelemetry } from './types';

/** Observation only. It neither sends MAVLink nor authorizes a physical launch. */
export type FlightProgressState = 'pending' | 'active' | 'takeover' | 'uncertain' | 'landed';

export interface FlightProgress {
  state: FlightProgressState;
  reason: string;
  aircraftId: string;
  linkGeneration: number;
  startedAt: number;
  observedAt: number;
  lastHeartbeatAt: number | null;
  activeAt: number | null;
  maxMissionSeq: number;
  maxReachedSeq: number;
  lastCurrentAt: number | null;
  lastAdvanceAt: number | null;
  lastReachedAt: number | null;
  finalCurrentAt: number | null;
  missionResetAt: number | null;
  airborneAt: number | null;
  disarmedAt: number | null;
}

export interface FlightProgressSample {
  now: number;
  linkGeneration: number;
  linkState: AircraftSnapshot['link']['state'];
  aircraft: AircraftTelemetry | null;
}

const EXPECTED_MISSION_COUNT = 4; // HOME, TAKEOFF, LOITER_TIME, LAND
const FINAL_SEQUENCE = EXPECTED_MISSION_COUNT - 1;
const HEARTBEAT_MAX_AGE_MS = 3000;
const POSITION_MAX_AGE_MS = 3000;
const EXTENDED_STATE_MAX_AGE_MS = 3000;
const PROGRESS_EVENT_MAX_AGE_MS = 3000;
const PENDING_TIMEOUT_MS = 15_000;
const FLIGHT_TIMEOUT_MS = 90_000;
const ACTIVE_SENSOR_GRACE_MS = 5000;
const PROGRESS_STALL_TIMEOUT_MS = 30_000;
const LANDING_EVIDENCE_TIMEOUT_MS = 5000;
const POST_LAND_RESET_GRACE_MS = 3000;
const PILOT_MODES = new Set(['Stabilize', 'Acro', 'AltHold', 'Loiter', 'PosHold', 'Brake']);

const fresh = (receivedAt: number, now: number, startedAt: number, maxAge: number) =>
  Number.isFinite(receivedAt) && receivedAt >= startedAt && receivedAt <= now && now - receivedAt <= maxAge;

const uncertain = (previous: FlightProgress, now: number, reason: string): FlightProgress => ({
  ...previous,
  state: 'uncertain',
  observedAt: Number.isFinite(now) ? now : previous.observedAt,
  reason,
});

export function beginFlightProgress(aircraftId: string, linkGeneration: number, startedAt: number): FlightProgress {
  if (!aircraftId || !Number.isSafeInteger(linkGeneration) || linkGeneration < 0 || !Number.isFinite(startedAt))
    throw new Error('Flight observation needs a specific aircraft, link generation, and start time.');
  return {
    state: 'pending', reason: 'Waiting for fresh AUTO mission progress.',
    aircraftId, linkGeneration, startedAt, observedAt: startedAt,
    lastHeartbeatAt: null, activeAt: null,
    maxMissionSeq: -1, maxReachedSeq: -1, lastCurrentAt: null, lastAdvanceAt: null, lastReachedAt: null,
    finalCurrentAt: null, missionResetAt: null, airborneAt: null, disarmedAt: null,
  };
}

/** Pure reducer for a future simulator runner. Uncertain and landed are terminal. */
export function observeFlightProgress(previous: FlightProgress, sample: FlightProgressSample): FlightProgress {
  if (previous.state === 'uncertain' || previous.state === 'landed') return previous;
  const { now, linkGeneration, linkState, aircraft } = sample;
  if (!Number.isFinite(now) || now < previous.observedAt)
    return uncertain(previous, now, 'Observation clock moved backward or became invalid.');
  if (linkGeneration !== previous.linkGeneration || linkState !== 'listening')
    return uncertain(previous, now, 'Aircraft link was lost or its generation changed; do not resume automatically.');
  if (!aircraft || aircraft.id !== previous.aircraftId)
    return uncertain(previous, now, 'The expected aircraft identity is no longer present.');
  const heartbeat = aircraft.heartbeat;
  if (!fresh(heartbeat.receivedAt, now, previous.startedAt - HEARTBEAT_MAX_AGE_MS, HEARTBEAT_MAX_AGE_MS))
    return uncertain(previous, now, 'Aircraft heartbeat is stale or in the future.');
  if (previous.lastHeartbeatAt !== null && heartbeat.receivedAt < previous.lastHeartbeatAt)
    return uncertain(previous, now, 'Aircraft heartbeat timestamp moved backward.');
  if (now - previous.startedAt > FLIGHT_TIMEOUT_MS)
    return uncertain(previous, now, 'Flight exceeded the bounded observation window.');

  const next: FlightProgress = { ...previous, observedAt: now, lastHeartbeatAt: heartbeat.receivedAt };
  const position = aircraft.position;
  const extended = aircraft.extendedState;
  const freshPosition = !!position && fresh(position.receivedAt, now, previous.startedAt, POSITION_MAX_AGE_MS) &&
    Number.isFinite(position.relativeAltitudeM);
  const freshExtended = !!extended && fresh(extended.receivedAt, now, previous.startedAt, EXTENDED_STATE_MAX_AGE_MS);
  const current = aircraft.missionCurrent;
  if (current && fresh(current.receivedAt, now, previous.startedAt, PROGRESS_EVENT_MAX_AGE_MS) &&
      (next.lastCurrentAt === null || current.receivedAt > next.lastCurrentAt)) {
    // Copter 4.7.1 SITL reports total=3 for HOME+three executable items;
    // other senders include HOME and report 4. Zero means extension absent.
    if (!Number.isInteger(current.seq) || current.seq < 0 || current.seq > FINAL_SEQUENCE ||
        (current.total !== 0 && current.total !== EXPECTED_MISSION_COUNT && current.total !== EXPECTED_MISSION_COUNT - 1))
      return uncertain(next, now, 'Aircraft reported a different or invalid mission sequence.');
    if (heartbeat.armed && heartbeat.mode === 'Auto' && current.seq < next.maxMissionSeq) {
      // Copter resets its mission during NAV_LAND disarm, while the latest
      // heartbeat may still say armed. Defer only this precise near-ground
      // terminal reset; a later disarmed heartbeat is still required.
      const terminalReset = current.seq === 1 && next.maxMissionSeq === FINAL_SEQUENCE &&
        next.finalCurrentAt !== null && current.receivedAt > next.finalCurrentAt &&
        next.maxReachedSeq >= FINAL_SEQUENCE - 1 && next.airborneAt !== null &&
        heartbeat.receivedAt < current.receivedAt && freshPosition && freshExtended &&
        extended!.landedState === 1 && extended.receivedAt >= next.finalCurrentAt &&
        position!.receivedAt >= next.finalCurrentAt && Math.abs(position.relativeAltitudeM) <= 0.75;
      if (!terminalReset) return uncertain(next, now, 'AUTO mission sequence moved backward.');
      next.missionResetAt ??= current.receivedAt;
    }
    if (current.seq > next.maxMissionSeq) next.lastAdvanceAt = current.receivedAt;
    next.lastCurrentAt = current.receivedAt;
    next.maxMissionSeq = Math.max(next.maxMissionSeq, current.seq);
    if (current.seq === FINAL_SEQUENCE && next.finalCurrentAt === null)
      next.finalCurrentAt = current.receivedAt;
  }
  const reached = aircraft.missionItemReached;
  if (reached && fresh(reached.receivedAt, now, previous.startedAt, PROGRESS_EVENT_MAX_AGE_MS) &&
      (next.lastReachedAt === null || reached.receivedAt > next.lastReachedAt)) {
    if (!Number.isInteger(reached.seq) || reached.seq < 0 || reached.seq > FINAL_SEQUENCE ||
        reached.seq < next.maxReachedSeq)
      return uncertain(next, now, 'Aircraft reported an invalid or regressing reached item.');
    next.lastReachedAt = reached.receivedAt;
    next.maxReachedSeq = reached.seq;
  }

  const autoNow = heartbeat.armed && heartbeat.mode === 'Auto' &&
    heartbeat.receivedAt >= previous.startedAt && next.maxMissionSeq >= 1;
  if (next.state === 'pending' && autoNow) {
    next.state = 'active';
    next.activeAt = now;
    next.reason = 'AUTO mission progress observed; flight outcome is still pending.';
  }
  if ((next.state === 'active' || next.state === 'takeover') && heartbeat.armed &&
      now - (next.activeAt ?? now) > ACTIVE_SENSOR_GRACE_MS && (!freshPosition || !freshExtended))
    return uncertain(next, now, 'Position or landed-state telemetry is stale during the run.');
  if (next.missionResetAt !== null && heartbeat.armed) {
    if (heartbeat.receivedAt >= next.missionResetAt || now - next.missionResetAt > POST_LAND_RESET_GRACE_MS)
      return uncertain(next, now, 'Mission reset was not followed by a timely disarmed heartbeat.');
    next.reason = 'Near-ground mission reset observed; awaiting a fresh disarmed heartbeat.';
    return next;
  }
  if (next.state === 'active' && heartbeat.armed && next.lastAdvanceAt !== null &&
      now - next.lastAdvanceAt > PROGRESS_STALL_TIMEOUT_MS)
    return uncertain(next, now, 'AUTO mission sequence stopped advancing.');
  if (next.state === 'active' && freshPosition && freshExtended &&
      extended!.landedState === 2 && position!.relativeAltitudeM >= 0.5)
    next.airborneAt ??= Math.max(extended!.receivedAt, position!.receivedAt);

  if (next.state === 'active' && !heartbeat.armed) {
    if (next.missionResetAt !== null && heartbeat.receivedAt <= next.missionResetAt) {
      if (now - next.missionResetAt > POST_LAND_RESET_GRACE_MS)
        return uncertain(next, now, 'Mission reset lacked a fresh disarmed heartbeat.');
      next.reason = 'Waiting for a disarmed heartbeat newer than the mission reset.';
      return next;
    }
    if (heartbeat.mode !== 'Auto')
      return uncertain(next, now, 'Disarmed outside AUTO; autonomous mission completion is unverified.');
    next.disarmedAt ??= heartbeat.receivedAt;
    // Copter 4.7.1 SITL emits REACHED for TAKEOFF and LOITER_TIME, but not
    // necessarily for final LAND. Current LAND plus the prior reached item is
    // the mission progression evidence; disarmed/on-ground/altitude confirm rest.
    if (next.airborneAt !== null && next.finalCurrentAt !== null &&
        next.maxReachedSeq >= FINAL_SEQUENCE - 1 && freshPosition && freshExtended &&
        extended!.landedState === 1 && extended!.receivedAt >= next.finalCurrentAt &&
        position!.receivedAt >= next.finalCurrentAt && Math.abs(position!.relativeAltitudeM) <= 0.75) {
      next.state = 'landed';
      next.reason = 'Mission progressed through LAND; fresh telemetry confirms disarmed and on ground.';
      return next;
    }
    if (now - next.disarmedAt > LANDING_EVIDENCE_TIMEOUT_MS)
      return uncertain(next, now, 'Disarmed, but final mission and landed-state evidence did not arrive.');
    next.reason = 'Disarmed; waiting briefly for fresh ground and mission-completion evidence.';
    return next;
  }

  if (next.state === 'takeover') {
    if (!heartbeat.armed)
      return uncertain(next, now, 'Pilot takeover ended; automated mission completion is unverified.');
    if (heartbeat.mode === 'Auto')
      return uncertain(next, now, 'AUTO resumed after takeover without a new reviewed observation.');
    next.reason = 'AUTO exited; pilot or failsafe control must be managed outside this observer.';
    return next;
  }
  if (next.state === 'active' && heartbeat.mode !== 'Auto') {
    if (!PILOT_MODES.has(heartbeat.mode))
      return uncertain(next, now, `AUTO exited into ${heartbeat.mode}; control source is unknown.`);
    next.state = 'takeover';
    next.reason = `AUTO exited into ${heartbeat.mode}; pilot control must be confirmed independently.`;
    return next;
  }
  if (next.state === 'pending' && now - previous.startedAt > PENDING_TIMEOUT_MS)
    return uncertain(next, now, 'No fresh AUTO mission progress arrived before the start deadline.');
  return next;
}
