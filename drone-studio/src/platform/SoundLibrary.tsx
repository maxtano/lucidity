import { useEffect, useState } from 'react';
import { Music2, Play, Square, SlidersHorizontal, Save, CheckCircle2 } from 'lucide-react';
import { motifs, tuneSeconds, type Tune } from './music-model';
import { useSoundPlayer } from './sound-player';
import { errorText } from './client';
import type { AircraftContext } from './useAircraft';
import { MelodyAction } from './MelodyAction';
import { hasInstalledMelody, musicDeviceState } from './music-device';

export function DroneSound({ tune, device, active = true }: { tune: Tune; device: AircraftContext; active?: boolean }) {
  const [action, setAction] = useState<'startup' | 'replay' | null>(null);
  const [pending, setPending] = useState(false);
  const { ready, configured, report, busy } = musicDeviceState(device);
  const installed = configured && hasInstalledMelody(report, tune);
  useEffect(() => { if (!active && !busy && !pending) setAction(null); }, [active, busy, pending]);
  return <>
    {installed ? <button className="platform-primary drone-play-button" disabled={!ready}
      title="Replay the sound already saved on your motors" onClick={() => setAction('replay')}><Play size={13} />Play on drone</button> :
      <button className="platform-button" disabled={!ready} title={ready ? 'Save this as the sound your motors play at power-on' : 'Complete Motor melody setup above first'}
        onClick={() => setAction('startup')}><Save size={13} />Set as startup</button>}
    {action && <MelodyAction tune={tune} device={device} mode={action} onBusy={setPending} onClose={() => setAction(null)} />}
  </>;
}

export function SoundLibrary({ device, active = true, onEdit }: { device: AircraftContext; active?: boolean; onEdit: (t: Tune) => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(motifs[0]);
  const [error, setError] = useState('');
  const player = useSoundPlayer(active);
  const { configured, report } = musicDeviceState(device);
  return <section className="platform-card sound-library" aria-labelledby="sound-library-heading">
    <div className="platform-section-heading"><div><h2 id="sound-library-heading">Sound library</h2><p>Find your drone’s hello. Listen on your computer, then make a favorite your startup sound.</p></div><span className="platform-pill"><Music2 size={14} />15 sounds</span></div>
    <p className="sound-library-help">Motor playback uses the sound saved on your drone. Set a sound as startup to unlock Play on drone.</p>
    <input aria-label="Search sounds" placeholder="Find a sound…" value={query} onChange={e => setQuery(e.target.value)} />
    <div className="sound-grid">
      {motifs.filter(t => t.name.toLowerCase().includes(query.toLowerCase())).map(t => <article aria-label={t.name} className={`sound-card ${selected.name === t.name ? 'selected' : ''}`} key={t.name}>
        <span className="platform-eyebrow">{String(motifs.indexOf(t) + 1).padStart(2, '0')} / {tuneSeconds(t).toFixed(1)} SEC</span>
        <div className="sound-card-title"><h3>{t.name}</h3>{configured && hasInstalledMelody(report, t) && <span className="sound-current-badge"><CheckCircle2 size={12} />Current startup</span>}</div>
        <svg viewBox="0 0 180 36" aria-hidden="true">{t.notes.map((n, j) => <rect key={j} x={j * 180 / t.notes.length} y={n.midi === null ? 30 : 30 - (n.midi - 48) * .6} width={180 / t.notes.length - 5} height="4" rx="2" />)}</svg>
        <div className="platform-actions"><button className="platform-button" onClick={async () => { setSelected(t); setError(''); try { if (player.playing === t.name) player.stop(); else await player.play(t); } catch (e) { setError(errorText(e)); } }}>{player.playing === t.name ? <Square size={12} /> : <Play size={12} />}{player.playing === t.name ? 'Stop' : 'Play on computer'}</button>
        <DroneSound tune={t} device={device} active={active} /></div>
      </article>)}
    </div>
    {!motifs.some(t => t.name.toLowerCase().includes(query.toLowerCase())) && <p>No sounds match “{query}”.</p>}
    <div className="sound-selection"><div><span className="platform-eyebrow">SELECTED SOUND</span><h3>{selected.name}</h3><button className="platform-text-button" onClick={() => { player.stop(); onEdit(structuredClone(selected)); }}><SlidersHorizontal size={14} />Customize melody</button></div></div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
