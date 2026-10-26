import { cueStart, totalDuration, type Project } from './model';
import type { Operation } from './commands';

export const EDIT_FPS = 30;

/** Display/edit resolution only. The audio clock and trajectory evaluator remain continuous. */
export function timecode(seconds: number) {
  const frames = Math.max(0, Math.floor((seconds + 1e-7) * EDIT_FPS));
  return [
    Math.floor(frames / (EDIT_FPS * 3600)),
    Math.floor(frames / (EDIT_FPS * 60)) % 60,
    Math.floor(frames / EDIT_FPS) % 60,
    frames % EDIT_FPS,
  ]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

/** Snap the outgoing cut to the global beat grid, then honor duration/project limits. */
export function trimDuration(project: Project, id: string, requested: number, snap: boolean) {
  const cue = project.cues.find((c) => c.id === id);
  if (!cue || !Number.isFinite(requested)) throw new Error('Invalid scene trim.');
  const start = cueStart(project, id);
  const interval = snap ? 60 / project.bpm : 1 / EDIT_FPS;
  const end = Math.round((start + requested) / interval) * interval;
  const max = Math.min(1800, 1800 - (totalDuration(project) - cue.duration));
  const duration = Math.max(1 / EDIT_FPS, Math.min(max, Number((end - start).toFixed(6))));
  return { duration, transition: Math.min(cue.transition, duration) };
}

/** Existing adjacent-move commands compose into one atomic, undoable timeline gesture. */
export function reorderOperations(project: Project, id: string, toIndex: number): Operation[] {
  const from = project.cues.findIndex((cue) => cue.id === id);
  if (from < 0 || !Number.isInteger(toIndex) || toIndex < 0 || toIndex >= project.cues.length) {
    throw new Error('Invalid scene destination.');
  }
  return Array.from({ length: Math.abs(toIndex - from) }, () => ({
    type: 'move_cue',
    id,
    direction: toIndex < from ? 'up' : 'down',
  }));
}

/** Midpoint insertion keeps scene identities and durations intact during a ripple move. */
export function insertionAt(project: Project, id: string, seconds: number) {
  let start = 0,
    index = 0;
  for (const cue of project.cues) {
    if (cue.id !== id && seconds > start + cue.duration / 2) index++;
    start += cue.duration;
  }
  return index;
}

export function rulerInterval(pixelsPerSecond: number) {
  return (
    [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find(
      (interval) => interval * pixelsPerSecond >= 68
    ) || 600
  );
}
