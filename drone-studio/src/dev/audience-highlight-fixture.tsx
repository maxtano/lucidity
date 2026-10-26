import { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { targetingEvaluation } from '../agent/evaluation-targeting';
import { totalDuration } from '../core/model';
import { Stage } from '../components/Stage';
import '../styles.css';

let root: Root | undefined;
import.meta.hot?.dispose(() => root?.unmount());

/** An owned synthetic document: no provider, saved-show state, or authoring callbacks. */
function Fixture() {
  const [fixture] = useState(() => targetingEvaluation.fixture().request);
  const [project, setProject] = useState(() => ({
    ...fixture.project,
    id: 'audience-highlight-fixture',
  }));
  const [selection, setSelection] = useState(() => [...fixture.selection]);
  const [time, setTime] = useState(fixture.time);
  const [playing, setPlaying] = useState(false);
  const [focused, setFocused] = useState(false);
  const duration = totalDuration(project);

  useEffect(() => {
    if (!playing) return;
    const startTime = time;
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const next = Math.min(duration, startTime + (now - startedAt) / 1000);
      setTime(next);
      if (next === duration) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // The running clock owns its initial time; only pause/start rebases it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration]);

  const seek = (next: number) => {
    if (!Number.isFinite(next)) return;
    setPlaying(false);
    setTime(Math.max(0, Math.min(duration, next)));
  };

  return (
    <main style={{ margin: '20px auto', padding: '0 20px 20px', maxWidth: 1440 }}>
      <p style={{ color: '#b7cc9f', fontSize: 12 }}>DEVELOPMENT FIXTURE · SYNTHETIC DOCUMENT</p>
      <h1 style={{ margin: '6px 0 10px', fontSize: 24 }}>Preview audience matches</h1>
      <p style={{ margin: '0 0 12px', maxWidth: 980, lineHeight: 1.5 }}>
        The front grid contains 200 dark lights and 200 lit lights; 200 dark lights are behind you.
        Open Select from audience view, find the dark lights in frame, then preview the matches.
        Highlight rings should reveal the dark points without brightening them or changing the
        artist selection. Show data and transform gestures are not saved or authored here; reloading
        resets this synthetic document.
      </p>
      <div
        role="group"
        aria-label="Synthetic fixture controls"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
          marginBottom: 10,
        }}
      >
        <button
          className="primary-button"
          onClick={() => {
            if (!playing && time === duration) setTime(0);
            setPlaying((value) => !value);
          }}
        >
          {playing ? 'Pause synthetic playback' : 'Play synthetic show'}
        </button>
        <label>
          Show time{' '}
          <input
            aria-label="Synthetic show time"
            type="number"
            min={0}
            max={duration}
            step={0.1}
            value={Number(time.toFixed(3))}
            onChange={(event) => seek(event.currentTarget.valueAsNumber)}
            style={{ width: 90 }}
          />{' '}
          / {duration} s
        </label>
        <button
          onClick={() => {
            setPlaying(false);
            setProject((current) => ({
              ...structuredClone(current),
              revision: current.revision + 1,
            }));
          }}
        >
          Advance synthetic revision
        </button>
        <button onClick={() => setSelection([...fixture.selection])}>
          Restore original selection
        </button>
      </div>
      <div
        aria-label="Synthetic fixture state"
        style={{ marginBottom: 12, fontSize: 13, lineHeight: 1.6 }}
      >
        <div>
          Project revision: <strong>{project.revision}</strong>
        </div>
        <div>
          Original selection: {fixture.selection.length} drones · IDs {fixture.selection.join(', ')}
        </div>
        <div style={{ maxHeight: 58, overflow: 'auto', overflowWrap: 'anywhere' }}>
          Current selection: <strong>{selection.length} drones</strong> · IDs{' '}
          {selection.length ? selection.join(', ') : 'none'}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          height: 'min(70vh, 760px)',
          minHeight: 420,
          border: '1px solid #303846',
          borderRadius: 'var(--radius-panel)',
          overflow: 'hidden',
        }}
      >
        <Stage
          project={project}
          time={time}
          playing={playing}
          focused={focused}
          onFocus={() => setFocused((value) => !value)}
          selection={selection}
          onPick={(ids, additive) =>
            setSelection((current) =>
              additive ? [...new Set([...current, ...ids])].sort((a, b) => a - b) : [...ids]
            )
          }
          onTransform={() => {}}
          onEditStart={() => setPlaying(false)}
          onSeek={seek}
          initialViewerSnapshot={fixture.viewer?.current.snapshot}
        />
      </div>
    </main>
  );
}

if (import.meta.env.DEV) {
  root = createRoot(document.getElementById('root')!);
  root.render(<Fixture />);
} else {
  document.getElementById('root')!.textContent =
    'This synthetic fixture is available only in the local dev server.';
}
