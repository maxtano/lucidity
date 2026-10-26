import { describe, expect, it } from 'vitest';
import { ShowEvaluator, evaluateDrone, flashIntensity } from './animation';
import { applyOperations } from './commands';
import { parseProjectFile, projectBundle, trajectoryCsv } from './export';
import { defaultProject, frameAt, projectSchema, type Project } from './model';
import { validateProject } from './validation';

const project = (): Project => ({
  ...structuredClone(defaultProject),
  droneCount: 3,
  cues: [{ ...structuredClone(defaultProject.cues[0]), duration: 10, transition: 0 }],
});

describe('expert point and animation authoring', () => {
  it('allows arbitrary positions and explicit colors without a formation-shaped constraint', () => {
    const p = applyOperations(project(), [
      {
        type: 'edit_drones',
        cueId: 'first-light',
        ids: [1, 3],
        patch: { position: [-500, 15, -12], color: '#ff0000', brightness: 0.5 },
      },
    ]);
    const frame = new ShowEvaluator(p).sample(0);
    expect(Array.from(frame.positions.slice(0, 3))).toEqual([-500, 15, -12]);
    expect(Array.from(frame.positions.slice(6, 9))).toEqual([-500, 15, -12]);
    expect(Array.from(frame.shades.slice(0, 3))).toEqual([0.5, 0, 0]);
    expect(validateProject(p).checks.find((c) => c.name === 'Stage volume')?.status).toBe('fail');
  });
  it('interpolates independently keyed channels and extends first/last values', () => {
    const p = project();
    p.cues[0].droneEdits = {
      '1': {
        keyframes: [
          { time: 0, position: [0, 0, 60], color: '#ff0000' },
          { time: 5, brightness: 0.5 },
          { time: 10, position: [20, 0, 80], color: '#0000ff' },
        ],
      },
    };
    const frame = new ShowEvaluator(p).sample(5);
    expect(Array.from(frame.positions.slice(0, 3))).toEqual([10, 0, 70]);
    expect(Array.from(frame.shades.slice(0, 3))).toEqual([0.25, 0, 0.25]);
    expect(evaluateDrone(p.cues[0].droneEdits['1'], 100, [0, 0, 0], [0, 0, 0]).position).toEqual([
      20, 0, 80,
    ]);
  });
  it('supports smooth motion, holds, and truly dark flashes', () => {
    const edit = {
      keyframes: [
        { time: 0, position: [0, 0, 0] as [number, number, number], easing: 'hold' as const },
        { time: 10, position: [10, 0, 0] as [number, number, number] },
      ],
    };
    expect(evaluateDrone(edit, 9, [0, 0, 0], [1, 1, 1]).position[0]).toBe(0);
    expect(evaluateDrone(edit, 10, [0, 0, 0], [1, 1, 1]).position[0]).toBe(10);
    expect(flashIntensity(0.3, { hz: 2, duty: 0.5, phase: 0 })).toBe(0);
    expect(flashIntensity(0.5, { hz: 2, duty: 0.5, phase: 0 })).toBe(1);
    expect(flashIntensity(1, { hz: 2, duty: 0, phase: -1 })).toBe(0);
    const p = applyOperations(project(), [
      {
        type: 'edit_drones',
        cueId: 'first-light',
        ids: [1],
        patch: { flash: { hz: 2, duty: 0.5, phase: 0 } },
      },
    ]);
    expect(Array.from(new ShowEvaluator(p).sample(0.3).shades.slice(0, 3))).toEqual([0, 0, 0]);
  });
  it('blends from the previous scene’s final animated pose and permits instant cuts', () => {
    const p = project();
    p.cues[0].droneEdits = {
      '1': {
        keyframes: [
          { time: 0, position: [0, 0, 60] },
          { time: 10, position: [10, 0, 60] },
        ],
      },
    };
    p.cues.push({
      ...p.cues[0],
      id: 'next',
      transition: 2,
      droneEdits: { '1': { position: [30, 0, 60] } },
    });
    const evaluator = new ShowEvaluator(p);
    expect(evaluator.sample(10).positions[0]).toBe(10);
    expect(evaluator.sample(11).positions[0]).toBe(20);
    p.cues[1].transition = 0;
    expect(frameAt(p, 10).progress).toBe(1);
    expect(new ShowEvaluator(p).sample(10).positions[0]).toBe(30);
  });
  it('retains inactive drone edits through fleet reduction and restoration', () => {
    let p = applyOperations(project(), [
      { type: 'edit_drones', cueId: 'first-light', ids: [3], patch: { position: [17, 23, 99] } },
    ]);
    p = applyOperations(p, [{ type: 'set_fleet', count: 1 }]);
    expect(p.cues[0].droneEdits?.['3'].position).toEqual([17, 23, 99]);
    expect(new ShowEvaluator(p).sample(0).positions.length).toBe(3);
    p = applyOperations(p, [{ type: 'set_fleet', count: 3 }]);
    expect(Array.from(new ShowEvaluator(p).sample(0).positions.slice(6))).toEqual([17, 23, 99]);
  });
  it('merges channels into a key, retimes it atomically, and rejects destructive collisions', () => {
    let p = applyOperations(project(), [
      {
        type: 'set_keyframe',
        cueId: 'first-light',
        ids: [1, 2],
        keyframe: { time: 1, position: [0, 0, 60] },
      },
      {
        type: 'set_keyframe',
        cueId: 'first-light',
        ids: [1],
        keyframe: { time: 1, color: '#ff0000' },
      },
      {
        type: 'set_keyframe',
        cueId: 'first-light',
        ids: [1],
        keyframe: { time: 3, position: [5, 0, 60] },
      },
    ]);
    expect(p.cues[0].droneEdits?.['1'].keyframes?.[0]).toEqual({
      time: 1,
      position: [0, 0, 60],
      color: '#ff0000',
    });
    expect(() =>
      applyOperations(p, [
        { type: 'move_keyframe', cueId: 'first-light', droneId: 1, from: 1, to: 3 },
      ])
    ).toThrow(/already exists/);
    p = applyOperations(p, [
      { type: 'move_keyframe', cueId: 'first-light', droneId: 1, from: 1, to: 2 },
    ]);
    expect(p.cues[0].droneEdits?.['1'].keyframes?.[0].time).toBe(2);
    p = applyOperations(p, [{ type: 'remove_keyframe', cueId: 'first-light', ids: [1], time: 2 }]);
    expect(p.cues[0].droneEdits?.['1'].keyframes).toHaveLength(1);
    expect(p.cues[0].droneEdits?.['2'].keyframes).toHaveLength(1);
  });
  it('exports edited geometry and light channels with the same evaluator and round-trips source', () => {
    const p = applyOperations(project(), [
      {
        type: 'set_keyframe',
        cueId: 'first-light',
        ids: [1],
        keyframe: { time: 0, position: [11, 22, 33], color: '#00ff00' },
      },
    ]);
    const row = trajectoryCsv(p).split('\n')[2].split(',').map(Number);
    expect(row).toEqual([0, 1, 11, 22, 33, 0, 255, 0]);
    const bundle = projectBundle(p, null);
    expect(bundle.formatVersion).toBe(3);
    expect(parseProjectFile(JSON.stringify(bundle))).toEqual(p);
    expect(parseProjectFile(JSON.stringify({ ...bundle, formatVersion: 1 }))).toEqual(p);
    expect(parseProjectFile(JSON.stringify({ ...bundle, formatVersion: 2 }))).toEqual(p);
    const profiled = structuredClone(p);
    profiled.cues[0].transitionEasing = 'ease-out';
    expect(
      parseProjectFile(JSON.stringify(projectBundle(profiled, null))).cues[0].transitionEasing
    ).toBe('ease-out');
  });
  it('rejects malformed channel values without imposing physical bounds on artistic coordinates', () => {
    const p = project();
    p.cues[0].duration = 1 / 30;
    p.cues[0].transition = 0;
    p.cues[0].altitude = -20;
    p.cues[0].droneEdits = { '1': { position: [10000, -10000, 0], color: '#123456' } };
    expect(projectSchema.parse(p)).toEqual(p);
    p.cues[0].droneEdits['1'].keyframes = [{ time: 0 }, { time: 0 }];
    expect(() => projectSchema.parse(p)).toThrow();
    expect(() =>
      applyOperations(project(), [
        { type: 'edit_drones', cueId: 'first-light', ids: [1], patch: { color: 'oops' } },
      ])
    ).toThrow();
  });
  it('does not certify keyframed motion using the old static-formation bounds', () => {
    const p = project();
    p.cues[0].droneEdits = {
      '1': {
        keyframes: [
          { time: 0, position: [0, 0, 60] },
          { time: 10, position: [1, 0, 60] },
        ],
      },
    };
    const report = validateProject(p);
    expect(report.checks.find((c) => c.name === 'Peak speed')?.status).toBe('incomplete');
    expect(report.checks.find((c) => c.name === 'Custom animation')).toBeDefined();
    expect(report.flightReady).toBe(false);
  });
});
