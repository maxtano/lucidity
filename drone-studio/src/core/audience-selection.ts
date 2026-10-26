import {
  assertAudienceInspectionBudget,
  assertAudienceView,
  createAudienceFrameClassifier,
} from './audience-inspection';
import { frameAt, totalDuration, type Project } from './model';
import type { ViewerSnapshot } from './viewer';

export type AudienceSelectionRequest = {
  time: number;
  snapshot: ViewerSnapshot;
  aspect: number;
  region: 'in_frame' | 'front' | 'right' | 'rear' | 'left' | 'overhead';
  lights: 'any' | 'on' | 'off';
  /** Omitted means the active fleet; an explicit empty array considers no drones. */
  scopeIds?: number[];
};
export type AudienceSelectionReport = {
  projectId: string;
  revision: number;
  request: AudienceSelectionRequest;
  cueId: string;
  localTime: number;
  blend: number;
  ids: number[];
  matchedCount: number;
  consideredCount: number;
  droneCount: number;
  limitations: string[];
};
export type AudienceSelectionOptions = {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
};

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Audience selection cancelled.', 'AbortError');
}
function exactKeys(value: unknown, required: readonly string[], optional: readonly string[] = []) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new Error('Audience selection has missing or unknown request fields.');
}
function ownRequest(project: Project, request: AudienceSelectionRequest): AudienceSelectionRequest {
  exactKeys(request, ['time', 'snapshot', 'aspect', 'region', 'lights'], ['scopeIds']);
  exactKeys(request.snapshot, ['pose', 'venue']);
  exactKeys(request.snapshot.pose, ['east', 'north', 'eyeHeight', 'yaw', 'pitch', 'fov']);
  exactKeys(request.snapshot.venue, ['east', 'north', 'heading']);
  assertAudienceView(request.snapshot, request.aspect);
  if (!['in_frame', 'front', 'right', 'rear', 'left', 'overhead'].includes(request.region))
    throw new Error('Audience selection region is not supported.');
  if (!['any', 'on', 'off'].includes(request.lights))
    throw new Error('Audience selection lights must be any, on, or off.');
  const duration = totalDuration(project);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(request.time) ||
    request.time < 0 ||
    request.time > duration
  )
    throw new Error('Audience selection time must be within the show.');
  let scopeIds: number[] | undefined;
  if (request.scopeIds !== undefined) {
    if (!Array.isArray(request.scopeIds) || request.scopeIds.length > 100_000)
      throw new Error('Audience selection scope must contain at most 100,000 stable drone IDs.');
    for (const id of request.scopeIds)
      if (!Number.isInteger(id) || id < 1 || id > 100_000)
        throw new Error('Audience selection scope IDs must be integers from 1 to 100,000.');
    scopeIds = [...new Set(request.scopeIds)].sort((a, b) => a - b);
  }
  return {
    time: request.time,
    snapshot: { pose: { ...request.snapshot.pose }, venue: { ...request.snapshot.venue } },
    aspect: request.aspect,
    region: request.region,
    lights: request.lights,
    ...(scopeIds === undefined ? {} : { scopeIds }),
  };
}

/** Complete stable-ID selection over one owned, bounded blended frame; no editor mutation. */
export async function selectAudienceDrones(
  project: Project,
  request: AudienceSelectionRequest,
  options: AudienceSelectionOptions = {}
): Promise<AudienceSelectionReport> {
  const { signal, onProgress } = options;
  checkCancelled(signal);
  const ownedRequest = ownRequest(project, request);
  // The shared evaluator prepares the entire active frame even for a narrow scope.
  assertAudienceInspectionBudget(project, ownedRequest.time);
  const ownedProject = structuredClone(project);
  const scope =
    ownedRequest.scopeIds === undefined
      ? Array.from({ length: ownedProject.droneCount }, (_, index) => index + 1)
      : ownedRequest.scopeIds.filter((id) => id <= ownedProject.droneCount);
  const progress = (completed: number) => {
    try {
      onProgress?.(completed, scope.length);
    } catch {
      /* Observers cannot affect the result. */
    }
  };
  // Capture first, then yield so a cancellation can stop before synchronous evaluation.
  progress(0);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  checkCancelled(signal);
  const ids: number[] = [];
  const timing = frameAt(ownedProject, ownedRequest.time);
  const frame = scope.length
    ? createAudienceFrameClassifier(
        ownedProject,
        ownedRequest.time,
        ownedRequest.snapshot,
        ownedRequest.aspect
      )
    : undefined;
  for (let index = 0; index < scope.length; index++) {
    const id = scope[index],
      drone = frame!.classify(id);
    const inRegion =
      ownedRequest.region === 'in_frame'
        ? drone.visible
        : ownedRequest.region === 'overhead'
          ? drone.overhead
          : drone.quadrant === ownedRequest.region;
    const lightMatches =
      ownedRequest.lights === 'any' || (ownedRequest.lights === 'on') === drone.lightsOn;
    if (inRegion && lightMatches) ids.push(id);
    if ((index + 1) % 1024 === 0 || index === scope.length - 1) {
      progress(index + 1);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      checkCancelled(signal);
    }
  }
  return {
    projectId: ownedProject.id,
    revision: ownedProject.revision,
    request: ownedRequest,
    cueId: timing.cue.id,
    localTime: ownedRequest.time - timing.start,
    blend: timing.progress,
    ids,
    matchedCount: ids.length,
    consideredCount: scope.length,
    droneCount: ownedProject.droneCount,
    limitations: [
      'Exact matching IDs at one sampled show time, not a representative subset or continuous coverage. IDs remain stable; valid dormant scope IDs are retained in the request but excluded from considered and matching counts.',
      'Front/right/rear/left are quadrants relative to the viewer-to-stage-center bearing, independent of camera yaw and stage front heading. Overhead is elevation at least 70 degrees and overlaps those quadrants.',
      'In-frame means the perspective frustum at the captured aspect and vertical FOV, with forward depth 0.1–5000 metres. Lights on means any positive evaluated RGB component; off means none. Shared incoming blend, keyed motion, brightness, flash, and beat modulation apply.',
      'Numerical geometry only: no rendered pixels, occlusion, venue obstruction, perceived visibility, artistic-quality assessment, aircraft control, or flight/safety certification. Finding a set never changes the editor selection or show.',
    ],
  };
}
