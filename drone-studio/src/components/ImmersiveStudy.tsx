import { useEffect, useState } from 'react';
import { ArrowDownToLine, Compass, LoaderCircle, Pause, Play, RotateCcw } from 'lucide-react';
import { parseProjectFile } from '../core/export';
import { cueStart, frameAt, totalDuration, type Project } from '../core/model';
import { timecode } from '../core/timeline';
import { Stage } from './Stage';
import './ImmersiveStudy.css';

const STUDY_URL = '/examples/immersive-study.lucid.json';

/** A separate document and transport: exploring the study never opens it as the saved project. */
export function ImmersiveStudy() {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [time, setTime] = useState(8);
  const [playing, setPlaying] = useState(false);
  const duration = project ? totalDuration(project) : 0;

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void (async () => {
      try {
        const response = await fetch(STUDY_URL, { signal: controller.signal });
        if (!response.ok) throw new Error('The surrounding show study could not be loaded.');
        const next = parseProjectFile(await response.text());
        if (!controller.signal.aborted) setProject(next);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'The study could not be loaded.');
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (!playing || !project) return;
    const started = performance.now();
    const offset = time >= duration ? 0 : time;
    let animation: number;
    const tick = () => {
      const next = Math.min(duration, offset + (performance.now() - started) / 1000);
      setTime(next);
      if (next >= duration) setPlaying(false);
      else animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [playing, project, duration]);

  if (!project)
    return (
      <div className="immersive-study-loading" role={error ? 'alert' : 'status'}>
        {error ? (
          <>
            <p>{error}</p>
            <button onClick={() => setAttempt(attempt + 1)}>Try again</button>
          </>
        ) : (
          <>
            <LoaderCircle size={18} />
            <span>Opening the surrounding sky…</span>
          </>
        )}
      </div>
    );

  const active = frameAt(project, time);
  return (
    <div className="immersive-study">
      <div className="immersive-study-intro">
        <p>
          <Compass size={14} />
          An audience at the center. A stage ahead. Light in every direction.
        </p>
        <span>
          {project.droneCount.toLocaleString()} lights · {duration}s · {project.bpm} BPM
        </span>
      </div>
      <Stage
        project={project}
        time={time}
        playing={playing}
        focused={false}
        onFocus={() => {}}
        selection={[]}
        onPick={() => {}}
        onTransform={() => {}}
        onEditStart={() => setPlaying(false)}
        onSeek={(next) => {
          setPlaying(false);
          setTime(next);
        }}
        readOnly
      />
      <div className="immersive-study-transport">
        <button
          aria-label="Restart surrounding study"
          onClick={() => {
            setPlaying(false);
            setTime(0);
          }}
        >
          <RotateCcw size={14} />
        </button>
        <button
          className="study-play"
          aria-label={playing ? 'Pause surrounding study' : 'Play surrounding study'}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <output aria-label="Study timecode">{timecode(time)}</output>
        <input
          aria-label="Surrounding study playhead"
          type="range"
          min={0}
          max={duration}
          step={1 / 30}
          value={time}
          onChange={(event) => {
            setPlaying(false);
            setTime(Number(event.target.value));
          }}
        />
        <span>{timecode(duration)}</span>
      </div>
      <div className="immersive-study-chapters" aria-label="Surrounding study chapters">
        {project.cues.map((cue, index) => (
          <button
            key={cue.id}
            aria-pressed={active.cue.id === cue.id}
            onClick={() => {
              setPlaying(false);
              setTime(cueStart(project, cue.id) + 8);
            }}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            {cue.name}
          </button>
        ))}
      </div>
      <div className="immersive-study-footer">
        <p>
          A separate, silent design study. Drag to look around, or try Behind and Sky. Your open
          show stays in place.
        </p>
        <a href={STUDY_URL} download="all-around-you.lucid.json">
          <ArrowDownToLine size={13} /> Editable show
        </a>
      </div>
    </div>
  );
}
