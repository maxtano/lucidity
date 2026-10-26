import { projectSchema, type Project } from '../core/model';

export type HoverMissionItem = {
  seq: number;
  command: 22 | 19 | 21;
  label: string;
  altitudeM: number;
  holdSeconds?: number;
};

export type HoverMissionDraft = {
  storyboardId: string;
  revision: number;
  heightM: number;
  holdSeconds: number;
  items: HoverMissionItem[];
  warning: string;
};

export class MissionPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissionPlanError';
  }
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const at = (position: number[] | undefined, x: number, y: number, z: number) =>
  !!position && close(position[0], x) && close(position[1], y) && close(position[2], z);

/**
 * Deliberately narrow: only a vertical, single-scene hover can be represented by
 * TAKEOFF -> LOITER_TIME -> LAND. The storyboard times are design intent, not
 * flight-controller climb/descent rates or guaranteed wall-clock timing.
 */
export function compileHoverMission(input: unknown): HoverMissionDraft {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) throw new MissionPlanError('The storyboard is invalid.');
  const project: Project = parsed.data;
  if (project.droneCount !== 1 || project.cues.length !== 1)
    throw new MissionPlanError('Flight preparation supports one drone and one vertical scene only.');
  const cue = project.cues[0];
  if (cue.shape !== 'custom' || cue.transition !== 0 || cue.altitude !== 0 || cue.scale !== 1 || cue.benchCue)
    throw new MissionPlanError('This scene contains formation, transition, or bench controls that cannot be flown by this mission compiler.');
  const edits = cue.droneEdits;
  if (!edits || Object.keys(edits).length !== 1 || !edits['1'])
    throw new MissionPlanError('Use exactly one explicit drone path.');
  const edit = edits['1'];
  if (edit.position || edit.color || edit.brightness !== undefined || edit.flash)
    throw new MissionPlanError('This flight path cannot include static position or light overrides.');
  const frames = edit.keyframes;
  if (!frames || frames.length !== 4 || frames.some(frame => !frame.position || frame.color || frame.brightness !== undefined || frame.flash))
    throw new MissionPlanError('Use four position-only keyframes: ground, hover start, hover end, ground.');
  const heightM = frames[1].position![2];
  if (!Number.isFinite(heightM) || heightM < 2 || heightM > 10 || project.limits.maxAltitude < heightM)
    throw new MissionPlanError('Choose a reviewed hover height from 2 to 10 m within the storyboard altitude limit. The 1 ft design study is preview-only.');
  if (!at(frames[0].position, 0, 0, 0) || !at(frames[1].position, 0, 0, heightM) ||
      !at(frames[2].position, 0, 0, heightM) || !at(frames[3].position, 0, 0, 0))
    throw new MissionPlanError('Only a vertical up, hold, and down path is supported. Horizontal movement needs a separate verified compiler.');
  const [start, hoverStart, hoverEnd, finish] = frames.map(frame => frame.time);
  const holdSeconds = hoverEnd - hoverStart;
  if (!close(start, 0) || !close(finish, cue.duration) || hoverStart < 3 || holdSeconds < 3 || holdSeconds > 15 || finish - hoverEnd < 3)
    throw new MissionPlanError('Use at least 3 s for ascent, 3–15 s for the hold, and 3 s for descent.');
  return {
    storyboardId: project.id,
    revision: project.revision,
    heightM,
    holdSeconds,
    items: [
      { seq: 1, command: 22, label: 'Take off vertically', altitudeM: heightM },
      { seq: 2, command: 19, label: 'Hold at current location', altitudeM: heightM, holdSeconds },
      { seq: 3, command: 21, label: 'Land at current location', altitudeM: 0 },
    ],
    warning: 'Flight requires a fresh field readiness check and a pilot ready to take control. Altitude is relative to ArduPilot home, not measured clearance above terrain. Climb, hold, and landing timing are controlled by ArduPilot; storyboard keyframe timing is not exact aircraft timing.',
  };
}
