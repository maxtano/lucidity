import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  Battery,
  Compass,
  Radio,
  RefreshCw,
  Satellite,
  ShieldCheck,
  Unplug,
  Usb,
} from 'lucide-react';
import type { AircraftPort, AircraftSnapshot, AircraftTelemetry } from '../aircraft/types';
import { Modal } from './Modal';
import type { Project } from '../core/model';
import { compileStoryboardBenchPlan } from '../core/bench-storyboard';
import { BenchShowPanel } from './BenchShowPanel';
import { ZorroStopTestPanel } from './ZorroStopTestPanel';
import { isZorroStopStoryboard } from '../core/zorro-test';
import { FlightMissionPanel } from './FlightMissionPanel';
import { BenchShowClient } from '../aircraft/bench-show-client';
import {
  MotorBenchPanel,
  motorPulseBlockReason,
  motorStopAvailable,
  type MotorChecks,
  type MotorNumber,
} from './MotorBenchPanel';
import './AircraftPanel.css';

const DEFAULT_PORT = '/dev/cu.usbmodem11401';
const STALE_MS = 5000;
type AircraftAction =
  | 'connect'
  | 'disconnect'
  | 'request-telemetry'
  | 'motor-test'
  | 'motor-test-stop'
  | 'bench-show/start'
  | 'bench-show/stop';
const numeric = (value: number | null | undefined, digits = 1, unit = '') =>
  value !== null && value !== undefined && Number.isFinite(value)
    ? `${value.toFixed(digits)}${unit}`
    : 'Unknown';

/** Ages use the server clock, advanced locally even when the next poll fails. */
export function aircraftFreshness(receivedAt: number | null | undefined, now: number) {
  if (receivedAt === null || receivedAt === undefined || !Number.isFinite(receivedAt))
    return { stale: true, label: 'Not received' };
  const age = Math.max(0, now - receivedAt);
  return {
    stale: age >= STALE_MS,
    label: age < 1000 ? 'Just received' : `${Math.floor(age / 1000)}s ago`,
  };
}

