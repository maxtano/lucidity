import { useEffect, useState } from 'react';
import { Octagon, Zap } from 'lucide-react';
import type { AircraftSnapshot, AircraftTelemetry } from '../aircraft/types';

export type MotorNumber = 1 | 2 | 3 | 4;
export type MotorChecks = { propsRemoved: boolean; areaClear: boolean; hardwareCool: boolean };
const unchecked: MotorChecks = { propsRemoved: false, areaClear: false, hardwareCool: false };

/** Stop stays available for our own test even if motor firmware reports armed or telemetry ages. */
export function motorStopAvailable(
  snapshot: AircraftSnapshot | undefined,
  aircraft: AircraftTelemetry | undefined,
  pulsePending: boolean
) {
  return Boolean(
    aircraft &&
      snapshot?.link.state === 'listening' &&
      (pulsePending || snapshot.motorTest?.aircraftId === aircraft.id)
  );
}

export function motorPulseBlockReason({
  snapshot,
  aircraft,
  now,
  busy,
  serviceUnavailable,
}: {
  snapshot?: AircraftSnapshot;
  aircraft?: AircraftTelemetry;
  now: number;
  busy: boolean;
  serviceUnavailable: boolean;
}): string | null {
  if (!snapshot || serviceUnavailable) return 'Wait for the telemetry service to reconnect.';
  if (snapshot.link.state !== 'listening')
    return 'Connect the serial link to enable a motor pulse.';
  if (!aircraft || snapshot.aircraft.length !== 1)
    return 'A motor pulse requires exactly one detected aircraft.';
  if (
    aircraft.componentId !== 1 ||
    aircraft.heartbeat.autopilot !== 3 ||
    aircraft.heartbeat.vehicleType !== 2
  )
    return 'Motor pulses require an ArduPilot quadcopter autopilot.';
  if (aircraft.signing !== 'unsigned')
    return 'This link cannot send motor commands to a signed aircraft.';
  if (
    !Number.isFinite(aircraft.heartbeat.receivedAt) ||
    aircraft.heartbeat.receivedAt > now ||
    now - aircraft.heartbeat.receivedAt >= 5000
  )
    return 'Wait for a fresh aircraft heartbeat.';
  if (aircraft.heartbeat.armed) return 'The aircraft must report disarmed before a new pulse.';
  if (snapshot.benchShow?.state === 'running' || snapshot.benchShow?.state === 'stopping')
    return 'Stop the bench show before an individual motor test.';
  if (busy || snapshot.request?.state === 'pending' || snapshot.motorTest?.state === 'pending')
    return 'Wait for the current command to finish.';
  if (
    aircraft.version?.flightVersion !== '4.7.1' ||
    aircraft.version.releaseType !== 255 ||
    snapshot.request?.aircraftId !== aircraft.id ||
    (snapshot.request.state !== 'verified' && snapshot.request.state !== 'partial') ||
    snapshot.link.connectedAt === null ||
    snapshot.request.startedAt < snapshot.link.connectedAt ||
    aircraft.version.receivedAt < snapshot.link.connectedAt
  )
    return 'Click Request telemetry to verify this drone before the bench sample. Firmware 4.7.1 is required.';
  if (snapshot.motorTest && now < snapshot.motorTest.availableAt)
    return `Cooldown · wait ${Math.ceil((snapshot.motorTest.availableAt - now) / 1000)} s before another pulse.`;
  return null;
}

