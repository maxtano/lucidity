/** Eye-level viewer coordinates are ENU metres; yaw, pitch, and field of view are degrees. */
export type ViewerPose = {
  east: number;
  north: number;
  eyeHeight: number;
  yaw: number;
  pitch: number;
  fov: number;
};

/** ENU ground coordinates; heading is the compass direction the stage FRONT faces. */
export type VenuePlacement = { east: number; north: number; heading: number };
export type ViewerSnapshot = { pose: ViewerPose; venue: VenuePlacement };
export type ViewerBookmark = { id: string; name: string; snapshot: ViewerSnapshot };

export const DEFAULT_VENUE_PLACEMENT: Readonly<VenuePlacement> = Object.freeze({
  east: 0,
  north: 70,
  heading: 180,
});

export const DEFAULT_VIEWER_POSE: Readonly<ViewerPose> = Object.freeze({
  east: 0,
  north: 0,
  eyeHeight: 1.7,
  yaw: 0,
  pitch: 35,
  fov: 90,
});

function finite(value: number, name: string) {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite.`);
  return value;
}
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));
function wrapDegrees(value: number) {
  // Preserve already-canonical angles exactly across repeated bookmark save/load cycles.
  if (value >= 0 && value < 360) return value === 0 ? 0 : value;
  const remainder = value % 360;
  const wrapped = remainder < 0 ? remainder + 360 : remainder;
  if (wrapped === 360) return 0;
  return wrapped === 0 ? 0 : wrapped;
}

/** Returns a new valid camera pose; does not mutate the caller or silently accept NaN. */
export function normalizeViewerPose(pose: ViewerPose): ViewerPose {
  return {
    east: clamp(finite(pose.east, 'East'), -500, 500),
    north: clamp(finite(pose.north, 'North'), -500, 500),
    eyeHeight: clamp(finite(pose.eyeHeight, 'Eye height'), 0.5, 5),
    yaw: wrapDegrees(finite(pose.yaw, 'Yaw')),
    pitch: clamp(finite(pose.pitch, 'Pitch'), -20, 89),
    fov: clamp(finite(pose.fov, 'Field of view'), 45, 100),
  };
}

export function normalizeVenuePlacement(venue: VenuePlacement): VenuePlacement {
  return {
    east: clamp(finite(venue.east, 'Venue east'), -500, 500),
    north: clamp(finite(venue.north, 'Venue north'), -500, 500),
    heading: wrapDegrees(finite(venue.heading, 'Venue heading')),
  };
}

/** Clone and normalize both display-only settings; no authored show data is involved. */
export function normalizeViewerSnapshot(snapshot: ViewerSnapshot): ViewerSnapshot {
  return {
    pose: normalizeViewerPose(snapshot.pose),
    venue: normalizeVenuePlacement(snapshot.venue),
  };
}

/** Unit world direction: +x East, +y Up, -z North. Pitch stays clear of vertical. */
export function viewerDirection(yaw: number, pitch: number): [number, number, number] {
  const heading = (wrapDegrees(finite(yaw, 'Yaw')) * Math.PI) / 180;
  const elevation = (clamp(finite(pitch, 'Pitch'), -20, 89) * Math.PI) / 180;
  const horizontal = Math.cos(elevation);
  return [Math.sin(heading) * horizontal, Math.sin(elevation), -Math.cos(heading) * horizontal];
}

/** Compass bearing between arbitrary ENU ground points, with finite overflow protection. */
export function headingToPoint(
  east: number,
  north: number,
  targetEast: number,
  targetNorth: number
): number {
  finite(east, 'East');
  finite(north, 'North');
  finite(targetEast, 'Target east');
  finite(targetNorth, 'Target north');
  let deltaEast = targetEast - east;
  let deltaNorth = targetNorth - north;
  if (!Number.isFinite(deltaEast) || !Number.isFinite(deltaNorth)) {
    const scale = Math.max(
      Math.abs(east),
      Math.abs(north),
      Math.abs(targetEast),
      Math.abs(targetNorth)
    );
    deltaEast = targetEast / scale - east / scale;
    deltaNorth = targetNorth / scale - north / scale;
  }
  if (deltaEast === 0 && deltaNorth === 0) return 0;
  return wrapDegrees((Math.atan2(deltaEast, deltaNorth) * 180) / Math.PI);
}

/** Backward-compatible compass bearing to stage centre [East 0, North stageDistance]. */
export function headingToStage(east: number, north: number, stageDistance: number): number {
  return headingToPoint(east, north, 0, finite(stageDistance, 'Stage distance'));
}

/** Quadrant describes where the viewer is looking relative to the stage bearing. */
export function viewDirectionLabel(yaw: number, stageBearing: number): string {
  const relative = wrapDegrees(
    wrapDegrees(finite(yaw, 'Yaw')) - wrapDegrees(finite(stageBearing, 'Stage bearing'))
  );
  if (relative < 45 || relative >= 315) return 'Stage ahead';
  if (relative < 135) return 'Right of stage';
  if (relative < 225) return 'Behind you';
  return 'Left of stage';
}
