import { useEffect, useState } from 'react';
import { Activity, Crosshair, LoaderCircle, RefreshCw, Usb } from 'lucide-react';
import type { AircraftSnapshot, AircraftTelemetry } from '../aircraft/types';
import type { LevelCalibrationResult } from '../aircraft/level-calibration';
import { Badge, Button, Card, Notice } from '../design-system';
import type { AircraftContext } from './useAircraft';
import { api, errorText } from './client';
import './LevelCalibration.css';

type BenchCheck = 'propsRemoved' | 'batteryDisconnected' | 'physicallyLevel' | 'still' | 'directUsb';
type BenchChecks = Record<BenchCheck, boolean>;
const emptyChecks = (): BenchChecks => ({
  propsRemoved: false,
  batteryDisconnected: false,
  physicallyLevel: false,
  still: false,
  directUsb: false,
});

const fresh = (receivedAt: number | undefined, now: number) =>
  receivedAt !== undefined && Number.isFinite(receivedAt) &&
  now >= receivedAt && now - receivedAt < 5000;

type AircraftClient = <T>(path: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
export async function requestLevelAttitude(aircraftId: string, client: AircraftClient = api) {
  const snapshot = await client<AircraftSnapshot>('aircraft/request-telemetry', { aircraftId });
  const request = snapshot.request;
  const attitude = snapshot.aircraft.find(item => item.id === aircraftId)?.attitude;
  if (request?.state === 'failed')
    return { received: false, message: request.message };
  if (attitude && fresh(attitude.receivedAt, snapshot.now) &&
      (!request || attitude.receivedAt > request.startedAt))
    return { received: true, message: 'Fresh roll and pitch received. Live readings will update above.' };
  return { received: false, message: 'No fresh roll and pitch arrived. Check the USB link and try again.' };
}

export function levelCalibrationBlockReason({
  snapshot, aircraft, now, serviceUnavailable, checks,
}: {
  snapshot: AircraftSnapshot | undefined;
  aircraft: AircraftTelemetry | undefined;
  now: number;
  serviceUnavailable: boolean;
  checks: BenchChecks;
}): string | null {
  if (serviceUnavailable) return 'The aircraft service is unavailable.';
  if (snapshot?.link.state !== 'listening' || !snapshot.link.path)
    return 'Connect the flight controller by USB.';
  if (!aircraft || !fresh(aircraft.heartbeat.receivedAt, now))
    return 'Wait for a fresh aircraft heartbeat.';
  if (snapshot.aircraft.filter(item => fresh(item.heartbeat.receivedAt, now)).length !== 1)
    return 'Only one aircraft may be responding.';
  if (aircraft.heartbeat.armed) return 'Disarm the aircraft first.';
  if (aircraft.heartbeat.autopilot !== 3 || aircraft.heartbeat.vehicleType !== 2 ||
      aircraft.componentId !== 1 || aircraft.protocolVersion !== 2 || aircraft.signing !== 'unsigned')
    return 'This action requires a directly connected ArduCopter flight controller.';
  if (fresh(aircraft.battery?.receivedAt, now) &&
      aircraft.battery?.voltageV !== null && aircraft.battery?.voltageV !== undefined &&
      aircraft.battery.voltageV >= 2)
    return 'Flight battery voltage is still reported. Unplug the flight battery.';
  if (!fresh(aircraft.attitude?.receivedAt, now)) return 'Wait for fresh roll and pitch readings.';
  if (!checks.directUsb) return 'Confirm direct flight controller USB.';
  if (!checks.propsRemoved) return 'Confirm every propeller is removed.';
  if (!checks.batteryDisconnected) return 'Confirm the flight battery is unplugged.';
  if (!checks.physicallyLevel) return 'Confirm the frame is physically level.';
  if (!checks.still) return 'Confirm the frame is stationary.';
  return null;
}

const angle = (value: number | undefined) =>
  value !== undefined && Number.isFinite(value) ? `${value.toFixed(1)}°` : 'Unavailable';
const trim = (value: number | null) =>
  value !== null && Number.isFinite(value)
    ? `${value.toFixed(5)} rad (${(value * 180 / Math.PI).toFixed(1)}°)`
    : 'Unavailable';

export function LevelCalibration({ device }: { device: AircraftContext }) {
  const [checks, setChecks] = useState<BenchChecks>(emptyChecks);
  const [pending, setPending] = useState(false);
  const [requestPending, setRequestPending] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');
  const [requestError, setRequestError] = useState('');
  const [result, setResult] = useState<LevelCalibrationResult | null>(null);
  const [error, setError] = useState('');
  const aircraft = device.aircraft;
  const heartbeatFresh = !!aircraft && !device.error && fresh(aircraft.heartbeat.receivedAt, device.now);
  const attitudeFresh = heartbeatFresh && fresh(aircraft.attitude?.receivedAt, device.now);
  const batteryPowerDetected = heartbeatFresh && fresh(aircraft.battery?.receivedAt, device.now) &&
    aircraft.battery?.voltageV !== null && aircraft.battery?.voltageV !== undefined &&
    aircraft.battery.voltageV >= 2;
  const canRequest = heartbeatFresh && device.snapshot?.link.state === 'listening' &&
    device.snapshot.aircraft.filter(item => fresh(item.heartbeat.receivedAt, device.now)).length === 1;
  const reason = levelCalibrationBlockReason({
    snapshot: device.snapshot, aircraft, now: device.now,
    serviceUnavailable: !!device.error, checks,
  });

  useEffect(() => {
    setChecks(emptyChecks());
    setError('');
    setRequestMessage('');
    setRequestError('');
  }, [device.selectedId, device.snapshot?.link.path, device.snapshot?.link.connectedAt]);

  const setCheck = (name: BenchCheck, checked: boolean) =>
    setChecks(current => ({ ...current, [name]: checked }));
  const requestAttitude = async () => {
    if (!canRequest || requestPending || pending || !aircraft) return;
    setRequestPending(true);
    setRequestMessage('');
    setRequestError('');
    try {
      const response = await requestLevelAttitude(aircraft.id);
      if (response.received) setRequestMessage(response.message);
      else setRequestError(response.message);
    } catch (cause) {
      setRequestError(errorText(cause));
    } finally {
      setRequestPending(false);
    }
  };
  const calibrate = async () => {
    if (pending || requestPending || reason || !aircraft) return;
    setPending(true);
    setError('');
    setResult(null);
    try {
      setResult(await api<LevelCalibrationResult>('aircraft/calibrate-level', {
        aircraftId: aircraft.id,
        propsRemoved: true,
        batteryDisconnected: true,
        physicallyLevel: true,
        still: true,
        directUsb: true,
        confirmed: true,
      }));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPending(false);
    }
  };

  const shownResult = result?.aircraftId === device.selectedId ? result : null;
  return <Card className="level-calibration" role="region" aria-label="Level calibration">
    <div className="level-calibration-heading">
      <div>
        <span className="platform-eyebrow">SENSOR ALIGNMENT</span>
        <h2>Calibrate level</h2>
        <p>Use the frame’s true level position to update the controller’s saved AHRS_TRIM_X/Y trim.</p>
      </div>
      <Crosshair size={22} aria-hidden="true" />
    </div>

    <div className="level-calibration-status" aria-label="Calibration readiness">
      <Badge tone={heartbeatFresh ? 'success' : 'warning'}>
        <Activity size={13} />{heartbeatFresh ? 'Fresh aircraft link' : 'Aircraft link unavailable'}
      </Badge>
      <Badge tone={heartbeatFresh && !aircraft?.heartbeat.armed ? 'success' : 'warning'}>
        {heartbeatFresh ? aircraft?.heartbeat.armed ? 'Armed' : 'Disarmed' : 'Arming state unknown'}
      </Badge>
      <Badge tone={device.snapshot?.link.state === 'listening' && checks.directUsb ? 'success' : 'warning'}>
        <Usb size={13} />{device.snapshot?.link.state === 'listening' && checks.directUsb
          ? 'Direct FC USB confirmed by you' : 'Direct FC USB unconfirmed'}
      </Badge>
      {batteryPowerDetected && <Badge tone="danger">Flight battery voltage detected</Badge>}
    </div>

    <div className="level-calibration-readings" aria-label="Live attitude">
      <div><span>Live roll</span><strong>{attitudeFresh ? angle(aircraft?.attitude?.rollDeg) : 'Unavailable'}</strong></div>
      <div><span>Live pitch</span><strong>{attitudeFresh ? angle(aircraft?.attitude?.pitchDeg) : 'Unavailable'}</strong></div>
      <small>{attitudeFresh ? 'Current controller attitude · updates while connected' : 'Waiting for fresh roll and pitch telemetry'}</small>
    </div>
    <div className="level-calibration-request">
      <Button size="sm" disabled={!canRequest || requestPending || pending} aria-busy={requestPending} onClick={() => void requestAttitude()}>
        {requestPending ? <LoaderCircle className="platform-spin" size={14} /> : <RefreshCw size={14} />}
        {requestPending ? 'Requesting attitude…' : 'Request attitude'}
      </Button>
      <span>Requests live reporting from the controller; no trim is changed.</span>
    </div>
    {requestMessage && <Notice tone="success" role="status">{requestMessage}</Notice>}
    {requestError && <Notice tone="warning" role="alert">{requestError}</Notice>}

    <div className="level-calibration-preparation" role="group" aria-label="Bench checks before level calibration">
      <label className="platform-check"><input type="checkbox" checked={checks.propsRemoved} disabled={pending} onChange={e => setCheck('propsRemoved', e.target.checked)} />Every propeller is removed.</label>
      <label className="platform-check"><input type="checkbox" checked={checks.batteryDisconnected} disabled={pending} onChange={e => setCheck('batteryDisconnected', e.target.checked)} />Flight battery is unplugged.</label>
      <label className="platform-check"><input type="checkbox" checked={checks.physicallyLevel} disabled={pending} onChange={e => setCheck('physicallyLevel', e.target.checked)} />Frame rests on a physically level surface.</label>
      <label className="platform-check"><input type="checkbox" checked={checks.still} disabled={pending} onChange={e => setCheck('still', e.target.checked)} />Frame is stationary and will stay still.</label>
      <label className="platform-check"><input type="checkbox" checked={checks.directUsb} disabled={pending} onChange={e => setCheck('directUsb', e.target.checked)} />USB cable goes to the flight controller, not the radio.</label>
    </div>

    <div className="level-calibration-action">
      <Button variant="primary" disabled={!!reason || pending || requestPending} aria-busy={pending} onClick={() => void calibrate()}>
        {pending ? <LoaderCircle className="platform-spin" size={15} /> : <Crosshair size={15} />}
        {pending ? 'Calibrating level…' : 'Calibrate level'}
      </Button>
      <span role="status">{pending ? 'Waiting for the controller and trim readback…' : reason ?? 'Ready to send level calibration.'}</span>
    </div>
    {error && <Notice tone="danger" role="alert">{error}</Notice>}
    {shownResult && <Notice tone={shownResult.state === 'accepted' ? 'success' : shownResult.state === 'rejected' ? 'danger' : 'warning'} role="status" className="level-calibration-result">
      <div>
        <strong>{shownResult.state === 'accepted' ? 'Controller accepted level calibration' : shownResult.state === 'rejected' ? 'Controller rejected level calibration' : 'Level calibration unconfirmed'}</strong>
        <p>{shownResult.message}</p>
        <small>{shownResult.ack ? `Controller acknowledgment code ${shownResult.ack.result}` : 'No matching controller acknowledgment received'}</small>
      </div>
    </Notice>}
    {shownResult && <div className="level-calibration-compare">
      <h3>Controller values</h3>
      <div className="level-calibration-table-wrap"><table>
        <thead><tr><th scope="col">Reading</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
        <tbody>
          <tr><th scope="row">AHRS_TRIM_X</th><td>{trim(shownResult.before.AHRS_TRIM_X)}</td><td>{trim(shownResult.after.AHRS_TRIM_X)}</td></tr>
          <tr><th scope="row">AHRS_TRIM_Y</th><td>{trim(shownResult.before.AHRS_TRIM_Y)}</td><td>{trim(shownResult.after.AHRS_TRIM_Y)}</td></tr>
          <tr><th scope="row">Roll attitude</th><td>{angle(shownResult.before.attitude?.rollDeg)}</td><td>{angle(shownResult.after.attitude?.rollDeg)}</td></tr>
          <tr><th scope="row">Pitch attitude</th><td>{angle(shownResult.before.attitude?.pitchDeg)}</td><td>{angle(shownResult.after.attitude?.pitchDeg)}</td></tr>
        </tbody>
      </table></div>
    </div>}
    <p className="level-calibration-caution">This checks the controller’s level reference. It does not confirm that left drift is fixed; flight behavior needs a separate controlled check.</p>
  </Card>;
}
