import { useId } from 'react';

/** Decorative artwork is deliberately independent of aircraft state. */
export function LucidityMark({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M16 1v9M16 22v9M1 16h9M22 16h9M5.4 5.4l6.4 6.4M20.2 20.2l6.4 6.4M5.4 26.6l6.4-6.4M20.2 11.8l6.4-6.4"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="m16 9 7 7-7 7-7-7Z" fill="currentColor" />
    </svg>
  );
}

export function DroneStudy() {
  const id = useId().replaceAll(':', '');
  return (
    <figure className="drone-study">
      <svg viewBox="0 0 460 330" fill="none" aria-hidden="true">
        <defs>
          <linearGradient
            id={`${id}-body`}
            x1="175"
            y1="95"
            x2="273"
            y2="219"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="var(--ds-surface-raised)" />
            <stop offset=".5" stopColor="var(--ds-surface)" />
            <stop offset="1" stopColor="var(--ds-surface-inset)" />
          </linearGradient>
          <linearGradient
            id={`${id}-arm`}
            x1="120"
            y1="90"
            x2="320"
            y2="240"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="var(--ds-border-strong)" />
            <stop offset="1" stopColor="var(--ds-accent-border)" />
          </linearGradient>
          <pattern id={`${id}-grid`} width="22" height="22" patternUnits="userSpaceOnUse">
            <path d="M22 0H0v22" stroke="var(--ds-text-subtle)" strokeWidth=".5" opacity=".16" />
          </pattern>
        </defs>
        <rect width="460" height="330" fill={`url(#${id}-grid)`} />
        <g stroke="var(--ds-border)" strokeWidth=".75">
          <ellipse cx="230" cy="182" rx="198" ry="107" />
          <ellipse cx="230" cy="182" rx="163" ry="87" strokeDasharray="2 6" />
          <path d="M230 35v272M19 182h422" strokeDasharray="2 7" />
          <path d="M39 38v-9h9M412 29h9v9M39 292v9h9M412 301h9v-9" />
        </g>
        <g className="drone-study-airframe">
          <ellipse cx="230" cy="237" rx="100" ry="16" fill="var(--ds-shadow-color)" opacity=".7" />
          <g stroke={`url(#${id}-arm)`} strokeWidth="17" strokeLinecap="round">
            <path d="m207 153-75-59m121 59 75-59m-121 88-88 54m134-54 88 54" />
          </g>
          <g stroke="var(--ds-accent)" strokeWidth="1.2" opacity=".75">
            <path d="m207 146-75-59m121 59 75-59m-121 88-88 54m134-54 88 54" />
          </g>
          <path
            d="m203 128 54 0 20 35-17 40h-60l-17-40Z"
            fill={`url(#${id}-body)`}
            stroke="var(--ds-accent)"
          />
          <path
            d="m203 128 10-9h34l10 9M183 163l10 7 8 33M277 163l-10 7-7 33M207 203l-6 15m52-15 6 15"
            stroke="var(--ds-border-strong)"
          />
          <rect x="214" y="145" width="32" height="40" rx="2" fill="var(--ds-surface-inset)" stroke="var(--ds-border)" />
          <path d="M219 154h22m-22 6h22m-22 6h22m-22 6h22" stroke="var(--ds-accent-border)" strokeWidth="1.2" />
          <path d="m225 134 5-7 5 7Z" fill="var(--ds-accent)" />
          <circle cx="230" cy="193" r="2.5" fill="var(--ds-accent)" />
          {[
            [132, 91],
            [328, 91],
            [119, 232],
            [341, 232],
          ].map(([x, y], i) => (
            <g key={i}>
              <ellipse
                cx={x}
                cy={y}
                rx="50"
                ry="22"
                fill="var(--ds-accent)"
                fillOpacity=".035"
                stroke="var(--ds-accent)"
                strokeOpacity=".6"
              />
              <ellipse cx={x} cy={y} rx="42" ry="17" stroke="var(--ds-border-strong)" strokeDasharray="2 4" />
              <path d={`M${x - 6} ${y}v9q6 5 12 0v-9`} fill="var(--ds-surface)" stroke="var(--ds-border-strong)" />
              <ellipse cx={x} cy={y} rx="7" ry="4" fill="var(--ds-text-muted)" />
              <path
                d={`m${x - 35} ${y - 9}q25-4 35 9m35 9q-25 4-35-9`}
                stroke="var(--ds-accent)"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </g>
          ))}
        </g>
        <g stroke="var(--ds-border-strong)" strokeWidth=".8">
          <path d="m332 59 20-18h45M129 251l-20 22H64" />
          <circle cx="332" cy="59" r="2" fill="var(--ds-accent)" />
          <circle cx="129" cy="251" r="2" fill="var(--ds-feature)" />
        </g>
        <g fill="var(--ds-text-muted)" fontSize="11" letterSpacing="1.5" fontFamily="monospace">
          <text x="356" y="34">
            AIRFRAME
          </text>
          <text x="58" y="288">
            QUADROTOR / ISOMETRIC
          </text>
          <text x="54" y="50">
            L / 01
          </text>
        </g>
      </svg>
      <figcaption>
        <span>QUAD / CONCEPT STUDY</span>
        <span>ILLUSTRATION / NOT TELEMETRY</span>
      </figcaption>
    </figure>
  );
}

