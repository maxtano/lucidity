import { useState } from 'react';
import { api, errorText } from './client';
import type { AircraftContext } from './useAircraft';
import type { DroneBridgeInfo } from './dronebridge';

export function DroneBridgeRecovery({ device }: { device: AircraftContext }) {
  const [role, setRole] = useState<'ground' | 'air'>('ground');
  const [info, setInfo] = useState<DroneBridgeInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const check = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try { setInfo(await api<DroneBridgeInfo>('workbench/dronebridge/input')); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const restore = async () => {
    if (!confirmed || !info?.reachable || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ message: string }>(`workbench/dronebridge/${role}-mode`, role === 'ground'
        ? { confirmedGroundRadio: true } : { confirmedAirRadio: true });
      setMessage(result.message);
      setInfo(null);
      setConfirmed(false);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  return <div className="platform-card connection-card">
    <h2>DroneBridge radio check</h2>
    <p>A listening USB port can receive the ground radio’s own heartbeat even when the aircraft link is down. Check for a live aircraft in Lucidity first.</p>
    <details className="radio-recovery-guide">
      <summary>Connection lost? Quick recovery</summary>
      <ol>
        <li>With props off, power the aircraft and check GROUND USB above. A fresh aircraft heartbeat is the pass condition.</li>
        <li>If AIR setup Wi-Fi is visible, join it, select Aircraft air radio below, and restore air mode. Return to normal Wi-Fi and check again.</li>
        <li>If still disconnected, check AIR UART input twice before restoring air mode. Rising decoded MAVLink counts point to the AIR–GROUND radio link; do not reset or reflash blindly.</li>
      </ol>
    </details>
    <div className="platform-form-row"><label>Radio connected to this Mac’s setup Wi-Fi
      <select value={role} onChange={(e) => { setRole(e.target.value as 'ground' | 'air'); setInfo(null); setConfirmed(false); setMessage(''); }}>
        <option value="ground">USB ground radio</option>
        <option value="air">Aircraft air radio</option>
      </select>
    </label></div>
    <div className="platform-actions">
      <button className="platform-button" type="button" onClick={() => void check()} disabled={busy}>Check radio</button>
    </div>
    {info && <p className={info.reachable ? 'platform-notice' : 'platform-error'} role="status">{info.message}{info.reachable && ` Firmware ${info.version}.`}</p>}
    {info?.serialBytes !== undefined && <p>UART input: {info.serialBytes.toLocaleString()} bytes · {info.decodedMavlink?.toLocaleString()} decoded MAVLink messages. Check again after a few seconds to see whether both rise.</p>}
    {info?.reachable && <>
      <p>Restore {role === 'ground' ? 'GROUND' : 'AIR'} ESP-NOW mode after checking. This changes only the mode and reboots the radio; binding, channel, and link secrets stay untouched.</p>
      <label className="platform-check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />This Wi-Fi page belongs to my {role === 'ground' ? 'USB ground' : 'aircraft air'} ESP32-C6, and the drone propellers are removed.</label>
      <button className="platform-primary" type="button" disabled={!confirmed || busy || device.snapshot?.link.state !== 'disconnected'} onClick={() => void restore()}>Restore {role === 'ground' ? 'ground' : 'air'} mode</button>
      {device.snapshot?.link.state !== 'disconnected' && <p>Disconnect the USB link above first.</p>}
    </>}
    {message && <p className="platform-notice" role="status">{message}</p>}
    {error && <p className="platform-error" role="alert">{error}</p>}
  </div>;
}
