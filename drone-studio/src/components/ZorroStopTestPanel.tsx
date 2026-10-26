import { useEffect, useRef, useState } from 'react';
import type { AircraftSnapshot, AircraftTelemetry } from '../aircraft/types';
import type { ParameterSnapshot } from '../aircraft/parameters';
import { IdleShowClient } from '../aircraft/idle-show-client';
import type { Project } from '../core/model';
import { zorroStopPlanError } from '../core/zorro-test';
import './ZorroStopTestPanel.css';

type Check = 'propsRemoved' | 'areaClear' | 'hardwareCool' | 'radioReady';
const emptyChecks: Record<Check, boolean> = {
  propsRemoved: false, areaClear: false, hardwareCool: false, radioReady: false,
};
const terminal = (state?: string) => ['completed', 'cancelled', 'failed'].includes(state ?? '');

export function idleSetupError(parameters?: ParameterSnapshot, connectedAt?: number | null, now = 0) {
  const value = (name: string) => parameters?.parameters.find(p => p.name === name &&
    connectedAt != null && p.receivedAt >= connectedAt && now - p.receivedAt < 300_000)?.value;
  if (value('RC6_OPTION') !== 31) return 'Motor-stop switch setup needs checking.';
  const delay = value('DISARM_DELAY');
  if (delay === undefined) return 'Auto-disarm delay has not been read. Check setup again.';
  if (delay < 25 || delay > 45) return `Auto-disarm delay is ${delay} seconds; this test needs 25–45 seconds.`;
  const spin = value('MOT_SPIN_ARM');
  if (spin === undefined || spin < 0.05 || spin > 0.15) return 'Armed-idle speed must be 0.05–0.15.';
  const skippedChecks = value('ARMING_SKIPCHK');
  if (skippedChecks === undefined) return 'Pre-arm checks have not been read. Check setup again.';
  if (skippedChecks !== 0) return 'Skipped pre-arm checks must be cleared.';
  return null;
}

