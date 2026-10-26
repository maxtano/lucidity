import { evaluateDrone } from './animation';
import { formation } from './formations';
import { keyframeAt } from './keyframes';
import type { Cue, Project, Vector3Tuple } from './model';

export type DroneTransform = {
  ids: number[];
  translation: Vector3Tuple;
  pivot?: Vector3Tuple;
  scale?: Vector3Tuple;
  rotation?: { axis: Vector3Tuple; angleDegrees: number };
  scope: 'base_and_keys' | 'key_at_time';
  time?: number;
};

function finiteVector(vector: Vector3Tuple, name: string) {
  if (
    !Array.isArray(vector) ||
    vector.length !== 3 ||
    vector.some((value) => !Number.isFinite(value))
  )
    throw new Error(`${name} must contain three finite numbers.`);
}
function finiteResult(value: number): number {
  if (!Number.isFinite(value))
    throw new Error('Drone transform overflowed the finite coordinate range.');
  return value;
}

/** Exact cardinal angles avoid cosine residue; nearby angles are deliberately not snapped. */
function rotationMatrix(rotation: NonNullable<DroneTransform['rotation']>) {
  finiteVector(rotation.axis, 'Rotation axis');
  if (!Number.isFinite(rotation.angleDegrees)) throw new Error('Rotation angle must be finite.');
  const largest = Math.max(...rotation.axis.map(Math.abs));
  if (largest === 0) throw new Error('Rotation axis must be nonzero.');
  // Divide before taking a norm, so both subnormal and near-MAX_VALUE axes remain usable.
  const scaled = rotation.axis.map((value) => value / largest);
  const magnitude = Math.hypot(...scaled);
  const [x, y, z] = scaled.map((value) => value / magnitude);
  const angle = rotation.angleDegrees % 360;
  if (angle === 0) return undefined;
  let cosine: number, sine: number;
  if (angle === 90 || angle === -270) {
    cosine = 0;
    sine = 1;
  } else if (angle === -90 || angle === 270) {
    cosine = 0;
    sine = -1;
  } else if (angle === 180 || angle === -180) {
    cosine = -1;
    sine = 0;
  } else {
    // Reduce first: multiplying a huge finite degree value by pi can overflow.
    const radians = angle * (Math.PI / 180);
    if (radians === 0) return undefined;
    cosine = Math.cos(radians);
    sine = Math.sin(radians);
  }
  const remainder = 1 - cosine;
  // Rodrigues rotation, right-handed in East/North/Up coordinates.
  return [
    [cosine + x * x * remainder, x * y * remainder - z * sine, x * z * remainder + y * sine],
    [y * x * remainder + z * sine, cosine + y * y * remainder, y * z * remainder - x * sine],
    [z * x * remainder - y * sine, z * y * remainder + x * sine, cosine + z * z * remainder],
  ];
}

/** Mutates only a private command transaction; each drone keeps its own geometry and channels. */
export function transformDrones(project: Project, cue: Cue, operation: DroneTransform) {
  const { scope, translation, time, pivot, rotation } = operation;
  if (scope === 'key_at_time' && time === undefined)
    throw new Error('key_at_time requires a scene-local time.');
  if (scope === 'base_and_keys' && time !== undefined)
    throw new Error('Omit time for base_and_keys; it transforms the entire authored path.');
  finiteVector(translation, 'Translation');
  const hasPivotTransform = rotation !== undefined || operation.scale !== undefined;
  if (hasPivotTransform && pivot === undefined)
    throw new Error('Rotation or scale requires an explicit pivot.');
  if (!hasPivotTransform && pivot !== undefined)
    throw new Error('Omit pivot unless rotation or scale is supplied.');
  if (pivot) finiteVector(pivot, 'Pivot');
  const scale = operation.scale || [1, 1, 1];
  finiteVector(scale, 'Scale');
  const matrix = rotation ? rotationMatrix(rotation) : undefined;
  const transformed = (point: Vector3Tuple): Vector3Tuple => {
    finiteVector(point, 'Authored or generated position');
    const relative: (number | undefined)[] = [];
    const scaledOffset = (axis: number) =>
      relative[axis] ??
      (relative[axis] =
        scale[axis] === 0
          ? 0
          : finiteResult(finiteResult(point[axis] - pivot![axis]) * scale[axis]));
    return point.map((value, axis) => {
      let positioned: number;
      if (!matrix) {
        // Identity scales/rotations preserve coordinates exactly, even with distant pivots.
        positioned = scale[axis] === 1 ? value : finiteResult(pivot![axis] + scaledOffset(axis));
      } else {
        const row = matrix[axis];
        const identityRow = row.every(
          (coefficient, index) => coefficient * scale[index] === (index === axis ? 1 : 0)
        );
        if (identityRow) positioned = value;
        else {
          let rotated = 0;
          for (let index = 0; index < 3; index++)
            if (row[index] !== 0)
              rotated = finiteResult(rotated + finiteResult(row[index] * scaledOffset(index)));
          positioned = finiteResult(pivot![axis] + rotated);
        }
      }
      return translation[axis] === 0 ? positioned : finiteResult(positioned + translation[axis]);
    }) as Vector3Tuple;
  };
  let generated: Float32Array | undefined;
  cue.droneEdits ||= {};
  for (const id of new Set(operation.ids)) {
    const edit = cue.droneEdits[id] || {};
    const keys = edit.keyframes?.slice().sort((a, b) => a.time - b.time) || [];
    const hasPositionKeys = keys.some((key) => key.position !== undefined);
    let base = edit.position;
    if (!base && id <= project.droneCount) {
      generated ||= formation(cue, project.droneCount);
      base = Array.from(generated.subarray((id - 1) * 3, id * 3)) as Vector3Tuple;
    }
    if (!base && !hasPositionKeys)
      throw new Error(`Drone ${id} is dormant and has no authored position to transform.`);
    if (scope === 'base_and_keys') {
      cue.droneEdits[id] = {
        ...edit,
        ...(base ? { position: transformed(base) } : {}),
        ...(edit.keyframes
          ? {
              keyframes: edit.keyframes.map((key) =>
                key.position ? { ...key, position: transformed(key.position) } : key
              ),
            }
          : {}),
      };
    } else {
      // Authored position keys override the base at every time, including dormant keys.
      const value = evaluateDrone(
        { ...edit, keyframes: keys },
        time!,
        base || [0, 0, 0],
        [1, 1, 1]
      );
      const existing = keyframeAt(keys, time!);
      const keyframe = {
        ...existing,
        time: existing?.time ?? time!,
        position: transformed(value.position),
      };
      cue.droneEdits[id] = {
        ...edit,
        keyframes: [...keys.filter((key) => key !== existing), keyframe].sort(
          (a, b) => a.time - b.time
        ),
      };
    }
  }
}
