import {
  assertAudienceInspectionBudget,
  assertAudienceView,
  inspectAudienceFrame,
  type AudienceInspectionReport,
} from './audience-inspection';
import {
  createCameraAuditionPlan,
  sampleCameraAudition,
  type CameraAuditionPlan,
} from './camera-audition';
import { totalDuration, type Project } from './model';
import type { ViewerSnapshot } from './viewer';

export type CameraMoveRequest = {
  plan: CameraAuditionPlan;
  aspect: number;
  fromName: string;
  toName: string;
  start: number;
  end: number;
  samples: number;
};
export type CameraMoveReport = {
  projectId: string;
  revision: number;
  request: CameraMoveRequest;
  samples: {
    cameraTime: number;
    showTime: number;
    snapshot: ViewerSnapshot;
    totals: AudienceInspectionReport['totals'];
  }[];
  summary: {
    minInFrameLights: number;
    maxInFrameLights: number;
    meanInFrameLights: number;
    minIndex: number;
    maxIndex: number;
  };
  limitations: string[];
};
export type CameraMoveInspectionOptions = {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
};

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Camera move inspection cancelled.', 'AbortError');
}
function label(value: string) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 48 || value !== value.trim())
    throw new Error('Camera move viewpoint names must be trimmed text of 1–48 characters.');
  return value;
}

/**
 * Sample one private camera path against one owned show. Camera and show clocks have
 * independent exact endpoints; holding the show still never freezes the camera path.
 * No renderer, authored edit, storage, or partial report publication is involved.
 */
export async function inspectCameraMove(
  project: Project,
  request: CameraMoveRequest,
  options: CameraMoveInspectionOptions = {}
): Promise<CameraMoveReport> {
  const { signal, onProgress } = options;
  checkCancelled(signal);
  const duration = totalDuration(project);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(request.start) ||
    !Number.isFinite(request.end) ||
    request.start < 0 ||
    request.start > request.end ||
    request.end > duration
  )
    throw new Error('Camera move interval must satisfy 0 <= start <= end <= show duration.');
  if (!Number.isInteger(request.samples) || request.samples < 2 || request.samples > 12)
    throw new Error('Camera move inspection requires 2–12 samples.');
  // The sampler validates the complete plan shape as well as its canonical endpoints.
  sampleCameraAudition(request.plan, 0);
  const plan = createCameraAuditionPlan(
    request.plan.from,
    request.plan.to,
    request.plan.duration,
    request.plan.easing
  );
  assertAudienceView(plan.from, request.aspect);
  assertAudienceView(plan.to, request.aspect);
  const ownedRequest: CameraMoveRequest = {
    plan,
    aspect: request.aspect,
    fromName: label(request.fromName),
    toName: label(request.toName),
    start: request.start,
    end: request.end,
    samples: request.samples,
  };
  const times = Array.from({ length: ownedRequest.samples }, (_, index) => ({
    cameraTime:
      index === 0
        ? 0
        : index === ownedRequest.samples - 1
          ? plan.duration
          : plan.duration * (index / (ownedRequest.samples - 1)),
    showTime:
      index === 0
        ? ownedRequest.start
        : index === ownedRequest.samples - 1
          ? ownedRequest.end
          : ownedRequest.start +
            (ownedRequest.end - ownedRequest.start) * (index / (ownedRequest.samples - 1)),
  }));
  if (project.droneCount * times.length > 2_000_000)
    throw new Error(
      'Camera move exceeds the 2,000,000 point-inspection budget. Use fewer samples.'
    );
  let weightedKeys = 0;
  for (const { showTime } of times) {
    checkCancelled(signal);
    weightedKeys += assertAudienceInspectionBudget(project, showTime);
    if (weightedKeys > 20_000_000)
      throw new Error(
        'Camera move exceeds the 20,000,000 aggregate key-work budget. Use fewer samples or a simpler show.'
      );
  }
  // Every budget passes before the first evaluator. Inputs are owned before any
  // callback or await, so subsequent editor changes cannot alter this run.
  const ownedProject = structuredClone(project);
  const samples: CameraMoveReport['samples'] = [];
  let minInFrameLights = Infinity,
    maxInFrameLights = -Infinity,
    sum = 0,
    minIndex = 0,
    maxIndex = 0;
  for (const [index, { cameraTime, showTime }] of times.entries()) {
    checkCancelled(signal);
    const snapshot = sampleCameraAudition(plan, cameraTime);
    const { totals } = inspectAudienceFrame(
      ownedProject,
      showTime,
      snapshot,
      ownedRequest.aspect,
      1
    );
    samples.push({ cameraTime, showTime, snapshot, totals });
    const count = totals.inFrustumLightsOn;
    sum += count;
    if (count < minInFrameLights) {
      minInFrameLights = count;
      minIndex = index;
    }
    if (count > maxInFrameLights) {
      maxInFrameLights = count;
      maxIndex = index;
    }
    try {
      onProgress?.(index + 1, times.length);
    } catch {
      /* Observer failures do not alter samples. */
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    checkCancelled(signal);
  }
  return {
    projectId: ownedProject.id,
    revision: ownedProject.revision,
    request: ownedRequest,
    samples,
    summary: {
      minInFrameLights,
      maxInFrameLights,
      meanInFrameLights: sum / samples.length,
      minIndex,
      maxIndex,
    },
    limitations: [
      'Discrete camera and show samples include both endpoints. Min/max use the earliest sample on ties; mean is an arithmetic sample mean, not continuous coverage or time-weighted exposure.',
      'The camera clock follows the captured audition duration and easing. Show time maps independently from start to end; equal show endpoints hold one frame while the camera still moves.',
      'In-frame lights count the camera frustum intersected with positive evaluated RGB using the shared blended show evaluator. Dark drones remain in geometry totals; overhead overlaps stage-relative quadrants.',
      'Sampling can miss fast motion or flashes. These are geometric measurements, not rendered pixels, occlusion, venue obstructions, perceived brightness, artistic quality, or flight/safety certification.',
    ],
  };
}
