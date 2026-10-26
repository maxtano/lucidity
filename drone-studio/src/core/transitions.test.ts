import { describe, expect, it } from 'vitest';
import { ShowEvaluator } from './animation';
import { applyOperations } from './commands';
import { parseProjectFile, projectBundle, trajectoryCsv } from './export';
import {
  defaultProject,
  frameAt,
  projectSchema,
  smooth,
  transitionEase,
  type Project,
} from './model';
import { measureTransition, transitionDurationForSpeed } from './transitions';
import { validateProject } from './validation';

function sceneProject(): Project {
  const base = structuredClone(defaultProject);
  return {
    ...base,
    droneCount: 2,
    cues: [
      {
        ...base.cues[0],
        duration: 10,
        transition: 0,
        droneEdits: { '1': { position: [0, 0, 60] }, '2': { position: [0, 5, 60] } },
      },
      {
        ...base.cues[1],
        duration: 10,
        transition: 4,
        droneEdits: { '1': { position: [20, 0, 60] }, '2': { position: [20, 5, 60] } },
      },
    ],
  };
}

describe('transition profiles and shared evaluation', () => {
  it('preserves the old default and clamps every supported curve', () => {
    expect(frameAt(sceneProject(), 11).progress).toBe(smooth(0.25));
    for (const profile of ['smooth', 'linear', 'ease-in', 'ease-out'] as const) {
      expect(transitionEase(-1, profile)).toBe(0);
      expect(transitionEase(2, profile)).toBe(1);
    }
    expect(transitionEase(0.25, 'linear')).toBe(0.25);
    expect(transitionEase(0.25, 'ease-in')).toBe(0.015625);
    expect(transitionEase(0.25, 'ease-out')).toBe(0.578125);
  });
  it('uses authored easing in the sampler, subset inspector, CSV, and portable files', () => {
    const project = applyOperations(sceneProject(), [
      { type: 'update_cue', id: 'in-orbit', patch: { transitionEasing: 'ease-in' } },
    ]);
    const evaluator = new ShowEvaluator(project);
    expect(evaluator.sample(11).positions[0]).toBeCloseTo(0.3125);
    expect(Array.from(evaluator.samplePositions(11, [2, 1]))).toEqual([
      0.3125, 5, 60, 0.3125, 0, 60,
    ]);
    const line = trajectoryCsv(project)
      .split('\n')
      .find((row) => row.startsWith('11.000,1,'));
    expect(Number(line!.split(',')[2])).toBe(0.3125);
    expect(parseProjectFile(JSON.stringify(projectBundle(project, null)))).toEqual(project);
    expect(() =>
      projectSchema.parse({
        ...project,
        cues: [{ ...project.cues[0], transitionEasing: 'random' }],
      })
    ).toThrow();
  });
  it('keeps subset sampling identical to full animation before and after mutable buffer reads', () => {
    const project = sceneProject();
    project.cues[1].droneEdits!['1'].keyframes = [
      { time: 0, position: [10, 0, 60] },
      { time: 10, position: [30, 0, 60] },
    ];
    const evaluator = new ShowEvaluator(project);
    for (const time of [10, 11.23, 14, 19, 11.23]) {
      evaluator.sample(19);
      const subset = evaluator.samplePositions(time, [1]);
      expect(Array.from(subset)).toEqual(Array.from(evaluator.sample(time).positions.slice(0, 3)));
    }
    expect(() => evaluator.samplePositions(11, [3])).toThrow(/active fleet/);
  });
  it('does not treat a velocity corner or scene cut as a finite acceleration bound', () => {
    const linear = applyOperations(sceneProject(), [
      { type: 'update_cue', id: 'in-orbit', patch: { transitionEasing: 'linear' } },
    ]);
    const report = validateProject(linear);
    expect(report.maxSpeed).toBeCloseTo(5);
    expect(report.checks.find((check) => check.name === 'Peak acceleration')?.status).toBe(
      'incomplete'
    );
    const cut = applyOperations(linear, [
      { type: 'update_cue', id: 'in-orbit', patch: { transition: 0 } },
    ]);
    expect(validateProject(cut).checks.find((check) => check.name === 'Peak speed')?.status).toBe(
      'incomplete'
    );
  });
});

