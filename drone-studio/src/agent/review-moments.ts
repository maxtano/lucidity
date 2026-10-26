import { z } from 'zod';
import { sampleCameraAudition } from '../core/camera-audition';
import { totalDuration, type Project } from '../core/model';
import type { ViewerSnapshot } from '../core/viewer';
import type { AgentResult } from './types';
import { agentViewerContextSchema } from './viewer-context';

export type AgentReviewMoment = {
  id: string;
  version: 'base' | 'draft';
  tool: 'inspect_viewpoint' | 'compare_viewpoints' | 'inspect_camera_move';
  eventId: number;
  callId: string;
  time: number;
  viewId: string;
  viewName: string;
  snapshot: ViewerSnapshot;
  aspect: number;
  kind: 'inspection' | 'minimum' | 'maximum';
  inFrameLights: number;
  droneCount: number;
  /** Camera elapsed is independent of `time`, which always identifies the show frame. */
  camera?: {
    elapsed: number;
    duration: number;
    easing: 'linear' | 'smooth';
    sampleIndex: number;
    sampleCount: number;
    fromViewId: string;
    toViewId: string;
    fromName: string;
    toName: string;
  };
};

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const count = integer.max(100_000);
const time = z.number().finite().nonnegative();
const viewId = z
  .string()
  .max(80)
  .refine((value) => value === value.trim());
const viewName = z
  .string()
  .min(1)
  .max(48)
  .refine((value) => value === value.trim());
const capture = agentViewerContextSchema.shape.current;
const provenanceSchema = z
  .object({
    projectId: z.string().min(1).max(100),
    baseRevision: integer,
    revision: integer,
    operationCount: integer.max(128),
  })
  .strict();
const totalsSchema = z.object({
  droneCount: count.min(1),
  front: count,
  right: count,
  rear: count,
  left: count,
  overhead: count,
  inFrustum: count,
  lightsOn: count,
  inFrustumLightsOn: count,
});
const inspectionSchema = z.object({
  provenance: provenanceSchema,
  viewId,
  viewName,
  snapshot: capture.shape.snapshot,
  aspect: capture.shape.aspect,
  time,
  totals: totalsSchema,
});
const comparisonSchema = z.object({
  provenance: provenanceSchema,
  projectId: z.string().min(1).max(100),
  revision: integer,
  start: time,
  end: time,
  times: z.array(time).min(2).max(12),
  views: z
    .array(
      z.object({
        id: viewId,
        name: viewName,
        snapshot: capture.shape.snapshot,
        aspect: capture.shape.aspect,
        summary: z.object({
          minInFrameLights: count,
          maxInFrameLights: count,
          meanInFrameLights: z.number().finite().nonnegative().max(100_000),
          minAt: time,
          maxAt: time,
        }),
      })
    )
    .min(1)
    .max(4),
});
const cameraMoveSchema = z
  .object({
    provenance: provenanceSchema,
    projectId: z.string().min(1).max(100),
    revision: integer,
    fromViewId: viewId,
    toViewId: viewId,
    request: z
      .object({
        plan: z
          .object({
            from: capture.shape.snapshot,
            to: capture.shape.snapshot,
            duration: z.number().finite().min(1).max(30),
            easing: z.enum(['linear', 'smooth']),
          })
          .strict(),
        aspect: capture.shape.aspect,
        fromName: viewName,
        toName: viewName,
        start: time,
        end: time,
        samples: z.number().int().min(2).max(12),
      })
      .strict(),
    mapping: z
      .array(z.object({ cameraTime: time, showTime: time, inFrameLights: count }).strict())
      .min(2)
      .max(12),
    summary: z
      .object({
        minInFrameLights: count,
        maxInFrameLights: count,
        meanInFrameLights: z.number().finite().nonnegative().max(100_000),
        minIndex: z.number().int().min(0).max(11),
        maxIndex: z.number().int().min(0).max(11),
      })
      .strict(),
    limitations: z.array(z.string().max(1000)).max(12).optional(),
  })
  .strict();
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const validId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const validCallId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 200;

