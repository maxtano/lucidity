export type DraftAuditionRange = { start: number; end: number };

export const DRAFT_PREVIEW_SPEEDS = Object.freeze([0.25, 0.5, 1, 1.5, 2] as const);
export type DraftPreviewSpeed = (typeof DRAFT_PREVIEW_SPEEDS)[number];

function validateDuration(duration: number) {
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error('Draft playback duration must be finite and positive.');
}

/** Validate without correcting endpoints or retaining the caller's range object. */
export function validateDraftAuditionRange(
  range: DraftAuditionRange,
  duration: number
): DraftAuditionRange {
  validateDuration(duration);
  if (
    !range ||
    typeof range !== 'object' ||
    !Number.isFinite(range.start) ||
    !Number.isFinite(range.end)
  )
    throw new Error('Draft audition range endpoints must be finite.');
  if (range.start < 0 || range.start >= range.end || range.end > duration)
    throw new Error('Draft audition range must satisfy 0 ≤ start < end ≤ duration.');
  return { start: range.start, end: range.end };
}

/** Start a new run. Loop endpoints are half open; a completed whole show restarts at zero. */
export function draftPlaybackStart(
  time: number,
  duration: number,
  range?: DraftAuditionRange
): number {
  validateDuration(duration);
  if (!Number.isFinite(time)) throw new Error('Draft playback time must be finite.');
  if (range !== undefined) {
    const valid = validateDraftAuditionRange(range, duration);
    return time >= valid.start && time < valid.end ? time : valid.start;
  }
  return time >= duration ? 0 : Math.max(0, time);
}

/**
 * Evaluate an absolute elapsed clock from one run's anchor, independent of frame cadence.
 * Callers settle the old clock before rebasing its anchor for a speed change or resume.
 * An omitted range plays the full shared duration; a supplied range always loops.
 */
export function advanceDraftPlayback({
  startTime,
  elapsedSeconds,
  speed,
  duration,
  range,
}: {
  startTime: number;
  elapsedSeconds: number;
  speed: number;
  duration: number;
  range?: DraftAuditionRange;
}): { time: number; ended: boolean } {
  const start = draftPlaybackStart(startTime, duration, range);
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0)
    throw new Error('Draft playback elapsed time must be finite and nonnegative.');
  if (!(DRAFT_PREVIEW_SPEEDS as readonly number[]).includes(speed))
    throw new Error('Draft playback speed must be 0.25, 0.5, 1, 1.5, or 2.');
  const elapsed = elapsedSeconds * speed;
  if (!Number.isFinite(elapsed))
    throw new Error('Scaled draft playback elapsed time must remain finite.');

  if (range === undefined) {
    // Compare first so a long delayed frame cannot overflow start + elapsed.
    if (elapsed >= duration - start) return { time: duration, ended: true };
    const time = Math.min(duration, start + elapsed);
    return { time, ended: time === duration };
  }

  // Preserve an exact paused anchor, even when subtracting/readding the range start
  // would perturb its least significant bits.
  if (elapsed === 0) return { time: start, ended: false };
  const span = range.end - range.start;
  const offset = start - range.start;
  const remainder = elapsed % span;
  // Modular addition without constructing a potentially overflowing offset + elapsed.
  const remaining = span - remainder;
  const phase = offset >= remaining ? offset - remaining : offset + remainder;
  const time = range.start + phase;
  // Do not widen the interval with an epsilon. If rounding reaches the excluded
  // endpoint, use the next cycle's exact start, including for adjacent floats.
  return { time: time >= range.end ? range.start : time, ended: false };
}