function Freshness({ receivedAt, now }: { receivedAt: number | null | undefined; now: number }) {
  const freshness = aircraftFreshness(receivedAt, now);
  return (
    <span className={`aircraft-freshness${freshness.stale ? ' is-stale' : ''}`}>
      <i />
      {freshness.stale && receivedAt != null ? 'Stale · ' : ''}
      {freshness.label}
    </span>
  );
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="aircraft-metric">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Attitude({ aircraft, now }: { aircraft: AircraftTelemetry; now: number }) {
  const id = useId();
  const attitude = aircraft.attitude;
  const available = Boolean(
    attitude && [attitude.rollDeg, attitude.pitchDeg, attitude.yawDeg].every(Number.isFinite)
  );
  const stale = aircraftFreshness(attitude?.receivedAt, now).stale;
  return (
    <section
      className={`aircraft-attitude${stale ? ' is-stale' : ''}`}
      aria-label="Measured aircraft attitude"
    >
      <div className="aircraft-section-heading">
        <span>
          <Compass size={14} /> Attitude
        </span>
        <Freshness receivedAt={attitude?.receivedAt} now={now} />
      </div>
      <svg
        className="aircraft-horizon"
        viewBox="0 0 320 260"
        role="img"
        aria-label={
          available
            ? `Measured roll ${numeric(attitude!.rollDeg, 1)} degrees, pitch ${numeric(attitude!.pitchDeg, 1)} degrees`
            : 'Attitude unknown. No attitude message received.'
        }
      >
        <defs>
          <clipPath id={id}>
            <circle cx="160" cy="122" r="96" />
          </clipPath>
        </defs>
        <circle cx="160" cy="122" r="105" fill="none" stroke="var(--ds-canvas-border)" strokeWidth="1" />
        <g clipPath={`url(#${id})`}>
          {available ? (
            <g transform={`rotate(${-attitude!.rollDeg} 160 122)`}>
              <g
                transform={`translate(0 ${Math.max(-90, Math.min(90, attitude!.pitchDeg)) * 1.6})`}
              >
                <rect x="-180" y="-500" width="700" height="622" fill="var(--ds-horizon-sky)" />
                <rect x="-180" y="122" width="700" height="620" fill="var(--ds-horizon-ground)" />
                <path d="M-180 122H520" stroke="var(--ds-horizon-mark)" strokeWidth="1.5" />
                {[-30, -20, -10, 10, 20, 30].map((angle) => (
                  <g key={angle}>
                    <path
                      d={`M${angle % 20 === 0 ? 130 : 142} ${122 - angle * 1.6}H${angle % 20 === 0 ? 190 : 178}`}
                      stroke="color-mix(in srgb, var(--ds-canvas-text) 65%, transparent)"
                    />
                    <text
                      x="199"
                      y={125 - angle * 1.6}
                      fill="var(--ds-canvas-text)"
                      fontSize="8"
                      fontFamily="var(--font-mono)"
                    >
                      {Math.abs(angle)}
                    </text>
                  </g>
                ))}
              </g>
            </g>
          ) : (
            <rect width="320" height="260" fill="var(--ds-canvas-bg)" />
          )}
        </g>
        <path d="M153 14L160 23L167 14" fill="none" stroke="var(--ds-horizon-mark)" strokeWidth="2" />
        {[-60, -30, 0, 30, 60].map((angle) => (
          <path
            key={angle}
            d="M160 21V29"
            stroke="var(--ds-canvas-muted)"
            transform={`rotate(${angle} 160 122)`}
          />
        ))}
        <g
          fill="none"
          stroke={available ? 'var(--ds-horizon-mark)' : 'var(--ds-canvas-muted)'}
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M117 122H145L153 130H167L175 122H203M160 115V126" />
          <circle cx="115" cy="115" r="9" />
          <circle cx="205" cy="115" r="9" />
        </g>
        {!available && (
          <text
            x="160"
            y="164"
            textAnchor="middle"
            fill="var(--ds-canvas-muted)"
            fontSize="10"
            fontFamily="var(--font-mono)"
          >
            WAITING FOR ATTITUDE
          </text>
        )}
        <text
          x="160"
          y="248"
          textAnchor="middle"
          fill="var(--ds-canvas-muted)"
          fontSize="9"
          fontFamily="var(--font-mono)"
        >
          {available
            ? stale
              ? 'LAST RECEIVED ATTITUDE'
              : 'LIVE SENSOR ATTITUDE'
            : 'NO SIMULATED POSE'}
        </text>
      </svg>
      <dl className="aircraft-angles">
        <Metric label="Roll">{numeric(attitude?.rollDeg, 1, '°')}</Metric>
        <Metric label="Pitch">{numeric(attitude?.pitchDeg, 1, '°')}</Metric>
        <Metric label="Yaw">{numeric(attitude?.yawDeg, 1, '°')}</Metric>
      </dl>
    </section>
  );
}

/** Receive-only display. Unknown channels remain unknown; stale values are historical. */
export function AircraftTelemetryDetails({
  aircraft,
  now,
}: {
  aircraft: AircraftTelemetry;
  now: number;
}) {
  const heartbeatStale = aircraftFreshness(aircraft.heartbeat.receivedAt, now).stale;
  return (
    <div className="aircraft-details">
      <div className="aircraft-source-heading">
        <div>
          <span className="aircraft-eyebrow">PHYSICAL AIRCRAFT</span>
          <h2>
            System {aircraft.systemId} <span>/ component {aircraft.componentId}</span>
          </h2>
        </div>
        <span className={`aircraft-heartbeat-state${heartbeatStale ? ' is-stale' : ''}`}>
          {heartbeatStale ? 'Heartbeat lost / stale' : 'Heartbeat received'}
        </span>
      </div>
      <div className="aircraft-source-meta">
        Source {aircraft.id} · MAVLink {aircraft.protocolVersion} ·{' '}
        {aircraft.signing === 'unverified' ? 'Signature unverified' : 'Unsigned packets'}
      </div>
      <div className="aircraft-telemetry-grid">
        <Attitude aircraft={aircraft} now={now} />
        <div className="aircraft-channel-grid">
          <section className="aircraft-channel">
            <div className="aircraft-section-heading">
              <span>
                <Activity size={14} /> Autopilot
              </span>
              <Freshness receivedAt={aircraft.heartbeat.receivedAt} now={now} />
            </div>
            <dl>
              <Metric label={heartbeatStale ? 'Last arming state' : 'Arming state'}>
                <span className={aircraft.heartbeat.armed ? 'aircraft-armed' : ''}>
                  {aircraft.heartbeat.armed ? 'Armed' : 'Disarmed'}
                </span>
              </Metric>
              <Metric label="Reported mode">{aircraft.heartbeat.mode}</Metric>
              <Metric label="System status">{aircraft.heartbeat.systemStatus}</Metric>
              <Metric label="Firmware">{aircraft.version?.flightVersion ?? 'Not requested'}</Metric>
            </dl>
          </section>
          <section className="aircraft-channel">
            <div className="aircraft-section-heading">
              <span>
                <Satellite size={14} /> GPS
              </span>
              <Freshness receivedAt={aircraft.gps?.receivedAt} now={now} />
            </div>
            <dl>
              <Metric label="Fix">{aircraft.gps?.fix ?? 'Unknown'}</Metric>
              <Metric label="Satellites">{numeric(aircraft.gps?.satellites, 0)}</Metric>
              <Metric label="HDOP">{numeric(aircraft.gps?.hdop, 2)}</Metric>
              <Metric label="GPS coordinates">
                {aircraft.gps?.latitude != null && aircraft.gps.longitude != null
                  ? `${numeric(aircraft.gps.latitude, 6)}, ${numeric(aircraft.gps.longitude, 6)}`
                  : 'Unknown'}
              </Metric>
            </dl>
          </section>
          <section className="aircraft-channel">
            <div className="aircraft-section-heading">
              <span>
                <Battery size={14} /> Battery
              </span>
              <Freshness receivedAt={aircraft.battery?.receivedAt} now={now} />
            </div>
            <dl>
              <Metric label="Voltage">{numeric(aircraft.battery?.voltageV, 2, ' V')}</Metric>
              <Metric label="Current">{numeric(aircraft.battery?.currentA, 2, ' A')}</Metric>
              <Metric label="Remaining">
                {numeric(aircraft.battery?.remainingPercent, 0, '%')}
              </Metric>
            </dl>
          </section>
          <section className="aircraft-channel">
            <div className="aircraft-section-heading">
              <span>
                <Compass size={14} /> Position
              </span>
              <Freshness receivedAt={aircraft.position?.receivedAt} now={now} />
            </div>
            <dl>
              <Metric label="Altitude above home · estimate">
                {numeric(aircraft.position?.relativeAltitudeM, 1, ' m')}
              </Metric>
              <Metric label="MSL altitude">
                {numeric(aircraft.position?.altitudeMslM, 1, ' m')}
              </Metric>
              <Metric label="Ground speed">
                {numeric(aircraft.position?.groundSpeedMps, 1, ' m/s')}
              </Metric>
              <Metric label="Position coordinates">
                {aircraft.position
                  ? `${numeric(aircraft.position.latitude, 6)}, ${numeric(aircraft.position.longitude, 6)}`
                  : 'Unknown'}
              </Metric>
            </dl>
          </section>
        </div>
      </div>
      <section className="aircraft-messages" aria-label="Received aircraft messages">
        <div className="aircraft-section-heading">
          <span>Aircraft messages</span>
          <small>Received status text</small>
        </div>
        {aircraft.messages.length ? (
          <ol>
            {aircraft.messages
              .slice(-8)
              .reverse()
              .map((message, index) => (
                <li key={`${message.receivedAt}-${index}`}>
                  <span>Severity {message.severity}</span>
                  <p>{message.text}</p>
                  <Freshness receivedAt={message.receivedAt} now={now} />
                </li>
              ))}
          </ol>
        ) : (
          <p>No status text received.</p>
        )}
      </section>
    </div>
  );
}

async function readResponse<T>(response: Response): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Aircraft service returned an unreadable response (${response.status}).`);
  }
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Aircraft service request failed (${response.status}).`;
    throw new Error(message);
  }
  return body as T;
}

