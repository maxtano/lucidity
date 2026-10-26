import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRight, Gauge, Timer } from 'lucide-react';
import type { Operation } from '../core/commands';
import { applyOperations } from '../core/commands';
import {
  cueStart,
  totalDuration,
  transitionEase,
  transitionEasingNames,
  transitionEasings,
  type Cue,
  type Project,
  type TransitionEasing,
} from '../core/model';
import {
  measureTransition,
  transitionDurationForSpeed,
  type TransitionMotion,
} from '../core/transitions';
import { PropertyNumber } from './DroneInspector';
import './TransitionInspector.css';

export type TransitionInspectorProps = {
  project: Project;
  cue: Cue;
  onApply: (operations: Operation[], revision: number) => void;
};

export function TransitionInspector({ project, cue, onApply }: TransitionInspectorProps) {
  const [speed, setSpeed] = useState(1);
  const [scaleKeys, setScaleKeys] = useState(true),
    [scaleTransition, setScaleTransition] = useState(true);
  const [targetSpeed, setTargetSpeed] = useState(project.limits.maxSpeed);
  const [measurement, setMeasurement] = useState<TransitionMotion | null>(null);
  const [error, setError] = useState('');
  const easing = cue.transitionEasing || 'smooth';
  const first = project.cues[0].id === cue.id;
  const beatDuration = 60 / project.bpm;
  const curve = useMemo(
    () =>
      Array.from(
        { length: 49 },
        (_, i) =>
          `${i === 0 ? 'M' : 'L'}${12 + (i / 48) * 208},${66 - transitionEase(i / 48, easing) * 50}`
      ).join(' '),
    [easing]
  );
  useEffect(() => {
    setMeasurement(null);
    setError('');
  }, [project, cue.id]);
  useEffect(() => {
    setSpeed(1);
  }, [cue.id]);
  const apply = (operations: Operation[]) => {
    try {
      applyOperations(project, operations, project.revision);
      onApply(operations, project.revision);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This timing change could not be applied.');
    }
  };
  const updateTransition = (transition: number) =>
    apply([{ type: 'update_cue', id: cue.id, patch: { transition } }]);
  return (
    <section className="transition-inspector" aria-label="Transition and retiming">
      <div className="transition-heading">
        <span>TRANSITION</span>
        <Activity size={12} />
      </div>
      <p className="transition-context">
        {first
          ? 'Opening scene'
          : `${project.cues[project.cues.findIndex((c) => c.id === cue.id) - 1].name} → ${cue.name}`}
      </p>
      {first ? (
        <p className="transition-note">
          The opening scene starts at its authored pose. Its incoming transition setting is used if
          you move it later in the sequence.
        </p>
      ) : null}
      <svg
        viewBox="0 0 232 82"
        className="transition-curve"
        role="img"
        aria-label={`${transitionEasingNames[easing]} transition curve`}
      >
        <path d="M12 16V66H220 M12 41H220 M116 16V66" className="transition-curve-grid" />
        <path d={curve} className="transition-curve-line" />
        <text x="12" y="79">
          0
        </text>
        <text x="220" y="79" textAnchor="end">
          {cue.transition.toFixed(2)} s
        </text>
      </svg>
      <label className="transition-select">
        <span>Blend profile</span>
        <select
          aria-label="Transition easing"
          value={easing}
          onChange={(e) =>
            apply([
              {
                type: 'update_cue',
                id: cue.id,
                patch: { transitionEasing: e.target.value as TransitionEasing },
              },
            ])
          }
        >
          {transitionEasings.map((value) => (
            <option key={value} value={value}>
              {transitionEasingNames[value]}
            </option>
          ))}
        </select>
      </label>
      <PropertyNumber
        label="Incoming blend"
        value={cue.transition}
        min={0}
        max={cue.duration}
        step={0.1}
        suffix="s"
        onChange={updateTransition}
      />
      <PropertyNumber
        label="Transition beats"
        value={cue.transition / beatDuration}
        min={0}
        max={cue.duration / beatDuration}
        step={0.25}
        suffix="beats"
        onChange={(beats) => apply([{ type: 'transition_to_beats', id: cue.id, beats }])}
      />
      <div className="transition-beats" aria-label="Transition beat presets">
        {[0, 1, 2, 4, 8, 16].map((beats) => (
          <button
            key={beats}
            disabled={beats * beatDuration > cue.duration}
            title={beats ? `${beats} beats at ${project.bpm} BPM` : 'Instant scene cut'}
            onClick={() => apply([{ type: 'transition_to_beats', id: cue.id, beats }])}
          >
            {beats === 0 ? 'Cut' : `${beats}b`}
          </button>
        ))}
      </div>
      <button
        className="transition-wide"
        onClick={() => {
          const start = cueStart(project, cue.id);
          const snapped =
            Math.round((start + cue.transition) / beatDuration) * beatDuration - start;
          updateTransition(Math.max(0, Math.min(cue.duration, snapped)));
        }}
      >
        Snap end to nearest show beat
      </button>
      <div className="transition-summary">
        <span>Blend {cue.transition.toFixed(2)} s</span>
        <ArrowRight size={11} />
        <span>Remain {(cue.duration - cue.transition).toFixed(2)} s</span>
      </div>
      <p className="transition-note">
        Scene animation keeps running during the blend. “Remain” is time after the incoming blend,
        not a freeze.
      </p>

      <div className="transition-heading">
        <span>SCENE RETIMING</span>
        <Timer size={12} />
      </div>
      <PropertyNumber
        label="Scene speed multiplier"
        value={speed}
        min={0.01}
        max={100}
        step={0.25}
        suffix="×"
        onChange={setSpeed}
      />
      <div className="transition-speeds">
        {[0.5, 0.75, 1.5, 2].map((value) => (
          <button
            key={value}
            className={speed === value ? 'active' : ''}
            onClick={() => setSpeed(value)}
          >
            {value}×
          </button>
        ))}
      </div>
      <label className="transition-check">
        <input
          type="checkbox"
          checked={scaleKeys}
          onChange={(e) => setScaleKeys(e.target.checked)}
        />
        Scale animation key times
      </label>
      <label className="transition-check">
        <input
          type="checkbox"
          checked={scaleTransition}
          onChange={(e) => setScaleTransition(e.target.checked)}
        />
        Scale incoming transition
      </label>
      <button
        className="transition-wide primary"
        disabled={speed === 1}
        onClick={() => {
          apply([
            { type: 'retime_cue', id: cue.id, speed, scaleKeyframes: scaleKeys, scaleTransition },
          ]);
        }}
      >
        Apply {speed}× · {cue.duration.toFixed(2)} → {(cue.duration / speed).toFixed(2)} s
      </button>
      <p className="transition-note">
        Ripple retimes this scene. Later scenes shift by{' '}
        {(cue.duration / speed - cue.duration).toFixed(2)} s. Music stays in place. Flash Hz stays
        unchanged.
      </p>
      <p className="transition-note">
        Show after edit: {(totalDuration(project) - cue.duration + cue.duration / speed).toFixed(2)}{' '}
        s. Keys outside a trimmed scene and inactive drone IDs are preserved.
      </p>

      <div className="transition-heading">
        <span>MOTION FEEDBACK</span>
        <Gauge size={12} />
      </div>
      <button
        className="transition-wide"
        onClick={() => {
          try {
            setMeasurement(measureTransition(project, cue.id));
            setError('');
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not analyze transition.');
          }
        }}
      >
        Analyze incoming transition
      </button>
      {measurement && (
        <div className="transition-measurement" aria-live="polite">
          <div>
            <span>
              {measurement.kind === 'sampled' ? 'Sampled peak speed' : 'Interior peak speed'}
            </span>
            <strong>
              {measurement.peakSpeed === null ? '—' : `${measurement.peakSpeed.toFixed(2)} m/s`}
            </strong>
          </div>
          <div>
            <span>Endpoint displacement</span>
            <strong>{measurement.endpointDistance.toFixed(2)} m</strong>
          </div>
          <p>{measurement.detail}</p>
          {measurement.kind === 'analytic' && measurement.endpointDistance === 0 && (
            <p>
              These drones do not move during the blend. The authored light fade stays unchanged.
            </p>
          )}
          {measurement.kind === 'analytic' && measurement.endpointDistance > 0 && (
            <>
              <PropertyNumber
                label="Target peak speed"
                value={targetSpeed}
                min={0.01}
                step={0.5}
                suffix="m/s"
                onChange={setTargetSpeed}
              />
              <button
                className="transition-wide"
                onClick={() => {
                  try {
                    const transition = transitionDurationForSpeed(project, cue.id, targetSpeed);
                    if (transition > cue.duration)
                      throw new Error(
                        `This speed needs ${transition.toFixed(2)} s. Lengthen the scene first.`
                      );
                    updateTransition(transition);
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : 'Could not fit this speed.');
                  }
                }}
              >
                Fit blend to target speed
              </button>
            </>
          )}
        </div>
      )}
      {error && (
        <p className="transition-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
