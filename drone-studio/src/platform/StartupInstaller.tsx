import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import type { Tune } from './music-model';
import { encodeBluejayMelody } from './bluejay-melody';
import type { EscStartupPlan, EscStartupStatus } from '../aircraft/esc-startup-types';
import type { AircraftContext } from './useAircraft';
import { api, downloadFile, errorText } from './client';
import { refreshEscPrerequisites } from './esc-client';

export function StartupInstaller({ tune, device, onBusy }: { tune: Tune; device: AircraftContext; onBusy: (busy: boolean) => void }) {
  const [propsRemoved, setPropsRemoved] = useState(false), [directUsb, setDirectUsb] = useState(false);
  const [confirmed, setConfirmed] = useState(false), [firmwareConfirmed, setFirmwareConfirmed] = useState(false);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const [plan, setPlan] = useState<EscStartupPlan | null>(null), [result, setResult] = useState<EscStartupStatus | null>(null);
  const mounted = useRef(true), lock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const key = JSON.stringify(tune);
  useEffect(() => { setPlan(null); setResult(null); setConfirmed(false); setFirmwareConfirmed(false); setPropsRemoved(false); setDirectUsb(false); setError(''); }, [device.selectedId, key]);
  const current = device.snapshot?.escStartup?.aircraftId === device.selectedId ? device.snapshot.escStartup : null;
  useEffect(() => {
    if (pending || plan || !current?.plan || !['ready', 'verified'].includes(current.state) || current.plan.tuneName !== tune.name) return;
    try {
      const hex = Array.from(encodeBluejayMelody(tune), byte => byte.toString(16).padStart(2, '0')).join('');
      if (current.plan.melodyHex === hex) setPlan(current.plan);
    } catch { /* Invalid melodies remain editable, but cannot restore an install plan. */ }
  }, [current, pending, plan, tune]);
  const busy = pending || current?.state === 'preparing' || current?.state === 'installing';
  useEffect(() => { onBusy(busy); }, [busy, onBusy]);
  let invalid = '';
  try { encodeBluejayMelody(tune); } catch (e) { invalid = errorText(e); }
  const expired = !!plan && device.now >= plan.expiresAt;
  const status = result ?? (current?.plan?.id === plan?.id ? current : null);
  const perform = async (install: boolean) => {
    if (lock.current) return;
    lock.current = true; setPending(true); setError(''); setResult(null);
    const aircraftId = device.selectedId;
    try {
      await refreshEscPrerequisites(aircraftId, () => !mounted.current);
      if (!mounted.current) return;
      if (install && plan) {
        setResult(await api<EscStartupStatus>('aircraft/esc/startup/install', {
          aircraftId, planId: plan.id, propsRemoved, directUsb, confirmed, firmwareChangeConfirmed: firmwareConfirmed,
        }));
      } else {
        setPlan(null); setConfirmed(false); setFirmwareConfirmed(false);
        setPlan(await api<EscStartupPlan>('aircraft/esc/startup/prepare', { aircraftId, tune, propsRemoved, directUsb }));
      }
    } catch (e) { setError(errorText(e)); if (install) setPlan(null); }
    finally { lock.current = false; setPending(false); }
  };
  return <section className="esc-inspector startup-installer" aria-label="Install motor startup melody">
    <h3>Install as startup sound</h3>
    <p>Lucidity can install this melody on J-H-40 / EFM8BB2 ESCs. Stock BLHeli_S 16.7 first needs the matching Bluejay 0.21.0 firmware. Preparation reads all four ESCs and saves a full backup.</p>
    {invalid && <p className="platform-error" role="alert">{invalid}</p>}
    <div className="drone-preview-checks">
      <label><input type="checkbox" checked={propsRemoved} disabled={busy} onChange={e => setPropsRemoved(e.target.checked)} />All propellers are removed and the drone is secure.</label>
      <label><input type="checkbox" checked={directUsb} disabled={busy} onChange={e => setDirectUsb(e.target.checked)} />Direct FC USB and flight battery are connected.</label>
    </div>
    <button className="platform-button" disabled={busy || !device.live || !propsRemoved || !directUsb || !!invalid} onClick={() => void perform(false)}>{busy ? 'Working with ESCs…' : plan ? 'Refresh backup & plan' : 'Back up & prepare installation'}</button>
    {busy && <p role="status">{current?.state === 'preparing' || current?.state === 'installing' ? current.message : 'Refreshing telemetry and passthrough settings…'} Keep USB and battery connected.</p>}
    {plan && <div className="startup-review">
      <h3>Review: {plan.tuneName}</h3>
      <p>{plan.firmware}</p>
      <div className="esc-readback-table"><table><thead><tr><th>ESC</th><th>Change</th><th>Direction preserved</th></tr></thead>
        <tbody>{plan.escs.map(esc => <tr key={esc.index}><td>{esc.index}</td><td>{esc.action === 'upgrade' ? `${esc.from} → Bluejay 0.21.0` : 'Startup melody only'}</td><td>{esc.direction}</td></tr>)}</tbody></table></div>
      {plan.requiresFirmwareChange && <p>Firmware installation changes motor-control behavior. Direction, beep volume and beacon settings are preserved; other motor settings use Bluejay defaults, including disabled temperature protection. Verify motor operation and tuning before flight. Interrupted flashing can require ESC recovery.</p>}
      <p>Backup saved on this computer. <a href={plan.firmwareUrl} target="_blank" rel="noreferrer">Official firmware ↗</a></p>
      <button className="platform-text-button" onClick={() => downloadFile('lucidity-startup-plan.json', JSON.stringify(plan, null, 2))}><Download size={14} />Download installation plan</button>
      <div className="drone-preview-checks">
        <label><input type="checkbox" disabled={busy} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Install this as the persistent startup sound on all four ESCs.</label>
        {plan.requiresFirmwareChange && <label><input type="checkbox" disabled={busy} checked={firmwareConfirmed} onChange={e => setFirmwareConfirmed(e.target.checked)} />I approve the Bluejay firmware upgrade and will keep power connected.</label>}
      </div>
      <button className="platform-primary drone-play-button" disabled={busy || !device.live || !confirmed || !propsRemoved || !directUsb || expired || plan.requiresFirmwareChange && !firmwareConfirmed || status?.state === 'verified'} onClick={() => void perform(true)}>
        {plan.requiresFirmwareChange ? 'Upgrade ESCs & install sound' : 'Install startup sound'}
      </button>
      {expired && <p>Plan expired. Refresh the backup and review again.</p>}
    </div>}
    {status?.state === 'verified' && <p className="platform-notice" role="status">{status.message}</p>}
    {error && <p className="platform-error" role="alert">{error}</p>}
    {!device.live && !busy && <p>Connect a disarmed flight controller at the top of Music to prepare installation.</p>}
  </section>;
}
