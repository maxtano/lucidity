import { WorkspaceNavigation, useWorkspaceNavigation } from './WorkspaceNavigation';
import { MusicConnection } from './MusicConnection';
import { SoundLibrary, DroneSound } from './SoundLibrary';
import { AudioImport } from './AudioImport';
import { useSoundPlayer } from './sound-player';
import type { AircraftContext } from './useAircraft';
import { useEffect, useState } from 'react';
import { Download, Play, Plus, Save, Square, Trash2, Volume2, Music2, Upload, SlidersHorizontal, Usb } from 'lucide-react';
import { motifs, noteName, tuneToRtttl, validateTune, type Tune } from './music-model';
import { downloadFile, errorText } from './client';
const KEY = 'lucidity.motor-tunes.v1'; // gitleaks:allow -- public localStorage key

function MelodyScore({ tune }: { tune: Tune }) {
  const beats = tune.notes.reduce((sum, note) => sum + note.beats, 0);
  const seconds = tune.bpm > 0 ? ((beats * 60) / tune.bpm).toFixed(1) : '—';
  let cursor = 0;
  return (
    <div className="music-score">
      <div>
        <span>MELODY / PITCH & DURATION</span>
        <span>
          {tune.notes.length} NOTES · {seconds}s
        </span>
      </div>
      <svg
        viewBox="0 0 600 90"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Melody score: ${tune.notes.length} notes, ${seconds} seconds. Edit pitches and durations below.`}
      >
        {[12, 32, 52, 72].map((y) => (
          <path key={y} d={`M0 ${y}h600`} stroke="var(--ds-border)" strokeDasharray="2 5" />
        ))}
        {tune.notes.map((note, i) => {
          const x = beats ? (cursor / beats) * 600 : 0;
          const width = beats ? (note.beats / beats) * 600 : 0;
          cursor += note.beats;
          const y = note.midi === null ? 78 : 73 - ((note.midi - 48) / 47) * 64;
          return (
            <g key={i}>
              <rect
                x={x + 1}
                y={y}
                width={Math.max(0.5, width - 3)}
                height={note.midi === null ? 2 : 6}
                rx="2"
                fill={note.midi === null ? 'var(--ds-text-subtle)' : 'var(--ds-mauve)'}
                opacity={0.65 + (i % 3) * 0.15}
              />
              {tune.notes.length <= 16 && (
                <text x={x + 2} y={y - 6} fill="var(--ds-text-muted)" fontSize="11" fontFamily="monospace">
                  {note.midi === null ? 'REST' : noteName(note.midi)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function Music({ active, device, draft }: { active: boolean; device: AircraftContext; draft?: Tune }) {
  const navigation = useWorkspaceNavigation();
  const [tune, setTune] = useState<Tune>(structuredClone(motifs[0])),
    [saved, setSaved] = useState<Tune[]>([]),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [storageInvalid, setStorageInvalid] = useState(false);
  const player = useSoundPlayer(active);
  const playing = !!player.playing;
  const stop = player.stop;
  useEffect(() => { if (draft) { stop(); setTune(structuredClone(draft)); } }, [draft]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const list = JSON.parse(raw);
        if (!Array.isArray(list) || list.length > 50)
          throw new Error('Saved tune library is invalid. Existing data was preserved.');
        setSaved(list.map(validateTune));
      }
    } catch (e) {
      setStorageInvalid(true);
      setError(errorText(e));
    }
  }, []);
  const preview = async () => {
    setError('');
    try { await player.play(tune); } catch (e) { setError(errorText(e)); }
  };
  const edit = (fn: (t: Tune) => Tune) => {
    stop();
    setTune(fn);
    setMessage('');
  };
  return (
    <section className="platform-stack">
      <WorkspaceNavigation active={active}>
        <nav className="app-local-navigation" aria-label="Music navigation">
          {[
            { id: 'music-sounds', label: 'Sound library', Icon: Music2 },
            { id: 'music-saved', label: 'Saved tunes', Icon: Save },
            { id: 'music-import', label: 'Import audio', Icon: Upload },
            { id: 'melody-editor', label: 'Compose a sound', Icon: SlidersHorizontal },
            { id: 'music-connect', label: 'Motor melody setup', Icon: Usb },
          ].map(({ id, label, Icon }) => (
            <button key={id} onClick={() => {
              navigation?.dismiss();
              const section = document.getElementById(id);
              section?.scrollIntoView({ block: 'start', behavior: 'smooth' });
              section?.focus({ preventScroll: true });
            }}><Icon size={16} />{label}</button>
          ))}
        </nav>
      </WorkspaceNavigation>
      <div className="platform-page-heading workspace-heading-row">
        <h1>Music</h1>
        <span className="platform-pill"><Volume2 size={14} />Your drone’s sound library</span>
      </div>
      <div id="music-connect" tabIndex={-1}><MusicConnection device={device} /></div>
      <div id="music-sounds" tabIndex={-1}><SoundLibrary active={active} device={device} onEdit={t => { edit(() => t); document.getElementById('melody-editor')?.scrollIntoView({ behavior: 'smooth' }); }} /></div>
      <section id="music-saved" tabIndex={-1} className="platform-card" aria-labelledby="saved-tunes-heading">
        <h2 id="saved-tunes-heading">Saved tunes</h2>
        {saved.length ? (
          <div className="platform-actions">
            {saved.map((m, i) => (
              <button
                className="platform-button"
                key={i}
                aria-pressed={JSON.stringify(tune) === JSON.stringify(m)}
                onClick={() => {
                  edit(() => structuredClone(m));
                  document.getElementById('melody-editor')?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                {m.name}
              </button>
            ))}
          </div>
        ) : <p>Save a melody from the composer to keep it here.</p>}
      </section>
      <div id="music-import" tabIndex={-1}><AudioImport active={active} /></div>
      <div className="platform-stack" id="melody-editor" tabIndex={-1}>

        <div className="platform-stack">
          <div className="platform-card">
            <h2>Melody composer</h2>
            <div className="platform-form-row">
              <label>
                Tune name
                <input
                  value={tune.name}
                  maxLength={60}
                  onChange={(e) => edit((t) => ({ ...t, name: e.target.value }))}
                />
              </label>
              <label className="music-tempo">
                Tempo
                <input
                  type="number"
                  min={60}
                  max={240}
                  value={tune.bpm}
                  onChange={(e) => edit((t) => ({ ...t, bpm: Number(e.target.value) }))}
                />
              </label>
            </div>
            <MelodyScore tune={tune} />
            <div className="music-sequence" aria-label="Melody notes">
              {tune.notes.map((note, i) => (
                <div className="music-note" key={i}>
                  <span>{String(i + 1).padStart(2, '0')}</span>
                  <select
                    aria-label={`Pitch ${i + 1}`}
                    value={note.midi ?? 'rest'}
                    onChange={(e) =>
                      edit((t) => ({
                        ...t,
                        notes: t.notes.map((n, index) =>
                          index === i
                            ? {
                                ...n,
                                midi: e.target.value === 'rest' ? null : Number(e.target.value),
                              }
                            : n
                        ),
                      }))
                    }
                  >
                    <option value="rest">Rest</option>
                    {Array.from({ length: 48 }, (_, j) => (
                      <option key={j} value={j + 48}>
                        {noteName(j + 48)}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`Length ${i + 1}`}
                    value={note.beats}
                    onChange={(e) =>
                      edit((t) => ({
                        ...t,
                        notes: t.notes.map((n, index) =>
                          index === i ? { ...n, beats: Number(e.target.value) } : n
                        ),
                      }))
                    }
                  >
                    {[0.125, 0.25, 0.5, 1, 2, 4].map((b) => (
                      <option key={b} value={b}>
                        {b} beat{b === 1 ? '' : 's'}
                      </option>
                    ))}
                  </select>
                  <button
                    aria-label={`Remove note ${i + 1}`}
                    onClick={() =>
                      edit((t) => ({ ...t, notes: t.notes.filter((_, index) => index !== i) }))
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <button
                className="music-add"
                disabled={tune.notes.length >= 128}
                onClick={() =>
                  edit((t) => ({ ...t, notes: [...t.notes, { midi: 72, beats: 0.5 }] }))
                }
              >
                <Plus size={22} />
                Add note
              </button>
            </div>
            <div className="platform-actions">
              <button
                className="platform-primary"
                onClick={() => (playing ? stop() : void preview())}
              >
                {playing ? <Square size={15} /> : <Play size={15} />}{' '}
                {playing ? 'Stop preview' : 'Play on computer'}
              </button>
              <button
                className="platform-button"
                disabled={storageInvalid}
                onClick={() => {
                  try {
                    const valid = validateTune(tune);
                    const next = [valid, ...saved.filter((t) => t.name !== valid.name)].slice(
                      0,
                      50
                    );
                    localStorage.setItem(KEY, JSON.stringify(next));
                    setSaved(next);
                    setMessage('Tune saved on this device.');
                  } catch (e) {
                    setError(errorText(e));
                  }
                }}
              >
                <Save size={14} />
                Save tune
              </button>
              <button
                className="platform-button"
                onClick={() => {
                  try {
                    downloadFile('lucidity-tune.rtttl', tuneToRtttl(tune), 'text/plain');
                  } catch (e) {
                    setError(errorText(e));
                  }
                }}
              >
                <Download size={14} />
                Export RTTTL
              </button>
            </div>
          </div>
          <div className="platform-card music-device">
            <h3>Use this melody on your drone</h3>
            <p>Happy with your sound? Save it as the tune your motors play when the drone powers on.</p>
            <DroneSound tune={tune} device={device} active={active} />
          </div>
        </div>
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
    </section>
  );
}
