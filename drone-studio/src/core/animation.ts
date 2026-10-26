import { colors, formation } from './formations';
import {
  frameAt,
  smooth,
  totalDuration,
  type Cue,
  type DroneEdit,
  type DroneKeyframe,
  type Project,
  type Vector3Tuple,
} from './model';

export const hexRgb = (hex: string): Vector3Tuple =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Vector3Tuple;
export const rgbHex = (rgb: number[]) =>
  '#' +
  rgb
    .map((v) =>
      Math.round(Math.max(0, Math.min(1, v)) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('');
export const lightIntensity = (time: number, bpm: number) =>
  0.9 + 0.1 * Math.cos(((time * bpm) / 60) * Math.PI * 2);
export const flashIntensity = (time: number, flash: DroneEdit['flash']) =>
  !flash || flash.hz === 0
    ? 1
    : (((time * flash.hz + flash.phase) % 1) + 1) % 1 < flash.duty
      ? 1
      : 0;

type Channel = 'position' | 'color' | 'brightness' | 'flash';
function channel(keys: DroneKeyframe[], name: Channel, time: number) {
  const values = keys.filter((key) => key[name] !== undefined);
  if (!values.length) return null;
  const right = values.findIndex((key) => key.time > time);
  if (right === 0) return { a: values[0], b: values[0], t: 0 };
  if (right < 0) return { a: values.at(-1)!, b: values.at(-1)!, t: 0 };
  const a = values[right - 1],
    b = values[right],
    fraction = (time - a.time) / (b.time - a.time);
  return { a, b, t: a.easing === 'hold' ? 0 : a.easing === 'smooth' ? smooth(fraction) : fraction };
}

/** Scene-local, independently keyed channels. First/last keys extend to the scene edges. */
export function evaluateDrone(
  edit: DroneEdit,
  localTime: number,
  basePosition: Vector3Tuple,
  baseColor: Vector3Tuple
) {
  let position = edit.position || basePosition,
    color = edit.color ? hexRgb(edit.color) : baseColor;
  let brightness = edit.brightness ?? 1,
    flash = edit.flash;
  const keys = edit.keyframes || [];
  const p = channel(keys, 'position', localTime),
    c = channel(keys, 'color', localTime),
    b = channel(keys, 'brightness', localTime),
    f = channel(keys, 'flash', localTime);
  if (p)
    position = p.a.position!.map(
      (value, i) => value + (p.b.position![i] - value) * p.t
    ) as Vector3Tuple;
  if (c) {
    const ca = hexRgb(c.a.color!),
      cb = hexRgb(c.b.color!);
    color = ca.map((value, i) => value + (cb[i] - value) * c.t) as Vector3Tuple;
  }
  if (b) brightness = b.a.brightness! + (b.b.brightness! - b.a.brightness!) * b.t;
  if (f) flash = f.a.flash;
  return { position, color, brightness, flash };
}

type PreparedCue = {
  positions: Float32Array;
  shades: Float32Array;
  edits: { index: number; edit: DroneEdit; basePosition: Vector3Tuple; baseColor: Vector3Tuple }[];
  editByIndex: Map<number, PreparedCue['edits'][number]>;
};

/** Shared by the viewport, picking, CSV, and sampled review. No DOM or renderer dependency. */
export class ShowEvaluator {
  private cache = new Map<string, PreparedCue>();
  readonly dynamic: boolean;
  constructor(readonly project: Project) {
    this.dynamic = project.cues.some((cue) =>
      Object.values(cue.droneEdits || {}).some((edit) => edit.keyframes?.length || edit.flash?.hz)
    );
  }
  private prepare(cue: Cue) {
    let result = this.cache.get(cue.id);
    if (result) return result;
    const positions = formation(cue, this.project.droneCount),
      shades = colors(cue.palette, this.project.droneCount);
    const edits = Object.entries(cue.droneEdits || {})
      .filter(([id]) => Number(id) <= this.project.droneCount)
      .map(([id, original]) => {
        const index = Number(id) - 1;
        return {
          index,
          edit: {
            ...original,
            keyframes: original.keyframes?.slice().sort((a, b) => a.time - b.time),
          },
          basePosition: Array.from(positions.subarray(index * 3, index * 3 + 3)) as Vector3Tuple,
          baseColor: Array.from(shades.subarray(index * 3, index * 3 + 3)) as Vector3Tuple,
        };
      });
    result = {
      positions,
      shades,
      edits,
      editByIndex: new Map(edits.map((entry) => [entry.index, entry])),
    };
    // Two active formations plus one adjacent cache entry, including at six-figure fleet sizes.
    if (this.cache.size >= 3) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(cue.id, result);
    return result;
  }
  cue(cue: Cue, localTime: number, showTime: number) {
    const data = this.prepare(cue);
    for (const entry of data.edits) {
      const value = evaluateDrone(entry.edit, localTime, entry.basePosition, entry.baseColor);
      data.positions.set(value.position, entry.index * 3);
      const intensity = value.brightness * flashIntensity(showTime, value.flash);
      data.shades.set(
        value.color.map((c) => c * intensity),
        entry.index * 3
      );
    }
    return data;
  }
  /** Position-only subset for inspection. IDs keep their positions in the full original fleet. */
  cuePositions(cue: Cue, localTime: number, ids: number[]) {
    const data = this.prepare(cue);
    const positions = new Float32Array(ids.length * 3);
    for (let index = 0; index < ids.length; index++) {
      const id = ids[index];
      if (!Number.isInteger(id) || id < 1 || id > this.project.droneCount)
        throw new Error('Drone ID is outside the active fleet.');
      const offset = (id - 1) * 3;
      const entry = data.editByIndex.get(id - 1);
      positions.set(
        entry
          ? evaluateDrone(entry.edit, localTime, entry.basePosition, entry.baseColor).position
          : data.positions.subarray(offset, offset + 3),
        index * 3
      );
    }
    return positions;
  }
  samplePositions(time: number, ids: number[]) {
    const t = Math.max(0, Math.min(totalDuration(this.project), time));
    const frame = frameAt(this.project, t);
    const positions = this.cuePositions(frame.cue, t - frame.start, ids);
    if (frame.index === 0) return positions;
    const previous = this.cuePositions(frame.previous, frame.previous.duration, ids);
    for (let index = 0; index < positions.length; index++)
      positions[index] = previous[index] + (positions[index] - previous[index]) * frame.progress;
    return positions;
  }
  frame(time: number) {
    const t = Math.max(0, Math.min(totalDuration(this.project), time)),
      frame = frameAt(this.project, t);
    const b = this.cue(frame.cue, t - frame.start, t);
    // The first scene has no incoming blend; avoid updating the same buffer twice.
    const a = frame.index === 0 ? b : this.cue(frame.previous, frame.previous.duration, t);
    return { ...frame, a, b, intensity: lightIntensity(t, this.project.bpm) };
  }
  sample(time: number) {
    const frame = this.frame(time),
      positions = new Float32Array(this.project.droneCount * 3),
      shades = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i++) {
      positions[i] =
        frame.a.positions[i] + (frame.b.positions[i] - frame.a.positions[i]) * frame.progress;
      shades[i] =
        (frame.a.shades[i] + (frame.b.shades[i] - frame.a.shades[i]) * frame.progress) *
        frame.intensity;
    }
    return { positions, shades };
  }
}
