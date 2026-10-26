import { useEffect, useMemo, useRef, useState } from 'react';
import { Code2, Diamond, MousePointer2, Plus, RotateCcw, Trash2, Zap } from 'lucide-react';
import { ShowEvaluator, evaluateDrone, rgbHex } from '../core/animation';
import {
  cueStart,
  type Cue,
  type DroneEdit,
  type DroneKeyframe,
  type Project,
  type Vector3Tuple,
} from '../core/model';
import { timecode } from '../core/timeline';

export function PropertyNumber({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(3))));
  const edited = useRef(false);
  useEffect(() => {
    setDraft(String(Number(value.toFixed(3))));
    edited.current = false;
  }, [value]);
  return (
    <label className="property-number">
      <span>{label}</span>
      <span>
        <input
          aria-label={label}
          type="number"
          step={step}
          min={min}
          max={max}
          value={draft}
          onChange={(e) => {
            edited.current = true;
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              e.stopPropagation();
              edited.current = false;
              setDraft(String(Number(value.toFixed(3))));
              e.currentTarget.blur();
            }
          }}
          onBlur={() => {
            const changed = edited.current;
            edited.current = false;
            const number = Number(draft);
            const bounded = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, number));
            setDraft(String(Number(value.toFixed(3))));
            if (changed && draft.trim() && Number.isFinite(number) && bounded !== value)
              onChange(bounded);
          }}
        />
        {suffix && <small>{suffix}</small>}
      </span>
    </label>
  );
}

export function SelectionPicker({
  count,
  selection,
  onSelect,
}: {
  count: number;
  selection: number[];
  onSelect: (ids: number[]) => void;
}) {
  const [text, setText] = useState(''),
    [error, setError] = useState('');
  const select = () => {
    const ids = new Set<number>();
    for (const part of text.split(',')) {
      const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!match) {
        setError('Use IDs or ranges, like 1, 4, 10-20.');
        return;
      }
      const a = Number(match[1]),
        b = Number(match[2] || match[1]);
      if (a < 1 || b > count || b < a) {
        setError(`Choose drone IDs from 1 to ${count.toLocaleString()}.`);
        return;
      }
      for (let id = a; id <= b; id++) ids.add(id);
    }
    setError('');
    onSelect([...ids]);
  };
  return (
    <div className="selection-picker">
      <div>
        <MousePointer2 size={12} />
        <strong>
          {selection.length ? `${selection.length.toLocaleString()} selected` : 'Individual drones'}
        </strong>
        <button onClick={() => onSelect(Array.from({ length: count }, (_, i) => i + 1))}>
          Select all
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          select();
        }}
      >
        <input
          aria-label="Select drone IDs"
          placeholder="IDs: 1, 4, 10–20"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" aria-label="Select entered drone IDs">
          Select
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

