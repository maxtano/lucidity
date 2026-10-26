import {
  assertAudienceInspectionBudget,
  assertAudienceView,
  inspectAudienceFrame,
  type AudienceInspectionReport,
} from './audience-inspection';
import { totalDuration, type Project } from './model';
import type { ViewerSnapshot } from './viewer';

export type AudienceComparisonRequest = {
  start: number;
  end: number;
  samples: number;
  views: { id: string; name: string; snapshot: ViewerSnapshot; aspect: number }[];
};
export type AudienceComparisonReport = {
  projectId: string;
  revision: number;
  times: number[];
  views: {
    id: string;
    name: string;
    snapshot: ViewerSnapshot;
    aspect: number;
    samples: { time: number; totals: AudienceInspectionReport['totals'] }[];
    summary: {
      minInFrameLights: number;
      maxInFrameLights: number;
      meanInFrameLights: number;
      minAt: number;
      maxAt: number;
    };
  }[];
  limitations: string[];
};
export type AudienceComparisonOptions = {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
};

function checkCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Audience comparison cancelled.', 'AbortError');
}

/**
 * Bounded sampled comparison. Inputs are owned before yielding; no caller/project mutation,
 * rendering, storage, or partial report publication occurs here.
 */
export async function compareAudienceViews(
  project: Project,
  request: AudienceComparisonRequest,
  options: AudienceComparisonOptions = {}
): Promise<AudienceComparisonReport> {
  const { signal, onProgress } = options;
  checkCancelled(signal);
  if (!Number.isFinite(request.start) || !Number.isFinite(request.end) ||
    request.start < 0 || request.start >= request.end || request.end > totalDuration(project))
    throw new Error('Comparison interval must satisfy 0 <= start < end <= show duration.');
  if (!Number.isInteger(request.samples) || request.samples < 2 || request.samples > 12)
    throw new Error('Audience comparison requires 2–12 samples.');
  if (!Array.isArray(request.views) || request.views.length < 1 || request.views.length > 4)
    throw new Error('Audience comparison requires 1–4 unique viewpoints.');
  const ids = new Set<string>();
  for (const view of request.views) {
    if (typeof view.id !== 'string' || view.id.length > 80 || view.id !== view.id.trim() || ids.has(view.id))
      throw new Error('Comparison viewpoint IDs must be unique trimmed strings up to 80 characters.');
    if (typeof view.name !== 'string' || !view.name.length || view.name.length > 48 || view.name !== view.name.trim())
      throw new Error('Comparison viewpoint names must be trimmed text of 1–48 characters.');
    ids.add(view.id);
    assertAudienceView(view.snapshot, view.aspect);
  }
  const times = Array.from({ length: request.samples }, (_, index) =>
    index === 0 ? request.start : index === request.samples - 1 ? request.end
      : request.start + (request.end - request.start) * (index / (request.samples - 1)));
  if (project.droneCount * times.length * request.views.length > 2_000_000)
    throw new Error('Audience comparison exceeds the 2,000,000 point-inspection budget. Use fewer samples or viewpoints.');
  let weightedKeys = 0;
  for (const time of times) {
    checkCancelled(signal);
    weightedKeys += assertAudienceInspectionBudget(project, time) * request.views.length;
    if (weightedKeys > 20_000_000)
      throw new Error('Audience comparison exceeds the 20,000,000 aggregate key-work budget. Use fewer samples or viewpoints.');
  }
  // All validation/work preflight completes before invoking even the first evaluator.
  // Copy synchronously before the first await so edits in progress callbacks cannot
  // change later samples or mutate the report's captured viewpoints.
  const ownedProject = structuredClone(project);
  const ownedViews = structuredClone(request.views);
  const results: AudienceComparisonReport['views'] = [];
  const total = times.length * ownedViews.length;
  let completed = 0;
  for (const view of ownedViews) {
    const samples: AudienceComparisonReport['views'][number]['samples'] = [];
    let minInFrameLights = Infinity, maxInFrameLights = -Infinity, sum = 0;
    let minAt = times[0], maxAt = times[0];
    for (const time of times) {
      checkCancelled(signal);
      const { totals } = inspectAudienceFrame(ownedProject, time, view.snapshot, view.aspect, 1);
      samples.push({ time, totals });
      const count = totals.inFrustumLightsOn;
      sum += count;
      if (count < minInFrameLights) { minInFrameLights = count; minAt = time; }
      if (count > maxInFrameLights) { maxInFrameLights = count; maxAt = time; }
      completed++;
      try { onProgress?.(completed, total); } catch { /* Observer errors cannot change sampled results. */ }
      // Yield a real event-loop turn after every frame/view, not merely a microtask,
      // so browser and Node abort events can run between synchronous inspections.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      checkCancelled(signal);
    }
    results.push({ ...view, samples, summary: {
      minInFrameLights, maxInFrameLights, meanInFrameLights: sum / times.length, minAt, maxAt,
    } });
  }
  return {
    projectId: ownedProject.id, revision: ownedProject.revision, times, views: results,
    limitations: [
      'Discrete samples include both interval endpoints. Min/max are observed sample values (earliest sample on ties); mean is the arithmetic sample mean, not continuous coverage or time-weighted exposure.',
      'In-frame light summaries count inFrustumLightsOn: geometric camera frustum intersected with positive evaluated RGB. Dark points still contribute to geometry totals; overhead overlaps stage-relative quadrants.',
      'Uses the shared blended show evaluator and immutable captured viewpoints. No rendered pixels, occlusion, venue obstruction, perceived brightness, artistic-quality judgment, aircraft access, or flight/safety certification.',
    ],
  };
}
