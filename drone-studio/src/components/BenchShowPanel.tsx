import { useEffect, useRef, useState } from 'react';
import { Clock3, Octagon, Play, Radio, Zap } from 'lucide-react';
import type { AircraftSnapshot, AircraftTelemetry } from '../aircraft/types';
import type { BenchShowStatus } from '../aircraft/bench-show-plan';
import type { StoryboardBenchPlan } from '../core/bench-storyboard';
import { motorPulseBlockReason, type MotorChecks } from './MotorBenchPanel';
import { StoryboardMotorPreview } from './StoryboardMotorPreview';
import './BenchShowPanel.css';

const unchecked: MotorChecks = { propsRemoved: false, areaClear: false, hardwareCool: false };
const motorName = (motor: number) => String.fromCharCode(64 + motor);
const isActive = (run?: BenchShowStatus) => run?.state === 'running' || run?.state === 'stopping';

export function benchShowConnectionIdentity(
  snapshot?: AircraftSnapshot,
  aircraft?: AircraftTelemetry
) {
  return `${snapshot?.link.path}/${snapshot?.link.connectedAt}/${snapshot?.link.state}/${aircraft?.id}`;
}

function connectedBenchShow(snapshot?: AircraftSnapshot, aircraft?: AircraftTelemetry) {
  const run = snapshot?.benchShow;
  const connectedAt = snapshot?.link.connectedAt;
  return run &&
    aircraft &&
    run.aircraftId === aircraft.id &&
    connectedAt != null &&
    Number.isFinite(connectedAt) &&
    Number.isFinite(run.startedAt) &&
    run.startedAt >= connectedAt
    ? run
    : undefined;
}

export function benchShowReviewIdentity(
  snapshot?: AircraftSnapshot,
  aircraft?: AircraftTelemetry,
  plan?: StoryboardBenchPlan
) {
  return JSON.stringify([benchShowConnectionIdentity(snapshot, aircraft), plan?.source]);
}

/** Never present an earlier revision's results as execution of the current storyboard. */
export function currentBenchShow(
  snapshot?: AircraftSnapshot,
  aircraft?: AircraftTelemetry,
  plan?: StoryboardBenchPlan
) {
  const run = connectedBenchShow(snapshot, aircraft);
  return run && plan && run.source?.id === plan.source.id &&
    run.source.revision === plan.source.revision && run.source.planKey === plan.source.planKey &&
    run.source.name === plan.source.name ? run : undefined;
}

export function benchShowStopAvailable(
  snapshot?: AircraftSnapshot,
  aircraft?: AircraftTelemetry,
  ownStartPending = false
) {
  return Boolean(
    aircraft &&
      snapshot?.link.state === 'listening' &&
      (ownStartPending || isActive(connectedBenchShow(snapshot, aircraft)))
  );
}

/** Elapsed time comes from the service. This helper never advances a stopped or stale run. */
export function benchShowTimeline(plan?: StoryboardBenchPlan, run?: BenchShowStatus) {
  const durationMs = plan?.durationMs ?? 0;
  const cues = plan?.cues ?? [];
  const elapsedMs =
    run && Number.isFinite(run.elapsedMs)
      ? Math.max(0, Math.min(durationMs, run.elapsedMs))
      : 0;
  const cue =
    run?.state === 'running'
      ? cues.find((item) => elapsedMs >= item.atMs && elapsedMs < item.atMs + 1000)
      : undefined;
  const phase = !run
    ? 'Authored storyboard schedule'
    : run.state === 'stopping'
      ? 'Stopping the schedule'
      : run.state !== 'running'
        ? 'Schedule ended'
        : cue
          ? `Motor ${motorName(cue.motor)} · scheduled pulse window`
          : cues[0] && elapsedMs < cues[0].atMs
            ? `Lead-in · first cue at ${cues[0].atMs / 1000}s`
            : cues.length > 0 && elapsedMs >= cues[cues.length - 1].atMs + 1000
              ? 'Final telemetry checks'
              : 'Gap between motor cues';
  return { elapsedMs, cue, phase };
}