export function AircraftPanel(props: { project: Project; saved?: boolean; onClose: () => void }) {
  if (!isZorroStopStoryboard(props.project) && !props.project.cues.some((cue) => cue.benchCue))
    return <FlightMissionPanel {...props} />;
  return <BenchAircraftPanel {...props} />;
}

function BenchAircraftPanel({ project, saved = true, onClose }: { project: Project; saved?: boolean; onClose: () => void }) {
  const review = useMemo(() => {
    try { return { plan: compileStoryboardBenchPlan(project), error: '' }; }
    catch (error) { return { plan: undefined, error: error instanceof Error ? error.message : 'Storyboard cannot run.' }; }
  }, [project]);
  const planError = !saved ? 'Save this storyboard before running it. Resolve the local storage error first.' : review.error;
  const [ports, setPorts] = useState<AircraftPort[]>([]);
  const [path, setPath] = useState(DEFAULT_PORT);
  const [portsLoading, setPortsLoading] = useState(false);
  const [portError, setPortError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [actionError, setActionError] = useState('');
  const [observation, setObservation] = useState<{
    snapshot: AircraftSnapshot;
    receivedAt: number;
  } | null>(null);
  const [clock, setClock] = useState(Date.now);
  const [selectedId, setSelectedId] = useState('');
  const [qgcClosed, setQgcClosed] = useState(false);
  const [propsRemoved, setPropsRemoved] = useState(false);
  const [pending, setPending] = useState<AircraftAction | null>(null);
  const [motorPulseAircraftId, setMotorPulseAircraftId] = useState('');
  const [refresh, setRefresh] = useState(0);
  const mounted = useRef(false);
  const portRequest = useRef<AbortController | null>(null);
  const actionRequest = useRef<AbortController | null>(null);
  const showClient = useRef<BenchShowClient | null>(null);
  const onIdleSnapshot = useCallback((latest: AircraftSnapshot) => {
    setObservation(previous => previous && previous.snapshot.now > latest.now
      ? previous : { snapshot: latest, receivedAt: Date.now() });
  }, []);

  useEffect(() => {
    const client = new BenchShowClient({ onError: (message) => {
      if (mounted.current) setActionError(message);
    }, onSnapshot: (snapshot) => {
      if (mounted.current) setObservation((previous) =>
        previous && previous.snapshot.now > snapshot.now ? previous : { snapshot, receivedAt: Date.now() });
    } });
    showClient.current = client;
    const hide = () => {
      if (document.visibilityState !== 'visible') void client.stop().catch(() => {});
    };
    const leave = () => client.dispose();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    return () => {
      client.dispose();
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
      if (showClient.current === client) showClient.current = null;
    };
  }, [review.plan?.source.planKey, saved]);

  const refreshPorts = useCallback(async () => {
    portRequest.current?.abort();
    const controller = new AbortController();
    portRequest.current = controller;
    setPortsLoading(true);
    setPortError('');
    try {
      const result = await readResponse<{ ports: AircraftPort[] }>(
        await fetch('/api/aircraft/ports', { signal: controller.signal, cache: 'no-store' })
      );
      if (!controller.signal.aborted && mounted.current) setPorts(result.ports);
    } catch (error) {
      if (!controller.signal.aborted && mounted.current)
        setPortError(error instanceof Error ? error.message : 'Could not enumerate serial ports.');
    } finally {
      if (portRequest.current === controller && mounted.current) setPortsLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshPorts();
    const timer = window.setInterval(() => setClock(Date.now()), 500);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      portRequest.current?.abort();
      actionRequest.current?.abort();
    };
  }, [refreshPorts]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const snapshot = await readResponse<AircraftSnapshot>(
          await fetch('/api/aircraft/status', { signal: controller.signal, cache: 'no-store' })
        );
        if (!controller.signal.aborted) {
          showClient.current?.observe(snapshot);
          setObservation((previous) => previous && previous.snapshot.now > snapshot.now
            ? previous : { snapshot, receivedAt: Date.now() });
          setStatusError('');
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setStatusError(
            error instanceof Error ? error.message : 'Could not read aircraft telemetry.'
          );
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 500);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [refresh]);

  const command = async (action: AircraftAction, pulse?: MotorChecks & { motor: MotorNumber }) => {
    if (showActive && !['disconnect'].includes(action)) return;
    if (
      action === 'connect' &&
      (!qgcClosed || !propsRemoved || !ports.some((port) => port.path === path))
    )
      return;
    if (
      action === 'motor-test' &&
      (!pulse?.propsRemoved ||
        !pulse.areaClear ||
        !pulse.hardwareCool ||
        motorPulseBlockReason({
          snapshot,
          aircraft: selected,
          now,
          busy: Boolean(pending),
          serviceUnavailable: Boolean(statusError),
        }))
    )
      return;
    if (
      action === 'motor-test-stop' &&
      !motorStopAvailable(
        snapshot,
        selected,
        pending === 'motor-test' && motorPulseAircraftId === selected?.id
      )
    )
      return;
    if (actionRequest.current) {
      if (action !== 'disconnect' && action !== 'motor-test-stop') return;
      actionRequest.current.abort();
    }
    const controller = new AbortController();
    actionRequest.current = controller;
    setPending(action);
    if (action === 'motor-test') setMotorPulseAircraftId(selected!.id);
    setActionError('');
    try {
      await readResponse(
        await fetch(`/api/aircraft/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Lucidity-Aircraft': '1' },
          body: JSON.stringify(
            action === 'connect'
              ? { path, baudRate: 115200 }
              : action === 'motor-test'
                ? { aircraftId: selected?.id, ...pulse }
                : action === 'request-telemetry' || action === 'motor-test-stop'
                  ? { aircraftId: selected?.id }
                  : {}
          ),
          signal: controller.signal,
        })
      );
      if (!controller.signal.aborted && mounted.current) setRefresh((value) => value + 1);
    } catch (error) {
      if (!controller.signal.aborted && mounted.current)
        setActionError(
          error instanceof Error ? error.message : 'The aircraft command could not be completed.'
        );
    } finally {
      if (actionRequest.current === controller) {
        actionRequest.current = null;
        if (mounted.current) setPending(null);
      }
    }
  };

  const snapshot = observation?.snapshot;
  const now = observation
    ? observation.snapshot.now + Math.max(0, clock - observation.receivedAt)
    : clock;
  const aircraft = snapshot?.aircraft ?? [];
  const selected = aircraft.find((item) => item.id === selectedId) ?? aircraft[0];
  const link = snapshot?.link;
  const idleActive = snapshot?.zorroStop && ['arming', 'running', 'stopping'].includes(snapshot.zorroStop.state);
  const showActive = Boolean(idleActive || snapshot?.benchShow?.state === 'running' || snapshot?.benchShow?.state === 'stopping');
  const startShow = async (checks: MotorChecks) => {
    const client = showClient.current;
    if (!client || !selected || pending || showActive || !review.plan || planError ||
      motorPulseBlockReason({ snapshot, aircraft: selected, now, busy: false, serviceUnavailable: Boolean(statusError) })) return;
    setPending('bench-show/start');
    setActionError('');
    try {
      const result = await client.start(selected.id, checks, structuredClone(project), review.plan.source.planKey);
      if (mounted.current) setObservation((previous) => previous && previous.snapshot.now > result.now ? previous : { snapshot: result, receivedAt: Date.now() });
    } catch (error) {
      if (mounted.current) setActionError(error instanceof Error ? error.message : 'Show could not start.');
    } finally { if (mounted.current) setPending(null); }
  };
  const stopShow = async () => {
    setPending('bench-show/stop');
    setActionError('');
    try {
      // End our lease immediately. Explicit Stop can also cancel a run started in another view.
      const result = await showClient.current?.stop();
      const stopped = result ?? (snapshot?.benchShow && await readResponse<AircraftSnapshot>(await fetch('/api/aircraft/bench-show/stop', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lucidity-Aircraft': '1' },
        body: JSON.stringify({ runId: snapshot.benchShow.runId }), signal: AbortSignal.timeout(2000),
      })));
      if (mounted.current && stopped) setObservation((previous) => previous && previous.snapshot.now > stopped.now ? previous : { snapshot: stopped, receivedAt: Date.now() });
    } catch (error) {
      if (mounted.current) setActionError(error instanceof Error ? error.message : 'Stop unconfirmed. Check the motors.');
    } finally { if (mounted.current) setPending(null); }
  };
  const connected = link?.state === 'listening' || link?.state === 'connecting';
  const chosenPortPresent = ports.some((port) => port.path === path);
  const staleCount = aircraft.filter(
    (item) => aircraftFreshness(item.heartbeat.receivedAt, now).stale
  ).length;
  const linkLabel = !link
    ? 'Waiting for service'
    : link.state === 'listening'
      ? link.transmittedBytes
        ? 'Listening · commands sent'
        : 'Listening · receive only'
      : link.state === 'connecting'
        ? 'Opening serial port'
        : link.state === 'error'
          ? 'Connection error'
          : 'Disconnected';

  return (
    <Modal title="Run storyboard" onClose={() => { showClient.current?.dispose(); onClose(); }}>
      <div
        className="aircraft-workspace"
        onKeyDown={(event) => {
          if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
        }}
      >
        <div className="aircraft-workspace-banner">
          <span>
            <Radio size={14} /> {isZorroStopStoryboard(project) ? 'Props-off idle' : project.name}
          </span>
          <span className="aircraft-receive-badge">
            <ShieldCheck size={13} /> Propellers off
          </span>
        </div>
        <div className="aircraft-workspace-body">
          <aside className="aircraft-connection">
            <div className="aircraft-section-heading">
              <span>
                <Usb size={14} /> Serial connection
              </span>
              <button
                type="button"
                aria-label="Refresh serial ports"
                title="Refresh ports"
                disabled={portsLoading}
                onClick={() => void refreshPorts()}
              >
                <RefreshCw size={13} className={portsLoading ? 'aircraft-spin' : ''} />
              </button>
            </div>
            <label className="aircraft-field">
              Detected port
              <select
                aria-label="Aircraft serial port"
                value={path}
                disabled={connected || Boolean(pending)}
                onChange={(event) => setPath(event.target.value)}
              >
                {!chosenPortPresent && <option value={path}>{path} · not detected</option>}
                {ports.map((port) => (
                  <option key={port.path} value={port.path}>
                    {port.path}
                  </option>
                ))}
              </select>
            </label>
            <div className="aircraft-port-note">
              {ports.find((port) => port.path === path)?.manufacturer ??
                (portsLoading
                  ? 'Enumerating serial devices…'
                  : chosenPortPresent
                    ? 'Detected serial device'
                    : 'Plug in the ground ESP32 radio, then refresh ports.')}
            </div>
            <div className="aircraft-baud">
              <span>Baud rate</span>
              <strong>115200</strong>
              <small>Fixed for this test</small>
            </div>
            <div className="aircraft-checks">
              <label>
                <input
                  type="checkbox"
                  checked={qgcClosed}
                  onChange={(event) => setQgcClosed(event.target.checked)}
                />{' '}
                QGroundControl is closed
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={propsRemoved}
                  onChange={(event) => setPropsRemoved(event.target.checked)}
                />{' '}
                Propellers are removed
              </label>
            </div>
            <div className="aircraft-connection-actions">
              <button
                className="aircraft-connect-button"
                type="button"
                disabled={
                  !snapshot ||
                  Boolean(statusError) ||
                  connected ||
                  Boolean(pending) ||
                  showActive ||
                  snapshot?.motorTest?.state === 'pending' ||
                  !qgcClosed ||
                  !propsRemoved ||
                  !chosenPortPresent
                }
                onClick={() => void command('connect')}
              >
                <Radio size={14} />
                {pending === 'connect' ? 'Opening port…' : 'Connect drone'}
              </button>
              <button
                type="button"
                disabled={!link || link.state === 'disconnected' || pending === 'disconnect' || showActive}
                onClick={() => void command('disconnect')}
              >
                <Unplug size={13} />
                {pending === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
            <div className="aircraft-connection-actions">
              <button
                type="button"
                onClick={() => void command('request-telemetry')}
                disabled={
                  !selected ||
                  link?.state !== 'listening' ||
                  Boolean(pending) ||
                  showActive ||
                  snapshot?.motorTest?.state === 'pending' ||
                  !qgcClosed ||
                  !propsRemoved ||
                  Boolean(statusError) ||
                  selected.heartbeat.armed ||
                  selected.signing !== 'unsigned' ||
                  aircraftFreshness(selected.heartbeat.receivedAt, now).stale
                }
              >
                <Activity size={14} />{' '}
                {pending === 'request-telemetry' ? 'Checking return link…' : 'Request telemetry'}
              </button>
            </div>
            {snapshot?.request && (
              <p
                className={
                  snapshot.request.state === 'failed' || snapshot.request.state === 'partial'
                    ? 'aircraft-error'
                    : 'aircraft-port-note'
                }
                role="status"
              >
                <strong>Last request result: </strong>
                {snapshot.request.message}
              </p>
            )}
            {(portError || actionError) && (
              <p className="aircraft-error" role="alert">
                {actionError || portError}
              </p>
            )}
            <div
              className={`aircraft-link-status${link?.state === 'listening' ? ' is-listening' : ''}`}
            >
              <i />
              <strong>{linkLabel}</strong>
            </div>
            {link && (
              <details className="aircraft-advanced-link"><summary>Connection details</summary>
                <p className="aircraft-link-path">{link.path ?? 'No open port'}</p>
                <dl className="aircraft-link-counters">
                  <Metric label="Received">{link.bytesReceived.toLocaleString()} bytes</Metric>
                  <Metric label="Valid packets">{link.packetsReceived.toLocaleString()}</Metric>
                  <Metric label="Rejected frames">{link.invalidFrames.toLocaleString()}</Metric>
                  <Metric label="Transmitted">
                    {link.transmittedBytes.toLocaleString()} bytes
                  </Metric>
                </dl>
                <Freshness receivedAt={link.lastPacketAt} now={now} />
              </details>
            )}
          </aside>
          <main className="aircraft-main">
            {(statusError || link?.error) && (
              <div className="aircraft-error" role="alert">
                <strong>
                  {statusError ? 'Telemetry service unavailable' : 'Serial link error'}
                </strong>
                <p>{statusError || link?.error}</p>
                {observation && <span>Last received values are retained; check their ages.</span>}
              </div>
            )}
            {staleCount > 0 && (
              <div className="aircraft-stale-notice" role="status">
                Heartbeat stale for {staleCount}{' '}
                {staleCount === 1 ? 'aircraft' : 'aircraft sources'} · last values are historical,
                not a live connection.
              </div>
            )}
            {isZorroStopStoryboard(project) ? <ZorroStopTestPanel
              project={project} snapshot={snapshot} aircraft={selected} now={now}
              serviceUnavailable={Boolean(statusError)} onSnapshot={onIdleSnapshot}
            /> : <BenchShowPanel
              snapshot={snapshot} aircraft={selected} now={now} busy={Boolean(pending)}
              serviceUnavailable={Boolean(statusError)} plan={review.plan} planError={planError}
              onStart={(checks) => void startShow(checks)} onStop={() => void stopShow()}
            />}
            {!isZorroStopStoryboard(project) && <details className="aircraft-secondary-test">
              <summary>Individual motor diagnostics</summary>
            <MotorBenchPanel
              snapshot={snapshot}
              aircraft={selected}
              now={now}
              busy={Boolean(pending) || showActive}
              pulsePending={pending === 'motor-test' && motorPulseAircraftId === selected?.id}
              stopPending={pending === 'motor-test-stop'}
              serviceUnavailable={Boolean(statusError)}
              onPulse={(motor, checks) => void command('motor-test', { motor, ...checks })}
              onStop={() => void command('motor-test-stop')}
            />
            </details>}
            <details className="aircraft-advanced-telemetry"><summary>Aircraft and telemetry details</summary>
            <div className="aircraft-fleet-heading">
              <span>
                Detected aircraft <b>{aircraft.length}</b>
              </span>
              <small>Sources received on this serial link</small>
            </div>
            {aircraft.length ? (
              <div className="aircraft-fleet" role="group" aria-label="Physical aircraft sources">
                {aircraft.map((item) => {
                  const stale = aircraftFreshness(item.heartbeat.receivedAt, now).stale;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={selected?.id === item.id}
                      disabled={showActive}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <span>
                        <Radio size={15} />
                        <strong>System {item.systemId}</strong>
                        <small>Component {item.componentId}</small>
                      </span>
                      <span className={stale ? 'is-stale' : ''}>
                        {stale ? 'Heartbeat stale' : 'Heartbeat received'}
                      </span>
                      <code>{item.id}</code>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="aircraft-empty">
                <div>
                  <Radio size={30} />
                </div>
                <h2>
                  {connected ? 'Listening for the first heartbeat' : 'Connect your physical drone'}
                </h2>
                <p>
                  {connected
                    ? 'The port is open. An aircraft appears only after a real MAVLink heartbeat arrives.'
                    : 'Choose the detected USB port and complete the two bench checks. Nothing connects automatically.'}
                </p>
                <span>Attitude, GPS, and battery remain unknown until received.</span>
              </div>
            )}
            {selected && <AircraftTelemetryDetails aircraft={selected} now={now} />}
            </details>
          </main>
        </div>
      </div>
    </Modal>
  );
}
