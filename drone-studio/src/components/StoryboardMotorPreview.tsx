import type { StoryboardBenchPlan } from '../core/bench-storyboard';
import './StoryboardMotorPreview.css';

export const storyboardMotorName = (motor: number) => String.fromCharCode(64 + motor);

/** This is a preview of authored cue timing, never feedback from a physical motor. */
export function storyboardMotorFrame(plan: StoryboardBenchPlan, time: number) {
  const durationMs = Number.isFinite(plan.durationMs) ? Math.max(0, plan.durationMs) : 0;
  const elapsedMs = Number.isFinite(time) ? Math.max(0, Math.min(durationMs, time * 1000)) : 0;
  return {
    elapsedMs,
    cue: plan.cues.find((cue) => elapsedMs >= cue.atMs && elapsedMs < cue.atMs + 1000),
    progress: durationMs > 0 ? elapsedMs / durationMs : 0,
  };
}

type Props = {
  plan: StoryboardBenchPlan;
  /** Editor playback time, in seconds. */
  time: number;
  onSeek?: (seconds: number) => void;
  /** Hide pulse emphasis when a physical schedule has ended at a frozen time. */
  highlightPulse?: boolean;
};

export function StoryboardMotorPreview({ plan, time, onSeek, highlightPulse = true }: Props) {
  const frame = storyboardMotorFrame(plan, time);
  const visibleCue = highlightPulse ? frame.cue : undefined;
  const motorPositions = [
    { motor: 1, x: 140, y: 41 },
    { motor: 2, x: 140, y: 119 },
    { motor: 3, x: 50, y: 119 },
    { motor: 4, x: 50, y: 41 },
  ];
  const cueDescription = visibleCue
    ? `${visibleCue.sceneName}: motor ${storyboardMotorName(visibleCue.motor)}, 5% for 1 second`
    : highlightPulse ? 'No scheduled pulse at this time' : 'Schedule ended; no pulse highlighting';

  return (
    <section className="storyboard-motor-preview" aria-label="Storyboard motor channel preview">
      <div className="storyboard-motor-overview">
        <svg
          className="storyboard-motor-drone"
          viewBox="0 0 190 161"
          role="img"
          aria-label={`Simulated motor channel preview. ${cueDescription}. Schematic positions, not measured movement.`}
        >
          <path d="M50 41L140 119M140 41L50 119" className="storyboard-motor-arms" />
          <rect x="79" y="60" width="32" height="40" rx="4" className="storyboard-motor-body" />
          <path d="M95 48L91 55H99Z" className="storyboard-motor-front" />
          {motorPositions.map(({ motor, x, y }) => (
            <g key={motor} className={visibleCue?.motor === motor ? 'is-active' : ''}>
              <circle cx={x} cy={y} r="23" className="storyboard-motor-ring" />
              <circle cx={x} cy={y} r="17" className="storyboard-motor-disc" />
              <text x={x} y={y + 4} textAnchor="middle">{storyboardMotorName(motor)}</text>
            </g>
          ))}
          <text x="95" y="157" textAnchor="middle" className="storyboard-motor-view-label">TOP VIEW · SCHEMATIC</text>
        </svg>
        <div className="storyboard-motor-caption">
          <span>STORYBOARD PREVIEW · SIMULATED</span>
          <strong>{visibleCue ? visibleCue.sceneName : highlightPulse ? 'No scheduled pulse' : 'Schedule ended'}</strong>
          <p>{visibleCue ? `Motor ${storyboardMotorName(visibleCue.motor)} · 5% · 1 second` : 'The diagram previews the authored motor channel.'}</p>
          <output aria-label="Storyboard motor preview time">
            {(frame.elapsedMs / 1000).toFixed(1)} / {plan.durationMs / 1000} s
          </output>
          <small>Preview only. Motor positions are schematic.</small>
        </div>
      </div>
      <div className="storyboard-motor-track" aria-hidden="true">
        <span style={{ width: `${frame.progress * 100}%` }} />
        {plan.cues.map((cue) => (
          <i
            key={cue.sceneId}
            className={visibleCue?.sceneId === cue.sceneId ? 'is-active' : ''}
            style={{ left: `${plan.durationMs > 0 ? (cue.atMs / plan.durationMs) * 100 : 0}%` }}
          />
        ))}
      </div>
      <ol className="storyboard-motor-cues" aria-label="Authored motor cues">
        {plan.cues.map((cue) => (
          <li key={cue.sceneId} className={visibleCue?.sceneId === cue.sceneId ? 'is-active' : ''}>
            {onSeek ? (
              <button type="button" onClick={() => onSeek(cue.atMs / 1000)} aria-label={`Preview ${cue.sceneName}, motor ${storyboardMotorName(cue.motor)} at ${cue.atMs / 1000} seconds`}>
                <b>{storyboardMotorName(cue.motor)}</b><span>{cue.sceneName}</span><time>{cue.atMs / 1000}s</time>
              </button>
            ) : (
              <div><b>{storyboardMotorName(cue.motor)}</b><span>{cue.sceneName}</span><time>{cue.atMs / 1000}s</time></div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
