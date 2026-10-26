import { describe, expect, it } from 'vitest';
import { createBenchStoryboard } from '../core/bench-storyboard';
import { applyOperations } from '../core/commands';
import { defaultProject, type Project } from '../core/model';
import { summarizeProjectImpact } from './impact';

function project(): Project {
  const value = structuredClone(defaultProject);
  value.droneCount = 8;
  value.cues = value.cues.slice(0, 2).map((cue) => ({ ...cue, duration: 10, transition: 2 }));
  value.cues[0].droneEdits = {
    1: { position: [1, 2, 3], color: '#abcdef', keyframes: [
      { time: 0, position: [1, 2, 3], brightness: 0.2 },
      { time: 5, position: [5, 6, 7], brightness: 0.8 },
    ] },
    50: { color: '#112233', keyframes: [{ time: 20, position: [50, 1, 2] }] },
  };
  return value;
}

describe('proposal impact from final documents', () => {
  it('reports no net edit after transient changes and ignores revision alone', () => {
    const base = project();
    const draft = applyOperations(base, [
      { type: 'set_tempo', bpm: 100 }, { type: 'set_tempo', bpm: base.bpm },
    ]);
    expect(summarizeProjectImpact(base, draft)).toMatchObject({
      durationBefore: 20, durationAfter: 20, fleetBefore: 8, fleetAfter: 8,
      changedSceneCount: 0, affectedDroneCount: 0, authoredDroneRecordsChanged: 0,
      totalKeyCountBefore: 3, totalKeyCountAfter: 3, keyframesAdded: 0, keyframesRemoved: 0, keyframesChanged: 0,
      positionChanged: false, lightChanged: false, timingChanged: false, scenes: [], notes: [],
    });
  });

  it('counts changed scene/drone pairs separately from the exact union of stable IDs', () => {
    const base = project();
    const draft = applyOperations(base, [
      { type: 'edit_drones', cueId: base.cues[0].id, ids: [1, 50], patch: { color: '#ff0000' } },
      { type: 'edit_drones', cueId: base.cues[1].id, ids: [1], patch: { brightness: 0.3 } },
    ]);
    const impact = summarizeProjectImpact(base, draft);
    expect(impact).toMatchObject({ changedSceneCount: 2, affectedDroneCount: 2,
      authoredDroneRecordsChanged: 3, positionChanged: false, lightChanged: true, timingChanged: false });
    expect(impact.scenes.map((scene) => scene.affectedDroneCount)).toEqual([2, 1]);
    expect(impact.keyframesAdded + impact.keyframesRemoved + impact.keyframesChanged).toBe(0);
  });

  it('distinguishes added, removed, and same-time changed keys, including dormant work', () => {
    const base = project();
    const draft = applyOperations(base, [
      { type: 'set_keyframe', cueId: base.cues[0].id, ids: [1], keyframe: { time: 5, color: '#ff0000' } },
      { type: 'move_keyframe', cueId: base.cues[0].id, droneId: 50, from: 20, to: 25 },
    ]);
    const impact = summarizeProjectImpact(base, draft);
    expect(impact).toMatchObject({ keyframesAdded: 1, keyframesRemoved: 1, keyframesChanged: 1,
      totalKeyCountBefore: 3, totalKeyCountAfter: 3, authoredDroneRecordsChanged: 2,
      affectedDroneCount: 2, positionChanged: true, lightChanged: true, timingChanged: true });
    expect(impact.notes.some((note) => note.includes('exact scene-local timestamp'))).toBe(true);
  });

  it('does not call a same-time lighting edit a position or timing edit', () => {
    const base = project();
    const draft = applyOperations(base, [{ type: 'set_keyframe', cueId: base.cues[0].id,
      ids: [1], keyframe: { time: 5, brightness: 0.4 } }]);
    expect(summarizeProjectImpact(base, draft)).toMatchObject({
      keyframesChanged: 1, positionChanged: false, lightChanged: true, timingChanged: false,
    });
  });

  it('recognizes interpolation changes in affected keyed channels', () => {
    const base = project();
    const draft = applyOperations(base, [{ type: 'set_keyframe', cueId: base.cues[0].id,
      ids: [1], keyframe: { time: 0, easing: 'hold' } }]);
    expect(summarizeProjectImpact(base, draft)).toMatchObject({
      keyframesChanged: 1, positionChanged: true, lightChanged: true, timingChanged: true,
    });
  });

  it('ignores key and object property ordering without mutating either document', () => {
    const base = project();
    base.cues[0].metadata = { a: 1, b: { c: 2, d: 3 } };
    const draft = structuredClone(base);
    draft.cues[0].droneEdits![1].keyframes!.reverse();
    draft.cues[0].metadata = { b: { d: 3, c: 2 }, a: 1 };
    const before = structuredClone(base), after = structuredClone(draft);
    expect(summarizeProjectImpact(base, draft).changedSceneCount).toBe(0);
    expect(base).toEqual(before);
    expect(draft).toEqual(after);
  });

  it('declares a full scene authoring scope for geometry changes, unioned with dormant edits', () => {
    const base = project();
    const draft = applyOperations(base, [
      { type: 'update_cue', id: base.cues[0].id, patch: { altitude: 100 } },
      { type: 'edit_drones', cueId: base.cues[1].id, ids: [50], patch: { color: '#ffffff' } },
    ]);
    const impact = summarizeProjectImpact(base, draft);
    expect(impact.affectedDroneCount).toBe(9); // IDs 1–8 plus dormant ID 50.
    expect(impact.authoredDroneRecordsChanged).toBe(1);
    expect(impact.scenes[0].affectedDroneCount).toBe(8);
    expect(impact.notes.join(' ')).toContain('not a count of drones whose rendered position changed');
  });

  it('does not claim retained authored edits changed when only the fleet changes', () => {
    const base = project();
    const draft = applyOperations(base, [{ type: 'set_fleet', count: 60 }]);
    expect(summarizeProjectImpact(base, draft)).toMatchObject({
      fleetBefore: 8, fleetAfter: 60, affectedDroneCount: 60, changedSceneCount: 0,
      authoredDroneRecordsChanged: 0, totalKeyCountBefore: 3, totalKeyCountAfter: 3,
      positionChanged: true, lightChanged: true,
    });
  });

  it.each([
    ['motor assignment', { motor: 4 as const, offset: 3 }],
    ['pulse timing', { motor: 1 as const, offset: 4 }],
    ['pulse removal', null],
  ])('includes %s edits in the proposal impact without inventing flight motion', (_description, benchCue) => {
    const base = createBenchStoryboard('Reviewed motor storyboard', 'impact-bench');
    base.cues = base.cues.slice(0, 1);
    base.cues[0].duration = 8;
    const draft = applyOperations(base, [{ type: 'update_cue', id: base.cues[0].id, patch: { benchCue } }]);
    const impact = summarizeProjectImpact(base, draft);
    expect(impact).toMatchObject({
      durationBefore: 8, durationAfter: 8, changedSceneCount: 1, affectedDroneCount: 1,
      authoredDroneRecordsChanged: 0, keyframesAdded: 0, keyframesRemoved: 0, keyframesChanged: 0,
      positionChanged: false, lightChanged: false, timingChanged: true,
      scenes: [{ id: base.cues[0].id, status: 'changed', changedProperties: ['benchCue'],
        affectedDroneCount: 1, positionChanged: false, lightChanged: false, timingChanged: true }],
    });
    expect(base.cues[0].benchCue).toEqual({ motor: 1, offset: 3 });
    expect(draft.cues[0].benchCue).toEqual(benchCue);
  });

  it('tracks scene timing without reporting shifted later records as edited', () => {
    const base = project();
    const draft = applyOperations(base, [{ type: 'update_cue', id: base.cues[0].id, patch: { duration: 5 } }]);
    const impact = summarizeProjectImpact(base, draft);
    expect(impact).toMatchObject({ durationBefore: 20, durationAfter: 15, changedSceneCount: 1,
      affectedDroneCount: 8, authoredDroneRecordsChanged: 0, timingChanged: true });
    expect(impact.scenes[0]).toMatchObject({ durationBefore: 10, durationAfter: 5, startBefore: 0, startAfter: 0 });
    expect(impact.notes.join(' ')).toContain('Scene start times shifted');
  });

  it('reports removals/additions with every authored key and keeps scene output bounded', () => {
    const base = project();
    const draft = structuredClone(base);
    draft.cues = Array.from({ length: 15 }, (_, index) => ({ ...base.cues[1], id: `new-${index}`, name: `New ${index}` }));
    const impact = summarizeProjectImpact(base, draft);
    expect(impact).toMatchObject({ changedSceneCount: 17, remainingSceneCount: 5,
      authoredDroneRecordsChanged: 2, keyframesRemoved: 3, keyframesAdded: 0,
      totalKeyCountBefore: 3, totalKeyCountAfter: 0, affectedDroneCount: 9 });
    expect(impact.scenes).toHaveLength(12);
    expect(impact.scenes.every((scene) => scene.status === 'added')).toBe(true);
  });

  it('does not mark retained scenes as reordered just because a scene was inserted or removed', () => {
    const base = project();
    const draft = structuredClone(base);
    draft.cues.unshift({ ...base.cues[1], id: 'new-intro', name: 'Intro', duration: 3 });
    const inserted = summarizeProjectImpact(base, draft);
    expect(inserted.changedSceneCount).toBe(1);
    expect(inserted.scenes[0]).toMatchObject({ id: 'new-intro', status: 'added' });
    expect(inserted.authoredDroneRecordsChanged).toBe(0);
    expect(inserted.notes.join(' ')).toContain('Scene start times shifted');
    const removed = summarizeProjectImpact(draft, base);
    expect(removed.changedSceneCount).toBe(1);
    expect(removed.scenes[0]).toMatchObject({ id: 'new-intro', status: 'removed' });
  });

  it('detects an actual scene reorder without claiming authored drone records or keys changed', () => {
    const base = project();
    const draft = structuredClone(base);
    draft.cues.reverse();
    const impact = summarizeProjectImpact(base, draft);
    expect(impact).toMatchObject({ changedSceneCount: 2, timingChanged: true,
      authoredDroneRecordsChanged: 0, keyframesAdded: 0, keyframesRemoved: 0,
      keyframesChanged: 0, affectedDroneCount: 8 });
    expect(impact.scenes.map((scene) => scene.changedProperties)).toEqual([['order'], ['order']]);
  });

  it('bounds output even when hundreds of scenes and many authored keys change', () => {
    const base = project();
    base.cues = Array.from({ length: 200 }, (_, index) => ({ ...base.cues[0],
      id: `scene-${index}`, name: 'A'.repeat(60), duration: 5,
      droneEdits: { 1: { keyframes: Array.from({ length: 100 }, (_, time) => ({ time, brightness: 0.2 })) } },
    }));
    const draft = structuredClone(base);
    for (const cue of draft.cues)
      for (const key of cue.droneEdits![1].keyframes!) key.brightness = 0.4;
    const impact = summarizeProjectImpact(base, draft);
    expect(impact).toMatchObject({ changedSceneCount: 200, remainingSceneCount: 188,
      authoredDroneRecordsChanged: 200, affectedDroneCount: 1, keyframesChanged: 20000,
      totalKeyCountBefore: 20000, totalKeyCountAfter: 20000 });
    expect(impact.scenes).toHaveLength(12);
    expect(JSON.stringify(impact).length).toBeLessThan(10000);
    expect(summarizeProjectImpact(base, draft)).toEqual(impact);
  });

  it('reports global tempo and descriptive changes without inventing authored edits', () => {
    const base = project();
    const draft = structuredClone(base);
    draft.name = 'Renamed';
    draft.bpm = 150;
    draft.limits.radius = 140;
    draft.cues[0].name = 'New scene name';
    const impact = summarizeProjectImpact(base, draft);
    expect(impact).toMatchObject({ changedSceneCount: 1, affectedDroneCount: 8,
      authoredDroneRecordsChanged: 0, positionChanged: false, lightChanged: true, timingChanged: true });
    expect(impact.scenes[0]).toMatchObject({ affectedDroneCount: 0, changedProperties: ['name'] });
    expect(impact.notes).toHaveLength(3);
  });

  it('handles six-figure stable scopes without generating formations or samples', () => {
    const base = project();
    base.droneCount = 100000;
    const draft = structuredClone(base);
    draft.cues[0].palette = 'ember';
    expect(summarizeProjectImpact(base, draft)).toMatchObject({ affectedDroneCount: 100000,
      authoredDroneRecordsChanged: 0, positionChanged: false, lightChanged: true });
  });
});
