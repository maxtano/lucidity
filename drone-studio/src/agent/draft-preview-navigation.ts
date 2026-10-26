import type { Cue, DroneKeyframe, Project } from '../core/model';
import { summarizeProjectImpact } from './impact';

export type DraftPreviewNavigationPoint = { label: string; time: number; localTime: number };
export type DraftPreviewNavigationSide = {
  start: number;
  duration: number;
  points: DraftPreviewNavigationPoint[];
};
export type DraftPreviewNavigation = {
  changes: {
    id: string;
    status: 'added' | 'removed' | 'changed';
    nameBefore: string | null;
    nameAfter: string | null;
    properties: string[];
    before: DraftPreviewNavigationSide | null;
    draft: DraftPreviewNavigationSide | null;
  }[];
  globalChanges: string[];
};
type IndexedScene = { cue: Cue; start: number; final: boolean };

function indexScenes(project: Project) {
  if (!project.cues.length || project.cues.length > 512)
    throw new Error('Draft navigation requires 1–512 scenes in each document.');
  let start = 0;
  const scenes = new Map<string, IndexedScene>();
  project.cues.forEach((cue, index) => {
    if (scenes.has(cue.id)) throw new Error('Draft navigation requires unique scene IDs.');
    if (!Number.isFinite(cue.duration) || cue.duration <= 0 || start + cue.duration > 1800)
      throw new Error('Draft navigation requires finite scene durations within a 30-minute show.');
    scenes.set(cue.id, { cue, start, final: index === project.cues.length - 1 });
    start += cue.duration;
  });
  return scenes;
}

/** Exact authored-channel equality, independent of object property order. */
function sameKey(a: DroneKeyframe | undefined, b: DroneKeyframe | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.time === b.time &&
    a.easing === b.easing &&
    a.color === b.color &&
    a.brightness === b.brightness &&
    (a.position === b.position ||
      (!!a.position &&
        !!b.position &&
        a.position.every((value, index) => value === b.position![index]))) &&
    (a.flash === b.flash ||
      (!!a.flash &&
        !!b.flash &&
        a.flash.hz === b.flash.hz &&
        a.flash.duty === b.flash.duty &&
        a.flash.phase === b.flash.phase))
  );
}

function editedKeyBounds(scene: IndexedScene, other: IndexedScene | undefined, fleet: number) {
  let first = Infinity,
    last = -Infinity;
  for (const [id, edit] of Object.entries(scene.cue.droneEdits ?? {})) {
    // Dormant authored drones and keys are measured in impact, but are not visible jump targets.
    if (Number(id) > fleet) continue;
    const otherKeys = new Map(
      (other?.cue.droneEdits?.[id]?.keyframes ?? []).map((key) => [key.time, key])
    );
    for (const key of edit.keyframes ?? []) {
      const time = key.time;
      const globalTime = scene.start + time;
      if (
        !Number.isFinite(time) ||
        time < 0 ||
        time > scene.cue.duration ||
        // A distinct local timestamp can round onto a scene boundary after global addition.
        (time > 0 && globalTime === scene.start) ||
        (!scene.final && globalTime >= scene.start + scene.cue.duration) ||
        sameKey(key, otherKeys.get(time))
      )
        continue;
      first = Math.min(first, time);
      last = Math.max(last, time);
    }
  }
  return { first, last };
}

function side(
  scene: IndexedScene | undefined,
  other: IndexedScene | undefined,
  fleet: number,
  transitionChanged: boolean
): DraftPreviewNavigationSide | null {
  if (!scene) return null;
  const points = new Map<number, DraftPreviewNavigationPoint>();
  const add = (label: string, localTime: number) => {
    if (!Number.isFinite(localTime)) return;
    const bounded = Math.max(0, Math.min(scene.cue.duration, localTime));
    const time = scene.start + bounded;
    // Prefer Scene start, then key landmarks when several authored features share a timestamp.
    if (!points.has(time)) points.set(time, { label, localTime: bounded, time });
  };
  add('Scene start', 0);
  const keys = editedKeyBounds(scene, other, fleet);
  add('First edited key', keys.first);
  if (keys.last !== keys.first) add('Last edited key', keys.last);
  if (transitionChanged) add('Transition end', scene.cue.transition);
  return {
    start: scene.start,
    duration: scene.cue.duration,
    points: [...points.values()].sort((a, b) => a.localTime - b.localTime),
  };
}

/** Authored-change landmarks, not first visible differences or evaluated drone movement. */
export function buildDraftPreviewNavigation(base: Project, draft: Project): DraftPreviewNavigation {
  const beforeScenes = indexScenes(base),
    draftScenes = indexScenes(draft);
  const impact = summarizeProjectImpact(base, draft, { sceneLimit: 1024 });
  const globalChanges: string[] = [];
  if (base.droneCount !== draft.droneCount)
    globalChanges.push(`Fleet size: ${base.droneCount} → ${draft.droneCount} drones`);
  if (base.bpm !== draft.bpm) globalChanges.push(`Tempo: ${base.bpm} → ${draft.bpm} BPM`);
  if (
    (Object.keys(base.limits) as (keyof Project['limits'])[]).some(
      (key) => base.limits[key] !== draft.limits[key]
    )
  )
    globalChanges.push('Design limits changed');
  if (base.name !== draft.name) globalChanges.push('Project name changed');
  return {
    changes: impact.scenes.map((change) => {
      const before = beforeScenes.get(change.id),
        after = draftScenes.get(change.id);
      const transitionChanged =
        !before ||
        !after ||
        change.changedProperties.includes('transition') ||
        change.changedProperties.includes('transitionEasing');
      return {
        id: change.id,
        status: change.status,
        nameBefore: before?.cue.name ?? null,
        nameAfter: after?.cue.name ?? null,
        properties: [...change.changedProperties],
        before: side(before, after, base.droneCount, transitionChanged),
        draft: side(after, before, draft.droneCount, transitionChanged),
      };
    }),
    globalChanges,
  };
}
