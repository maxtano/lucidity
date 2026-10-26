import { Pause, Play, RotateCcw } from 'lucide-react';
import { useDraftPreviewPlayback } from './useDraftPreviewPlayback';
import {
  FIRST_FLIGHT_DURATION_S,
  FIRST_FLIGHT_HEIGHT_M,
  firstFlightPreviewAt,
} from './first-flight-preview';

const profile = Array.from({ length: 91 }, (_, index) => {
  const time = index / 10;
  return `${42 + time * 30},${100 - (firstFlightPreviewAt(time).altitudeM / FIRST_FLIGHT_HEIGHT_M) * 63}`;
}).join(' ');

export function FirstFlightRehearsal() {
  const playback = useDraftPreviewPlayback(0, FIRST_FLIGHT_DURATION_S);
  const frame = firstFlightPreviewAt(playback.time);
  const x = 42 + playback.time * 30;
  const y = 100 - (frame.altitudeM / FIRST_FLIGHT_HEIGHT_M) * 63;

  return (
    <details
      className="aircraft-first-preview"
      onToggle={(event) => {
        if (!event.currentTarget.open) playback.pause();
      }}
    >
      <summary>
        Preview height study <span>Up 1 ft · hover · down</span>
      </summary>
      <div className="aircraft-first-heading">
        <span className="aircraft-eyebrow">01 / FLIGHT PREVIEW</span>
        <span className="aircraft-simulation-badge">Simulation only</span>
      </div>
      <h2>One drone. Up, hover, down.</h2>
      <p>Idealized path: up 1 ft (0.3048 m) in 2 s · hover 4 s · down in 3 s.</p>
      <svg
        className="aircraft-preview-profile"
        viewBox="0 0 360 130"
        role="img"
        aria-label={`Simulated altitude profile: ${frame.phase.toLowerCase()}, ${(frame.altitudeM / 0.3048).toFixed(2)} feet at ${playback.time.toFixed(1)} seconds. Not aircraft telemetry.`}
      >
        <path d="M42 37H315M42 100H315" stroke="var(--ds-border)" strokeDasharray="3 4" />
        <g fill="var(--ds-text-muted)" fontSize="9" fontFamily="var(--font-mono)">
          <text x="4" y="40">
            1 ft
          </text>
          <text x="4" y="103">
            0 ft
          </text>
          <text x="39" y="122">
            0s
          </text>
          <text x="100" y="122">
            2s
          </text>
          <text x="226" y="122">
            6s
          </text>
          <text x="300" y="122">
            9s
          </text>
          <text x="181" y="22" textAnchor="middle">
            HOVER · 4s
          </text>
        </g>
        <polyline points={profile} fill="none" stroke="var(--ds-accent)" strokeWidth="2" />
        <path d={`M${x} ${y + 8}V107`} stroke="var(--ds-border-strong)" strokeDasharray="2 3" />
        <g
          transform={`translate(${x} ${y})`}
          stroke="var(--ds-text)"
          strokeWidth="1.7"
          fill="var(--ds-surface-raised)"
          strokeLinecap="round"
        >
          <path d="M-9 0H9M0 -4V4" />
          <ellipse cx="-10" cy="-3" rx="5" ry="2" />
          <ellipse cx="10" cy="-3" rx="5" ry="2" />
          <rect x="-4" y="-3" width="8" height="6" rx="2" />
        </g>
      </svg>
      <div className="aircraft-preview-controls">
        <button type="button" onClick={playback.togglePlaying}>
          {playback.playing ? <Pause size={13} /> : <Play size={13} />}
          {playback.playing
            ? 'Pause preview'
            : playback.time >= 9
              ? 'Replay simulation'
              : playback.time > 0
                ? 'Resume preview'
                : 'Preview simulation'}
        </button>
        <button
          type="button"
          onClick={playback.restart}
          aria-label="Reset flight simulation"
          title="Reset preview"
        >
          <RotateCcw size={13} />
        </button>
        <span>
          {frame.phase} <b>{playback.time.toFixed(1)} / 9 s</b>
        </span>
      </div>
      <p className="aircraft-preview-note">
        This animation sends no hardware commands. It does not measure or control the aircraft’s height.
      </p>
    </details>
  );
}
