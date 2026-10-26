import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Activity, ArrowRight, Check, Circle, Play, Radio, RefreshCw, ShieldCheck, Usb } from 'lucide-react';
import type { AircraftPort, AircraftSnapshot, AircraftTelemetry } from '../aircraft/types';
import type { MissionPrelaunchVerification } from '../aircraft/service';
import { compileHoverMission, type HoverMissionDraft } from '../aircraft/mission-plan';
import type { MissionItem } from '../aircraft/mission-protocol';
import type { Project } from '../core/model';
import { totalDuration } from '../core/model';
import { Modal } from './Modal';
import './FlightMissionPanel.css';

const DEFAULT_PORT = '/dev/cu.usbmodem11401';
const HEARTBEAT_STALE_MS = 5000;

interface MissionPlan extends HoverMissionDraft { planId: string }

interface PlanResponse {
  eligible: boolean;
  reason?: string;
  plan?: MissionPlan;
}

interface UploadResponse {
  state: 'verified' | 'failed';
  missionCount: number;
  message: string;
}

interface ReadbackResponse {
  aircraftId: string;
  count: number;
  items: MissionItem[];
  message: string;
}

interface LaunchCheckResponse {
  ready: true;
  verificationId: string;
  expiresAt: number;
  message: string;
}

interface FlightRunStatus {
  runId: string | null;
  aircraftId?: string | null;
  planId?: string | null;
  state: 'idle' | 'resetting' | 'arming' | 'starting' | 'active' | 'takeover' | 'landing' | 'landed' | 'rejected' | 'unknown';
  reason: string;
  issuedCommands: number[];
  progress: unknown | null;
}

type FieldCheck = 'propsInstalled' | 'areaClear' | 'pilotReady' | 'modeSwitchReady';
const emptyFieldChecks: Record<FieldCheck, boolean> = {
  propsInstalled: false, areaClear: false, pilotReady: false, modeSwitchReady: false,
};

/** UI affordance only; the service must independently enforce every launch gate. */
export function flightMissionLaunchReady(input: {
  check: LaunchCheckResponse | null;
  checkedConnectionAt: number | null;
  connectedAt: number | null | undefined;
  checkedAircraftId: string;
  aircraftId: string | undefined;
  checkedPlanId: string;
  planId: string | undefined;
  checks: Record<FieldCheck, boolean>;
  now: number;
  live: boolean;
  pending: boolean;
  uncertain: boolean;
  runState: FlightRunStatus['state'];
  runCommandsIssued: number;
}): boolean {
  return Boolean(input.check?.ready && input.check.verificationId &&
    input.now < input.check.expiresAt &&
    input.live && !input.pending && !input.uncertain &&
    ['idle', 'landed', 'rejected'].includes(input.runState) &&
    !(input.runState === 'rejected' && input.runCommandsIssued > 0) &&
    input.connectedAt != null && input.checkedConnectionAt === input.connectedAt &&
    input.aircraftId && input.checkedAircraftId === input.aircraftId &&
    input.planId && input.checkedPlanId === input.planId &&
    Object.values(input.checks).every(Boolean));
}

export function flightMissionLandAvailable(
  status: FlightRunStatus | null,
  snapshot: AircraftSnapshot | null,
  aircraft: AircraftTelemetry | undefined,
  now: number,
): boolean {
  const liveQuads = snapshot?.aircraft.filter((item) =>
    item.heartbeat.autopilot === 3 && item.heartbeat.vehicleType === 2 &&
    now >= item.heartbeat.receivedAt && now - item.heartbeat.receivedAt < HEARTBEAT_STALE_MS) ?? [];
  return Boolean(status?.state === 'active' && status.runId && status.aircraftId &&
    snapshot?.link.state === 'listening' && liveQuads.length === 1 &&
    aircraft && aircraft.id === status.aircraftId && liveQuads[0].id === aircraft.id &&
    aircraft.protocolVersion === 2 && aircraft.signing === 'unsigned' &&
    aircraft.heartbeat.armed && aircraft.heartbeat.mode === 'Auto');
}

/** UI affordance for an observation-only interrupted-run recovery. The service rechecks these facts. */
export function flightMissionRecoveryAvailable(
  status: FlightRunStatus | null,
  snapshot: AircraftSnapshot | null,
  aircraft: AircraftTelemetry | undefined,
  now: number,
  selectedAircraftId?: string,
): boolean {
  const interrupted = status?.state === 'unknown' ||
    (status?.state === 'rejected' && status.issuedCommands.length > 0);
  const liveQuads = snapshot?.aircraft.filter((item) =>
    item.heartbeat.autopilot === 3 && item.heartbeat.vehicleType === 2 &&
    now >= item.heartbeat.receivedAt && now - item.heartbeat.receivedAt < 3000) ?? [];
  return Boolean(interrupted && selectedAircraftId && snapshot?.link.state === 'listening' &&
    liveQuads.length === 1 && aircraft && liveQuads[0].id === aircraft.id &&
    aircraft.id === selectedAircraftId &&
    aircraft.protocolVersion === 2 &&
    aircraft.signing === 'unsigned' && !aircraft.heartbeat.armed &&
    aircraft.extendedState?.landedState === 1 && now >= aircraft.extendedState.receivedAt &&
    now - aircraft.extendedState.receivedAt < 3000 &&
    aircraft.position && now >= aircraft.position.receivedAt &&
    now - aircraft.position.receivedAt < 3000 &&
    Math.abs(aircraft.position.relativeAltitudeM) <= 0.75);
}

export function flightMissionRecoveryDisconnectAvailable(
  status: FlightRunStatus | null,
  propsRemoved: boolean,
  groundConfirmed: boolean,
): boolean {
  return Boolean(propsRemoved && groundConfirmed && status &&
    (status.state === 'unknown' || (status.state === 'rejected' && status.issuedCommands.length > 0)));
}

