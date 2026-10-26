import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Play, Save } from 'lucide-react';
import type { EscStartupPlan, EscStartupStatus } from '../aircraft/esc-startup-types';
import type { Tune } from './music-model';
import { tuneSeconds } from './music-model';
import { encodeBluejayMelody } from './bluejay-melody';
import { stopSound } from './sound-player';
import { api, errorText } from './client';
import { refreshEscPrerequisites } from './esc-client';
import { hasInstalledMelody, musicDeviceState } from './music-device';
import type { AircraftContext } from './useAircraft';

export function MelodyAction({ tune, device, mode, onClose, onBusy }: {
  tune: Tune; device: AircraftContext; mode: 'startup' | 'replay'; onClose: () => void; onBusy: (busy: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), lock = useRef(false), mounted = useRef(true);
  const [propsRemoved, setPropsRemoved] = useState(false), [powered, setPowered] = useState(false);
  const [pending, setPending] = useState(false), [phase, setPhase] = useState(''), [error, setError] = useState(''), [done, setDone] = useState('');
  const connection = useRef(device.selectedId);
  const { ready, report, installed } = musicDeviceState(device);
  const replay = mode === 'replay';
  useEffect(() => {
    mounted.current = true; stopSound(); dialog.current?.showModal();
    return () => { mounted.current = false; };
  }, []);
  const sameDrone = connection.current === device.selectedId;
  let invalid = '';
  try { encodeBluejayMelody(tune); } catch (e) { invalid = errorText(e); }
  const allowed = ready && sameDrone && !invalid && (!replay || hasInstalledMelody(report, tune));
  const current = device.snapshot?.escStartup;
  const progress = current?.aircraftId === connection.current && ['preparing', 'installing'].includes(current.state) ? current.message : phase;
  const perform = async () => {
    if (lock.current || !allowed) return;
    lock.current = true; onBusy(true); setPending(true); setError(''); setDone('');
    const aircraftId = connection.current;
    try {
      setPhase('Checking the connection…');
      await refreshEscPrerequisites(aircraftId, () => !mounted.current);
      if (!mounted.current) return;
      const checks = { aircraftId, propsRemoved, directUsb: powered };
      if (replay) {
        setPhase('Restarting the motor controllers to play your startup sound…');
        const result = await api<{ message: string }>('aircraft/esc/startup/replay', { ...checks, tune });
        setDone(result.message);
      } else {
        setPhase('Backing up your current sound…');
        const plan = await api<EscStartupPlan>('aircraft/esc/startup/prepare', { ...checks, tune, melodyOnly: true });
        if (plan.requiresFirmwareChange) throw new Error('Firmware setup is required. Open Motor melody setup at the top of Music.');
        if (!mounted.current) return; // A closed page may prepare a backup, but cannot approve a later write.
        await refreshEscPrerequisites(aircraftId, () => !mounted.current);
        if (!mounted.current) return;
        setPhase('Saving and verifying your startup sound…');
        const result = await api<EscStartupStatus>('aircraft/esc/startup/install', {
          ...checks, planId: plan.id, confirmed: true, firmwareChangeConfirmed: false,
        });
        if (result.state !== 'verified') throw new Error(result.message);
        setDone(`“${tune.name}” is now your startup sound on all four motors. The saved melody was read back and verified. Listen after a power cycle to confirm it.`);
      }
    } catch (e) { setError(errorText(e)); }
    finally { lock.current = false; onBusy(false); if (mounted.current) setPending(false); }
  };
  return createPortal(<dialog ref={dialog} className="drone-preview-dialog" aria-labelledby="melody-action-title"
    onCancel={e => { e.preventDefault(); if (!pending) onClose(); }}>
    <div className="platform-section-heading"><h2 id="melody-action-title">{replay ? 'Play on drone' : 'Set as startup'}</h2>
      <button className="platform-button" disabled={pending} aria-label="Close sound action" onClick={onClose}>Close</button></div>
    <div className="melody-action-sound"><span className="platform-eyebrow">{tuneSeconds(tune).toFixed(1)} SECOND MOTOR MELODY</span><h3>{tune.name}</h3></div>
    <p>{replay ? 'Your motor controllers will restart and play their saved startup sound. You may also hear their normal connection beeps.' : `This replaces ${installed ? `“${installed.name}”` : 'your current startup sound'} on all four motors. You’ll hear it whenever you power on the drone.`}</p>
    {!replay && <p>Lucidity backs up your settings first. Motor direction and firmware stay the same.</p>}
    {done ? <div className="platform-notice" role="status"><CheckCircle2 size={18} /><p>{done}</p></div> : <>
      <div className="drone-preview-checks">
        <label><input type="checkbox" disabled={pending} checked={propsRemoved} onChange={e => setPropsRemoved(e.target.checked)} />All propellers are removed and the drone is secure.</label>
        <label><input type="checkbox" disabled={pending} checked={powered} onChange={e => setPowered(e.target.checked)} />Direct USB and the flight battery are connected and will stay connected.</label>
      </div>
      <button className="platform-primary drone-play-button" disabled={!allowed || !propsRemoved || !powered || pending} onClick={() => void perform()}>
        {replay ? <Play size={15} /> : <Save size={15} />}{pending ? 'Working…' : replay ? 'Play on drone' : 'Set as startup'}
      </button>
    </>}
    {pending && <p role="status">{progress} Keep USB and battery connected.</p>}
    {invalid && <p className="platform-error" role="alert">{invalid}</p>}
    {error && <p className="platform-error" role="alert">{error}</p>}
    {!allowed && !pending && !done && !invalid && <p role="status">{!sameDrone ? 'The connected drone changed. Close this window and check setup.' : 'Check the connection and motor setup at the top of Music.'}</p>}
    {!replay && !pending && !done && <small>Saving takes a little longer than computer playback. Keep this window open until verification finishes.</small>}
  </dialog>, document.body);
}
