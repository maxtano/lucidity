import { assertAudienceView } from './audience-inspection';
import type { AudienceSelectionReport } from './audience-selection';
import { frameAt, totalDuration, type Project } from './model';

/** Minimal validated membership consumed by the display-only marker renderer. */
export type AudienceHighlightTarget = {
  readonly projectId: string;
  readonly revision: number;
  readonly droneCount: number;
  readonly ids: readonly number[];
};

/** Captured membership only; the renderer samples these IDs at its current show time. */
export type AudienceHighlight = AudienceHighlightTarget & {
  readonly request: AudienceSelectionReport['request'];
  readonly matchedCount: number;
  readonly consideredCount: number;
  readonly cueId: string;
  readonly localTime: number;
  readonly blend: number;
  readonly limitations: readonly string[];
};

function exactKeys(value: unknown, required: readonly string[], optional: readonly string[] = []) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new Error('Audience highlight has missing or unknown metadata fields.');
}
function assertIds(ids: readonly number[], maximum: number, label: string): void {
  if (!Array.isArray(ids) || ids.length > 100_000)
    throw new Error(`${label} must contain at most 100,000 sorted, unique drone IDs.`);
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index];
    if (!Number.isInteger(id) || id < 1 || id > maximum || (index > 0 && id <= ids[index - 1]))
      throw new Error(`${label} must contain sorted, unique IDs within its fleet bounds.`);
  }
}

/** Validate a complete query report once, without rerunning or changing its membership. */
export function createAudienceHighlight(
  project: Project,
  report: AudienceSelectionReport
): AudienceHighlight {
  exactKeys(report, [
    'projectId',
    'revision',
    'droneCount',
    'ids',
    'request',
    'matchedCount',
    'consideredCount',
    'cueId',
    'localTime',
    'blend',
    'limitations',
  ]);
  if (
    typeof project.id !== 'string' ||
    !project.id.length ||
    project.id.length > 100 ||
    !Number.isSafeInteger(project.revision) ||
    project.revision < 0 ||
    !Number.isInteger(project.droneCount) ||
    project.droneCount < 1 ||
    project.droneCount > 100_000 ||
    report.projectId !== project.id ||
    report.revision !== project.revision ||
    report.droneCount !== project.droneCount
  )
    throw new Error(
      'Audience highlight report does not match the current project, revision, and fleet.'
    );
  const source = report.request;
  exactKeys(source, ['time', 'snapshot', 'aspect', 'region', 'lights'], ['scopeIds']);
  exactKeys(source.snapshot, ['pose', 'venue']);
  exactKeys(source.snapshot.pose, ['east', 'north', 'eyeHeight', 'yaw', 'pitch', 'fov']);
  exactKeys(source.snapshot.venue, ['east', 'north', 'heading']);
  assertAudienceView(source.snapshot, source.aspect);
  const duration = totalDuration(project);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(source.time) ||
    source.time < 0 ||
    source.time > duration
  )
    throw new Error('Audience highlight query time must be within the show.');
  if (
    !['in_frame', 'front', 'right', 'rear', 'left', 'overhead'].includes(source.region) ||
    !['any', 'on', 'off'].includes(source.lights)
  )
    throw new Error('Audience highlight query criteria are invalid.');
  assertIds(report.ids, project.droneCount, 'Audience highlight matches');
  let considered = project.droneCount;
  if (source.scopeIds !== undefined) {
    assertIds(source.scopeIds, 100_000, 'Audience highlight scope');
    considered = 0;
    while (considered < source.scopeIds.length && source.scopeIds[considered] <= project.droneCount)
      considered++;
    let scopeIndex = 0;
    for (const id of report.ids) {
      while (scopeIndex < considered && source.scopeIds[scopeIndex] < id) scopeIndex++;
      if (scopeIndex >= considered || source.scopeIds[scopeIndex] !== id)
        throw new Error('Audience highlight matches must belong to the captured query scope.');
    }
  }
  if (
    report.matchedCount !== report.ids.length ||
    report.consideredCount !== considered ||
    report.matchedCount > considered
  )
    throw new Error(
      'Audience highlight requires complete IDs and exact matching/considered counts.'
    );
  const frame = frameAt(project, source.time);
  if (
    report.cueId !== frame.cue.id ||
    report.localTime !== source.time - frame.start ||
    report.blend !== frame.progress
  )
    throw new Error('Audience highlight scene metadata does not match the captured query time.');
  if (!Array.isArray(report.limitations) || report.limitations.length > 16)
    throw new Error('Audience highlight limitations are invalid.');
  for (const text of report.limitations)
    if (typeof text !== 'string' || text.length > 1000)
      throw new Error('Audience highlight limitations are invalid.');
  const request: AudienceSelectionReport['request'] = {
    time: source.time,
    snapshot: { pose: { ...source.snapshot.pose }, venue: { ...source.snapshot.venue } },
    aspect: source.aspect,
    region: source.region,
    lights: source.lights,
    ...(source.scopeIds === undefined ? {} : { scopeIds: [...source.scopeIds] }),
  };
  Object.freeze(request.snapshot.pose);
  Object.freeze(request.snapshot.venue);
  Object.freeze(request.snapshot);
  if (request.scopeIds) Object.freeze(request.scopeIds);
  Object.freeze(request);
  return Object.freeze({
    projectId: report.projectId,
    revision: report.revision,
    droneCount: report.droneCount,
    ids: Object.freeze([...report.ids]),
    request,
    matchedCount: report.matchedCount,
    consideredCount: report.consideredCount,
    cueId: report.cueId,
    localTime: report.localTime,
    blend: report.blend,
    limitations: Object.freeze([...report.limitations]),
  });
}