type Props = {
  project: Project;
  cue: Cue;
  time: number;
  selection: number[];
  autoKey: boolean;
  onAutoKey: () => void;
  onChange: (patch: DroneEdit) => void;
  onMove: (updates: { id: number; position: Vector3Tuple }[]) => void;
  onKeyframe: (keyframes: { id: number; keyframe: DroneKeyframe }[]) => void;
  onRemoveKey: (time: number) => void;
  onSeek: (time: number) => void;
  onReset: () => void;
  onSource: () => void;
};
export function DroneInspector({
  project,
  cue,
  time,
  selection,
  autoKey,
  onAutoKey,
  onChange,
  onMove,
  onKeyframe,
  onRemoveKey,
  onSeek,
  onReset,
  onSource,
}: Props) {
  const evaluator = useMemo(() => new ShowEvaluator(project), [project]);
  const localTime = Math.max(0, Math.min(cue.duration, time - cueStart(project, cue.id)));
  const prepared = evaluator.cue(cue, localTime, time);
  const first = selection[0],
    entry = prepared.edits.find((e) => e.index === first - 1);
  const fallbackPosition = Array.from(
    prepared.positions.slice((first - 1) * 3, first * 3)
  ) as Vector3Tuple;
  const fallbackColor = Array.from(
    prepared.shades.slice((first - 1) * 3, first * 3)
  ) as Vector3Tuple;
  const value = evaluateDrone(
    entry?.edit || {},
    localTime,
    entry?.basePosition || fallbackPosition,
    entry?.baseColor || fallbackColor
  );
  const centroid = [0, 1, 2].map(
    (axis) =>
      selection.reduce((sum, id) => sum + prepared.positions[(id - 1) * 3 + axis], 0) /
      selection.length
  );
  const [color, setColor] = useState(rgbHex(value.color));
  const activeColor = rgbHex(value.color);
  useEffect(() => setColor(activeColor), [activeColor, first]);
  const keyframes =
    cue.droneEdits?.[first]?.keyframes?.slice().sort((a, b) => a.time - b.time) || [];
  const atKey = keyframes.find((k) => Math.abs(k.time - localTime) < 1 / 60);
  const flash = value.flash || { hz: 0, duty: 0.5, phase: 0 };
  const addKey = () =>
    onKeyframe(
      selection.map((id) => {
        const edited = prepared.edits.find((e) => e.index === id - 1);
        const position = Array.from(prepared.positions.slice((id - 1) * 3, id * 3)) as Vector3Tuple;
        const base = Array.from(prepared.shades.slice((id - 1) * 3, id * 3)) as Vector3Tuple;
        const state = evaluateDrone(
          edited?.edit || {},
          localTime,
          edited?.basePosition || position,
          edited?.baseColor || base
        );
        return {
          id,
          keyframe: {
            time: localTime,
            position: state.position,
            color: rgbHex(state.color),
            brightness: state.brightness,
            flash: state.flash || { hz: 0, duty: 0.5, phase: 0 },
            easing: 'smooth',
          },
        };
      })
    );
  return (
    <div className="drone-inspector">
      <div className="object-title">
        <span className="object-id">
          {selection.length === 1
            ? `D${first.toString().padStart(4, '0')}`
            : `${selection.length.toLocaleString()} DRONES`}
        </span>
        <button title="Edit scene source" aria-label="Edit scene source" onClick={onSource}>
          <Code2 size={15} />
        </button>
      </div>
      <p className="object-context">
        {cue.name} <span>· scene time {localTime.toFixed(2)} s</span>
      </p>
      <div className="object-section-heading">
        <span>
          TRANSFORM <small>ENU · meters</small>
        </span>
        <button
          className={autoKey ? 'auto-key active' : 'auto-key'}
          aria-label="Auto keyframe edits"
          aria-pressed={autoKey}
          onClick={onAutoKey}
        >
          <Diamond size={10} fill={autoKey ? 'currentColor' : 'none'} />
          Auto key
        </button>
      </div>
      {selection.length > 1 && (
        <p className="inspector-hint">
          Coordinates move the selection’s center. Color and light controls apply to every selected
          drone.
        </p>
      )}
      <div className="xyz-properties">
        {['East · X', 'North · Y', 'Up · Z'].map((name, axis) => (
          <PropertyNumber
            key={name}
            label={name}
            value={centroid[axis]}
            onChange={(next) =>
              onMove(
                selection.map((id) => {
                  const position = Array.from(
                    prepared.positions.slice((id - 1) * 3, id * 3)
                  ) as Vector3Tuple;
                  position[axis] += next - centroid[axis];
                  return { id, position };
                })
              )
            }
          />
        ))}
      </div>
      <p className="inspector-hint">
        {autoKey ? 'Edits write keys at the playhead.' : 'Edits change the scene’s base values.'}{' '}
        Position keys override the base. Incoming transitions blend toward this target.
      </p>
      <div className="object-section-heading">
        <span>LIGHT</span>
        <Zap size={12} />
      </div>
      <label className="color-property">
        <span>Color</span>
        <input
          aria-label="Light color picker"
          type="color"
          value={color}
          onChange={(e) => {
            setColor(e.target.value);
            onChange({ color: e.target.value });
          }}
        />
        <input
          aria-label="Light color hex"
          value={color}
          spellCheck={false}
          maxLength={7}
          onChange={(e) => setColor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          onBlur={() => {
            if (/^#[0-9a-f]{6}$/i.test(color) && color !== activeColor) onChange({ color });
            else setColor(activeColor);
          }}
        />
      </label>
      <PropertyNumber
        label="Brightness"
        value={value.brightness * 100}
        min={0}
        max={100}
        step={1}
        suffix="%"
        onChange={(n) => onChange({ brightness: n / 100 })}
      />
      <div className="field-row">
        <PropertyNumber
          label="Flash frequency"
          value={flash.hz}
          min={0}
          max={100}
          suffix="Hz"
          onChange={(hz) => onChange({ flash: { ...flash, hz } })}
        />
        <PropertyNumber
          label="Flash duty"
          value={flash.duty * 100}
          min={0}
          max={100}
          step={1}
          suffix="%"
          onChange={(duty) => onChange({ flash: { ...flash, duty: duty / 100 } })}
        />
      </div>
      <PropertyNumber
        label="Flash phase"
        value={flash.phase}
        step={0.05}
        suffix="cycles"
        onChange={(phase) => onChange({ flash: { ...flash, phase } })}
      />
      <div className="object-section-heading">
        <span>
          ANIMATION{' '}
          <small>
            {keyframes.length} keys · D{first}
          </small>
        </span>
        <button title="Add keyframe at playhead" aria-label="Add drone keyframe" onClick={addKey}>
          <Plus size={14} />
        </button>
      </div>
      <div className="keyframe-actions">
        <button onClick={addKey}>
          <Diamond size={11} />
          {atKey ? 'Update key' : 'Key all channels'}
        </button>
        <button
          aria-label="Delete keyframe at playhead"
          disabled={!atKey}
          onClick={() => atKey && onRemoveKey(atKey.time)}
        >
          <Trash2 size={12} />
        </button>
      </div>
      {atKey && (
        <label className="key-easing">
          Interpolation
          <select
            aria-label="Keyframe interpolation"
            value={atKey.easing || 'linear'}
            onChange={(e) =>
              onKeyframe(
                selection.map((id) => ({
                  id,
                  keyframe: { time: atKey.time, easing: e.target.value as DroneKeyframe['easing'] },
                }))
              )
            }
          >
            <option value="linear">Linear</option>
            <option value="smooth">Smooth</option>
            <option value="hold">Hold / cut</option>
          </select>
        </label>
      )}
      <div className="keyframe-list">
        {keyframes.length ? (
          keyframes.map((key) => (
            <button
              key={key.time}
              disabled={key.time > cue.duration}
              className={key === atKey ? 'active' : ''}
              onClick={() => onSeek(cueStart(project, cue.id) + key.time)}
            >
              <Diamond size={9} fill="currentColor" />
              <span>{timecode(key.time)}</span>
              <small>
                {[
                  key.position && 'XYZ',
                  key.color && 'RGB',
                  key.brightness !== undefined && 'DIM',
                  key.flash && 'FX',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            </button>
          ))
        ) : (
          <p>Add a key, move the playhead, then move or recolor the selection to animate it.</p>
        )}
      </div>
      <div className="object-footer">
        <button onClick={onSource}>
          <Code2 size={12} />
          Scene source
        </button>
        <button onClick={onReset}>
          <RotateCcw size={12} />
          Reset selection
        </button>
      </div>
    </div>
  );
}
