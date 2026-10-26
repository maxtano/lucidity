import { ShowEvaluator } from '../core/animation';
import { compareAudienceViews, type AudienceComparisonReport } from '../core/audience-comparison';
import type { Project } from '../core/model';
import type { ViewerSnapshot } from '../core/viewer';
import { audienceEvaluationSpec } from './evaluation-audience';
import type { AgentEvent, AgentRequest } from './types';

type Finding = { name: string; passed: boolean; detail: string };
export type AudienceRefinementEvidence = {
  times: number[];
  views: {
    id: string;
    name: string;
    snapshot: ViewerSnapshot;
    aspect: number;
    before: { geometry: number[]; lit: number[] };
    after: { geometry: number[]; lit: number[] };
  }[];
  trace: {
    beforeComparisonEventId: number | null;
    afterComparisonEventId: number | null;
    beforeComparisonEventIds: number[];
    afterComparisonEventIds: number[];
    firstStageEventId: number | null;
    lastStageEventId: number | null;
  };
};

const names = [
  'Captured audience context',
  'Independent audience baseline',
  'Selected weaker view improved',
  'Unrelated audience view preserved',
  'Drone geometry preserved',
  'Unselected light channels preserved',
  'Captured comparisons before and after editing',
] as const;

// Independent geometric oracle: IDs 1–3 lie north of the origin, while 4–7 lie
// south. Every point fits the respective 75° vertical / 1.6 aspect frustum at
// 0, 1, 2 seconds. Neither hemisphere overlaps the opposite view. Only 4 and 5
// may become lit: the north three and south ID 7 stay lit; decoy 6 stays dark.
// These numbers deliberately do not use the fixture's expected document or its
// before/after count fields, production summary arithmetic, or applied commands.
const expectedGeometry = { '': [3, 3, 3], 'south-view': [4, 4, 4] };
const expectedBefore = { '': [3, 3, 3], 'south-view': [1, 1, 1] };
const expectedAfter = { '': [3, 3, 3], 'south-view': [3, 3, 3] };
const unaffectedIds = [1, 2, 3, 6, 7];

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)])
    );
  return value;
}
function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Audience evaluation cancelled.', 'AbortError');
}
function geometry(project: Project) {
  return {
    droneCount: project.droneCount,
    cues: project.cues.map((cue) => ({
      id: cue.id,
      duration: cue.duration,
      transition: cue.transition,
      transitionEasing: cue.transitionEasing,
      shape: cue.shape,
      scale: cue.scale,
      altitude: cue.altitude,
      drones: Object.fromEntries(
        Object.entries(cue.droneEdits || {}).flatMap(([id, edit]) => {
          const keys = (edit.keyframes || [])
            .filter((key) => key.position !== undefined)
            .map(({ time, position, easing }) => ({ time, position, easing }))
            .sort((a, b) => a.time - b.time);
          return edit.position !== undefined || keys.length
            ? [[id, { position: edit.position, keys }]]
            : [];
        })
      ),
    })),
  };
}
function counts(view: AudienceComparisonReport['views'][number]) {
  return {
    geometry: view.samples.map((sample) => sample.totals.inFrustum),
    lit: view.samples.map((sample) => sample.totals.inFrustumLightsOn),
  };
}

function comparisonCoverage(
  event: AgentEvent,
  project: Project,
  views: AudienceComparisonReport['views'],
  phase: 'before' | 'after'
): string[] {
  if (event.type !== 'tool_result' || event.tool !== 'compare_viewpoints') return [];
  const detail = record(event.details);
  if (
    !detail ||
    detail.projectId !== project.id ||
    detail.revision !== project.revision ||
    detail.start !== audienceEvaluationSpec.start ||
    detail.end !== audienceEvaluationSpec.end ||
    !equal(detail.times, audienceEvaluationSpec.times) ||
    !Array.isArray(detail.views) ||
    detail.views.length < 1 ||
    detail.views.length > views.length
  )
    return [];
  const reported = detail.views.map(record);
  const seen = new Set<string>();
  for (const candidate of reported) {
    const view = views.find((item) => item.id === candidate?.id);
    if (!candidate || !view || seen.has(view.id)) return [];
    seen.add(view.id);
    const expected = (phase === 'before' ? expectedBefore : expectedAfter)[
      view.id as keyof typeof expectedBefore
    ];
    if (!expected || !equal(candidate.snapshot, view.snapshot) || candidate.aspect !== view.aspect)
      return [];
    const minimum = Math.min(...expected),
      maximum = Math.max(...expected);
    // Recompute independently instead of trusting production report summaries.
    if (
      !equal(candidate.summary, {
        minInFrameLights: minimum,
        maxInFrameLights: maximum,
        meanInFrameLights: expected.reduce((sum, count) => sum + count, 0) / expected.length,
        minAt: audienceEvaluationSpec.times[expected.indexOf(minimum)],
        maxAt: audienceEvaluationSpec.times[expected.indexOf(maximum)],
      })
    )
      return [];
  }
  return [...seen];
}

