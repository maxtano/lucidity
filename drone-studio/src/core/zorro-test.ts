import { createStoryboard } from './storyboards';
import { projectSchema, type Project } from './model';

const MARKER = 'zorro-estop-props-off-v1';

/** Fixed storyboard identity; execution is a separate gated aircraft operation. */
export function createZorroStopStoryboard(id?: string): Project {
  const project = createStoryboard('Props-off idle', id);
  project.cues[0] = {
    ...project.cues[0], id: 'zorro-stop-window', name: 'Armed idle',
    duration: 20, metadata: { operatorTest: MARKER },
  };
  return projectSchema.parse(project);
}

export function isZorroStopStoryboard(project: Project): boolean {
  return project.cues.some((scene) => scene.metadata?.operatorTest === MARKER);
}

/** Fail closed if the operator exercise is edited into a flight or motor-command show. */
export function zorroStopPlanError(project: Project): string | null {
  if (!isZorroStopStoryboard(project)) return 'Open the props-off idle storyboard.';
  if (project.droneCount !== 1 || project.cues.length !== 1)
    return 'This run requires exactly one drone and one 20-second scene.';
  const scene = project.cues[0];
  const position = scene.droneEdits?.['1']?.position;
  if (scene.duration !== 20 || scene.transition !== 0 || scene.altitude !== 0 ||
    scene.shape !== 'custom' || scene.benchCue ||
    !position || position.some((value) => value !== 0) ||
    Object.keys(scene.droneEdits ?? {}).some((id) => id !== '1') ||
    (scene.droneEdits?.['1']?.keyframes?.length ?? 0) > 0)
    return 'Restore the fixed, stationary 20-second scene before this run.';
  return null;
}
