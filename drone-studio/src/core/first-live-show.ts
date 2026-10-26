import { projectSchema, type Project } from './model';

const MARKER = 'first-live-hover-candidate-v1';

/** Editable flight-design candidate. This is never an aircraft mission by itself. */
export function createFirstLiveHoverStoryboard(id: string = crypto.randomUUID()): Project {
  return projectSchema.parse({
    version: 1,
    id,
    revision: 0,
    name: 'First live hover',
    droneCount: 1,
    bpm: 120,
    limits: { minimumSeparation: 0.5, maxSpeed: 2, maxAcceleration: 1, maxAltitude: 5, radius: 5 },
    cues: [{
      id: 'vertical-hover',
      name: 'Rise · hold · land',
      shape: 'custom',
      palette: 'moonlight',
      duration: 15,
      transition: 0,
      scale: 1,
      altitude: 0,
      metadata: { study: MARKER },
      droneEdits: { '1': { keyframes: [
        { time: 0, position: [0, 0, 0], easing: 'smooth' },
        { time: 5, position: [0, 0, 2], easing: 'hold' },
        { time: 10, position: [0, 0, 2], easing: 'smooth' },
        { time: 15, position: [0, 0, 0] },
      ] } },
    }],
  });
}

export function isFirstLiveHoverStoryboard(project: Project): boolean {
  return project.cues.some((cue) => cue.metadata?.study === MARKER);
}
