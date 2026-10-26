import { normalizeViewerSnapshot, type ViewerSnapshot } from './viewer';

export type CameraAuditionPlan = {
  from: ViewerSnapshot;
  to: ViewerSnapshot;
  duration: number;
  easing: 'linear' | 'smooth';
};
export type CameraAuditionClock = { elapsed: number; startedAt: number | null };

function exactKeys(value: unknown, keys: readonly string[], label: string) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error(`Camera audition ${label} has missing or unknown fields.`);
}
function capture(snapshot: ViewerSnapshot): ViewerSnapshot {
  exactKeys(snapshot, ['pose', 'venue'], 'snapshot');
  exactKeys(snapshot.pose, ['east', 'north', 'eyeHeight', 'yaw', 'pitch', 'fov'], 'pose');
  exactKeys(snapshot.venue, ['east', 'north', 'heading'], 'venue');
  const normalized = normalizeViewerSnapshot(snapshot);
  for (const key of Object.keys(normalized.pose) as (keyof ViewerSnapshot['pose'])[])
    if (snapshot.pose[key] !== normalized.pose[key])
      throw new Error('Camera audition requires a canonical, in-range viewer pose.');
  for (const key of Object.keys(normalized.venue) as (keyof ViewerSnapshot['venue'])[])
    if (snapshot.venue[key] !== normalized.venue[key])
      throw new Error('Camera audition requires a canonical, in-range venue placement.');
  // Validation must not change an already valid fractional angle or endpoint value.
  return { pose: { ...snapshot.pose }, venue: { ...snapshot.venue } };
}
function finite(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`Camera audition ${label} must be finite.`);
  return value;
}

/** A display-only camera path. The venue stays fixed; no authored show data is involved. */
export function createCameraAuditionPlan(
  from: ViewerSnapshot,
  to: ViewerSnapshot,
  duration: number,
  easing: CameraAuditionPlan['easing']
): CameraAuditionPlan {
  if (!Number.isFinite(duration) || duration < 1 || duration > 30)
    throw new Error('Camera audition duration must be between 1 and 30 seconds.');
  if (easing !== 'linear' && easing !== 'smooth')
    throw new Error('Camera audition easing must be linear or smooth.');
  const ownedFrom = capture(from),
    ownedTo = capture(to);
  if (
    (Object.keys(ownedFrom.venue) as (keyof ViewerSnapshot['venue'])[]).some(
      (key) => ownedFrom.venue[key] !== ownedTo.venue[key]
    )
  )
    throw new Error('Camera audition endpoints must use identical venue placement.');
  return { from: ownedFrom, to: ownedTo, duration, easing };
}
function validatePlan(plan: CameraAuditionPlan) {
  exactKeys(plan, ['from', 'to', 'duration', 'easing'], 'plan');
  return createCameraAuditionPlan(plan.from, plan.to, plan.duration, plan.easing);
}
function sample(plan: CameraAuditionPlan, elapsed: number): ViewerSnapshot {
  if (elapsed <= 0) return { pose: { ...plan.from.pose }, venue: { ...plan.from.venue } };
  if (elapsed >= plan.duration) return { pose: { ...plan.to.pose }, venue: { ...plan.to.venue } };
  const progress = elapsed / plan.duration;
  const amount =
    plan.easing === 'linear'
      ? progress
      : Math.min(1, Math.max(0, progress * progress * (3 - 2 * progress)));
  const interpolate = (a: number, b: number) =>
    a === b ? a : Math.max(Math.min(a, b), Math.min(Math.max(a, b), a + (b - a) * amount));
  const from = plan.from.pose,
    to = plan.to.pose;
  let arc = to.yaw - from.yaw;
  if (arc > 180) arc -= 360;
  else if (arc <= -180) arc += 360; // Both exact opposite-angle ties turn +180°.
  let yaw = from.yaw + arc * amount;
  if (yaw < 0) yaw += 360;
  else if (yaw >= 360) yaw -= 360;
  if (yaw === 360) yaw = 0; // A tiny negative angle can round to 360 when wrapped.
  return {
    pose: {
      east: interpolate(from.east, to.east),
      north: interpolate(from.north, to.north),
      eyeHeight: interpolate(from.eyeHeight, to.eyeHeight),
      yaw,
      pitch: interpolate(from.pitch, to.pitch),
      fov: interpolate(from.fov, to.fov),
    },
    venue: { ...plan.from.venue },
  };
}

/** Sample an owned snapshot, clamping finite elapsed seconds to the exact endpoints. */
export function sampleCameraAudition(plan: CameraAuditionPlan, elapsed: number): ViewerSnapshot {
  finite(elapsed, 'elapsed time');
  return sample(validatePlan(plan), elapsed);
}

/**
 * Sample one absolute clock anchor. Elapsed is seconds; startedAt/now are milliseconds.
 * Null startedAt pauses. Callers settle this clock before rebasing for resume or seek.
 * Reaching the end holds it; backward timestamps never rewind the stored elapsed anchor.
 */
export function sampleCameraAuditionClock(
  plan: CameraAuditionPlan,
  clock: CameraAuditionClock,
  now: number
): { elapsed: number; playing: boolean; snapshot: ViewerSnapshot } {
  const owned = validatePlan(plan);
  exactKeys(clock, ['elapsed', 'startedAt'], 'clock');
  finite(clock.elapsed, 'clock elapsed time');
  finite(now, 'clock timestamp');
  if (clock.startedAt !== null) finite(clock.startedAt, 'clock start timestamp');
  let elapsed = Math.max(0, Math.min(owned.duration, clock.elapsed));
  if (clock.startedAt !== null && now > clock.startedAt && elapsed < owned.duration) {
    const deltaMilliseconds = now - clock.startedAt;
    const remaining = owned.duration - elapsed;
    // Compare before addition; even opposite extreme finite timestamps finish safely.
    elapsed =
      deltaMilliseconds >= remaining * 1000
        ? owned.duration
        : Math.min(owned.duration, elapsed + deltaMilliseconds / 1000);
  }
  return {
    elapsed,
    playing: clock.startedAt !== null && elapsed < owned.duration,
    snapshot: sample(owned, elapsed),
  };
}