const runLabels: Record<BenchShowStatus['state'], string> = {
  running: 'Storyboard running · props off',
  stopping: 'Stop requested · verify the motors',
  completed: 'Schedule complete · observation needed',
  cancelled: 'Schedule cancelled · verify the motors',
  failed: 'Schedule ended early · verify the motors',
};

type Props = {
  plan?: StoryboardBenchPlan;
  planError?: string;
  snapshot?: AircraftSnapshot;
  aircraft?: AircraftTelemetry;
  now: number;
  busy: boolean;
  serviceUnavailable: boolean;
  onStart: (checks: MotorChecks) => void;
  onStop: () => void;
};

export function BenchShowPanel({
  plan,
  planError,
  snapshot,
  aircraft,
  now,
  busy,
  serviceUnavailable,
  onStart,
  onStop,
}: Props) {
  const [assignedIdentity, setAssignedIdentity] = useState('');
  const [checks, setChecks] = useState<MotorChecks>(unchecked);
  const [observationRecord, setObservation] = useState<{
    runId: string;
    identity: string;
    label: string;
  } | null>(null);
  const [pendingStartIdentity, setPendingStartIdentity] = useState('');
  const [stopRequested, setStopRequested] = useState(false);
  const startLatch = useRef(false);
  const stopLatch = useRef(false);
  const identity = benchShowReviewIdentity(snapshot, aircraft, plan);
  const run = currentBenchShow(snapshot, aircraft, plan);
  const otherRun = connectedBenchShow(snapshot, aircraft);
  const observation =
    observationRecord?.runId === run?.runId && observationRecord?.identity === identity
      ? observationRecord.label
      : '';
  const assigned = assignedIdentity === identity;
  const active = isActive(snapshot?.benchShow);
  const ownStartPending = pendingStartIdentity === identity && Boolean(pendingStartIdentity);
  const timeline = benchShowTimeline(plan, run);
  const checked = checks.propsRemoved && checks.areaClear && checks.hardwareCool;
  const awaitingStop = stopRequested || (busy && run?.state === 'stopping');
  const blocked = active
    ? 'Wait for the current storyboard run to end before starting again.'
    : ownStartPending
      ? 'Starting the storyboard…'
      : planError || !plan || plan.cues.length === 0
        ? planError || 'Open a storyboard with authored motor cues to run it with props off.'
        : !assigned
        ? 'Connect and assign the physical aircraft to Drone 1.'
        : motorPulseBlockReason({ snapshot, aircraft, now, busy, serviceUnavailable });
  const terminal = Boolean(run && !isActive(run));
  const observationReady =
    terminal &&
    !busy &&
    !ownStartPending &&
    !serviceUnavailable &&
    (!snapshot?.motorTest || now >= snapshot.motorTest.availableAt);

  useEffect(() => {
    setAssignedIdentity('');
    setChecks(unchecked);
    setObservation(null);
    setPendingStartIdentity('');
    setStopRequested(false);
    startLatch.current = false;
    stopLatch.current = false;
  }, [identity]);
  useEffect(() => setObservation(null), [run?.runId]);
  useEffect(() => {
    if (!busy) {
      setPendingStartIdentity('');
      setStopRequested(false);
      startLatch.current = false;
      stopLatch.current = false;
    }
  }, [busy]);
  useEffect(() => {
    if (run && isActive(run)) setPendingStartIdentity('');
  }, [run?.runId, run?.state]);

  const targetLabel = aircraft
    ? `System ${aircraft.systemId} / Component ${aircraft.componentId}`
    : '';

  return (
    <section className="bench-show-panel" aria-label="Run storyboard with props off">
      <header className="bench-show-heading">
        <div>
          <span className="bench-show-eyebrow">STORYBOARD / ONE DRONE</span>
          <h2>Run storyboard · props off</h2>
          {plan ? <p className="bench-show-source"><strong>{plan.source.name}</strong> · Revision {plan.source.revision}<br />{plan.cues.length} authored motor cues · {plan.durationMs / 1000} seconds · Each pulse is 5% for 1 second.</p> : <p>Open a storyboard with authored motor cues to review its run.</p>}
        </div>
        <span className="bench-show-hardware-badge">
          <Zap size={12} />
          Real motors · props off
        </span>
      </header>

      {plan && <div className="bench-show-timeline">
        <div className="bench-show-timeline-heading">
          <span>
            <Clock3 size={13} />
            {timeline.phase}
          </span>
          <output aria-label="Bench show elapsed time" aria-live="off">
            {(timeline.elapsedMs / 1000).toFixed(1)} / {plan.durationMs / 1000} s
          </output>
        </div>
        <StoryboardMotorPreview plan={plan} time={timeline.elapsedMs / 1000} highlightPulse={!run || run.state === 'running'} />
        <p>
          {serviceUnavailable && run
            ? 'Service unavailable · showing the last reported schedule time. '
            : ''}
          Scheduled timing only. The diagram does not measure rotation, position, or height.
        </p>
      </div>}
      {planError && <p className="bench-show-plan-error" role="alert">{planError}</p>}
      {otherRun && !run && <p className="bench-show-other-run" role="status">
        {isActive(otherRun) ? 'A different storyboard version is running' : 'Previous run belongs to a different storyboard version'}
        {otherRun.source ? `: ${otherRun.source.name}, revision ${otherRun.source.revision}` : ''}.
        {isActive(otherRun) ? ' Stop remains available below.' : ' Its results are not shown as this storyboard’s results.'}
      </p>}

      <div className="bench-show-assignment">
        <div>
          <span className="bench-show-eyebrow">DRONE 1 / PHYSICAL ASSIGNMENT</span>
          <strong>
            {assigned ? targetLabel : run ? `Run target: ${targetLabel}` : 'No aircraft assigned'}
          </strong>
          <small>
            {assigned
              ? 'Bound to this connection and storyboard version. Edits require a fresh review.'
              : 'Connect the radio and request telemetry, then assign the detected drone.'}
          </small>
        </div>
        <button
          type="button"
          disabled={
            !plan || Boolean(planError) || !aircraft ||
            snapshot?.link.state !== 'listening' ||
            snapshot.aircraft.length !== 1 ||
            busy ||
            active ||
            serviceUnavailable
          }
          onClick={() => {
            setAssignedIdentity(identity);
            setChecks(unchecked);
          }}
        >
          <Radio size={12} />
          {assigned
            ? 'Reassign Drone 1'
            : aircraft
              ? `Assign Drone 1 to ${targetLabel}`
              : 'Connect a drone to assign'}
        </button>
      </div>

      <div
        className="bench-show-checks"
        role="group"
        aria-label="Physical checks before the storyboard run"
      >
        {(
          [
            ['propsRemoved', 'Every propeller is physically removed'],
            ['areaClear', 'The aircraft is secure and the area is clear'],
            ['hardwareCool', 'Hardware is cool; no unusual heat or smell'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={checks[key]}
              disabled={!assigned || !plan || Boolean(planError) || active || busy || ownStartPending}
              onChange={(event) =>
                setChecks((current) => ({ ...current, [key]: event.target.checked }))
              }
            />
            {label}
          </label>
        ))}
      </div>

      <div className="bench-show-actions">
        <button
          className="bench-show-start"
          type="button"
          disabled={Boolean(blocked) || !checked}
          onClick={() => {
            if (blocked || !checked || startLatch.current) return;
            startLatch.current = true;
            setPendingStartIdentity(identity);
            setChecks(unchecked);
            setObservation(null);
            onStart({ ...checks });
          }}
        >
          <Play size={15} />
          {ownStartPending ? 'Starting storyboard…' : 'Start storyboard run'}
        </button>
        <button
          className="bench-show-stop"
          type="button"
          disabled={!benchShowStopAvailable(snapshot, aircraft, ownStartPending) || awaitingStop}
          onClick={() => {
            if (stopLatch.current) return;
            stopLatch.current = true;
            setStopRequested(true);
            onStop();
          }}
        >
          <Octagon size={14} />
          {awaitingStop ? 'Requesting stop…' : 'Stop show'}
        </button>
      </div>
      <p className="bench-show-readiness" role="status">
        {stopRequested
          ? 'Stop requested. Verify the motors; a request is not proof they stopped.'
          : blocked ||
            (checked
              ? `Ready to run this ${plan!.durationMs / 1000}-second storyboard once. No loop or automatic retry.`
              : 'Confirm all three physical checks before each run.')}
      </p>
      <p className="bench-show-stop-note">
        Stop ends future cues and requests a motor stop. If a motor continues, disconnect battery
        power.
      </p>

      <div className="bench-show-run-result">
        <div className="bench-show-result-heading" role="status">
          <strong>{run ? runLabels[run.state] : plan ? `${plan.cues.length} cues · one pulse at a time` : 'Storyboard required'}</strong>
          <span>{run ? 'SERVICE REPORTED' : 'PLANNED SCHEDULE'}</span>
        </div>
        {run && <p>{run.message}</p>}
        <ol className="bench-show-cue-results" aria-label="Storyboard cue results">
          {plan?.cues.map((planned) => {
            const cue = run?.cues.find(
              (item) => item.sceneId === planned.sceneId && item.motor === planned.motor && item.atMs === planned.atMs
            );
            const state = cue?.state ?? 'waiting';
            const label = {
              waiting: terminal ? 'Not run' : 'Scheduled',
              pending: 'Awaiting acknowledgement',
              accepted: 'Command accepted',
              confirmed: 'Disarmed heartbeat received',
              failed: 'Cue not confirmed',
            }[state];
            return (
              <li
                key={planned.sceneId}
                className={timeline.cue?.sceneId === planned.sceneId ? 'is-active' : ''}
              >
                <div>
                  <strong>Motor {motorName(planned.motor)}</strong>
                  <time>{planned.atMs / 1000}s</time>
                </div>
                <p className="bench-show-cue-scene">{planned.sceneName}</p>
                <p>{label}</p>
                {cue?.message && <p>{cue.message}</p>}
              </li>
            );
          })}
        </ol>
        {terminal && (
          <div
            className="bench-show-observation"
            role="group"
            aria-label="Your physical storyboard-run observation"
          >
            <span>Your observation · separate from acknowledgements and telemetry</span>
            <div>
              {[
                run?.state === 'completed' ? 'Every scheduled pulse moved and stopped' : 'Motors stopped',
                'No movement observed',
                'Unexpected movement',
              ].map((label) => (
                <button
                  type="button"
                  key={label}
                  disabled={!observationReady}
                  aria-pressed={observation === label}
                  onClick={() => setObservation({ runId: run!.runId, identity, label })}
                >
                  {label}
                </button>
              ))}
            </div>
            <p role="status">
              {observation
                ? `Operator observed: ${observation}.`
                : observationReady
                  ? 'Awaiting your observation. Command results do not prove motor movement.'
                  : 'Wait for current commands and cooldown to finish before recording your observation.'}
            </p>
          </div>
        )}
      </div>
      <p className="bench-show-limits">
        Runs the motor cues authored in this storyboard. Flight paths and lights are not sent in props-off mode.
        No export is needed. A–D identify motor test order; verify physical mapping.
        Power stays at 5%, with no automatic increase or retry. Acknowledgements do not prove movement.
      </p>
    </section>
  );
}
