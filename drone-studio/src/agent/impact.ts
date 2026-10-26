import { totalDuration, type DroneEdit, type DroneKeyframe, type Project } from '../core/model';

export type SceneImpact = {
  id: string;
  name: string;
  status: 'added' | 'removed' | 'changed';
  durationBefore: number | null;
  durationAfter: number | null;
  startBefore: number | null;
  startAfter: number | null;
  changedProperties: string[];
  /** Stable IDs in the affected authoring scope, not a measurement of drones moved. */
  affectedDroneCount: number;
  authoredDroneRecordsChanged: number;
  keyframesAdded: number;
  keyframesRemoved: number;
  keyframesChanged: number;
  /** Authored position channels or generated geometry changed; excludes timing-only edits. */
  positionChanged: boolean;
  /** Authored lighting channels, generated palette, or fleet membership changed. */
  lightChanged: boolean;
  timingChanged: boolean;
};

export type ProposalImpact = {
  durationBefore: number;
  durationAfter: number;
  fleetBefore: number;
  fleetAfter: number;
  changedSceneCount: number;
  /** Exact union of stable IDs within the declared affected authoring scopes. */
  affectedDroneCount: number;
  /** Scene/drone pairs; the same ID edited in two scenes counts twice. */
  authoredDroneRecordsChanged: number;
  totalKeyCountBefore: number;
  totalKeyCountAfter: number;
  keyframesAdded: number;
  keyframesRemoved: number;
  /** Different channel/easing data at the same exact timestamp. */
  keyframesChanged: number;
  positionChanged: boolean;
  lightChanged: boolean;
  timingChanged: boolean;
  scenes: SceneImpact[];
  remainingSceneCount: number;
  notes: string[];
};

/** JSON value equality without property-order sensitivity or recursive stack growth. */
function equal(a: unknown, b: unknown): boolean {
  const pending: [unknown, unknown][] = [[a, b]];
  while (pending.length) {
    const [left, right] = pending.pop()!;
    if (left === right) continue;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    const leftKeys = Object.keys(left);
    if (leftKeys.length !== Object.keys(right).length) return false;
    for (const key of leftKeys) {
      if (!Object.hasOwn(right, key)) return false;
      pending.push([(left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]]);
    }
  }
  return true;
}

const lightChannels = ['color', 'brightness', 'flash'] as const;
function differentLight(a: DroneEdit | DroneKeyframe | undefined, b: DroneEdit | DroneKeyframe | undefined) {
  return lightChannels.some((channel) => !equal(a?.[channel], b?.[channel]));
}
function scopeCount(fullFleet: number, ids: Set<number>) {
  let result = fullFleet;
  for (const id of ids) if (id > fullFleet) result++;
  return result;
}
function indexScenes(project: Project) {
  let start = 0;
  return new Map(project.cues.map((cue, index) => {
    const entry = { cue, index, start };
    start += cue.duration;
    return [cue.id, entry] as const;
  }));
}

/**
 * Compare already validated documents, after the command engine has applied the entire proposal.
 * Work is linear in authored records/keys, with no formation generation or frame evaluation.
 * Authored channel differences include dormant work; they do not imply a visible change now.
 */
