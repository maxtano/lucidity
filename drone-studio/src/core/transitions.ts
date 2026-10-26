import { ShowEvaluator } from './animation';
import { transitionEase, transitionPeakSlope, type Project } from './model';

export type TransitionMotion = {
  kind: 'first-scene' | 'cut' | 'analytic' | 'sampled';
  peakSpeed: number | null;
  endpointDistance: number;
  droneSamples: number;
  timeSamples: number;
  interval: number | null;
  detail: string;
};

/** Creative motion feedback, never flight certification. Animated estimates have a fixed budget. */
export function measureTransition(project: Project, cueId: string): TransitionMotion {
  const cueIndex = project.cues.findIndex((cue) => cue.id === cueId);
  if (cueIndex < 0) throw new Error('Cue not found.');
  if (cueIndex === 0)
    return {
      kind: 'first-scene',
      peakSpeed: null,
      endpointDistance: 0,
      droneSamples: 0,
      timeSamples: 0,
      interval: null,
      detail:
        'The first scene has no incoming blend. This does not measure animation inside the scene.',
    };
  const cue = project.cues[cueIndex],
    previous = project.cues[cueIndex - 1];
  const cut = cue.transition === 0;
  const animated = Object.entries(cue.droneEdits || {}).some(
    ([id, edit]) => Number(id) <= project.droneCount && edit.keyframes?.some((key) => key.position)
  );
  // Static endpoint analysis is linear in fleet size. Animated previews inspect a documented subset.
  const count = animated && !cut ? Math.min(project.droneCount, 1000) : project.droneCount;
  const ids = Array.from({ length: count }, (_, index) =>
    count === 1 ? 1 : 1 + Math.floor((index * (project.droneCount - 1)) / (count - 1))
  );
  const evaluator = new ShowEvaluator(project);
  const origin = evaluator.cuePositions(previous, previous.duration, ids);
  const destination = evaluator.cuePositions(cue, cue.transition, ids);
  let endpointDistance = 0;
  for (let i = 0; i < origin.length; i += 3)
    endpointDistance = Math.max(
      endpointDistance,
      Math.hypot(
        destination[i] - origin[i],
        destination[i + 1] - origin[i + 1],
        destination[i + 2] - origin[i + 2]
      )
    );
  if (cut)
    return {
      kind: 'cut',
      peakSpeed: null,
      endpointDistance,
      droneSamples: count,
      timeSamples: 2,
      interval: null,
      detail: `Both sides of the cut were evaluated for all ${count.toLocaleString()} drones. An instant position jump has no finite transition speed.`,
    };
  if (!animated) {
    const easing = cue.transitionEasing || 'smooth';
    return {
      kind: 'analytic',
      peakSpeed: (endpointDistance * transitionPeakSlope[easing]) / cue.transition,
      endpointDistance,
      droneSamples: count,
      timeSamples: 2,
      interval: null,
      detail: `Analytic interior peak for all ${count.toLocaleString()} drones with static targets. ${easing === 'smooth' ? 'Smooth blend starts and ends at rest.' : 'This profile has endpoint velocity jumps; acceleration is unbounded at those joins.'} This is creative feedback, not a flight check.`,
    };
  }
  const steps = 64,
    dt = cue.transition / steps;
  let peakSpeed = 0,
    previousPositions = origin;
  for (let step = 1; step <= steps; step++) {
    const positions = evaluator.cuePositions(cue, step * dt, ids);
    const weight = transitionEase(step / steps, cue.transitionEasing);
    for (let i = 0; i < positions.length; i++)
      positions[i] = origin[i] + (positions[i] - origin[i]) * weight;
    for (let i = 0; i < positions.length; i += 3)
      peakSpeed = Math.max(
        peakSpeed,
        Math.hypot(
          positions[i] - previousPositions[i],
          positions[i + 1] - previousPositions[i + 1],
          positions[i + 2] - previousPositions[i + 2]
        ) / dt
      );
    previousPositions = positions;
  }
  return {
    kind: 'sampled',
    peakSpeed,
    endpointDistance,
    droneSamples: count,
    timeSamples: steps + 1,
    interval: dt,
    detail: `Observed over ${steps + 1} times (${dt.toFixed(3)} s intervals), ${count.toLocaleString()} of ${project.droneCount.toLocaleString()} drones. Samples can miss faster motion, hold-key jumps, and unsampled drones. This is not a continuous speed bound.`,
  };
}

/** A static-target timing suggestion. Animated targets need their own trajectory analysis. */
export function transitionDurationForSpeed(project: Project, cueId: string, targetSpeed: number) {
  if (!Number.isFinite(targetSpeed) || targetSpeed <= 0)
    throw new Error('Enter a positive transition speed.');
  const result = measureTransition(project, cueId);
  if (result.kind !== 'analytic')
    throw new Error('Speed fitting requires a nonzero transition with static target positions.');
  const cue = project.cues.find((candidate) => candidate.id === cueId)!;
  // Zero movement imposes no speed constraint. Keep authored RGB fades and other timing intact.
  if (result.endpointDistance === 0) return cue.transition;
  return (
    (result.endpointDistance * transitionPeakSlope[cue.transitionEasing || 'smooth']) / targetSpeed
  );
}