export function MotorBenchPanel({
  snapshot,
  aircraft,
  now,
  busy,
  pulsePending,
  stopPending,
  serviceUnavailable,
  onPulse,
  onStop,
}: {
  snapshot?: AircraftSnapshot;
  aircraft?: AircraftTelemetry;
  now: number;
  busy: boolean;
  pulsePending: boolean;
  stopPending: boolean;
  serviceUnavailable: boolean;
  onPulse: (motor: MotorNumber, checks: MotorChecks) => void;
  onStop: () => void;
}) {
  const [checks, setChecks] = useState<MotorChecks>(unchecked);
  const [motor, setMotor] = useState<MotorNumber>(1);
  const [sampleLoaded, setSampleLoaded] = useState(false);
  const [assignedIdentity, setAssignedIdentity] = useState('');
  const [operatorObservation, setOperatorObservation] = useState('');
  const identity = `${snapshot?.link.path}/${snapshot?.link.connectedAt}/${snapshot?.link.state}/${aircraft?.id}`;
  useEffect(() => {
    setChecks(unchecked);
    setAssignedIdentity('');
    setOperatorObservation('');
  }, [identity]);
  useEffect(() => setOperatorObservation(''), [snapshot?.motorTest?.startedAt]);
  const assigned = sampleLoaded && assignedIdentity === identity;
  const blocked = !sampleLoaded
    ? 'Open the bench sample to begin.'
    : !assigned
      ? 'Connect and assign the physical aircraft to Drone 1.'
      : motorPulseBlockReason({ snapshot, aircraft, now, busy, serviceUnavailable });
  const checked = checks.propsRemoved && checks.areaClear && checks.hardwareCool;
  const result = snapshot?.motorTest?.aircraftId === aircraft?.id ? snapshot?.motorTest : undefined;
  const observationReady = Boolean(
    result && result.state !== 'pending' && now >= result.availableAt
  );
  const resultLabel = result
    ? {
        pending: 'Awaiting acknowledgement',
        accepted: 'Command accepted · rotation unconfirmed',
        rejected: 'Command rejected',
        unconfirmed: 'Command result unconfirmed',
        'stop-requested': 'Stop requested · verify the motors',
      }[result.state]
    : '';

  return (
    <section className="aircraft-motor-bench" aria-label="Physical motor bench test">
      <div className="aircraft-first-heading">
        <span className="aircraft-eyebrow">FIRST BENCH SAMPLE / 1 DRONE</span>
        <span className="aircraft-motor-badge">
          <Zap size={11} /> Moves real motors
        </span>
      </div>
      <h2>Sample → your drone → result.</h2>
      <p>
        One drone · motor {String.fromCharCode(64 + motor)} pulse · <strong>5% · 1 second</strong>.
      </p>
      <ol className="aircraft-bench-steps" aria-label="Bench sample steps">
        <li>Open sample</li>
        <li>Connect &amp; assign</li>
        <li>Review</li>
        <li>Run</li>
        <li>Result</li>
      </ol>
      <div className="aircraft-bench-setup">
        <div>
          <span className="aircraft-eyebrow">SAMPLE</span>
          {sampleLoaded ? (
            <p className="aircraft-sample-loaded">Bench sample opened · Drone 1</p>
          ) : (
            <button type="button" onClick={() => setSampleLoaded(true)}>
              Open bench sample
            </button>
          )}
          <small>
            This sample sends a motor test, not your show’s flight trajectory. No export is needed.
          </small>
        </div>
        <div>
          <span className="aircraft-eyebrow">PHYSICAL ASSIGNMENT</span>
          {assigned && aircraft ? (
            <p className="aircraft-sample-loaded">
              Drone 1 → System {aircraft.systemId} / Component {aircraft.componentId}
            </p>
          ) : (
            <button
              type="button"
              disabled={
                !sampleLoaded ||
                !aircraft ||
                snapshot?.link.state !== 'listening' ||
                busy ||
                snapshot.aircraft.length !== 1
              }
              onClick={() => {
                setAssignedIdentity(identity);
                setChecks(unchecked);
              }}
            >
              {aircraft
                ? `Assign Drone 1 to System ${aircraft.systemId} / Component ${aircraft.componentId}`
                : 'Connect a drone to assign Drone 1'}
            </button>
          )}
          <small>
            {assigned
              ? 'Assigned to this live connection. Reconnection requires a new assignment.'
              : 'Use Serial connection, then Request telemetry to identify the drone.'}
          </small>
        </div>
      </div>
      <div
        className="aircraft-motor-checks"
        role="group"
        aria-label="Review before running the sample"
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
              disabled={!assigned}
              checked={checks[key]}
              onChange={(event) =>
                setChecks((current) => ({ ...current, [key]: event.target.checked }))
              }
            />
            {label}
          </label>
        ))}
      </div>
      <div className="aircraft-motor-pulses">
        <label>
          Motor test order
          <select
            aria-label="Motor test order"
            value={motor}
            disabled={busy || !sampleLoaded}
            onChange={(event) => {
              setMotor(Number(event.target.value) as MotorNumber);
              setChecks(unchecked);
            }}
          >
            {([1, 2, 3, 4] as const).map((number) => (
              <option key={number} value={number}>
                Motor {String.fromCharCode(64 + number)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={Boolean(blocked) || !checked}
          onClick={() => {
            if (blocked || !checked) return;
            onPulse(motor, checks);
            setChecks(unchecked);
            setOperatorObservation('');
          }}
        >
          <Zap size={13} />
          Run bench sample · 1s
        </button>
      </div>
      <p className="aircraft-motor-readiness" role="status">
        {blocked ||
          (checked
            ? 'Ready for one pulse. Recheck before each test.'
            : 'Confirm all three checks before each pulse.')}
      </p>
      <div className="aircraft-motor-stop-row">
        <button
          className="aircraft-motor-stop"
          type="button"
          disabled={!motorStopAvailable(snapshot, aircraft, pulsePending) || stopPending}
          onClick={onStop}
        >
          <Octagon size={13} />
          {stopPending ? 'Requesting stop…' : 'Request motor stop'}
        </button>
        <span>If a motor continues, disconnect battery power.</span>
      </div>
      {result && (
        <div className={`aircraft-motor-result is-${result.state}`}>
          <div role="status">
            <strong>
              Motor {String.fromCharCode(64 + result.motor)} · {resultLabel}
            </strong>
            <p>{result.message}</p>
          </div>
          {result.state !== 'pending' && (
            <div
              className="aircraft-operator-result"
              role="group"
              aria-label="Your observed motor result"
            >
              <span>Your observation · separate from controller acknowledgement</span>
              <div>
                <button
                  type="button"
                  disabled={!observationReady}
                  aria-pressed={operatorObservation === 'Motor moved and stopped'}
                  onClick={() => setOperatorObservation('Motor moved and stopped')}
                >
                  Motor moved and stopped
                </button>
                <button
                  type="button"
                  disabled={!observationReady}
                  aria-pressed={operatorObservation === 'No movement'}
                  onClick={() => setOperatorObservation('No movement')}
                >
                  No movement
                </button>
              </div>
              {!observationReady && (
                <p>Wait for the pulse and cooldown to finish, then record what you observed.</p>
              )}
              {operatorObservation && (
                <p role="status">
                  Operator observed: {operatorObservation}.
                  {operatorObservation === 'No movement'
                    ? ' The sample stays at 5%.'
                    : ' Bench sample complete.'}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      <p className="aircraft-motor-note">
        A–D are motor test order, not verified physical positions. USB alone does not power the
        motors. If 5% produces no movement, do not increase it automatically.
      </p>
      <p className="aircraft-motor-note">
        No takeoff or flight-mode change; firmware briefly enables motor output. Acknowledgement
        does not prove rotation or that motors stopped.
      </p>
    </section>
  );
}
