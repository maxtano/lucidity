import { useEffect, useRef, useState } from 'react';
import { errorText } from './client';
import { stopSound } from './sound-player';

/** Local file preview only. Recordings are not ESC melodies. */
export function AudioImport({ active }: { active: boolean }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [error, setError] = useState('');
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  useEffect(() => { if (!active) audio.current?.pause(); }, [active]);
  const load = (file?: File) => {
    if (!file) return;
    setError('');
    if (file.size > 40 * 1024 * 1024) { setError('Choose an audio file under 40 MB.'); return; }
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|ogg|flac)$/i.test(file.name)) { setError('Choose an MP3, WAV, M4A, OGG, or FLAC audio file.'); return; }
    audio.current?.pause(); stopSound();
    setDuration(0); setStart(0); setEnd(0); setName(file.name); setUrl(URL.createObjectURL(file));
  };
  return <section className="platform-card audio-import" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); load(e.dataTransfer.files[0]); }}>
    <h2>Import audio</h2>
    <p>Drop a song here or choose a file. Listen to a clip on your computer, then use the composer to recreate its melody.</p>
    <label className="platform-button">Choose audio <input type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac" onChange={e => { load(e.target.files?.[0]); e.target.value = ''; }} /></label>
    <p><small>Files stay on this computer and are available until you reload. YouTube links cannot be converted here. Import a local audio file instead.</small></p>
    {url && <><h3>{name}</h3><audio ref={audio} src={url} controls preload="metadata" onPlay={stopSound} onLoadedMetadata={e => {
      const d = e.currentTarget.duration;
      if (!Number.isFinite(d) || d <= 0) { setError('Could not read the duration of this file.'); return; }
      setDuration(d); setEnd(Math.min(d, 10));
    }} onError={() => setError('This browser cannot decode the file. Try MP3 or WAV.')} onTimeUpdate={e => { if (end > start && e.currentTarget.currentTime >= end) e.currentTarget.pause(); }} />
    <div className="platform-form-row"><label>Clip start (seconds)<input type="number" min={0} max={duration} step={.1} value={start} onChange={e => { audio.current?.pause(); setStart(Number(e.target.value)); }} /></label><label>Clip end (seconds)<input type="number" min={0} max={duration} step={.1} value={end} onChange={e => { audio.current?.pause(); setEnd(Number(e.target.value)); }} /></label></div>
    <button className="platform-button" disabled={!duration || start < 0 || end <= start || end > duration} onClick={async () => { try { if (audio.current) { audio.current.currentTime = start; await audio.current.play(); } } catch (e) { setError(errorText(e)); } }}>Play selected clip</button>
    <p><small>Drone buzzers and ESCs play notes, not MP3 recordings. This clip is a reference, not an installable startup sound.</small></p></>}
    {error && <p role="alert" className="platform-error">{error}</p>}
  </section>;
}
