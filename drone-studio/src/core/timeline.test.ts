import { describe, expect, it } from 'vitest';
import { applyOperations } from './commands';
import { defaultProject, totalDuration } from './model';
import { insertionAt, reorderOperations, timecode, trimDuration } from './timeline';

describe('direct timeline editing', () => {
  it('snaps the outgoing cut to the show beat, including a non-beat-aligned scene start', () => {
    const project = structuredClone(defaultProject);
    project.cues[0].duration = 16.2;
    const trim = trimDuration(project, project.cues[1].id, 20, true);
    expect(trim.duration).toBeCloseTo(19.8);
    expect((16.2 + trim.duration) % 0.5).toBeCloseTo(0);
  });
  it('ripples later scenes and clamps the incoming transition when trimming shorter', () => {
    const patch = trimDuration(defaultProject, defaultProject.cues[1].id, 6.1, true);
    const edited = applyOperations(defaultProject, [
      { type: 'update_cue', id: defaultProject.cues[1].id, patch },
    ]);
    expect(patch).toEqual({ duration: 6, transition: 6 });
    expect(totalDuration(edited)).toBe(totalDuration(defaultProject) - 18);
    expect(edited.cues[2]).toEqual(defaultProject.cues[2]);
  });
  it('honors scene bounds, the full-show cap, and frame precision without snapping', () => {
    expect(trimDuration(defaultProject, defaultProject.cues[0].id, -100, false).duration).toBe(
      1 / 30
    );
    expect(trimDuration(defaultProject, defaultProject.cues[0].id, 2000, true).duration).toBe(1688);
    expect(
      trimDuration(defaultProject, defaultProject.cues[0].id, 16.05, false).duration
    ).toBeCloseTo(16 + 2 / 30);
    const full = structuredClone(defaultProject);
    full.cues = Array.from({ length: 15 }, (_, i) => ({
      ...full.cues[0],
      id: `c${i}`,
      duration: i === 0 ? 119 : 120,
    }));
    expect(trimDuration(full, 'c0', 200, true).duration).toBe(120);
    expect(() => trimDuration(full, 'c0', NaN, true)).toThrow();
  });
  it('moves across the entire sequence as one revision with no identity or timing loss', () => {
    const id = defaultProject.cues[0].id;
    const moved = applyOperations(defaultProject, reorderOperations(defaultProject, id, 5));
    expect(moved.cues.at(-1)).toEqual(defaultProject.cues[0]);
    expect(moved.cues.slice(0, -1)).toEqual(defaultProject.cues.slice(1));
    expect(moved.revision).toBe(defaultProject.revision + 1);
    expect(totalDuration(moved)).toBe(totalDuration(defaultProject));
    const restored = applyOperations(moved, reorderOperations(moved, id, 0));
    expect(restored.cues).toEqual(defaultProject.cues);
    expect(reorderOperations(defaultProject, id, 0)).toEqual([]);
    expect(() => reorderOperations(defaultProject, id, 99)).toThrow();
  });
  it('resolves midpoint drops in both directions and at the sequence boundaries', () => {
    const id = defaultProject.cues[1].id;
    expect(insertionAt(defaultProject, id, -10)).toBe(0);
    expect(insertionAt(defaultProject, id, 34)).toBe(1);
    expect(insertionAt(defaultProject, id, 55)).toBe(2);
    expect(insertionAt(defaultProject, id, 1000)).toBe(5);
  });
  it('displays exact edit frames without rounding into the next second', () => {
    expect(timecode(34)).toBe('00:00:34:00');
    expect(timecode(59 + 29 / 30)).toBe('00:00:59:29');
    expect(timecode(3600)).toBe('01:00:00:00');
    expect(timecode(-1)).toBe('00:00:00:00');
  });
});
