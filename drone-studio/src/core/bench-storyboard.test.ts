import { describe, expect, it } from 'vitest';
import { ShowEvaluator } from './animation';
import { createBenchStoryboard, compileStoryboardBenchPlan } from './bench-storyboard';
import { applyOperations } from './commands';
import { parseProjectFile, projectBundle } from './export';
import { defaultProject, projectSchema, type Project } from './model';

const storyboard = () => createBenchStoryboard('My motor storyboard', 'bench-project');
const compile = (project = storyboard()) => compileStoryboardBenchPlan(project);

describe('authored props-off storyboards', () => {
  it('creates an ordinary one-drone project with four authored scene-local pulses', () => {
    const project = storyboard();
    expect(projectSchema.parse(project)).toEqual(project);
    expect(project.droneCount).toBe(1);
    expect(project.cues.map((scene) => scene.benchCue)).toEqual(
      [1, 2, 3, 4].map((motor) => ({ motor, offset: 3 }))
    );
    const plan = compile(project);
    expect(plan.durationMs).toBe(24_000);
    expect(plan.source).toMatchObject({ id: project.id, name: project.name, revision: 0 });
    expect(plan.cues).toEqual(project.cues.map((scene, i) => ({
      sceneId: scene.id, sceneName: scene.name, motor: i + 1, atMs: 3000 + i * 6000,
    })));
    const evaluator = new ShowEvaluator(project);
    for (let time = 0; time <= 24; time += 0.5)
      expect(Array.from(evaluator.sample(time).positions)).toEqual([0, 0, 0]);
  });

  it('gives separately created projects distinct IDs', () => {
    expect(createBenchStoryboard().id).not.toBe(createBenchStoryboard().id);
  });

  it('compiles current scene edits rather than a detached canned schedule', () => {
    const before = storyboard();
    const changed = applyOperations(before, [{
      type: 'update_cue', id: before.cues[0].id,
      patch: { name: 'Opening pulse', duration: 8 },
    }]);
    const plan = compile(changed);
    expect(plan.durationMs).toBe(26_000);
    expect(plan.cues.map((cue) => cue.atMs)).toEqual([3000, 11000, 17000, 23000]);
    expect(plan.cues[0].sceneName).toBe('Opening pulse');
    expect(plan.source.revision).toBe(1);
    expect(plan.source.planKey).not.toBe(compile(before).source.planKey);
    expect(before.cues[0].duration).toBe(6);
  });

  it('reordering scenes reorders the real motor sequence at the authored scene boundaries', () => {
    const project = storyboard();
    const changed = applyOperations(project, [{ type: 'move_cue', id: project.cues[1].id, direction: 'up' }]);
    expect(compile(changed).cues.map(({ motor, atMs }) => [motor, atMs])).toEqual([
      [2, 3000], [1, 9000], [3, 15000], [4, 21000],
    ]);
  });

  it('retiming scales the motor offset as well as the scene, including with keyframe scaling disabled', () => {
    const project = storyboard();
    const changed = applyOperations(project, [{
      type: 'retime_cue', id: project.cues[0].id, speed: 0.5, scaleKeyframes: false,
    }]);
    expect(changed.cues[0]).toMatchObject({ duration: 12, benchCue: { motor: 1, offset: 6 } });
    expect(compile(changed).cues.map((cue) => cue.atMs)).toEqual([6000, 15000, 21000, 27000]);
    expect(compile(changed).durationMs).toBe(30_000);
    const unsafe = applyOperations(project, [{ type: 'retime_cue', id: project.cues[0].id, speed: 2 }]);
    expect(() => compile(unsafe)).toThrow(/three seconds before/);
  });

  it('supports authored offset changes and clearing a pulse to leave a wait scene', () => {
    const project = storyboard();
    const changed = applyOperations(project, project.cues.map((scene) => ({
      type: 'update_cue', id: scene.id,
      patch: { duration: 7, benchCue: { ...scene.benchCue, offset: 4 } },
    })));
    expect(compile(changed).cues.map((cue) => cue.atMs)).toEqual([4000, 11000, 18000, 25000]);
    const cleared = applyOperations(changed, [{ type: 'update_cue', id: changed.cues[1].id, patch: { benchCue: null } }]);
    expect(compile(cleared).cues.map(({ motor, atMs }) => [motor, atMs])).toEqual([
      [1, 4000], [3, 18000], [4, 25000],
    ]);
    expect(compile(cleared).durationMs).toBe(28_000);
  });

  it('accepts wait-only scenes before, between and after pulses', () => {
    const project = storyboard();
    project.cues = [
      { ...project.cues[0], id: 'lead-wait', benchCue: undefined },
      project.cues[1],
      { ...project.cues[2], benchCue: null },
      project.cues[3],
      { ...project.cues[0], id: 'tail-wait', benchCue: undefined },
    ];
    expect(compile(project).cues.map(({ motor, atMs }) => [motor, atMs])).toEqual([[2, 9000], [4, 21000]]);
    expect(compile(project).durationMs).toBe(30_000);
  });

  it('uses exact deterministic execution projection and produces independent plan copies', () => {
    const project = storyboard();
    const plan = compile(project);
    expect(compile(structuredClone(project))).toEqual(plan);
    expect(JSON.parse(plan.source.planKey)).toEqual({
      id: project.id, name: project.name, revision: project.revision,
      durationMs: plan.durationMs, cues: plan.cues,
    });
    plan.cues[0].motor = 4;
    expect(compile(project).cues[0].motor).toBe(1);
    expect(compile({ ...project, revision: 1 }).source.planKey).not.toBe(plan.source.planKey);
    expect(compile({ ...project, name: 'Renamed' }).source.planKey).not.toBe(plan.source.planKey);
  });

  it('round-trips authored cues and their changed order/timing through portable design v4', () => {
    const project = storyboard();
    const edited = applyOperations(project, [
      { type: 'move_cue', id: project.cues[3].id, direction: 'up' },
      { type: 'retime_cue', id: project.cues[0].id, speed: 0.5 },
    ]);
    const bundle = projectBundle(edited, null);
    expect(bundle.formatVersion).toBe(4);
    expect(bundle.intendedUse).toBe('props-off-storyboard-rehearsal');
    expect(bundle.flightReady).toBe(false);
    expect(bundle.benchExecution).toMatchObject({
      intendedUse: 'props-off-only', pulse: { throttlePercent: 5, durationSeconds: 1 },
    });
    const restored = parseProjectFile(JSON.stringify(bundle));
    expect(restored).toEqual(edited);
    expect(compile(restored)).toEqual(compile(edited));
    expect(compile(parseProjectFile(JSON.stringify(edited)))).toEqual(compile(edited));
  });

  it('keeps ordinary designs valid and accepts all previous portable formats', () => {
    const project = structuredClone(defaultProject);
    const bundle = projectBundle(project, null);
    expect(bundle.formatVersion).toBe(3);
    expect(bundle.benchExecution).toBeUndefined();
    for (const formatVersion of [1, 2, 3])
      expect(parseProjectFile(JSON.stringify({ ...bundle, formatVersion }))).toEqual(project);
    expect(() => parseProjectFile(JSON.stringify({ ...bundle, formatVersion: 5 }))).toThrow(/Unsupported/);
    expect(() => compile(project)).toThrow(/exactly one drone/);
  });
});

