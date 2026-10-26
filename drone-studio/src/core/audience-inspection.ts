import { ShowEvaluator } from './animation';
import { frameAt, totalDuration, type Project, type Vector3Tuple } from './model';
import { headingToPoint, normalizeViewerSnapshot, type ViewerSnapshot } from './viewer';

export type AudienceInspectionReport = {
  time: number;
  cueId: string;
  localTime: number;
  blend: number;
  stageBearing: number;
  totals: {
    droneCount: number;
    front: number;
    right: number;
    rear: number;
    left: number;
    overhead: number;
    inFrustum: number;
    lightsOn: number;
    inFrustumLightsOn: number;
  };
  drones: {
    id: number;
    position: Vector3Tuple;
    color: Vector3Tuple;
    bearing: number;
    elevation: number;
    visible: boolean;
    lightsOn: boolean;
  }[];
  semantics: string[];
  limitations: string[];
};

export type AudienceDroneClassification = AudienceInspectionReport['drones'][number] & {
  quadrant: 'front' | 'right' | 'rear' | 'left';
  overhead: boolean;
};

export type AudienceFrameClassifier = {
  cueId: string;
  localTime: number;
  blend: number;
  stageBearing: number;
  droneCount: number;
  classify: (id: number) => AudienceDroneClassification;
};

/** Conservative bound before the evaluator sorts and independently scans keyed channels. */
export function assertAudienceInspectionBudget(project: Project, time: number): number {
  if (
    !Number.isInteger(project.droneCount) ||
    project.droneCount < 1 ||
    project.droneCount > 100000
  )
    throw new Error('Audience inspection requires an active fleet of 1–100,000 drones.');
  if (!Number.isFinite(time) || time < 0 || time > totalDuration(project))
    throw new Error('Inspection time must be within the show.');
  const frame = frameAt(project, time);
  const cues = frame.index === 0 ? [frame.cue] : [frame.previous, frame.cue];
  let work = 0;
  for (const cue of cues)
    for (const [id, edit] of Object.entries(cue.droneEdits || {})) {
      if (Number(id) > project.droneCount) continue;
      const count = edit.keyframes?.length || 0;
      work += count * (8 + Math.ceil(Math.log2(Math.max(1, count))));
      if (work > 5_000_000)
        throw new Error(
          'Audience inspection exceeds the synchronous key-evaluation budget. Inspect a simpler draft or time with fewer active authored keys.'
        );
    }
  return work;
}

function assertCanonicalSnapshot(snapshot: ViewerSnapshot) {
  const normalized = normalizeViewerSnapshot(snapshot);
  for (const key of Object.keys(normalized.pose) as (keyof ViewerSnapshot['pose'])[])
    if (snapshot.pose[key] !== normalized.pose[key])
      throw new Error('Audience inspection requires a canonical, in-range viewer pose.');
  for (const key of Object.keys(normalized.venue) as (keyof ViewerSnapshot['venue'])[])
    if (snapshot.venue[key] !== normalized.venue[key])
      throw new Error('Audience inspection requires a canonical, in-range venue placement.');
}

/** Public shared boundary for read-only audience inspection/comparison callers. */
export function assertAudienceView(snapshot: ViewerSnapshot, aspect: number): void {
  assertCanonicalSnapshot(snapshot);
  if (!Number.isFinite(aspect) || aspect <= 0 || aspect > 100)
    throw new Error('Inspection aspect ratio must be greater than zero and at most 100.');
}

/**
 * Evaluate one bounded frame and share its exact per-drone geometry/light classifier.
 * Callers that retain this across awaits must own the project and snapshot first.
 */
