import { ShowEvaluator } from '../core/animation';
import type { Project } from '../core/model';
import type { AgentEvent, AgentRequest } from './types';

type Finding = { name: string; passed: boolean; detail: string };
export type AudienceTargetingEvidence = {
  time: number;
  matchedIdsBefore: number[];
  matchedIdsAfter: number[];
  changedDroneIds: number[];
  originalSelection: number[];
  trace: {
    beforeEventId: number | null;
    targetStageEventId: number | null;
    afterEventId: number | null;
    targetId: string | null;
  };
};

// The independent expected set is arithmetic, not the production audience classifier,
// returned tool pages, fixture operations, or the generated expected document.
const wanted = Array.from({ length: 200 }, (_, index) => 1 + index * 3);
const originalSelection = [2, 3, 599, 600];
const snapshot = {
  pose: { east: 0, north: 0, eyeHeight: 2, yaw: 0, pitch: 0, fov: 60 },
  venue: { east: 0, north: 70, heading: 180 },
};
const criteria = {
  time: 1,
  snapshot,
  aspect: 1,
  region: 'in_frame',
  lights: 'off',
  scope: 'fleet',
};
const names = [
  'Independent complete audience target',
  'Full target edited and controls preserved',
  'No remaining dark in-frame matches',
  'Measured target handle and final evidence',
];
function canonical(value: unknown, key = ''): unknown {
  if (key === 'color' && typeof value === 'string') return value.toLowerCase();
  if (Array.isArray(value))
    return (key === 'keyframes' ? [...value].sort((a, b) => a.time - b.time) : value).map((item) =>
      canonical(item)
    );
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, item]) => [name, canonical(item, name)])
    );
  return value;
}
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const record = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
function measured(project: Project) {
  const frame = new ShowEvaluator(project).sample(1);
  const dark: number[] = [];
  // For this fixed North-facing camera, tan(vertical FOV/2)=tan30°=1/sqrt3.
  // All fixture points are comfortably away from frustum and zero-light boundaries.
  for (let id = 1; id <= project.droneCount; id++) {
    const i = (id - 1) * 3,
      east = frame.positions[i],
      north = frame.positions[i + 1],
      up = frame.positions[i + 2] - 2;
    const inFrame =
      north >= 0.1 &&
      north <= 5000 &&
      Math.abs(east) <= north / Math.sqrt(3) &&
      Math.abs(up) <= north / Math.sqrt(3);
    if (inFrame && !frame.shades.slice(i, i + 3).some((channel) => channel > 0)) dark.push(id);
  }
  return { dark, positions: frame.positions };
}
function protectedDocument(project: Project) {
  const owned = structuredClone(project);
  owned.revision = 0;
  const edits = owned.cues.find((cue) => cue.id === 'opening')?.droneEdits;
  for (const id of wanted) if (edits?.[id]) delete edits[id].brightness;
  return owned;
}
function paired(event: AgentEvent, events: AgentEvent[]) {
  if (
    !event.callId ||
    !Number.isSafeInteger(event.id) ||
    event.id < 1 ||
    events.filter((item) => item.id === event.id).length !== 1
  )
    return false;
  const starts = events.filter(
    (item) => item.type === 'tool_start' && item.callId === event.callId
  );
  const ends = events.filter(
    (item) =>
      ['tool_result', 'validation_error'].includes(item.type) && item.callId === event.callId
  );
  return (
    starts.length === 1 &&
    ends.length === 1 &&
    ends[0] === event &&
    starts[0].tool === event.tool &&
    Number.isSafeInteger(starts[0].id) &&
    starts[0].id > 0 &&
    starts[0].id < event.id &&
    events.filter((item) => item.id === starts[0].id).length === 1 &&
    events.indexOf(starts[0]) < events.indexOf(event)
  );
}
function query(
  event: AgentEvent,
  events: AgentEvent[],
  project: Project,
  operationCount: number,
  baseline: boolean
) {
  if (
    event.type !== 'tool_result' ||
    event.tool !== 'inspect_audience_selection' ||
    !paired(event, events)
  )
    return false;
  const d = record(event.details);
  return (
    d?.projectId === project.id &&
    d.revision === project.revision &&
    d.stagedOperations === operationCount &&
    equal(d.provenance, {
      projectId: project.id,
      baseRevision: 7,
      revision: project.revision,
      operationCount,
    }) &&
    d.viewId === '' &&
    d.viewName === 'Captured current viewpoint' &&
    equal(d.request, criteria) &&
    d.cueId === 'opening' &&
    d.localTime === 1 &&
    d.blend === 1 &&
    d.consideredCount === 600 &&
    d.droneCount === 600 &&
    d.offset === 0 &&
    d.limit === 128 &&
    d.matchedCount === (baseline ? 200 : 0) &&
    d.hasMore === baseline &&
    d.nextOffset === (baseline ? 128 : null) &&
    equal(d.ids, baseline ? wanted.slice(0, 128) : []) &&
    (baseline ? typeof d.targetId === 'string' && d.targetId.length > 0 : d.targetId === null)
  );
}