describe('storyboard compiler rejects unexecutable designs', () => {
  const expectRejected = (change: (project: Project) => void, reason: RegExp) => {
    const project = storyboard();
    change(project);
    expect(() => compile(project)).toThrow(reason);
  };

  it.each([
    null,
    {},
    { ...storyboard(), name: '' },
    { ...storyboard(), revision: -1 },
    { ...storyboard(), cues: [{ ...storyboard().cues[0], benchCue: { motor: 5, offset: 3 } }] },
    { ...storyboard(), cues: [{ ...storyboard().cues[0], benchCue: { motor: 1, offset: Infinity } }] },
    { ...storyboard(), cues: [{ ...storyboard().cues[0], benchCue: { motor: 1, offset: 3, throttle: 50 } }] },
  ])('rejects malformed project or pulse data %#', (input) => {
    expect(() => compileStoryboardBenchPlan(input)).toThrow(/Invalid storyboard/);
  });

  it('rejects multiple drones, too many scenes, and excessive duration', () => {
    expectRejected((p) => { p.droneCount = 2; }, /exactly one drone/);
    expectRejected((p) => { p.cues = Array.from({ length: 13 }, (_, i) => ({ ...p.cues[0], id: `scene-${i}` })); }, /at most 12/);
    expectRejected((p) => { p.cues[0].duration = 110; }, /120 seconds/);
  });

  it.each([
    ['generated shape', (p: Project) => { p.cues[0].shape = 'grid'; }],
    ['altitude', (p: Project) => { p.cues[0].altitude = 1; }],
    ['transition', (p: Project) => { p.cues[0].transition = 1; }],
    ['translated point', (p: Project) => { p.cues[0].droneEdits!['1'].position = [0, 1, 0]; }],
    ['missing position', (p: Project) => { delete p.cues[0].droneEdits; }],
    ['position keyframes', (p: Project) => { p.cues[0].droneEdits!['1'].keyframes = [{ time: 0, position: [0, 0, 0] }]; }],
    ['other keyframes', (p: Project) => { p.cues[0].droneEdits!['1'].keyframes = [{ time: 0, brightness: 1 }]; }],
    ['dormant drone edits', (p: Project) => { p.cues[0].droneEdits!['2'] = { position: [0, 0, 0] }; }],
  ] as const)('rejects %s rather than treating flight content as a motor show', (_name, change) => {
    expectRejected(change, /fixed at the origin/);
  });

  it('rejects motion even in a scene without a motor pulse', () => {
    expectRejected((p) => { p.cues[0].benchCue = null; p.cues[0].altitude = 2; }, /fixed at the origin/);
  });

  it('requires a bounded, unique set of authored motor pulses', () => {
    expectRejected((p) => { p.cues.forEach((scene) => { scene.benchCue = null; }); }, /one to four/);
    expectRejected((p) => { p.cues.push({ ...p.cues[0], id: 'fifth' }); }, /one to four/);
    expectRejected((p) => { p.cues[1].benchCue!.motor = 1; }, /only once/);
  });

  it('rejects short lead-in, dense pulses, insufficient final observation, and overrun', () => {
    expectRejected((p) => { p.cues[0].benchCue!.offset = 2; }, /three seconds before/);
    expectRejected((p) => { p.cues[0].duration = 5; }, /six seconds apart/);
    expectRejected((p) => { p.cues[3].benchCue!.offset = 4; }, /last pulse start/);
    expectRejected((p) => { p.cues[3].benchCue!.offset = 5.5; }, /fit inside scene/);
  });

  it('does not let shared update_cue accept arbitrary pulse power or duration', () => {
    const project = storyboard();
    for (const extra of [{ throttlePercent: 60 }, { durationSeconds: 5 }])
      expect(() => applyOperations(project, [{
        type: 'update_cue', id: project.cues[0].id,
        patch: { benchCue: { motor: 1, offset: 3, ...extra } },
      }])).toThrow();
  });
});
