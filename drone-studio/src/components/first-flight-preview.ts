import { ShowEvaluator } from '../core/animation';
import type { Project } from '../core/model';

export const FIRST_FLIGHT_HEIGHT_M = 0.3048;
export const FIRST_FLIGHT_DURATION_S = 9;
const MARKER = 'one-foot-hover-study-v1';

/** Editable design study. Its keyframes are not an aircraft mission or height controller. */
export function createOneFootHoverStoryboard(id: string = crypto.randomUUID()): Project {
  return {
    version: 1,
    id,
    revision: 0,
    name: 'One-foot hover study',
    droneCount: 1,
    bpm: 120,
    limits: { minimumSeparation: 0.5, maxSpeed: 1, maxAcceleration: 1, maxAltitude: 1, radius: 1 },
    cues: [
      {
        id: 'up-hover-down',
        name: 'Up 1 ft · hover 4 s · down',
        shape: 'custom',
        palette: 'moonlight',
        duration: FIRST_FLIGHT_DURATION_S,
        transition: 0,
        scale: 1,
        altitude: 0,
        metadata: { study: MARKER },
        droneEdits: {
          '1': {
            keyframes: [
              { time: 0, position: [0, 0, 0], easing: 'smooth' },
              { time: 2, position: [0, 0, FIRST_FLIGHT_HEIGHT_M], easing: 'hold' },
              { time: 6, position: [0, 0, FIRST_FLIGHT_HEIGHT_M], easing: 'smooth' },
              { time: 9, position: [0, 0, 0] },
            ],
          },
        },
      },
    ],
  };
}

export function isOneFootHoverStoryboard(project: Project): boolean {
  // Recognize the earlier one-drone study already saved in users' libraries.
  // Match its full structure so a similarly named future motor show is unaffected.
  return project.cues.some((cue) => cue.metadata?.study === MARKER) ||
    (project.name === 'One drone · 1 ft hover' && project.droneCount === 1 &&
      project.cues.length === 1 && project.cues[0].shape === 'custom' &&
      !project.cues[0].benchCue &&
      (project.cues[0].droneEdits?.['1']?.keyframes?.length ?? 0) >= 2);
}

/** Stable private evaluator used only by the optional diagram. */
export function createFirstFlightPreview(): Project {
  return createOneFootHoverStoryboard('first-flight-preview');
}

const evaluator = new ShowEvaluator(createFirstFlightPreview());

export function firstFlightPreviewAt(time: number) {
  const seconds = Number.isFinite(time) ? Math.max(0, Math.min(FIRST_FLIGHT_DURATION_S, time)) : 0;
  return {
    altitudeM: evaluator.samplePositions(seconds, [1])[2],
    phase:
      seconds === 0
        ? 'Ready'
        : seconds < 2
          ? 'Rising'
          : seconds < 6
            ? 'Hovering'
            : seconds < 9
              ? 'Descending'
              : 'Complete',
  };
}