/** Constant-time guard for an already validated highlight; no fleet or metadata scans. */
export function audienceHighlightIsCurrent(
  highlight: AudienceHighlightTarget | null | undefined,
  project: Project
): boolean {
  return (
    !!highlight &&
    highlight.projectId === project.id &&
    highlight.revision === project.revision &&
    highlight.droneCount === project.droneCount
  );
}

function overlaps(output: Float32Array, writtenBytes: number, source: Float32Array): boolean {
  return (
    output.buffer === source.buffer &&
    output.byteOffset < source.byteOffset + source.byteLength &&
    source.byteOffset < output.byteOffset + writtenBytes
  );
}

/**
 * Write all captured IDs using current evaluated ENU buffers, mapped to Three's (E,U,-N).
 * Output may have spare capacity, which remains untouched. Source arrays may overlap each
 * other, but output writes may not overlap either source. Shared-memory inputs are rejected:
 * concurrent mutation would defeat validation-before-write. Only selected coordinates are
 * read. Two linear passes validate first, then write without temporary per-drone allocations.
 */
export function writeAudienceHighlightPositions(
  ids: readonly number[],
  from: Float32Array,
  to: Float32Array,
  blend: number,
  output: Float32Array
): void {
  if (
    !(from instanceof Float32Array) ||
    !(to instanceof Float32Array) ||
    !(output instanceof Float32Array) ||
    !(from.buffer instanceof ArrayBuffer) ||
    !(to.buffer instanceof ArrayBuffer) ||
    !(output.buffer instanceof ArrayBuffer) ||
    from.length !== to.length ||
    from.length % 3 !== 0 ||
    from.length > 300_000 ||
    output.length % 3 !== 0 ||
    output.length > 300_000
  )
    throw new Error('Audience highlight requires compatible, non-shared Float32 position buffers.');
  if (!Number.isFinite(blend) || blend < 0 || blend > 1)
    throw new Error('Audience highlight blend must be finite and between zero and one.');
  assertIds(ids, from.length / 3, 'Audience highlight positions');
  if (output.length < ids.length * 3)
    throw new Error('Audience highlight output buffer has insufficient capacity.');
  if (
    ids.length &&
    (overlaps(output, ids.length * 12, from) || overlaps(output, ids.length * 12, to))
  )
    throw new Error('Audience highlight output must not overlap its evaluated source buffers.');
  for (let index = 0; index < ids.length; index++) {
    const offset = (ids[index] - 1) * 3;
    for (let axis = 0; axis < 3; axis++) {
      const a = from[offset + axis],
        b = to[offset + axis];
      const value = a + (b - a) * blend;
      if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(Math.fround(value)))
        throw new Error('Audience highlight selected positions must remain finite Float32 values.');
    }
  }
  for (let index = 0; index < ids.length; index++) {
    const source = (ids[index] - 1) * 3,
      destination = index * 3;
    output[destination] = from[source] + (to[source] - from[source]) * blend;
    output[destination + 1] = from[source + 2] + (to[source + 2] - from[source + 2]) * blend;
    output[destination + 2] = -(from[source + 1] + (to[source + 1] - from[source + 1]) * blend);
  }
}