/**
 * Derive owned, bounded navigation evidence from one completed run's full trace.
 * The caller supplies the exact documents from createDraftPreview(base, result.proposal).
 * Old/recovered traces and intermediate drafts deliberately provide no landmarks.
 * Inspect every bounded record before deduplication/capping; keep recent evidence and
 * reserve one place for each document when both have valid measurements.
 */
export function buildAgentReviewMoments(
  base: Project,
  draft: Project,
  result: AgentResult
): AgentReviewMoment[] {
  try {
    return buildMoments(base, draft, result);
  } catch {
    // Optional trace navigation must never prevent an otherwise valid preview opening.
    return [];
  }
}

function buildMoments(base: Project, draft: Project, result: AgentResult): AgentReviewMoment[] {
  const proposal = result.proposal;
  if (
    result.status !== 'completed' ||
    !proposal ||
    typeof result.runId !== 'string' ||
    !result.runId.length ||
    result.runId.length > 200 ||
    proposal.projectId !== base.id ||
    proposal.revision !== base.revision ||
    typeof base.id !== 'string' ||
    !base.id.length ||
    base.id.length > 100 ||
    !Number.isSafeInteger(base.revision) ||
    base.revision < 0 ||
    draft.id !== base.id ||
    draft.revision !== base.revision + 1 ||
    !Number.isSafeInteger(draft.revision) ||
    !Array.isArray(proposal.operations) ||
    proposal.operations.length < 1 ||
    proposal.operations.length > 128 ||
    !Array.isArray(result.events) ||
    result.events.length > 256
  )
    return [];
  const durations = { base: totalDuration(base), draft: totalDuration(draft) };
  for (const [version, project] of [
    ['base', base],
    ['draft', draft],
  ] as const)
    if (
      !Number.isFinite(durations[version]) ||
      durations[version] <= 0 ||
      !Number.isInteger(project.droneCount) ||
      project.droneCount < 1 ||
      project.droneCount > 100_000
    )
      return [];

  const records = result.events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => isRecord(event));
  const idCounts = new Map<number, number>();
  const calls = new Map<
    string,
    { starts: number; results: number; errors: number; index: number; tool?: string; id: number }
  >();
  for (const { event, index } of records) {
    if (validId(event.id)) idCounts.set(event.id, (idCounts.get(event.id) ?? 0) + 1);
    if (!validCallId(event.callId)) continue;
    const call = calls.get(event.callId) ?? { starts: 0, results: 0, errors: 0, index: -1, id: -1 };
    if (event.type === 'tool_start') {
      call.starts++;
      call.index = index;
      call.tool = event.tool;
      call.id = event.id;
    } else if (event.type === 'tool_result') call.results++;
    else if (event.type === 'validation_error') call.errors++;
    calls.set(event.callId, call);
  }
  const candidates: AgentReviewMoment[] = [];
  // A camera path must resolve against the same owned capture that supplied its tool.
  // Invalid/missing context only suppresses path evidence, not valid sibling tools.
  const capturedViewer = agentViewerContextSchema.safeParse(result.viewer);
  const side = (provenance: z.infer<typeof provenanceSchema>) => {
    if (provenance.projectId !== base.id || provenance.baseRevision !== base.revision) return;
    const version =
      provenance.operationCount === 0
        ? 'base'
        : provenance.operationCount === proposal.operations.length
          ? 'draft'
          : undefined;
    if (!version) return;
    const project = version === 'base' ? base : draft;
    return provenance.revision === project.revision ? ({ version, project } as const) : undefined;
  };
  for (const { event, index } of records) {
    if (
      event.type !== 'tool_result' ||
      !validId(event.id) ||
      idCounts.get(event.id) !== 1 ||
      !validCallId(event.callId) ||
      (event.tool !== 'inspect_viewpoint' &&
        event.tool !== 'compare_viewpoints' &&
        event.tool !== 'inspect_camera_move')
    )
      continue;
    const call = calls.get(event.callId);
    if (
      !call ||
      call.starts !== 1 ||
      call.results !== 1 ||
      call.errors !== 0 ||
      call.tool !== event.tool ||
      call.index >= index ||
      !validId(call.id) ||
      call.id >= event.id ||
      idCounts.get(call.id) !== 1
    )
      continue;
    const identity = { tool: event.tool, eventId: event.id, callId: event.callId };
    const makeId = (view: number, kind: AgentReviewMoment['kind']) =>
      `${encodeURIComponent(result.runId)}:${event.id}:${view}:${kind}`;
    if (event.tool === 'inspect_camera_move') {
      const parsed = cameraMoveSchema.safeParse(event.details);
      if (!parsed.success || !capturedViewer.success) continue;
      const data = parsed.data,
        target = side(data.provenance),
        viewer = capturedViewer.data,
        { plan, aspect, fromName, toName, start, end, samples } = data.request;
      if (
        !target ||
        data.projectId !== base.id ||
        data.revision !== target.project.revision ||
        start > end ||
        end > durations[target.version] ||
        data.mapping.length !== samples ||
        aspect !== viewer.current.aspect ||
        JSON.stringify(plan.from.venue) !== JSON.stringify(plan.to.venue)
      )
        continue;
      const resolveView = (id: string) =>
        id === ''
          ? { name: 'Captured current viewpoint', snapshot: viewer.current.snapshot }
          : viewer.savedViews.find((view) => view.id === id);
      const from = resolveView(data.fromViewId),
        to = resolveView(data.toViewId);
      if (
        !from ||
        !to ||
        fromName !== from.name ||
        toName !== to.name ||
        JSON.stringify(plan.from) !== JSON.stringify(from.snapshot) ||
        JSON.stringify(plan.to) !== JSON.stringify(to.snapshot)
      )
        continue;
      const fleet = target.project.droneCount;
      if (
        data.mapping.some((row, index) => {
          const ratio = index / (samples - 1);
          const cameraTime =
            index === 0 ? 0 : index === samples - 1 ? plan.duration : plan.duration * ratio;
          const showTime =
            index === 0 ? start : index === samples - 1 ? end : start + (end - start) * ratio;
          return (
            row.cameraTime !== cameraTime || row.showTime !== showTime || row.inFrameLights > fleet
          );
        })
      )
        continue;
      const counts = data.mapping.map((row) => row.inFrameLights),
        minimum = Math.min(...counts),
        maximum = Math.max(...counts),
        minIndex = counts.indexOf(minimum),
        maxIndex = counts.indexOf(maximum),
        mean = counts.reduce((sum, value) => sum + value, 0) / samples;
      if (
        data.summary.minInFrameLights !== minimum ||
        data.summary.maxInFrameLights !== maximum ||
        data.summary.meanInFrameLights !== mean ||
        data.summary.minIndex !== minIndex ||
        data.summary.maxIndex !== maxIndex
      )
        continue;
      for (const [sampleIndex, kind] of [
        [minIndex, 'minimum'],
        ...(maxIndex === minIndex ? [] : [[maxIndex, 'maximum']]),
      ] as [number, 'minimum' | 'maximum'][]) {
        const row = data.mapping[sampleIndex];
        candidates.push({
          ...identity,
          tool: 'inspect_camera_move',
          id: makeId(sampleIndex, kind),
          version: target.version,
          time: row.showTime,
          viewId: '', // Interpolated poses are not bookmarks; endpoints remain in camera context.
          viewName: `${fromName} → ${toName}`,
          snapshot: sampleCameraAudition(plan, row.cameraTime),
          aspect,
          kind,
          inFrameLights: row.inFrameLights,
          droneCount: fleet,
          camera: {
            elapsed: row.cameraTime,
            duration: plan.duration,
            easing: plan.easing,
            sampleIndex,
            sampleCount: samples,
            fromViewId: data.fromViewId,
            toViewId: data.toViewId,
            fromName,
            toName,
          },
        });
      }
      continue;
    }
    if (event.tool === 'inspect_viewpoint') {
      const parsed = inspectionSchema.safeParse(event.details);
      if (!parsed.success) continue;
      const data = parsed.data,
        target = side(data.provenance);
      if (!target || data.time > durations[target.version]) continue;
      const totals = data.totals,
        fleet = target.project.droneCount;
      if (
        totals.droneCount !== fleet ||
        Object.values(totals).some((value) => value > fleet) ||
        totals.front + totals.right + totals.rear + totals.left !== fleet ||
        totals.inFrustumLightsOn > Math.min(totals.inFrustum, totals.lightsOn)
      )
        continue;
      candidates.push({
        ...identity,
        tool: 'inspect_viewpoint',
        id: makeId(0, 'inspection'),
        version: target.version,
        time: data.time,
        viewId: data.viewId,
        viewName: data.viewName,
        snapshot: data.snapshot,
        aspect: data.aspect,
        kind: 'inspection',
        inFrameLights: totals.inFrustumLightsOn,
        droneCount: fleet,
      });
      continue;
    }
    const parsed = comparisonSchema.safeParse(event.details);
    if (!parsed.success) continue;
    const data = parsed.data,
      target = side(data.provenance);
    if (
      !target ||
      data.projectId !== base.id ||
      data.revision !== target.project.revision ||
      data.start !== data.times[0] ||
      data.end !== data.times.at(-1) ||
      data.times.some(
        (value, i) => value > durations[target.version] || (i > 0 && value <= data.times[i - 1])
      ) ||
      new Set(data.views.map((view) => view.id)).size !== data.views.length
    )
      continue;
    const fleet = target.project.droneCount;
    if (
      data.views.some(
        ({ summary: s }) =>
          s.minInFrameLights > s.maxInFrameLights ||
          s.maxInFrameLights > fleet ||
          s.meanInFrameLights < s.minInFrameLights ||
          s.meanInFrameLights > s.maxInFrameLights ||
          !data.times.includes(s.minAt) ||
          !data.times.includes(s.maxAt) ||
          (s.minAt === s.maxAt && s.minInFrameLights !== s.maxInFrameLights) ||
          (s.minInFrameLights === s.maxInFrameLights &&
            (s.minAt !== data.start || s.maxAt !== data.start))
      )
    )
      continue;
    data.views.forEach((view, viewIndex) => {
      const common = {
        ...identity,
        tool: 'compare_viewpoints' as const,
        version: target.version,
        viewId: view.id,
        viewName: view.name,
        snapshot: view.snapshot,
        aspect: view.aspect,
        droneCount: fleet,
      };
      candidates.push({
        ...common,
        id: makeId(viewIndex, 'minimum'),
        kind: 'minimum',
        time: view.summary.minAt,
        inFrameLights: view.summary.minInFrameLights,
      });
      if (view.summary.maxAt !== view.summary.minAt)
        candidates.push({
          ...common,
          id: makeId(viewIndex, 'maximum'),
          kind: 'maximum',
          time: view.summary.maxAt,
          inFrameLights: view.summary.maxInFrameLights,
        });
    });
  }
  const seen = new Set<string>();
  const unique = candidates
    .sort((a, b) => b.eventId - a.eventId)
    .filter((moment) => {
      const key = JSON.stringify([moment.version, moment.time, moment.snapshot, moment.aspect]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const selected = new Set<AgentReviewMoment>();
  for (const version of ['base', 'draft'] as const) {
    const latest = unique.find((moment) => moment.version === version);
    if (latest) selected.add(latest);
  }
  for (const moment of unique) {
    if (selected.size >= 12) break;
    selected.add(moment);
  }
  // Restore one deterministic latest-first order after reserving both versions.
  return unique.filter((moment) => selected.has(moment));
}