export function createAudienceFrameClassifier(
  project: Project,
  time: number,
  snapshot: ViewerSnapshot,
  aspect: number
): AudienceFrameClassifier {
  assertAudienceView(snapshot, aspect);
  assertAudienceInspectionBudget(project, time);
  const { pose, venue } = snapshot;
  const stageBearing = headingToPoint(pose.east, pose.north, venue.east, venue.north);
  const yaw = (pose.yaw * Math.PI) / 180,
    pitch = (pose.pitch * Math.PI) / 180;
  const sinYaw = Math.sin(yaw),
    cosYaw = Math.cos(yaw),
    sinPitch = Math.sin(pitch),
    cosPitch = Math.cos(pitch);
  const tanVertical = Math.tan((pose.fov * Math.PI) / 360);
  const withinEdge = (value: number, edge: number) =>
    Math.abs(value) <= edge + Number.EPSILON * 16 * Math.max(1, Math.abs(value), edge);
  const frame = new ShowEvaluator(project).frame(time);
  const classify = (id: number): AudienceDroneClassification => {
    if (!Number.isInteger(id) || id < 1 || id > project.droneCount)
      throw new Error('Audience classification requires an active drone ID.');
    const offset = (id - 1) * 3;
    const position: Vector3Tuple = [0, 0, 0],
      color: Vector3Tuple = [0, 0, 0];
    for (let axis = 0; axis < 3; axis++) {
      const index = offset + axis;
      position[axis] =
        frame.a.positions[index] +
        (frame.b.positions[index] - frame.a.positions[index]) * frame.progress;
      color[axis] =
        (frame.a.shades[index] + (frame.b.shades[index] - frame.a.shades[index]) * frame.progress) *
        frame.intensity;
      if (!Number.isFinite(position[axis]) || !Number.isFinite(color[axis]))
        throw new Error('Evaluated frame exceeds the finite numerical inspection range.');
    }
    const east = position[0] - pose.east,
      north = position[1] - pose.north,
      up = position[2] - pose.eyeHeight;
    const horizontal = Math.hypot(east, north);
    const bearing =
      horizontal === 0
        ? stageBearing
        : headingToPoint(pose.east, pose.north, position[0], position[1]);
    const elevation = (Math.atan2(up, horizontal) * 180) / Math.PI;
    const relative = (((bearing - stageBearing) % 360) + 360) % 360;
    const quadrant =
      relative < 45 || relative >= 315
        ? 'front'
        : relative < 135
          ? 'right'
          : relative < 225
            ? 'rear'
            : 'left';
    // ENU camera basis: right=(cosYaw,-sinYaw,0), forward=(sinYaw*cosPitch,
    // cosYaw*cosPitch,sinPitch), up=(-sinYaw*sinPitch,-cosYaw*sinPitch,cosPitch).
    const depth = east * sinYaw * cosPitch + north * cosYaw * cosPitch + up * sinPitch;
    const cameraRight = east * cosYaw - north * sinYaw;
    const cameraUp = -east * sinYaw * sinPitch - north * cosYaw * sinPitch + up * cosPitch;
    const visible =
      depth >= 0.1 &&
      depth <= 5000 &&
      withinEdge(cameraRight, depth * tanVertical * aspect) &&
      withinEdge(cameraUp, depth * tanVertical);
    const lightsOn = color.some((channel) => channel > 0);
    return {
      id,
      position,
      color,
      bearing,
      elevation,
      visible,
      lightsOn,
      quadrant,
      overhead: elevation >= 70,
    };
  };
  return {
    cueId: frame.cue.id,
    localTime: time - frame.start,
    blend: frame.progress,
    stageBearing,
    droneCount: project.droneCount,
    classify,
  };
}

/** Numerical audience geometry over the actual blended frame; never a rendered-image review. */
export function inspectAudienceFrame(
  project: Project,
  time: number,
  snapshot: ViewerSnapshot,
  aspect: number,
  limit: number
): AudienceInspectionReport {
  assertAudienceView(snapshot, aspect);
  if (!Number.isInteger(limit) || limit < 1 || limit > 32)
    throw new Error('Inspection representative limit must be an integer from 1 to 32.');
  const frame = createAudienceFrameClassifier(project, time, snapshot, aspect);
  const representatives = new Set<number>();
  const rows = Math.min(limit, project.droneCount);
  for (let index = 0; index < rows; index++)
    representatives.add(
      rows === 1 ? 1 : 1 + Math.floor((index * (project.droneCount - 1)) / (rows - 1))
    );
  const totals: AudienceInspectionReport['totals'] = {
    droneCount: project.droneCount,
    front: 0,
    right: 0,
    rear: 0,
    left: 0,
    overhead: 0,
    inFrustum: 0,
    lightsOn: 0,
    inFrustumLightsOn: 0,
  };
  const drones: AudienceInspectionReport['drones'] = [];
  for (let id = 1; id <= project.droneCount; id++) {
    const { quadrant, overhead, ...drone } = frame.classify(id);
    totals[quadrant]++;
    if (overhead) totals.overhead++;
    if (drone.visible) totals.inFrustum++;
    if (drone.lightsOn) totals.lightsOn++;
    if (drone.visible && drone.lightsOn) totals.inFrustumLightsOn++;
    if (representatives.has(id)) drones.push(drone);
  }
  return {
    time,
    cueId: frame.cueId,
    localTime: frame.localTime,
    blend: frame.blend,
    stageBearing: frame.stageBearing,
    totals,
    drones,
    semantics: [
      'Totals cover every active drone. Front/right/rear/left partition geometry relative to the viewer-to-stage-center compass bearing, independent of the current look direction and stage front heading.',
      'Overhead means elevation at least 70 degrees above the viewer and overlaps the quadrant counts. Directly vertical or coincident points use the stage bearing as a deterministic azimuth fallback.',
      'visible/inFrustum mean only the camera perspective frustum at the supplied aspect, vertical FOV, and depth 0.1–5000 metres. Geometry counts include dark drones; lightsOn means any evaluated RGB component is positive, and inFrustumLightsOn is their intersection.',
      'Positions and RGB use the shared evaluator with incoming scene blend, keyed motion, brightness, flash gating, and beat modulation. Representative IDs are evenly spaced across the stable active fleet, not ranked by brightness or visibility.',
    ],
    limitations: [
      'Analytical geometry only: no rendered pixels, screenshots, occlusion, venue obstruction, photometric visibility, artistic-quality assessment, aircraft control, or flight/safety certification.',
    ],
  };
}