/** Match the service's validMissionHome check before lifting a local recovery block. */
export function missionReadbackClearForReplan(readback: Pick<ReadbackResponse, 'count' | 'items'>): boolean {
  const home = readback.items[0];
  return (readback.count === 0 && readback.items.length === 0) ||
    (readback.count === 1 && readback.items.length === 1 &&
      home.seq === 0 && home.command === 16 && [0, 3, 6].includes(home.frame) &&
      Number.isInteger(home.x) && Math.abs(home.x) <= 900_000_000 &&
      Number.isInteger(home.y) && Math.abs(home.y) <= 1_800_000_000 && Number.isFinite(home.z));
}

async function readJson<T>(response: Response): Promise<T> {
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new Error(`Aircraft service returned an unreadable response (${response.status}).`); }
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error : `Aircraft service request failed (${response.status}).`;
    throw new Error(message);
  }
  return body as T;
}

export function flightMissionHardwareReady(
  snapshot: AircraftSnapshot | null,
  aircraft: AircraftTelemetry | undefined,
  now: number,
  serviceError = '',
): boolean {
  const liveQuads = snapshot?.aircraft.filter((item) =>
    item.heartbeat.autopilot === 3 && item.heartbeat.vehicleType === 2 &&
    now >= item.heartbeat.receivedAt && now - item.heartbeat.receivedAt < HEARTBEAT_STALE_MS) ?? [];
  return !serviceError && snapshot?.link.state === 'listening' && liveQuads.length === 1 && Boolean(
    aircraft && liveQuads[0]?.id === aircraft.id && aircraft.protocolVersion === 2 &&
    aircraft.signing === 'unsigned' && !aircraft.heartbeat.armed &&
    now - aircraft.heartbeat.receivedAt < HEARTBEAT_STALE_MS &&
    now >= aircraft.heartbeat.receivedAt
  );
}

/** This is a short-lived storage observation, never permission to arm or start AUTO. */
export function flightMissionStorageProofCurrent(
  proof: MissionPrelaunchVerification | null,
  context: {
    project: Pick<Project, 'id' | 'revision'>;
    plan: MissionPlan | undefined;
    aircraftId: string | undefined;
    connectedAt: number | null | undefined;
    verifiedConnectionAt: number | null;
    now: number;
    live: boolean;
    missionState: AircraftSnapshot['mission'] | undefined;
  },
): boolean {
  return Boolean(proof && context.live && context.plan && context.aircraftId &&
    context.connectedAt != null && context.connectedAt === context.verifiedConnectionAt &&
    context.missionState?.state === 'verified' && context.missionState.planId === proof.planId &&
    context.missionState.aircraftId === proof.aircraftId &&
    proof.planId === context.plan.planId && proof.aircraftId === context.aircraftId &&
    context.plan.storyboardId === context.project.id && context.plan.revision === context.project.revision &&
    proof.storyboardId === context.project.id && proof.revision === context.project.revision &&
    proof.heightM === context.plan.heightM && proof.holdSeconds === context.plan.holdSeconds &&
    proof.missionCount === 4 && context.now >= proof.verifiedAt && context.now < proof.expiresAt);
}