describe('atomic scene retiming', () => {
  it('scales all authored key times, including inactive drones and trimmed-away keys', () => {
    const project = sceneProject();
    project.cues[1].droneEdits!['900'] = {
      color: '#ff0000',
      flash: { hz: 2, duty: 0.5, phase: 0.25 },
      keyframes: [
        { time: 2, brightness: 0.3 },
        { time: 18, position: [12, 3, 60] },
      ],
    };
    const next = applyOperations(project, [{ type: 'retime_cue', id: 'in-orbit', speed: 2 }]);
    expect(next.cues[1].duration).toBe(5);
    expect(next.cues[1].transition).toBe(2);
    expect(next.cues[1].droneEdits!['900'].keyframes?.map((key) => key.time)).toEqual([1, 9]);
    expect(next.cues[1].droneEdits!['900'].flash).toEqual(project.cues[1].droneEdits!['900'].flash);
    expect(next.revision).toBe(1);
    expect(project.cues[1].duration).toBe(10);
  });
  it('supports independently retaining key timestamps and transition duration', () => {
    const project = sceneProject();
    project.cues[1].droneEdits!['1'].keyframes = [{ time: 8, position: [25, 0, 60] }];
    const next = applyOperations(project, [
      {
        type: 'retime_cue',
        id: 'in-orbit',
        speed: 2,
        scaleKeyframes: false,
        scaleTransition: false,
      },
    ]);
    expect(next.cues[1].duration).toBe(5);
    expect(next.cues[1].transition).toBe(4);
    expect(next.cues[1].droneEdits!['1'].keyframes?.[0].time).toBe(8);
  });
  it('preserves the motion at matching local fractions when speed scales keys and blend', () => {
    const project = sceneProject();
    project.cues[1].droneEdits!['1'].keyframes = [
      { time: 0, position: [10, 0, 60] },
      { time: 10, position: [30, 0, 60] },
    ];
    const next = applyOperations(project, [{ type: 'retime_cue', id: 'in-orbit', speed: 2 }]);
    const before = new ShowEvaluator(project),
      after = new ShowEvaluator(next);
    for (const local of [0, 1, 4, 9, 10])
      expect(after.samplePositions(10 + local / 2, [1])).toEqual(
        before.samplePositions(10 + local, [1])
      );
  });
  it('rejects impossible timing and stale revisions without partially applying other edits', () => {
    const project = sceneProject(),
      original = structuredClone(project);
    for (const operation of [
      { type: 'retime_cue', id: 'in-orbit', speed: 0 },
      { type: 'retime_cue', id: 'in-orbit', speed: 0.0001 },
      { type: 'retime_cue', id: 'in-orbit', speed: 1000 },
      { type: 'retime_cue', id: 'in-orbit', speed: 4, scaleTransition: false },
      { type: 'transition_to_beats', id: 'in-orbit', beats: 30 },
    ])
      expect(() =>
        applyOperations(project, [{ type: 'rename', name: 'Changed' }, operation])
      ).toThrow();
    expect(() =>
      applyOperations(project, [{ type: 'retime_cue', id: 'in-orbit', speed: 2 }], 5)
    ).toThrow(/out of date/);
    expect(project).toEqual(original);
  });
  it('maps beat duration using the tempo in the same atomic batch', () => {
    const next = applyOperations(sceneProject(), [
      { type: 'set_tempo', bpm: 90 },
      { type: 'transition_to_beats', id: 'in-orbit', beats: 4.5 },
    ]);
    expect(next.cues[1].transition).toBe(3);
  });
  it('keeps tightly spaced retimed keys distinct when editing, deleting, or moving exact times', () => {
    const project = sceneProject();
    project.cues[1].droneEdits!['1'].keyframes = [
      { time: 1, position: [0, 0, 60], color: '#ff0000' },
      { time: 1.0000015, position: [20, 0, 60], color: '#0000ff' },
    ];
    const retimed = applyOperations(project, [{ type: 'retime_cue', id: 'in-orbit', speed: 2 }]);
    const times = retimed.cues[1].droneEdits!['1'].keyframes!.map((key) => key.time);
    const edited = applyOperations(retimed, [
      {
        type: 'set_keyframe',
        cueId: 'in-orbit',
        ids: [1],
        keyframe: { time: times[1], brightness: 0.25 },
      },
    ]);
    expect(edited.cues[1].droneEdits!['1'].keyframes).toEqual([
      { time: times[0], position: [0, 0, 60], color: '#ff0000' },
      { time: times[1], position: [20, 0, 60], color: '#0000ff', brightness: 0.25 },
    ]);
    const removed = applyOperations(retimed, [
      { type: 'remove_keyframe', cueId: 'in-orbit', ids: [1], time: times[1] },
    ]);
    expect(removed.cues[1].droneEdits!['1'].keyframes?.map((key) => key.time)).toEqual([times[0]]);
    const moved = applyOperations(retimed, [
      { type: 'move_keyframe', cueId: 'in-orbit', droneId: 1, from: times[1], to: 2 },
    ]);
    expect(moved.cues[1].droneEdits!['1'].keyframes).toEqual([
      { time: times[0], position: [0, 0, 60], color: '#ff0000' },
      { time: 2, position: [20, 0, 60], color: '#0000ff' },
    ]);
  });
  it('rejects ambiguous approximate key references atomically while retaining unique fallbacks', () => {
    const project = sceneProject();
    project.cues[1].droneEdits!['1'].keyframes = [
      { time: 0.5, brightness: 0.2 },
      { time: 0.50000075, brightness: 0.8 },
    ];
    const between = 0.500000375;
    for (const command of [
      {
        type: 'set_keyframe',
        cueId: 'in-orbit',
        ids: [1],
        keyframe: { time: between, color: '#ffffff' },
      },
      { type: 'remove_keyframe', cueId: 'in-orbit', ids: [1], time: between },
      { type: 'move_keyframe', cueId: 'in-orbit', droneId: 1, from: between, to: 2 },
    ])
      expect(() =>
        applyOperations(project, [{ type: 'rename', name: 'Should roll back' }, command])
      ).toThrow(/ambiguous/);
    expect(project.name).toBe(defaultProject.name);
    expect(project.cues[1].droneEdits!['1'].keyframes).toHaveLength(2);
    const single = applyOperations(project, [
      { type: 'remove_keyframe', cueId: 'in-orbit', ids: [1], time: 0.50000075 },
    ]);
    const approximate = applyOperations(single, [
      { type: 'remove_keyframe', cueId: 'in-orbit', ids: [1], time: 0.5000001 },
    ]);
    expect(approximate.cues[1].droneEdits!['1'].keyframes).toHaveLength(0);
  });
  it('accepts full-duration beats despite floating roundoff but rejects real overshoots', () => {
    const project = sceneProject();
    project.bpm = 100;
    const beats = project.cues[1].duration / (60 / project.bpm);
    expect((beats * 60) / project.bpm).toBeGreaterThan(project.cues[1].duration);
    const next = applyOperations(project, [{ type: 'transition_to_beats', id: 'in-orbit', beats }]);
    expect(next.cues[1].transition).toBe(10);
    expect(() =>
      applyOperations(project, [
        { type: 'transition_to_beats', id: 'in-orbit', beats: beats + 0.00001 },
      ])
    ).toThrow(/Transition must fit/);
  });
  it('keeps retimed boundary keys valid without clipping substantive out-of-range authored times', () => {
    const project = sceneProject();
    project.cues = [
      {
        ...project.cues[0],
        duration: 1800,
        transition: 1800,
        droneEdits: { '1': { keyframes: [{ time: 1800, brightness: 0 }] } },
      },
    ];
    const next = applyOperations(project, [
      { type: 'retime_cue', id: 'first-light', speed: 1 - Number.EPSILON },
    ]);
    expect(next.cues[0].duration).toBe(1800);
    expect(next.cues[0].transition).toBe(1800);
    expect(next.cues[0].droneEdits!['1'].keyframes?.[0].time).toBe(1800);
    expect(() =>
      applyOperations(project, [{ type: 'retime_cue', id: 'first-light', speed: 0.99999 }])
    ).toThrow();
  });
});