export function summarizeProjectImpact(
  base: Project,
  draft: Project,
  options: { sceneLimit?: number } = {}
): ProposalImpact {
  // Two validated 512-scene documents can contain 1,024 distinct added/removed IDs.
  const sceneLimit = options.sceneLimit ?? 12;
  if (!Number.isInteger(sceneLimit) || sceneLimit < 0 || sceneLimit > 1024)
    throw new Error('Scene detail limit must be an integer from 0 to 1024.');
  const fleetChanged = base.droneCount !== draft.droneCount;
  const tempoChanged = base.bpm !== draft.bpm;
  const maxFleet = Math.max(base.droneCount, draft.droneCount);
  const result: ProposalImpact = {
    durationBefore: totalDuration(base), durationAfter: totalDuration(draft),
    fleetBefore: base.droneCount, fleetAfter: draft.droneCount,
    changedSceneCount: 0, affectedDroneCount: 0, authoredDroneRecordsChanged: 0,
    totalKeyCountBefore: 0, totalKeyCountAfter: 0,
    keyframesAdded: 0, keyframesRemoved: 0, keyframesChanged: 0,
    positionChanged: fleetChanged, lightChanged: tempoChanged || fleetChanged,
    timingChanged: tempoChanged, scenes: [], remainingSceneCount: 0, notes: [],
  };
  const beforeScenes = indexScenes(base), afterScenes = indexScenes(draft);
  // Inserting/removing a scene shifts indices without reordering the retained scenes.
  const retainedBefore = new Map(base.cues.filter((cue) => afterScenes.has(cue.id))
    .map((cue, index) => [cue.id, index]));
  const retainedAfter = new Map(draft.cues.filter((cue) => beforeScenes.has(cue.id))
    .map((cue, index) => [cue.id, index]));
  const ids = [...new Set([...afterScenes.keys(), ...beforeScenes.keys()])];
  const affectedIds = new Set<number>();
  let fullFleetScope = fleetChanged || tempoChanged ? maxFleet : 0;
  let hasSceneWideChange = false;
  let hasShiftedStart = false;

  for (const id of ids) {
    const before = beforeScenes.get(id), after = afterScenes.get(id);
    const a = before?.cue, b = after?.cue;
    const status = !a ? 'added' : !b ? 'removed' : 'changed';
    const properties: string[] = [];
    const scene: SceneImpact = {
      id, name: (b || a)!.name, status,
      durationBefore: a?.duration ?? null, durationAfter: b?.duration ?? null,
      startBefore: before?.start ?? null, startAfter: after?.start ?? null,
      changedProperties: properties, affectedDroneCount: 0, authoredDroneRecordsChanged: 0,
      keyframesAdded: 0, keyframesRemoved: 0, keyframesChanged: 0,
      positionChanged: !a || !b, lightChanged: !a || !b, timingChanged: !a || !b,
    };
    const sceneIds = new Set<number>();
    let sceneFleetScope = !a ? draft.droneCount : !b ? base.droneCount : 0;
    if (a && b) {
      for (const property of ['name', 'shape', 'palette', 'duration', 'transition', 'transitionEasing', 'scale', 'altitude', 'metadata', 'benchCue'] as const)
        if (!equal(a[property], b[property])) properties.push(property);
      if (retainedBefore.get(id) !== retainedAfter.get(id)) properties.push('order');
      hasShiftedStart ||= before!.start !== after!.start;
      scene.positionChanged = properties.some((property) => ['shape', 'scale', 'altitude'].includes(property));
      scene.lightChanged = properties.includes('palette');
      scene.timingChanged = properties.some((property) => ['duration', 'transition', 'transitionEasing', 'order', 'benchCue'].includes(property));
      if (scene.positionChanged || scene.lightChanged || scene.timingChanged) sceneFleetScope = maxFleet;
    } else properties.push(status === 'added' ? 'scene_added' : 'scene_removed');

    const beforeEdits = a?.droneEdits || {}, afterEdits = b?.droneEdits || {};
    const droneIds = new Set([...Object.keys(beforeEdits), ...Object.keys(afterEdits)]);
    for (const droneId of droneIds) {
      const left = beforeEdits[droneId], right = afterEdits[droneId];
      const leftKeys = left?.keyframes || [], rightKeys = right?.keyframes || [];
      result.totalKeyCountBefore += leftKeys.length;
      result.totalKeyCountAfter += rightKeys.length;
      if (left === right) continue;
      let changed = Boolean(left) !== Boolean(right);
      const positionChanged = !equal(left?.position, right?.position);
      const lightChanged = differentLight(left, right);
      changed ||= positionChanged || lightChanged;
      scene.positionChanged ||= positionChanged;
      scene.lightChanged ||= lightChanged;
      const leftByTime = new Map(leftKeys.map((key) => [key.time, key]));
      const rightByTime = new Map(rightKeys.map((key) => [key.time, key]));
      for (const time of new Set([...leftByTime.keys(), ...rightByTime.keys()])) {
        const oldKey = leftByTime.get(time), newKey = rightByTime.get(time);
        if (equal(oldKey, newKey)) continue;
        changed = true;
        if (!oldKey) scene.keyframesAdded++;
        else if (!newKey) scene.keyframesRemoved++;
        else scene.keyframesChanged++;
        const interpolationChanged = oldKey?.easing !== newKey?.easing;
        scene.positionChanged ||= !equal(oldKey?.position, newKey?.position) ||
          (interpolationChanged && Boolean(oldKey?.position || newKey?.position));
        scene.lightChanged ||= differentLight(oldKey, newKey) ||
          (interpolationChanged && (oldKey?.color !== undefined || newKey?.color !== undefined ||
            oldKey?.brightness !== undefined || newKey?.brightness !== undefined));
        scene.timingChanged ||= !oldKey || !newKey || interpolationChanged;
      }
      if (changed) {
        scene.authoredDroneRecordsChanged++;
        sceneIds.add(Number(droneId));
        affectedIds.add(Number(droneId));
      }
    }
    if (scene.authoredDroneRecordsChanged) properties.push('droneEdits');
    if (!properties.length) continue;
    scene.affectedDroneCount = scopeCount(sceneFleetScope, sceneIds);
    hasSceneWideChange ||= sceneFleetScope > 0;
    fullFleetScope = Math.max(fullFleetScope, sceneFleetScope);
    result.changedSceneCount++;
    result.authoredDroneRecordsChanged += scene.authoredDroneRecordsChanged;
    result.keyframesAdded += scene.keyframesAdded;
    result.keyframesRemoved += scene.keyframesRemoved;
    result.keyframesChanged += scene.keyframesChanged;
    result.positionChanged ||= scene.positionChanged;
    result.lightChanged ||= scene.lightChanged;
    result.timingChanged ||= scene.timingChanged;
    if (result.scenes.length < sceneLimit) result.scenes.push(scene);
  }
  result.affectedDroneCount = scopeCount(fullFleetScope, affectedIds);
  result.remainingSceneCount = result.changedSceneCount - result.scenes.length;
  if (fleetChanged)
    result.notes.push('Fleet size changed. The affected authoring scope includes the full before/after fleet because generated formation geometry can change; retained dormant authored records are counted only when edited.');
  if (tempoChanged)
    result.notes.push('Tempo changed across the show, affecting the beat grid and global light modulation; the affected authoring scope includes the full fleet.');
  if (hasSceneWideChange)
    result.notes.push('Scene geometry, palette, timing, ordering, additions, or removals include their full active fleet in the affected authoring scope. This is not a count of drones whose rendered position changed.');
  if (hasShiftedStart)
    result.notes.push('Scene start times shifted. Unchanged scene records are not counted as edited merely because an earlier scene changed duration.');
  if (result.keyframesAdded || result.keyframesRemoved || result.keyframesChanged)
    result.notes.push('Keys are matched by exact scene-local timestamp. Moving a key counts as one removed and one added key; channel or easing changes at the same timestamp count as changed. Dormant keys are included.');
  if (!equal(base.limits, draft.limits)) result.notes.push('Project design limits changed. No motion or separation metrics are calculated by this summary.');
  if (base.name !== draft.name) result.notes.push('Project name changed.');
  return result;
}