export function FlightMissionPanel({ project, saved = true, onClose }: {
  project: Project;
  saved?: boolean;
  onClose: () => void;
}) {
  const [ports, setPorts] = useState<AircraftPort[]>([]);
  const [path, setPath] = useState(DEFAULT_PORT);
  const [snapshot, setSnapshot] = useState<AircraftSnapshot | null>(null);
  const [snapshotObservedAt, setSnapshotObservedAt] = useState(Date.now);
  const [clock, setClock] = useState(Date.now);
  const [serviceError, setServiceError] = useState('');
  const [actionError, setActionError] = useState('');
  const [pending, setPending] = useState<'connect' | 'disconnect' | 'plan' | 'upload' | 'readback' | 'verify' | 'launch-check' | 'launch' | 'land' | 'refresh-status' | 'reconcile' | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [qgcClosed, setQgcClosed] = useState(false);
  const [propsRemoved, setPropsRemoved] = useState(false);
  const [uploadConfirmed, setUploadConfirmed] = useState(false);
  const [assignedId, setAssignedId] = useState('');
  const [planResponse, setPlanResponse] = useState<PlanResponse | null>(null);
  const [uploadResponse, setUploadResponse] = useState<UploadResponse | null>(null);
  const [plannedConnectionAt, setPlannedConnectionAt] = useState<number | null>(null);
  const [plannedAircraftId, setPlannedAircraftId] = useState('');
  const [uploadedConnectionAt, setUploadedConnectionAt] = useState<number | null>(null);
  const [uploadUncertain, setUploadUncertain] = useState(false);
  const [readbackResult, setReadbackResult] = useState<ReadbackResponse | null>(null);
  const [storageProof, setStorageProof] = useState<MissionPrelaunchVerification | null>(null);
  const [storageProofConnectionAt, setStorageProofConnectionAt] = useState<number | null>(null);
  const [fieldChecks, setFieldChecks] = useState<Record<FieldCheck, boolean>>(emptyFieldChecks);
  const [launchCheck, setLaunchCheck] = useState<LaunchCheckResponse | null>(null);
  const [launchCheckConnectionAt, setLaunchCheckConnectionAt] = useState<number | null>(null);
  const [launchCheckAircraftId, setLaunchCheckAircraftId] = useState('');
  const [launchCheckPlanId, setLaunchCheckPlanId] = useState('');
  const [runStatus, setRunStatus] = useState<FlightRunStatus | null>(null);
  const [runStatusError, setRunStatusError] = useState('');
  const [launchUncertain, setLaunchUncertain] = useState(false);
  const [recoveryPropsRemoved, setRecoveryPropsRemoved] = useState(false);
  const [recoveryGroundConfirmed, setRecoveryGroundConfirmed] = useState(false);
  const [recoverySelection, setRecoverySelection] = useState<{ id: string; connectedAt: number } | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const mounted = useRef(false);
  const activeAction = useRef<AbortController | null>(null);
  const runSection = useRef<HTMLElement | null>(null);

  const peakM = useMemo(() => Math.max(0, ...project.cues.flatMap((cue) =>
    cue.droneEdits?.['1']?.keyframes?.map((key) => key.position?.[2] ?? 0) ?? [])), [project]);
  const offlineReview = useMemo(() => {
    try { return { draft: compileHoverMission(project), error: '' }; }
    catch (error) { return { draft: null, error: error instanceof Error ? error.message : 'This storyboard cannot be planned.' }; }
  }, [project]);
  const now = snapshot ? snapshot.now + Math.max(0, clock - snapshotObservedAt) : clock;
  // DroneBridge can emit its own heartbeat. Offer only a physical ArduCopter quad.
  const eligibleAircraft = snapshot?.aircraft.filter((aircraft) =>
    aircraft.heartbeat.autopilot === 3 && aircraft.heartbeat.vehicleType === 2) ?? [];
  const candidate = eligibleAircraft.find((aircraft) => aircraft.id === assignedId);
  const runningAircraft = eligibleAircraft.find((aircraft) => aircraft.id === runStatus?.aircraftId);
  const recoveryCandidates = eligibleAircraft.filter((aircraft) =>
    snapshot?.link.state === 'listening' && aircraft.protocolVersion === 2 &&
    aircraft.signing === 'unsigned' && !aircraft.heartbeat.armed &&
    now >= aircraft.heartbeat.receivedAt && now - aircraft.heartbeat.receivedAt < 3000);
  const recoveryAircraft = recoveryCandidates.find((aircraft) =>
    aircraft.id === recoverySelection?.id && snapshot?.link.connectedAt === recoverySelection.connectedAt);
  const firstAircraft = eligibleAircraft[0];
  const live = flightMissionHardwareReady(snapshot, candidate, now, serviceError);
  const plan = planResponse?.eligible ? planResponse.plan : undefined;
  const planMatches = Boolean(plan && live && plannedConnectionAt !== null &&
    plan.storyboardId === project.id && plan.revision === project.revision &&
    plannedConnectionAt === snapshot?.link.connectedAt && plannedAircraftId === candidate?.id);
  const recoveryRequired = Boolean(runStatus && (runStatus.state === 'unknown' ||
    (runStatus.state === 'rejected' && runStatus.issuedCommands.length > 0)));
  const runInProgress = Boolean(runStatus && (!['idle', 'landed', 'rejected'].includes(runStatus.state) || recoveryRequired));
  const canDisconnectForRecovery = flightMissionRecoveryDisconnectAvailable(
    runStatus, recoveryPropsRemoved, recoveryGroundConfirmed);
  const canPlan = saved && Boolean(offlineReview.draft) && Boolean(candidate) && live && !pending && !runInProgress &&
    snapshot?.mission?.state !== 'uploading' && snapshot?.mission?.state !== 'unknown' && !uploadUncertain;
  const canUpload = canPlan && planMatches && propsRemoved && uploadConfirmed && !uploadResponse && !uploadUncertain;
  const verified = uploadResponse?.state === 'verified';
  const verifiedOnCurrentLink = verified && planMatches && uploadedConnectionAt === snapshot?.link.connectedAt && live &&
    snapshot?.mission?.state === 'verified' && snapshot.mission.planId === plan?.planId;
  const storageProofCurrent = flightMissionStorageProofCurrent(storageProof, {
    project, plan, aircraftId: candidate?.id, connectedAt: snapshot?.link.connectedAt,
    verifiedConnectionAt: storageProofConnectionAt, now, live,
    missionState: snapshot?.mission,
  });
  const storageProofAwaitingStatus = Boolean(storageProof && snapshot && snapshot.now <= storageProof.verifiedAt);
  const canVerifyStorage = planMatches && live && !pending && !uploadUncertain && !runInProgress &&
    snapshot?.mission?.state !== 'uploading' && snapshot?.mission?.state !== 'unknown';
  const previewHasPath = project.cues.some((cue) => Boolean(cue.droneEdits?.['1']?.keyframes?.some((key) => key.position)));
  const connected = snapshot?.link.state === 'listening' || snapshot?.link.state === 'connecting';
  const runState = runStatus?.state ?? 'unknown';
  const allFieldChecks = Object.values(fieldChecks).every(Boolean);
  const canCheckLaunch = planMatches && live && !propsRemoved && allFieldChecks && !pending && !uploadUncertain &&
    !launchUncertain && ['idle', 'landed', 'rejected'].includes(runState) &&
    !(runState === 'rejected' && (runStatus?.issuedCommands.length ?? 0) > 0) &&
    snapshot?.mission?.state !== 'uploading' &&
    snapshot?.mission?.state !== 'unknown';
  const canLaunch = !propsRemoved && flightMissionLaunchReady({
    check: launchCheck, checkedConnectionAt: launchCheckConnectionAt,
    connectedAt: snapshot?.link.connectedAt, checkedAircraftId: launchCheckAircraftId,
    aircraftId: candidate?.id, checkedPlanId: launchCheckPlanId, planId: plan?.planId,
    checks: fieldChecks, now, live, pending: Boolean(pending || runStatusError || serviceError),
    uncertain: launchUncertain, runState, runCommandsIssued: runStatus?.issuedCommands.length ?? 0,
  });
  const canLand = !pending && !runStatusError && !serviceError &&
    flightMissionLandAvailable(runStatus, snapshot, runningAircraft, now);
  const canReconcileInterrupted = !pending && !runStatusError && !serviceError &&
    recoveryPropsRemoved && recoveryGroundConfirmed &&
    flightMissionRecoveryAvailable(runStatus, snapshot, recoveryAircraft, now, recoverySelection?.id);

  const refreshPorts = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await readJson<{ ports: AircraftPort[] }>(await fetch('/api/aircraft/ports', {
        cache: 'no-store', signal,
      }));
      if (!signal?.aborted && mounted.current) setPorts(result.ports);
    } catch (error) {
      if (!signal?.aborted && mounted.current) setActionError(error instanceof Error ? error.message : 'Could not find serial ports.');
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void refreshPorts(controller.signal);
    const clockTimer = window.setInterval(() => setClock(Date.now()), 500);
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const latest = await readJson<AircraftSnapshot>(await fetch('/api/aircraft/status', {
          cache: 'no-store', signal: controller.signal,
        }));
        if (!controller.signal.aborted) {
          setSnapshot(latest);
          setSnapshotObservedAt(Date.now());
          setServiceError('');
        }
      } catch (error) {
        if (!controller.signal.aborted) setServiceError(error instanceof Error ? error.message : 'Could not read live aircraft status.');
      } finally {
        try {
          const latest = await readJson<FlightRunStatus>(await fetch('/api/aircraft/mission/launch-status', {
            cache: 'no-store', signal: controller.signal,
          }));
          if (!controller.signal.aborted) { setRunStatus(latest); setRunStatusError(''); }
        } catch (error) {
          if (!controller.signal.aborted) {
            setRunStatusError(error instanceof Error ? error.message : 'Could not confirm the flight state.');
            setRunStatus((previous) => previous && !['idle', 'landed', 'rejected'].includes(previous.state)
              ? { ...previous, state: 'unknown', reason: 'Flight state cannot be confirmed. Use your Zorro and ground station.' }
              : previous);
          }
        }
        if (!controller.signal.aborted) pollTimer = setTimeout(poll, 750);
      }
    };
    void poll();
    return () => {
      mounted.current = false;
      controller.abort();
      activeAction.current?.abort();
      window.clearInterval(clockTimer);
      clearTimeout(pollTimer);
    };
  }, [refreshPorts]);

  // A proof from an interrupted link or restarted service must not revive if telemetry returns.
  useEffect(() => {
    if (storageProof && snapshot && snapshot.now > storageProof.verifiedAt &&
      (!live || snapshot.link.connectedAt !== storageProofConnectionAt ||
      snapshot?.mission?.state !== 'verified' || snapshot.mission.planId !== storageProof.planId)) {
      setStorageProof(null);
      setStorageProofConnectionAt(null);
    }
  }, [storageProof, storageProofConnectionAt, live, snapshot?.link.connectedAt, snapshot?.mission]);

  const post = async <T,>(route: string, body: unknown, action: NonNullable<typeof pending>): Promise<T | null> => {
    if (activeAction.current) return null;
    const controller = new AbortController();
    activeAction.current = controller;
    setPending(action);
    setActionError('');
    try {
      return await readJson<T>(await fetch(`/api/aircraft/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Lucidity-Aircraft': '1' },
        body: JSON.stringify(body),
        signal: controller.signal,
      }));
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) setActionError(error instanceof Error ? error.message : 'Aircraft request failed.');
      return null;
    } finally {
      if (activeAction.current === controller) activeAction.current = null;
      if (mounted.current) setPending(null);
    }
  };

  const connect = async () => {
    if (!qgcClosed || !ports.some((port) => port.path === path) || pending || connected) return;
    await post('connect', { path, baudRate: 115200 }, 'connect');
  };
  const disconnect = async () => {
    if (!connected || pending || (runInProgress && !canDisconnectForRecovery)) return;
    const result = await post<AircraftSnapshot>('disconnect', {}, 'disconnect');
    if (!result || !mounted.current) return;
    setSnapshot(result); setSnapshotObservedAt(Date.now());
    setAssignedId(''); setPlanResponse(null); setUploadResponse(null); setUploadConfirmed(false);
    setPlannedConnectionAt(null); setPlannedAircraftId(''); setUploadedConnectionAt(null); setUploadUncertain(false); setReadbackResult(null);
    setStorageProof(null); setStorageProofConnectionAt(null);
    setLaunchCheck(null); setLaunchCheckConnectionAt(null); setLaunchCheckAircraftId(''); setLaunchCheckPlanId('');
    setFieldChecks(emptyFieldChecks);
    setPropsRemoved(false);
    setRecoveryPropsRemoved(false); setRecoveryGroundConfirmed(false); setRecoverySelection(null);
  };
  const reviewMission = async () => {
    if (!canPlan || !candidate) return;
    setPlanResponse(null); setUploadResponse(null); setUploadConfirmed(false);
    setPlannedConnectionAt(null); setPlannedAircraftId(''); setUploadedConnectionAt(null); setUploadUncertain(false); setReadbackResult(null);
    setStorageProof(null); setStorageProofConnectionAt(null);
    setLaunchCheck(null); setLaunchCheckConnectionAt(null); setLaunchCheckAircraftId(''); setLaunchCheckPlanId('');
    const result = await post<PlanResponse>('mission/plan', {
      aircraftId: candidate.id, storyboard: structuredClone(project),
    }, 'plan');
    if (result && mounted.current) {
      setPlanResponse(result);
      setPlannedConnectionAt(snapshot?.link.connectedAt ?? null);
      setPlannedAircraftId(candidate.id);
    }
  };
  const upload = async () => {
    if (!canUpload || !candidate || !plan) return;
    setReadbackResult(null); setStorageProof(null); setStorageProofConnectionAt(null);
    setLaunchCheck(null);
    const result = await post<UploadResponse>('mission/upload', {
      aircraftId: candidate.id, planId: plan.planId, storyboard: structuredClone(project),
      propsRemoved: true, confirmed: true,
    }, 'upload');
    if (result && mounted.current) {
      setUploadResponse(result);
      setUploadedConnectionAt(snapshot?.link.connectedAt ?? null);
    } else if (mounted.current) setUploadUncertain(true);
    setUploadConfirmed(false);
    setPropsRemoved(false);
  };
  const cancelUpload = async () => {
    if (cancelPending || !plan || snapshot?.mission?.state !== 'uploading' || snapshot.mission.planId !== plan.planId) return;
    setCancelPending(true);
    setUploadUncertain(true);
    try {
      await readJson(await fetch('/api/aircraft/mission/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lucidity-Aircraft': '1' },
        body: JSON.stringify({ planId: plan.planId }),
      }));
    } catch (error) {
      if (mounted.current) setActionError(error instanceof Error ? error.message : 'Cancellation not confirmed. Mission state is unknown.');
    } finally { if (mounted.current) setCancelPending(false); }
  };
  const readbackMission = async () => {
    if (!candidate || !live || pending || snapshot?.mission?.state === 'uploading') return;
    setStorageProof(null); setStorageProofConnectionAt(null);
    setLaunchCheck(null);
    const result = await post<ReadbackResponse>('mission/readback', { aircraftId: candidate.id }, 'readback');
    if (!result || !mounted.current) return;
    setReadbackResult(result);
    if (missionReadbackClearForReplan(result)) {
      setUploadUncertain(false);
      setPlanResponse(null);
      setUploadResponse(null);
      setPlannedConnectionAt(null);
      setPlannedAircraftId('');
      setUploadedConnectionAt(null);
    }
  };
  const verifyStoredMission = async () => {
    if (!canVerifyStorage || !candidate || !plan) return;
    setStorageProof(null); setStorageProofConnectionAt(null);
    const result = await post<MissionPrelaunchVerification>('mission/verify', {
      aircraftId: candidate.id, planId: plan.planId, storyboard: structuredClone(project),
    }, 'verify');
    if (result && mounted.current) {
      setStorageProof(result);
      setStorageProofConnectionAt(snapshot?.link.connectedAt ?? null);
    }
  };
  const checkLaunch = async () => {
    if (!canCheckLaunch || !candidate || !plan) return;
    setLaunchCheck(null); setLaunchCheckConnectionAt(null); setLaunchCheckAircraftId(''); setLaunchCheckPlanId('');
    const result = await post<LaunchCheckResponse>('mission/launch-check', {
      aircraftId: candidate.id, planId: plan.planId, storyboard: structuredClone(project),
    }, 'launch-check');
    if (result?.ready && mounted.current) {
      setLaunchCheck(result);
      setLaunchCheckConnectionAt(snapshot?.link.connectedAt ?? null);
      setLaunchCheckAircraftId(candidate.id);
      setLaunchCheckPlanId(plan.planId);
    }
  };
  const launchFlight = async () => {
    if (!canLaunch || !candidate || !plan || !launchCheck) return;
    const result = await post<FlightRunStatus>('mission/launch', {
      aircraftId: candidate.id, storyboard: structuredClone(project),
      verificationId: launchCheck.verificationId,
      checks: { propsInstalled: true, areaClear: true, pilotReady: true, modeSwitchReady: true },
    }, 'launch');
    setLaunchCheck(null); setLaunchCheckConnectionAt(null); setFieldChecks(emptyFieldChecks);
    if (result && mounted.current) setRunStatus(result);
    else if (mounted.current) setLaunchUncertain(true);
  };
  const landFlight = async () => {
    if (!canLand || !runStatus?.runId) return;
    const result = await post<FlightRunStatus>('mission/land', { runId: runStatus.runId }, 'land');
    if (result && mounted.current) setRunStatus(result);
    else if (mounted.current) {
      setLaunchUncertain(true);
      setRunStatus((previous) => previous ? { ...previous, state: 'unknown', reason: 'LAND result is unconfirmed. Use your Zorro and ground station.' } : previous);
    }
  };
  const reconcileFlight = async () => {
    if (pending || !launchUncertain) return;
    const controller = new AbortController();
    activeAction.current = controller;
    setPending('refresh-status');
    setActionError('');
    try {
      const result = await readJson<FlightRunStatus>(await fetch('/api/aircraft/mission/launch-status', {
        cache: 'no-store', signal: controller.signal,
      }));
      if (!mounted.current || controller.signal.aborted) return;
      setRunStatus(result);
      setRunStatusError('');
      if (['idle', 'landed'].includes(result.state) ||
        (result.state === 'rejected' && result.issuedCommands.length === 0)) {
        setLaunchUncertain(false);
      } else setActionError('Flight is not confirmed landed or idle. Refreshing status does not clear an interrupted run; use pilot control, then props-off recovery.');
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) setActionError(error instanceof Error ? error.message : 'Could not reconcile flight state.');
    } finally {
      if (activeAction.current === controller) activeAction.current = null;
      if (mounted.current) setPending(null);
    }
  };
  const reconcileInterruptedRun = async () => {
    if (!canReconcileInterrupted || !recoveryAircraft) return;
    const aircraftId = recoveryAircraft.id;
    setRecoveryMessage('');
    const result = await post<{ recovered: true; message: string }>('mission/reconcile', {
      aircraftId, propsRemoved: true, confirmed: true,
    }, 'reconcile');
    setRecoveryPropsRemoved(false);
    setRecoveryGroundConfirmed(false);
    setRecoverySelection(null);
    if (!result?.recovered || !mounted.current) return;
    setRecoveryMessage(result.message);
    setRunStatus(null);
    setLaunchUncertain(false);
    setLaunchCheck(null); setLaunchCheckConnectionAt(null); setLaunchCheckAircraftId(''); setLaunchCheckPlanId('');
    setStorageProof(null); setStorageProofConnectionAt(null);
    setPlanResponse(null); setUploadResponse(null); setUploadConfirmed(false);
    setPlannedConnectionAt(null); setPlannedAircraftId(''); setUploadedConnectionAt(null);
    setFieldChecks(emptyFieldChecks);
  };
  const requestClose = () => {
    if (pending === 'upload' || snapshot?.mission?.state === 'uploading') {
      setActionError('Mission upload is still in progress. Wait for readback; if the page is interrupted, treat mission state as unknown.');
      return false;
    }
    if (pending === 'launch' || pending === 'land') {
      setActionError('Wait for the flight command result. If the page loses contact, use your Zorro and ground station.');
      return false;
    }
    if (runInProgress) {
      setActionError('Flight is not confirmed landed. Keep this monitor open and be ready to take control with the Zorro. Closing a page does not stop the aircraft.');
      return false;
    }
    onClose();
    return true;
  };
  const openRadioSetup = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (requestClose()) window.location.hash = '/tools/receiver';
  };

  return <Modal title="Flight readiness" onClose={requestClose}>
    <div className="flight-mission-panel">
      <div className="flight-mission-banner">
        <span className="flight-mission-tag">ONE-DRONE FLIGHT</span>
        <strong>{project.name}</strong>
        {runInProgress
          ? <button type="button" className="flight-mission-simulation" onClick={() => runSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Flight {runState} · view controls</button>
          : <span className="flight-mission-simulation">Mission review · guarded flight</span>}
      </div>

      <ol className="flight-mission-steps" aria-label="Flight preparation stages">
        <li className="is-current"><span>1</span> Preview</li>
        <li className={live ? 'is-current' : ''}><span>2</span> Connect</li>
        <li className={planMatches ? 'is-current' : ''}><span>3</span> Review mission</li>
        <li className={storageProofCurrent ? 'is-current' : ''}><span>4</span> Store · verify</li>
        <li className={canLaunch || runInProgress ? 'is-current' : ''}><span>5</span> Field run</li>
      </ol>

      <div className="flight-mission-grid">
        <section className="flight-mission-card" aria-labelledby="flight-preview-heading">
          <header><span>01 / DESIGN</span><h3 id="flight-preview-heading">Preview the path</h3></header>
          {previewHasPath ? <div className="flight-mission-route" aria-label={`Storyboard design: ground, rise to ${peakM.toFixed(2)} meters, return to ground.`}>
            <span>Ground</span><i aria-hidden="true">↗</i><strong>{peakM.toFixed(2)} m</strong><i aria-hidden="true">↘</i><span>Ground</span>
          </div> : <div className="flight-mission-route" role="note">No explicit one-drone altitude path in this storyboard.</div>}
          <p>{totalDuration(project)} s authored timing. The aircraft mission may have different timing; review its commands below.</p>
          {previewHasPath && peakM < 2 && <p className="flight-mission-warning" role="note">This low hover is a design study. Exact near-ground height has not been validated for this aircraft.</p>}
        </section>

        <section className="flight-mission-card" aria-labelledby="flight-connect-heading">
          <header><span>02 / AIRCRAFT</span><h3 id="flight-connect-heading">Connect your drone</h3></header>
          <label className="flight-mission-field">USB serial port
            <span><select aria-label="Ground radio serial port" value={path} disabled={Boolean(connected || pending)} onChange={(event) => setPath(event.target.value)}>
              {ports.some((port) => port.path === path) ? null : <option value={path}>{path} · not detected</option>}
              {ports.map((port) => <option value={port.path} key={port.path}>{port.path}</option>)}
            </select><button type="button" title="Rescan ports" aria-label="Rescan ports" onClick={() => void refreshPorts()}><RefreshCw size={15} /></button></span>
          </label>
          <div className="flight-mission-checks">
            <label><input type="checkbox" checked={qgcClosed} onChange={(event) => setQgcClosed(event.target.checked)} /> QGroundControl is closed</label>
          </div>
          <div className="flight-mission-actions"><button type="button" onClick={() => void connect()} disabled={Boolean(connected || pending || !qgcClosed || !ports.some((port) => port.path === path))}><Usb size={15} /> {pending === 'connect' ? 'Connecting…' : 'Connect drone'}</button>
            {connected && <button type="button" className="flight-mission-secondary" disabled={Boolean(pending || (runInProgress && !canDisconnectForRecovery))} onClick={() => void disconnect()}>Disconnect</button>}
          </div>
          <p>Connect and assign while disarmed. Propellers may be installed for read-only planning and mission checks.</p>
          <p className={live ? 'flight-mission-ok' : 'flight-mission-muted'} role="status">
            {live ? <><Check size={15} /> System {candidate!.systemId} · fresh heartbeat · disarmed</>
              : connected ? eligibleAircraft.length ? 'Listening. Assign a live, disarmed aircraft before planning.' : 'Listening; waiting for an ArduCopter quad heartbeat.' : 'No live aircraft assigned.'}
          </p>
          {firstAircraft && !assignedId && <button type="button" className="flight-mission-secondary" onClick={() => { setAssignedId(firstAircraft.id); setPlanResponse(null); setUploadResponse(null); }}>Assign system {firstAircraft.systemId}</button>}
          {assignedId && <p className="flight-mission-muted">Assigned: {candidate ? `system ${candidate.systemId}` : 'aircraft unavailable'} · GPS {candidate?.gps?.fix ?? 'unknown'} · mode {candidate?.heartbeat.mode ?? 'unknown'}</p>}
        </section>

        <section className="flight-mission-card" aria-labelledby="flight-review-heading">
          <header><span>03 / REVIEW</span><h3 id="flight-review-heading">Inspect the aircraft mission</h3></header>
          <p>Local command preview first; then verify the plan against the connected drone.</p>
          {offlineReview.error && <p className="flight-mission-warning" role="status">{offlineReview.error}</p>}
          {offlineReview.draft && <div className="flight-mission-plan">
            <p><ShieldCheck size={15} /> {planMatches ? 'Bound to live aircraft' : 'Local preview only'} · {offlineReview.draft.heightM.toFixed(1)} m above home · {offlineReview.draft.holdSeconds.toFixed(0)} s hold</p>
            <ol>{offlineReview.draft.items.map((item) => <li key={item.seq}><span>{item.seq}</span>{item.label}{item.command === 22 ? ` · ${item.altitudeM.toFixed(1)} m` : item.command === 19 ? ` · ${item.holdSeconds?.toFixed(0)} s` : ''}</li>)}</ol>
            <p className="flight-mission-warning">{offlineReview.draft.warning}</p>
          </div>}
          <button type="button" disabled={!canPlan} onClick={() => void reviewMission()}><Activity size={15} /> {pending === 'plan' ? 'Verifying…' : 'Verify plan with drone'}</button>
          {!saved && <p className="flight-mission-warning">Save this storyboard locally before planning.</p>}
          {planResponse && !planResponse.eligible && <p className="flight-mission-warning" role="status">{planResponse.reason ?? 'This storyboard is not eligible for hardware mission planning.'}</p>}
          {plan && planMatches && <p className="flight-mission-ok" role="status"><Check size={15} /> Plan bound to system {candidate?.systemId}. Upload with props off, or check a stored mission read-only.</p>}
        </section>

        <section className="flight-mission-card" aria-labelledby="flight-upload-heading">
          <header><span>04 / MISSION STORAGE</span><h3 id="flight-upload-heading">Upload, then check at the field</h3></header>
          <h4 className="flight-mission-phase">Props off · upload</h4>
          <p>While disarmed, upload the reviewed mission once. Lucidity checks existing storage first and refuses to replace an authored mission.</p>
          <label className="flight-mission-confirm"><input type="checkbox" checked={propsRemoved} onChange={(event) => { setPropsRemoved(event.target.checked); setUploadConfirmed(false); setLaunchCheck(null); }} /> Every propeller is physically removed for this upload.</label>
          <label className="flight-mission-confirm"><input type="checkbox" checked={uploadConfirmed} disabled={!planMatches || !live || !propsRemoved || Boolean(uploadResponse)} onChange={(event) => setUploadConfirmed(event.target.checked)} /> I reviewed the mission and confirm this props-off upload.</label>
          <button type="button" disabled={!canUpload} onClick={() => void upload()}><Radio size={15} /> {pending === 'upload' ? 'Uploading and verifying…' : 'Upload & verify with props off'}</button>
          {snapshot?.mission?.state === 'uploading' && plan && snapshot.mission.planId === plan.planId &&
            <button type="button" className="flight-mission-secondary" disabled={cancelPending} onClick={() => void cancelUpload()}>{cancelPending ? 'Cancelling…' : 'Cancel exchange'}</button>}
          {uploadResponse && <p className={verifiedOnCurrentLink ? 'flight-mission-ok' : 'flight-mission-warning'} role="status">{verified ? <Check size={15} /> : <Circle size={15} />} {uploadResponse.message}{verified && !verifiedOnCurrentLink ? ' Current link or mission status needs a fresh check.' : ''}</p>}
          <h4 className="flight-mission-phase">At the field · read-only check</h4>
          <p>At the field, inspect stored items here if useful. Flight readiness repeats this readback just before Run.</p>
          <button type="button" className="flight-mission-secondary" disabled={!canVerifyStorage} title="Read-only download of all four mission items; sends no ARM or AUTO command." onClick={() => void verifyStoredMission()}><ShieldCheck size={15} /> {pending === 'verify' ? 'Checking stored mission…' : 'Verify stored mission'}</button>
          {storageProof && <p className={storageProofCurrent ? 'flight-mission-ok' : storageProofAwaitingStatus ? 'flight-mission-muted' : 'flight-mission-warning'} role="status">{storageProofCurrent ? <Check size={15} /> : <Circle size={15} />} {storageProofCurrent
            ? `Storage only: ${storageProof.missionCount} items match this storyboard. Expires in ${Math.ceil((storageProof.expiresAt - now) / 1000)} s. No flight authorized.`
            : storageProofAwaitingStatus ? 'Readback matched; refreshing live link status. No flight authorized.'
              : 'Stored-mission check expired or no longer matches this live link and storyboard. Verify again; no flight authorized.'}</p>}
          {(uploadUncertain || snapshot?.mission?.state === 'unknown') && <>
            <p className="flight-mission-warning" role="alert">Upload outcome is unknown. Do not arm or start AUTO. Read back the full mission before retrying.</p>
            <button type="button" className="flight-mission-secondary" disabled={!live || Boolean(pending) || snapshot?.mission?.state === 'uploading'} onClick={() => void readbackMission()}>{pending === 'readback' ? 'Reading mission…' : 'Read back mission'}</button>
          </>}
          {readbackResult && <p className={missionReadbackClearForReplan(readbackResult) ? 'flight-mission-ok' : 'flight-mission-warning'} role="status">Readback: {readbackResult.count} item{readbackResult.count === 1 ? '' : 's'}. {missionReadbackClearForReplan(readbackResult) ? `${readbackResult.count === 0 ? 'Empty' : 'Home-only'} mission state recovered. Re-plan before uploading again; no flight is authorized.` : 'Flight commands may remain. Inspect and restore the mission in a ground station; do not start AUTO.'}</p>}
        </section>
      </div>

      <section ref={runSection} className="flight-mission-run" aria-labelledby="flight-run-heading">
        <div className="flight-mission-run-header">
          <div><span>05 / FIELD RUN</span><h3 id="flight-run-heading">Launch this storyboard</h3></div>
          <span className={`flight-mission-state is-${runStatus ? runState : 'checking'}`} role="status">{!runStatus ? 'Checking state' : runState === 'idle' ? 'Not running' : runState === 'takeover' ? 'Pilot takeover' : runState === 'unknown' ? 'State unknown' : runState === 'rejected' ? 'Launch rejected' : runState[0].toUpperCase() + runState.slice(1)}</span>
        </div>
        {runStatus && runState !== 'idle' && <p className={runState === 'unknown' || runState === 'rejected' ? 'flight-mission-warning' : 'flight-mission-muted'} role="status">
          {runStatus.reason || (runState === 'landed' ? 'Landed. Review the flight before another run.' : 'Monitoring aircraft state.')}
        </p>}
        {runInProgress ? <p className="flight-mission-muted">The pilot stays at the Zorro. If Lucidity loses contact, treat flight state as unknown and take control using the tested mode switch. A lost ground link does not stop the aircraft automatically.</p> : <>
          <p className="flight-mission-muted">For each flight, confirm the aircraft and field. Lucidity reads back the mission and checks live readiness before Run.</p>
          <div className="flight-mission-field-checks">
            <label><input type="checkbox" checked={fieldChecks.propsInstalled} disabled={Boolean(pending)} onChange={(event) => { setFieldChecks((checks) => ({ ...checks, propsInstalled: event.target.checked })); setLaunchCheck(null); }} /> Correct propellers installed and secure</label>
            <label><input type="checkbox" checked={fieldChecks.areaClear} disabled={Boolean(pending)} onChange={(event) => { setFieldChecks((checks) => ({ ...checks, areaClear: event.target.checked })); setLaunchCheck(null); }} /> Clear outdoor area; drone on level ground</label>
            <label><input type="checkbox" checked={fieldChecks.pilotReady} disabled={Boolean(pending)} onChange={(event) => { setFieldChecks((checks) => ({ ...checks, pilotReady: event.target.checked })); setLaunchCheck(null); }} /> Pilot has flown AltHold and Loiter on this quad</label>
            <label><input type="checkbox" checked={fieldChecks.modeSwitchReady} disabled={Boolean(pending)} onChange={(event) => { setFieldChecks((checks) => ({ ...checks, modeSwitchReady: event.target.checked })); setLaunchCheck(null); }} /> Zorro mode switch and takeover tested; pilot at controls</label>
          </div>
          <a className="flight-mission-radio-link" href="#/tools/receiver" onClick={openRadioSetup}>Radio setup <ArrowRight size={12} aria-hidden="true" /></a>
        </>}
        <div className="flight-mission-run-actions">
          {!runInProgress && <button type="button" disabled={!canCheckLaunch} onClick={() => void checkLaunch()}><ShieldCheck size={15} /> {pending === 'launch-check' ? 'Checking aircraft…' : 'Check flight readiness'}</button>}
          {!runInProgress && <button type="button" className="flight-mission-launch-button" disabled={!canLaunch} onClick={() => void launchFlight()}><Play size={15} /> {pending === 'launch' ? 'Starting…' : 'Run storyboard'}</button>}
          {runInProgress && <button type="button" className="flight-mission-land-button" disabled={!canLand} onClick={() => void landFlight()}>{pending === 'land' ? 'Requesting LAND…' : 'Request LAND'}</button>}
        </div>
        {launchCheck && <p className={canLaunch ? 'flight-mission-ok' : 'flight-mission-muted'} role="status">{canLaunch ? `Fresh mission readback and flight checks passed. Run once within ${Math.ceil((launchCheck.expiresAt - now) / 1000)} s.` : 'Readiness expired or changed. Check again.'}</p>}
        {launchUncertain && <p className="flight-mission-warning" role="alert">Command result is uncertain. Do not retry automatically. Use the pilot’s Zorro and ground station to confirm the aircraft state.</p>}
        {launchUncertain && <button type="button" className="flight-mission-reconcile" disabled={Boolean(pending)} onClick={() => void reconcileFlight()}>{pending === 'refresh-status' ? 'Checking status…' : 'Refresh status (read-only)'}</button>}
        {runStatusError && <p className="flight-mission-warning" role="alert">Cannot confirm flight state: {runStatusError}</p>}
        {runState === 'takeover' && <p className="flight-mission-muted">Pilot control takes priority. Lucidity will not resume AUTO automatically.</p>}
        {runState === 'landed' && <p className="flight-mission-muted">Landed. Review telemetry and the log before another run.</p>}
        {recoveryRequired && <div className="flight-mission-recovery" role="group" aria-label="Interrupted flight recovery">
          <strong>Recover interrupted run {recoveryAircraft ? `· system ${recoveryAircraft.systemId}, component ${recoveryAircraft.componentId}` : ''}</strong>
          <p className="flight-mission-muted">Only after landing: remove every propeller. Reconnect this same aircraft; recovery observes it and clears the interrupted run. It sends no motor or flight command.</p>
          <p className="flight-mission-muted">If the ground link needs reconnecting, confirm the checks below, then use Disconnect above.</p>
          <label className="flight-mission-field">Select the reconnected aircraft
            <select aria-label="Aircraft to recover" value={recoveryAircraft?.id ?? ''} disabled={Boolean(pending)} onChange={(event) => {
              setRecoverySelection(event.target.value && snapshot?.link.connectedAt != null
                ? { id: event.target.value, connectedAt: snapshot.link.connectedAt } : null);
              setRecoveryGroundConfirmed(false);
            }}>
              <option value="">Select live aircraft</option>
              {recoveryCandidates.map((aircraft) => <option key={aircraft.id} value={aircraft.id}>System {aircraft.systemId} · component {aircraft.componentId}</option>)}
            </select>
          </label>
          <div className="flight-mission-field-checks">
            <label><input type="checkbox" checked={recoveryPropsRemoved} disabled={Boolean(pending)} onChange={(event) => setRecoveryPropsRemoved(event.target.checked)} /> Every propeller is physically removed</label>
            <label><input type="checkbox" checked={recoveryGroundConfirmed} disabled={Boolean(pending)} onChange={(event) => setRecoveryGroundConfirmed(event.target.checked)} /> I confirmed this is the same aircraft, on the ground, disarmed, with motors stopped</label>
          </div>
          {!flightMissionRecoveryAvailable(runStatus, snapshot, recoveryAircraft, now, recoverySelection?.id) && <p className="flight-mission-muted">Select the reconnected aircraft and wait for fresh disarmed, landed, near-ground telemetry. Lucidity checks its identity against the interrupted-run record.</p>}
          <button type="button" className="flight-mission-reconcile" disabled={!canReconcileInterrupted} onClick={() => void reconcileInterruptedRun()}>{pending === 'reconcile' ? 'Recovering…' : 'Confirm props-off recovery'}</button>
        </div>}
        {recoveryMessage && <p className="flight-mission-ok" role="status">{recoveryMessage}</p>}
      </section>
      {(serviceError || actionError) && <p className="flight-mission-error" role="alert">{actionError || serviceError}</p>}
    </div>
  </Modal>;
}