export function ZorroStopTestPanel({ project, snapshot, aircraft, now, serviceUnavailable, onSnapshot }: {
  project: Project;
  snapshot?: AircraftSnapshot;
  aircraft?: AircraftTelemetry;
  now: number;
  serviceUnavailable: boolean;
  onSnapshot: (snapshot: AircraftSnapshot) => void;
}) {
  const [checks, setChecks] = useState(emptyChecks);
  const [assigned, setAssigned] = useState('');
  const [parameters, setParameters] = useState<ParameterSnapshot>();
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [observation, setObservation] = useState('');
  const client = useRef<IdleShowClient | undefined>(undefined);
  const planError = zorroStopPlanError(project);
  const identity = `${project.id}/${project.revision}/${snapshot?.link.path}/${snapshot?.link.connectedAt}/${aircraft?.id}`;
  const fresh = Boolean(aircraft && snapshot?.link.state === 'listening' &&
    snapshot.aircraft.length === 1 && now - aircraft.heartbeat.receivedAt < 5000 &&
    aircraft.heartbeat.receivedAt <= now);
  const run = snapshot?.zorroStop?.storyboardId === project.id &&
    snapshot.zorroStop.revision === project.revision ? snapshot.zorroStop : undefined;
  const active = Boolean(run && !terminal(run.state));
  const setupError = idleSetupError(parameters, snapshot?.link.connectedAt, now);
  const telemetryReady = Boolean(snapshot?.request && aircraft &&
    snapshot.request.aircraftId === aircraft.id &&
    ['verified', 'partial'].includes(snapshot.request.state) &&
    (snapshot.link.connectedAt ?? Infinity) <= snapshot.request.startedAt);

  useEffect(() => {
    const owned = new IdleShowClient({ onError: setError, onSnapshot });
    client.current = owned;
    const hide = () => { if (document.visibilityState !== 'visible') void owned.stop().catch(() => {}); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', hide);
    return () => {
      owned.dispose();
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', hide);
      if (client.current === owned) client.current = undefined;
    };
  }, [onSnapshot]);
  useEffect(() => {
    setChecks(emptyChecks); setAssigned(''); setParameters(undefined); setObservation(''); setError('');
  }, [identity]);
  useEffect(() => {
    if (!aircraft || assigned !== identity || !snapshot?.link.connectedAt) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/aircraft/parameters?aircraftId=${encodeURIComponent(aircraft.id)}`, { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json() as ParameterSnapshot;
        if (!cancelled) setParameters(data);
      } catch { /* A missing service is reported by the parent status view. */ }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [aircraft?.id, assigned, identity, snapshot?.link.connectedAt]);
  useEffect(() => { if (snapshot) client.current?.observe(snapshot); }, [snapshot]);

  const readSetup = async () => {
    if (!aircraft) return;
    setPending('setup'); setError('');
    try {
      const response = await fetch('/api/aircraft/parameters/read', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lucidity-Aircraft': '1' },
        body: JSON.stringify({ aircraftId: aircraft.id, names: ['RC6_OPTION', 'DISARM_DELAY', 'MOT_SPIN_ARM', 'ARMING_SKIPCHK'] }),
      });
      const result = await response.json() as ParameterSnapshot & { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Setup read failed.');
      setParameters(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Setup read failed.'); }
    finally { setPending(''); }
  };
  const start = async () => {
    if (!aircraft || !client.current) return;
    setPending('start'); setError(''); setObservation('');
    try {
      onSnapshot(await client.current.start(aircraft.id, project, checks));
      setChecks(emptyChecks);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start the show.'); }
    finally { setPending(''); }
  };
  const stop = async () => {
    setPending('stop'); setError('');
    try {
      let result = await client.current?.stop();
      if (!result && run) {
        const response = await fetch('/api/aircraft/idle-show/stop', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lucidity-Aircraft': '1' },
          body: JSON.stringify({ runId: run.runId }), signal: AbortSignal.timeout(2000),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Disarm was not confirmed.');
        result = body as AircraftSnapshot;
      }
      if (result) onSnapshot(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Disarm unconfirmed.'); }
    finally { setPending(''); }
  };
  const ready = !planError && fresh && telemetryReady && assigned === identity && !active && !serviceUnavailable &&
    !aircraft?.heartbeat.armed && Boolean(parameters) && !setupError && Object.values(checks).every(Boolean) && !pending;
  const guidance = !fresh ? 'Connect a physical drone to begin.'
    : !telemetryReady ? 'Request telemetry to begin.'
    : assigned !== identity ? 'Assign the connected drone to begin.'
    : !parameters ? 'Check setup to begin.'
    : setupError ? `Cannot run: ${setupError}`
    : !Object.values(checks).every(Boolean) ? 'Confirm the four physical checks before every run.'
    : 'Ready to run the props-off idle storyboard.';

  return <section className="zorro-stop-test" aria-label="Run props-off idle storyboard">
    <header className="zorro-stop-header"><strong>One drone · all motors at idle</strong><span className="zorro-stop-duration">20 s</span></header>
    {planError && <p role="alert">{planError}</p>}
    <div className="zorro-stop-assignment">
      <strong>{assigned === identity && aircraft ? `Drone 1 · system ${aircraft.systemId}` : 'Drone 1 · unassigned'}</strong>
      <button type="button" disabled={!fresh || Boolean(planError) || active} onClick={() => {
        setAssigned(identity); setChecks(emptyChecks); setObservation('');
      }}>{assigned === identity ? 'Assigned' : 'Assign connected drone'}</button>
    </div>
    <div className="zorro-stop-setup">
      <span>{parameters ? (setupError ? `Setup · ${setupError}` : 'Setup · ready') : 'Setup · check after connecting'}</span>
      <button type="button" disabled={assigned !== identity || active || Boolean(pending)} onClick={() => void readSetup()}>
        {pending === 'setup' ? 'Reading…' : 'Check setup'}
      </button>
    </div>
    <fieldset disabled={assigned !== identity || active || Boolean(planError)}>
      <legend>Before every run</legend>
      {([
        ['propsRemoved', 'Propellers removed'],
        ['areaClear', 'Drone secured; area clear'],
        ['hardwareCool', 'Hardware cool'],
        ['radioReady', 'Radio linked; throttle at minimum'],
      ] as const).map(([key, label]) => <label key={key}>
        <input type="checkbox" checked={checks[key]} onChange={event =>
          setChecks(current => ({ ...current, [key]: event.target.checked }))} />{label}
      </label>)}
    </fieldset>
    <div className="zorro-stop-controls">
      <button type="button" disabled={!ready} onClick={() => void start()}>Run storyboard</button>
      <output aria-label="Show elapsed time">{((run?.elapsedMs ?? 0) / 1000).toFixed(1)} / 20 s</output>
      <button type="button" disabled={!active || pending === 'stop'} onClick={() => void stop()}>Stop / disarm</button>
    </div>
    <p role="status">{run?.message ?? guidance}</p>
    {error && <p className="zorro-stop-warning" role="alert">{error}</p>}
    {run && terminal(run.state) && <div className="zorro-stop-observation">
      <span>Observed motors:</span>
      {['Stopped as expected', 'Did not stop', 'Unsure'].map(label =>
        <button type="button" key={label} aria-pressed={observation === label} onClick={() => setObservation(label)}>{label}</button>)}
    </div>}
    <details><summary>How this run works</summary><p>Lucidity requests a normal arm, holds no throttle, and requests disarm after 20 seconds. Your configured radio motor-stop switch acts directly on ArduPilot. Motor rotation is not measured here. If stopping is unconfirmed, use the radio stop and disconnect the battery.</p></details>
  </section>;
}
