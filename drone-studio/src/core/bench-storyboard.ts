import { defaultProject, projectSchema, totalDuration, type Project } from './model';

export type StoryboardBenchSource = {
  id: string;
  name: string;
  revision: number;
  /** Exact canonical execution projection, not a cryptographic identity or authorization. */
  planKey: string;
};
export type StoryboardBenchPlan = {
  source: StoryboardBenchSource;
  durationMs: number;
  cues: Array<{ sceneId: string; sceneName: string; motor: number; atMs: number }>;
};

export const STORYBOARD_BENCH_PULSE = Object.freeze({ throttlePercent: 5, durationSeconds: 1 });

/** An ordinary editable project. Only its authored bench cues drive the props-off run. */
export function createBenchStoryboard(name = 'Motor sequence', id: string = crypto.randomUUID()): Project {
  return projectSchema.parse({
    version: 1,
    id,
    name,
    revision: 0,
    droneCount: 1,
    bpm: 120,
    limits: { ...defaultProject.limits },
    cues: [1, 2, 3, 4].map((motor) => ({
      id: `motor-${String.fromCharCode(96 + motor)}`,
      name: `Motor ${String.fromCharCode(64 + motor)}`,
      shape: 'custom',
      palette: 'aurora',
      duration: 6,
      transition: 0,
      scale: 1,
      altitude: 0,
      droneEdits: { '1': { position: [0, 0, 0] } },
      benchCue: { motor, offset: 3 },
    })),
  });
}

/** Fail closed: flight formations and motion are never translated to motor-test commands. */
export function compileStoryboardBenchPlan(input: unknown): StoryboardBenchPlan {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(`Invalid storyboard: ${parsed.error.issues[0]?.message || 'Project validation failed.'}`);
  const project = parsed.data;
  if (project.droneCount !== 1) throw new Error('A props-off storyboard must contain exactly one drone.');
  if (project.cues.length > 12) throw new Error('A props-off storyboard supports at most 12 scenes.');
  const durationMs = totalDuration(project) * 1000;
  if (durationMs > 120_000) throw new Error('A props-off storyboard must last no more than 120 seconds.');

  const cues: StoryboardBenchPlan['cues'] = [];
  let sceneStart = 0;
  for (const scene of project.cues) {
    const edits = scene.droneEdits || {};
    const position = edits['1']?.position;
    if (
      scene.shape !== 'custom' || scene.altitude !== 0 || scene.transition !== 0 ||
      !position || position.some((value) => value !== 0) ||
      Object.keys(edits).some((droneId) => droneId !== '1') ||
      Object.values(edits).some((edit) => (edit.keyframes?.length || 0) > 0)
    ) {
      throw new Error(`Scene “${scene.name}” must keep drone 1 fixed at the origin, with zero altitude, no transition and no keyframes. Flight motion cannot run as a props-off motor show.`);
    }
    if (scene.benchCue) {
      if (scene.benchCue.offset + STORYBOARD_BENCH_PULSE.durationSeconds > scene.duration)
        throw new Error(`The one-second motor pulse must fit inside scene “${scene.name}”.`);
      cues.push({
        sceneId: scene.id,
        sceneName: scene.name,
        motor: scene.benchCue.motor,
        atMs: (sceneStart + scene.benchCue.offset) * 1000,
      });
    }
    sceneStart += scene.duration;
  }
  if (cues.length < 1 || cues.length > 4)
    throw new Error('Add one to four motor pulses to this storyboard before running it props-off.');
  if (new Set(cues.map((cue) => cue.motor)).size !== cues.length)
    throw new Error('Each motor may appear only once in a props-off storyboard.');
  if (cues[0].atMs < 3000)
    throw new Error('Leave at least three seconds before the first motor pulse.');
  if (cues.some((cue, index) => index > 0 && cue.atMs - cues[index - 1].atMs < 6000))
    throw new Error('Motor pulses must start at least six seconds apart.');
  if (durationMs - cues[cues.length - 1].atMs < 3000)
    throw new Error('Leave at least three seconds from the last pulse start to the end of the storyboard.');

  const projection = {
    id: project.id,
    name: project.name,
    revision: project.revision,
    durationMs,
    cues,
  };
  return {
    source: { id: project.id, name: project.name, revision: project.revision, planKey: JSON.stringify(projection) },
    durationMs,
    cues,
  };
}
