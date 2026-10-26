import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  LoaderCircle,
  Radio,
  RefreshCw,
  Unplug,
  Usb,
} from 'lucide-react';
import type { AircraftPort, AircraftSnapshot } from '../aircraft/types';
import { AircraftTelemetryDetails } from '../components/AircraftPanel';
import type { AircraftContext } from './useAircraft';
import { api, downloadFile, errorText } from './client';
import { DroneBridgeRecovery } from './DroneBridgeRecovery';
export function Connection({ device, compact = false, guidance, check = 'telemetry' }: { device: AircraftContext; compact?: boolean; guidance?: string; check?: 'telemetry' | 'radio' }) {
  const [ports, setPorts] = useState<AircraftPort[]>([]),
    [path, setPath] = useState(''),
    [prepared, setPrepared] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const scan = async () => {
    try {
      const data = await api<{ ports: AircraftPort[] }>('aircraft/ports');
      setPorts(data.ports);
      setPath((old) =>
        device.snapshot?.link.path ?? (data.ports.some((p) => p.path === old)
          ? old
          : data.ports.length === 1
            ? data.ports[0].path
            : '')
      );
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    void scan();
    return () => controller.current?.abort();
  }, []);
  useEffect(() => setPrepared(false), [device.snapshot?.link.connectedAt, path]);
  const run = async () => {
    if (controller.current || !prepared) return;
    const runController = new AbortController();
    controller.current = runController;
    setBusy(true);
    setError('');
    try {
      setMessage('Opening the USB connection…');
      let snapshot = await api<AircraftSnapshot>(
        'aircraft/status',
        undefined,
        runController.signal
      );
      if (snapshot.link.state !== 'listening')
        snapshot = await api<AircraftSnapshot>(
          'aircraft/connect',
          { path, baudRate: 115200 },
          runController.signal
        );
      if (snapshot.link.path !== path)
        throw new Error('A different device is connected. Disconnect it first.');
      setMessage('Listening for your drone. Keep it powered with propellers removed.');
      for (let i = 0; i < 20; i++) {
        runController.signal.throwIfAborted();
        snapshot = await api<AircraftSnapshot>('aircraft/status', undefined, runController.signal);
        const fresh = snapshot.aircraft.filter(
          (a) =>
            snapshot.now - a.heartbeat.receivedAt >= 0 &&
            snapshot.now - a.heartbeat.receivedAt < 5000
        );
        if (fresh.length > 1)
          throw new Error(
            'More than one aircraft is responding. Power only the drone you want to check.'
          );
        if (fresh.length === 1) {
          device.setSelectedId(fresh[0].id);
          if (check === 'radio') {
            setMessage('Checking receiver channels…');
            await api('aircraft/request-radio', { aircraftId: fresh[0].id }, runController.signal);
            setMessage('Receiver input received. Move the Zorro controls in Radio setup.');
            return;
          }
          setMessage('Requesting firmware and sensor readings…');
          const result = await api<AircraftSnapshot>(
            'aircraft/request-telemetry',
            { aircraftId: fresh[0].id },
            runController.signal
          );
          if (result.request?.state !== 'verified')
            throw new Error(result.request?.message ?? 'The return link is not verified yet.');
          setMessage(
            `Connection check passed at ${new Date(result.now).toLocaleTimeString()}. Firmware and sensor messages received. Live readings appear below.`
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
      throw new Error(
        'The USB port is open, but no drone heartbeat arrived. Check aircraft power and the USB or radio connection.'
      );
    } catch (e) {
      if (!runController.signal.aborted) setError(errorText(e));
    } finally {
      if (controller.current === runController) {
        controller.current = null;
        setBusy(false);
      }
    }
  };
  const disconnect = async () => {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    try {
      await api('aircraft/disconnect', {});
      setMessage('Disconnected.');
      setPrepared(false);
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <div className="platform-stack">
      <div className="platform-card connection-card">
        <div className="platform-step-icon">
          <Usb size={23} />
        </div>
        <div>
          <h2>{compact ? 'Connect drone' : 'Connect your ground radio'}</h2>
          <p>{guidance ?? 'Remove the propellers. Close other drone apps. Power the drone, then let Lucidity check the connection.'}</p>
        </div>
        <div className="platform-form-row">
          <label>
            USB device
            <select
              value={path}
              disabled={busy || device.snapshot?.link.state === 'listening'}
              onChange={(e) => setPath(e.target.value)}
            >
              <option value="">
                {ports.length ? 'Choose a device' : 'No USB devices detected'}
              </option>
              {ports.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.manufacturer ?? 'USB device'} · {p.path}
                </option>
              ))}
            </select>
          </label>
          <button className="platform-button" onClick={() => void scan()} disabled={busy}>
            <RefreshCw size={14} />
            Scan
          </button>
        </div>
        <label className="platform-check">
          <input
            type="checkbox"
            checked={prepared}
            disabled={busy}
            onChange={(e) => setPrepared(e.target.checked)}
          />
          Propellers are removed, the drone is secure, and other drone apps are closed.
        </label>
        <div className="platform-actions">
          <button
            className="platform-primary"
            disabled={!prepared || !path || busy}
            onClick={() => void run()}
          >
            {busy ? <LoaderCircle className="platform-spin" size={16} /> : <Radio size={16} />}Check
            my connection
            <ArrowRight size={16} />
          </button>
          <button className="platform-button" onClick={() => void disconnect()}>
            <Unplug size={15} />
            Disconnect
          </button>
        </div>
        {message && (
          <p className="platform-notice" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="platform-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {!compact && <DroneBridgeRecovery device={device} />}
      {!compact && (device.aircraft ? (
        <>
          <div className="platform-section-heading">
            <h2>Aircraft readings</h2>
            <button
              className="platform-button"
              onClick={() =>
                downloadFile('lucidity-diagnostics.json', JSON.stringify(device.snapshot, null, 2))
              }
            >
              Export snapshot
            </button>
          </div>
          <AircraftTelemetryDetails aircraft={device.aircraft} now={device.now} />
        </>
      ) : (
        <div className="platform-empty">
          <CheckCircle2 size={22} />
          <h3>Waiting for aircraft telemetry</h3>
        </div>
      ))}
    </div>
  );
}