export async function evaluateAudienceTargeting(
  before: AgentRequest,
  applied: Project | undefined,
  events: AgentEvent[],
  operationCount: number,
  signal?: AbortSignal
): Promise<{ findings: Finding[]; evidence?: AudienceTargetingEvidence }> {
  signal?.throwIfAborted();
  if (!applied)
    return {
      findings: names.map((name) => ({
        name,
        passed: false,
        detail: 'No applied candidate was available for complete-target verification.',
      })),
    };
  const baseline = measured(before.project),
    after = measured(applied);
  const baselineEdits = before.project.cues[0].droneEdits!,
    candidateEdits = applied.cues.find((cue) => cue.id === 'opening')?.droneEdits ?? {};
  const allIds = [
    ...new Set([...Object.keys(baselineEdits), ...Object.keys(candidateEdits)].map(Number)),
  ].sort((a, b) => a - b);
  const changed = allIds.filter((id) => !equal(baselineEdits[id], candidateEdits[id]));
  const preserved =
    equal(protectedDocument(before.project), protectedDocument(applied)) &&
    equal(before.selection, originalSelection) &&
    equal(changed, wanted) &&
    wanted.every((id) => candidateEdits[id]?.brightness === 1) &&
    equal(baseline.positions, after.positions);
  const edits = events
    .map((event, index) => ({ event, index }))
    .filter(
      ({ event }) =>
        event.type === 'tool_result' &&
        ['stage_operations', 'stage_selection_operation', 'stage_audience_operation'].includes(
          event.tool ?? ''
        ) &&
        Number(record(event.details)?.addedOperations) > 0 &&
        paired(event, events)
    );
  const first = edits[0],
    last = edits.at(-1);
  const beforeQueries = first
    ? events.slice(0, first.index).filter((event) => query(event, events, before.project, 0, true))
    : [];
  const afterEvent = last
    ? events
        .slice(last.index + 1)
        .find((event) => query(event, events, applied, operationCount, false))
    : undefined;
  const targetStage = edits.find(({ event, index }) => {
    const d = record(event.details),
      target = record(d?.target);
    return (
      index === first?.index &&
      event.tool === 'stage_audience_operation' &&
      typeof d?.targetId === 'string' &&
      beforeQueries.some((query) => record(query.details)?.targetId === d.targetId) &&
      d.stagedOperations === 1 &&
      d.baseRevision === 7 &&
      d.matchedCount === 200 &&
      d.addedOperations === 1 &&
      target?.projectId === before.project.id &&
      target.revision === 7 &&
      target.stagedOperations === 0 &&
      target.viewId === '' &&
      target.viewName === 'Captured current viewpoint' &&
      target.consideredCount === 600 &&
      target.droneCount === 600 &&
      equal(target.request, criteria)
    );
  });
  const targetId = record(targetStage?.event.details)?.targetId;
  const beforeEvent = beforeQueries.find((event) => record(event.details)?.targetId === targetId);
  const stagedCount = edits.reduce(
    (sum, { event }) => sum + Number(record(event.details)?.addedOperations),
    0
  );
  return {
    findings: [
      {
        name: names[0],
        passed:
          equal(baseline.dark, wanted) &&
          equal(before.viewer, { current: { snapshot, aspect: 1 }, savedViews: [] }),
        detail:
          'The independent North-facing projection must match exactly 200 dark IDs 1,4,...598; the first 128 returned rows cannot represent the complete set.',
      },
      {
        name: names[1],
        passed: preserved,
        detail: `Exactly 200 matched authored records must change only base brightness. Changed ${changed.length}; original selection, nonmatches, keys, geometry and dormant 900 must be preserved.`,
      },
      {
        name: names[2],
        passed: after.dark.length === 0,
        detail: `Independent projection found ${after.dark.length} remaining dark in-frame drones; expected 0.`,
      },
      {
        name: names[3],
        passed: Boolean(
          beforeEvent &&
            targetStage &&
            afterEvent &&
            operationCount > 0 &&
            stagedCount === operationCount
        ),
        detail:
          'The full target must come from the successful baseline query, be consumed by a paired audience-stage result with bound source criteria, then be remeasured after every edit with actual proposal provenance.',
      },
    ],
    evidence: {
      time: 1,
      matchedIdsBefore: baseline.dark,
      matchedIdsAfter: after.dark,
      changedDroneIds: changed,
      originalSelection: [...before.selection],
      trace: {
        beforeEventId: beforeEvent?.id ?? null,
        targetStageEventId: targetStage?.event.id ?? null,
        afterEventId: afterEvent?.id ?? null,
        targetId: typeof targetId === 'string' ? targetId : null,
      },
    },
  };
}