describe('transition motion feedback', () => {
  it('computes static peak speed from the authored profile and previous final pose', () => {
    const project = sceneProject();
    project.cues[0].droneEdits!['1'].keyframes = [
      { time: 0, position: [-20, 0, 60] },
      { time: 10, position: [0, 0, 60] },
    ];
    expect(measureTransition(project, 'in-orbit')).toMatchObject({
      kind: 'analytic',
      peakSpeed: 9.375,
      endpointDistance: 20,
      droneSamples: 2,
    });
    expect(transitionDurationForSpeed(project, 'in-orbit', 5)).toBe(7.5);
    project.cues[1].transitionEasing = 'ease-in';
    expect(measureTransition(project, 'in-orbit').peakSpeed).toBe(15);
  });
  it('labels animated estimates as sampled and excludes the following cut at the scene endpoint', () => {
    const project = sceneProject();
    project.cues[1].transition = 10;
    project.cues[1].transitionEasing = 'linear';
    project.cues[1].droneEdits!['1'].keyframes = [
      { time: 0, position: [0, 0, 60] },
      { time: 10, position: [20, 0, 60] },
    ];
    project.cues.push({
      ...project.cues[0],
      id: 'third',
      transition: 0,
      droneEdits: { '1': { position: [1000, 0, 60] } },
    });
    const result = measureTransition(project, 'in-orbit');
    expect(result.kind).toBe('sampled');
    expect(result.peakSpeed).toBeGreaterThan(3.9);
    expect(result.peakSpeed).toBeLessThan(4);
    expect(result.timeSamples).toBe(65);
    expect(result.detail).toContain('not a continuous speed bound');
    expect(() => transitionDurationForSpeed(project, 'in-orbit', 5)).toThrow(/static target/);
  });
  it('documents sparse fleet estimates and does not invent a speed for cuts or openings', () => {
    const project = sceneProject();
    expect(measureTransition(project, 'first-light').kind).toBe('first-scene');
    project.droneCount = 2001;
    project.cues[1].droneEdits!['1'].keyframes = [{ time: 0, position: [0, 0, 60] }];
    expect(measureTransition(project, 'in-orbit')).toMatchObject({
      kind: 'sampled',
      droneSamples: 1000,
    });
    project.cues[1].transition = 0;
    expect(measureTransition(project, 'in-orbit')).toMatchObject({ kind: 'cut', peakSpeed: null });
  });
  it('preserves a stationary color fade when no motion needs a speed fit', () => {
    const project = sceneProject();
    project.cues[1].droneEdits = structuredClone(project.cues[0].droneEdits);
    project.cues[0].palette = 'moonlight';
    project.cues[1].palette = 'ember';
    expect(measureTransition(project, 'in-orbit')).toMatchObject({
      kind: 'analytic',
      endpointDistance: 0,
      peakSpeed: 0,
    });
    expect(transitionDurationForSpeed(project, 'in-orbit', 8)).toBe(4);
    const original = new ShowEvaluator(project).sample(12);
    const fitted = applyOperations(project, [
      {
        type: 'update_cue',
        id: 'in-orbit',
        patch: { transition: transitionDurationForSpeed(project, 'in-orbit', 8) },
      },
    ]);
    expect(new ShowEvaluator(fitted).sample(12).shades).toEqual(original.shades);
  });
  it('measures both sides of a cut, including previous final and current opening keys', () => {
    const project = sceneProject();
    project.cues[1].transition = 0;
    project.cues[0].droneEdits!['1'].keyframes = [
      { time: 0, position: [0, 0, 60] },
      { time: 10, position: [7, 0, 60] },
    ];
    project.cues[1].droneEdits!['1'].keyframes = [
      { time: 0, position: [47, 0, 60] },
      { time: 10, position: [97, 0, 60] },
    ];
    expect(measureTransition(project, 'in-orbit')).toMatchObject({
      kind: 'cut',
      endpointDistance: 40,
      peakSpeed: null,
      droneSamples: 2,
      timeSamples: 2,
      interval: null,
    });
  });
});
