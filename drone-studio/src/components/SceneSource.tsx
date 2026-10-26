import { useState } from 'react';
import { Check, Code2 } from 'lucide-react';
import { cueSchema, type Cue } from '../core/model';

export function SceneSource({
  cue,
  revision,
  onApply,
}: {
  cue: Cue;
  revision: number;
  onApply: (cue: Cue, revision: number) => boolean;
}) {
  const [source, setSource] = useState(() => JSON.stringify(cue, null, 2)),
    [error, setError] = useState('');
  const [baseRevision] = useState(revision);
  const [scrollTop, setScrollTop] = useState(0);
  return (
    <div className="scene-source">
      <p>
        Edit the scene directly. <code>droneEdits</code> maps drone IDs to positions, colors,
        brightness, flashing, and independently keyed channels. Coordinates are ENU meters; key
        times are scene-local seconds.
      </p>
      <div className="source-toolbar">
        <span>
          <Code2 size={13} />
          {cue.id}.scene.json
        </span>
        <span>Revision {baseRevision}</span>
      </div>
      <div className="source-editor">
        <div aria-hidden="true">
          <pre style={{ transform: `translateY(${-scrollTop}px)` }}>
            {source
              .split('\n')
              .map((_, i) => i + 1)
              .join('\n')}
          </pre>
        </div>
        <textarea
          aria-label="Scene JSON source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault();
              const input = e.currentTarget,
                a = input.selectionStart,
                b = input.selectionEnd;
              setSource(source.slice(0, a) + '  ' + source.slice(b));
              requestAnimationFrame(() => {
                input.selectionStart = input.selectionEnd = a + 2;
              });
            }
          }}
        />
      </div>
      {error && (
        <p className="source-error" role="alert">
          {error}
        </p>
      )}
      <div className="source-actions">
        <span>One atomic edit · Undo available</span>
        <button
          className="primary-button"
          onClick={() => {
            try {
              const next = cueSchema.parse(JSON.parse(source));
              setError('');
              onApply(next, baseRevision);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Invalid scene data.');
            }
          }}
        >
          <Check size={13} />
          Apply scene
        </button>
      </div>
      <details>
        <summary>Point and keyframe example</summary>
        <pre>{`"droneEdits": {
  "1": {
    "position": [12, 0, 65],
    "color": "#ff5e9c",
    "brightness": 0.8,
    "flash": { "hz": 2, "duty": 0.5, "phase": 0 },
    "keyframes": [
      { "time": 0, "position": [12, 0, 65], "easing": "smooth" },
      { "time": 10, "position": [-12, 0, 85], "color": "#55ddff" }
    ]
  }
}`}</pre>
      </details>
    </div>
  );
}