function comparisonPhase(
  events: AgentEvent[],
  project: Project,
  views: AudienceComparisonReport['views'],
  phase: 'before' | 'after'
): { complete: boolean; eventIds: number[] } {
  const covered = new Set<string>(),
    eventIds: number[] = [];
  for (const event of events) {
    const ids = comparisonCoverage(event, project, views, phase);
    if (!ids.some((id) => !covered.has(id))) continue;
    ids.forEach((id) => covered.add(id));
    eventIds.push(event.id);
    if (views.every((view) => covered.has(view.id))) return { complete: true, eventIds };
  }
  return { complete: false, eventIds };
}

/** Independently measures the applied candidate and checks actual successful tool evidence. */
export async function evaluateAudienceRefinement(
  before: AgentRequest,
  applied: Project | undefined,
  events: AgentEvent[],
  signal?: AbortSignal
): Promise<{ findings: Finding[]; evidence?: AudienceRefinementEvidence }> {
  cancelled(signal);
  const failed = (detail: string) => ({
    findings: names.map((name) => ({ name, passed: false, detail })),
  });
  if (!applied)
    return failed('No applied candidate was available for independent audience evaluation.');
  if (!before.viewer) return failed('The run did not capture the required audience viewpoints.');
  if (
    audienceEvaluationSpec.viewIds.some(
      (id) => id && !before.viewer!.savedViews.some((view) => view.id === id)
    )
  )
    return failed('The run did not capture the required saved audience viewpoint.');
  const views = audienceEvaluationSpec.viewIds.map((id) => {
    const saved = before.viewer!.savedViews.find((view) => view.id === id);
    return {
      id,
      name: saved?.name ?? 'Captured current viewpoint',
      snapshot: saved?.snapshot ?? before.viewer!.current.snapshot,
      aspect: before.viewer!.current.aspect,
    };
  });
  const capturedMatches = equal(views, audienceEvaluationSpec.views);
  let baseline: AudienceComparisonReport, candidate: AudienceComparisonReport;
  try {
    const request = {
      start: audienceEvaluationSpec.start,
      end: audienceEvaluationSpec.end,
      samples: audienceEvaluationSpec.samples,
      views,
    };
    baseline = await compareAudienceViews(before.project, request, { signal });
    candidate = await compareAudienceViews(applied, request, { signal });
  } catch (error) {
    cancelled(signal);
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return failed(
      'The candidate could not be measured at the required captured viewpoints and times.'
    );
  }
  cancelled(signal);
  const evidenceViews = baseline.views.map((view) => ({
    id: view.id,
    name: view.name,
    snapshot: structuredClone(view.snapshot),
    aspect: view.aspect,
    before: counts(view),
    after: counts(candidate.views.find((item) => item.id === view.id)!),
  }));
  const north = evidenceViews.find((view) => view.id === audienceEvaluationSpec.unrelatedViewId)!;
  const south = evidenceViews.find((view) => view.id === audienceEvaluationSpec.weakerViewId)!;
  const baselineMatches =
    equal(baseline.times, [0, 1, 2]) &&
    evidenceViews.every(
      (view) =>
        equal(view.before.geometry, expectedGeometry[view.id as keyof typeof expectedGeometry]) &&
        equal(view.before.lit, expectedBefore[view.id as keyof typeof expectedBefore])
    );
  const improved =
    equal(south.after.geometry, [4, 4, 4]) &&
    equal(south.after.lit, [3, 3, 3]) &&
    south.after.lit.every((count, index) => count > south.before.lit[index]);
  const unrelatedPreserved =
    equal(north.after, north.before) &&
    equal(north.after.geometry, [3, 3, 3]) &&
    equal(north.after.lit, [3, 3, 3]);

  let positionsPreserved = equal(geometry(before.project), geometry(applied));
  let lightsPreserved = true;
  const baseEvaluator = new ShowEvaluator(before.project),
    candidateEvaluator = new ShowEvaluator(applied);
  for (const time of audienceEvaluationSpec.times) {
    cancelled(signal);
    const a = baseEvaluator.sample(time),
      b = candidateEvaluator.sample(time);
    if (
      a.positions.length !== b.positions.length ||
      a.positions.some((value, index) => value !== b.positions[index])
    )
      positionsPreserved = false;
    for (const id of unaffectedIds)
      for (let channel = 0; channel < 3; channel++) {
        const index = (id - 1) * 3 + channel;
        if (a.shades[index] !== b.shades[index]) lightsPreserved = false;
      }
  }

  const stages = events
    .map((event, index) => ({ event, index }))
    .filter(
      ({ event }) =>
        event.type === 'tool_result' &&
        ['stage_operations', 'stage_selection_operation', 'stage_audience_operation'].includes(
          event.tool || ''
        ) &&
        Number(record(event.details)?.addedOperations) > 0
    );
  const firstStage = stages[0],
    lastStage = stages.at(-1);
  const beforeComparison = comparisonPhase(
    firstStage ? events.slice(0, firstStage.index) : [],
    before.project,
    baseline.views,
    'before'
  );
  const afterComparison = comparisonPhase(
    lastStage ? events.slice(lastStage.index + 1) : [],
    applied,
    candidate.views,
    'after'
  );
  const comparisonsComplete = beforeComparison.complete && afterComparison.complete;
  const findings: Finding[] = [
    {
      name: names[0],
      passed: capturedMatches,
      detail: capturedMatches
        ? 'Both cameras retain the exact captured position, yaw, pitch, vertical FOV, venue, and aspect.'
        : 'The captured cameras differ from the audience fixture specification.',
    },
    {
      name: names[1],
      passed: baselineMatches,
      detail: `Independent expected north/south lit counts are [3,3,3] / [1,1,1] at 0, 1, 2 s; measured ${JSON.stringify(north.before.lit)} / ${JSON.stringify(south.before.lit)}.`,
    },
    {
      name: names[2],
      passed: improved,
      detail: `South must improve from one to three lit drones with four geometric points at every sample; measured lights ${JSON.stringify(south.after.lit)}, geometry ${JSON.stringify(south.after.geometry)}.`,
    },
    {
      name: names[3],
      passed: unrelatedPreserved,
      detail: `North must retain three geometric points and three lit drones at every sample; measured lights ${JSON.stringify(north.after.lit)}, geometry ${JSON.stringify(north.after.geometry)}.`,
    },
    {
      name: names[4],
      passed: positionsPreserved,
      detail: positionsPreserved
        ? 'Fleet, all authored motion/timing data including dormant paths, and all seven evaluated positions are unchanged.'
        : 'Fleet, authored geometry/timing, or evaluated drone positions changed.',
    },
    {
      name: names[5],
      passed: lightsPreserved,
      detail: lightsPreserved
        ? 'Evaluated RGB for unselected IDs 1, 2, 3, 6, 7 is unchanged at every required sample; the dark decoy remains dark.'
        : 'An unselected drone’s sampled RGB changed.',
    },
    {
      name: names[6],
      passed: comparisonsComplete,
      detail: comparisonsComplete
        ? 'Successful comparisons collectively cover both views before and after all staged edits, with exact sampled times, captured cameras, and independently expected summaries.'
        : 'Missing or mismatched successful comparison coverage before the first edit or after the final edit (both view IDs, times, camera, aspect, revision, and numeric summaries must match).',
    },
  ];
  return {
    findings,
    evidence: {
      times: [...baseline.times],
      views: evidenceViews,
      trace: {
        beforeComparisonEventId: beforeComparison.complete
          ? beforeComparison.eventIds.at(-1)!
          : null,
        afterComparisonEventId: afterComparison.complete ? afterComparison.eventIds.at(-1)! : null,
        beforeComparisonEventIds: beforeComparison.eventIds,
        afterComparisonEventIds: afterComparison.eventIds,
        firstStageEventId: firstStage?.event.id ?? null,
        lastStageEventId: lastStage?.event.id ?? null,
      },
    },
  };
}