export function WorkspaceArt({ kind }: { kind: 'tools' | 'music' | 'show' | 'code' }) {
  return (
    <svg
      viewBox="0 0 240 90"
      className={`workspace-art art-${kind}`}
      fill="none"
      aria-hidden="true"
    >
      {kind === 'tools' && (
        <>
          <path d="M25 45h54m82 0h54M120 12v13m0 40v13" stroke="currentColor" opacity=".35" />
          <rect x="87" y="16" width="66" height="58" rx="2" stroke="currentColor" opacity=".55" />
          <rect x="99" y="27" width="42" height="36" rx="3" stroke="currentColor" />
          {[0, 1, 2, 3].map((i) => (
            <g key={i} stroke="currentColor">
              <path d={`M79 ${29 + i * 11}h8m66 0h8`} />
              <circle cx={35 + i * 57} cy="82" r="1" opacity=".4" />
            </g>
          ))}
          <path d="m112 45 6 6 12-14" stroke="currentColor" strokeWidth="1.5" />
        </>
      )}
      {kind === 'music' &&
        Array.from({ length: 37 }, (_, i) => {
          const height = 8 + Math.abs(Math.sin(i * 0.65) * Math.sin(i * 0.16)) * 60;
          return (
            <path
              key={i}
              d={`M${12 + i * 6} ${45 - height / 2}v${height}`}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              opacity={0.3 + 0.7 * Math.sin((i / 37) * Math.PI)}
            />
          );
        })}
      {kind === 'show' && (
        <>
          {[0, 1, 2, 3, 4].map((r) => (
            <g key={r}>
              {Array.from({ length: 9 }, (_, i) => {
                const x = 28 + i * 23,
                  y = 16 + r * 14 + Math.sin(i * 0.8 + r * 0.5) * 10;
                return (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r={1.2 + Math.sin(i + r) ** 2 * 0.7}
                    fill="currentColor"
                    opacity={0.35 + (i % 3) * 0.25}
                  />
                );
              })}
            </g>
          ))}
          <path
            d="M25 69c65-70 130 26 190-36"
            stroke="currentColor"
            strokeDasharray="2 5"
            opacity=".25"
          />
        </>
      )}
      {kind === 'code' && (
        <g stroke="currentColor" strokeWidth="1.4">
          <path d="m51 31-16 14 16 14m138-28 16 14-16 14m-59-36-20 44" />
          <path d="M72 28h37M72 39h24m48 12h23m-29 12h29" opacity=".3" />
        </g>
      )}
    </svg>
  );
}
