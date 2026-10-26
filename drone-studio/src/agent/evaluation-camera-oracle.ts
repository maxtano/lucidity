import {
  inspectCameraMove,
  type CameraMoveReport,
  type CameraMoveRequest,
} from '../core/camera-move-inspection';
import type { Project } from '../core/model';
import type { AgentEvent, AgentRequest } from './types';

type Finding = { name: string; passed: boolean; detail: string };
export type CameraRefinementEvidence = {
  request: CameraMoveRequest;
  mapping: { cameraTime: number; showTime: number; yaw: number }[];
  before: { geometry: number[]; lit: number[] };
  after: { geometry: number[]; lit: number[] };
  trace: {
    beforeEventId: number | null;
    afterEventId: number | null;
    firstStageEventId: number | null;
    lastStageEventId: number | null;
  };
};

// Independent analytic specification, not generated with commands or camera sampling:
// Four moving points fit North/NE/East at the three moments; static North/East
// anchors add one at either end. Only moving1 is lit initially; selected2/3 may
// become lit. Moving dark4, selected south5, and dormant9 must stay untouched.
const geometry = [5, 4, 5],
  beforeLights = [2, 1, 2],
  afterLights = [4, 3, 4];
const pose = { east: 0, north: 0, eyeHeight: 2, yaw: 0, pitch: 0, fov: 60 };
const venue = { east: 0, north: 70, heading: 180 };
const expectedRequest: CameraMoveRequest = {
  plan: {
    from: { pose: { ...pose }, venue: { ...venue } },
    to: { pose: { ...pose, yaw: 90 }, venue: { ...venue } },
    duration: 8,
    easing: 'linear',
  },
  aspect: 1,
  fromName: 'Captured current viewpoint',
  toName: 'East audience',
  start: 1,
  end: 3,
  samples: 3,
};
const expectedMapping = [0, 1, 2].map((index) => ({
  cameraTime: index * 4,
  showTime: index + 1,
  yaw: index * 45,
}));
const names = [
  'Captured camera clocks',
  'Independent camera baseline',
  'Sampled camera lights improved',
  'Camera authoring preservation',
  'Camera comparisons before and after editing',
];

function canonical(value: unknown, key = ''): unknown {
  if (key === 'color' && typeof value === 'string') return value.toLowerCase();
  if (Array.isArray(value)) {
    const items = key === 'keyframes' ? [...value].sort((a, b) => a.time - b.time) : value;
    return items.map((item) => canonical(item));
  }
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
function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function protectedContent(project: Project) {
  const result = structuredClone(project);
  result.revision = 0;
  const cue = result.cues.find((item) => item.id === 'camera-opening');
  for (const id of [2, 3])
    for (const key of cue?.droneEdits?.[id]?.keyframes ?? [])
      if ([1, 2, 3].includes(key.time)) delete key.brightness;
  return result;
}
function summary(lit: number[]) {
  const min = Math.min(...lit),
    max = Math.max(...lit);
  return {
    minInFrameLights: min,
    maxInFrameLights: max,
    meanInFrameLights: lit.reduce((sum, count) => sum + count, 0) / lit.length,
    minIndex: lit.indexOf(min),
    maxIndex: lit.indexOf(max),
  };
}
function counts(report: CameraMoveReport) {
  return {
    geometry: report.samples.map((row) => row.totals.inFrustum),
    lit: report.samples.map((row) => row.totals.inFrustumLightsOn),
  };
}
function paired(event: AgentEvent, events: AgentEvent[]): boolean {
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
    Number.isSafeInteger(starts[0].id) &&
    starts[0].id >= 1 &&
    starts[0].id < event.id &&
    events.filter((item) => item.id === starts[0].id).length === 1 &&
    starts[0].tool === event.tool &&
    events.indexOf(starts[0]) < events.indexOf(event)
  );
}
function validMeasurement(
  event: AgentEvent,
  events: AgentEvent[],
  project: Project,
  operationCount: number,
  lit: number[]
) {
  if (
    event.type !== 'tool_result' ||
    event.tool !== 'inspect_camera_move' ||
    !paired(event, events)
  )
    return false;
  const details = record(event.details);
  return (
    details?.projectId === project.id &&
    details.revision === project.revision &&
    details.fromViewId === '' &&
    details.toViewId === 'east-view' &&
    equal(details.request, expectedRequest) &&
    equal(details.provenance, {
      projectId: project.id,
      baseRevision: 7,
      revision: project.revision,
      operationCount,
    }) &&
    equal(
      details.mapping,
      expectedMapping.map(({ cameraTime, showTime }, index) => ({
        cameraTime,
        showTime,
        inFrameLights: lit[index],
      }))
    ) &&
    equal(details.summary, summary(lit))
  );
}

export async function evaluateCameraRefinement(
  before: AgentRequest,
  applied: Project | undefined,
  events: AgentEvent[],
  operationCount: number,
  signal?: AbortSignal
): Promise<{ findings: Finding[]; evidence?: CameraRefinementEvidence }> {
  signal?.throwIfAborted();
  const fail = (detail: string) => ({
    findings: names.map((name) => ({ name, passed: false, detail })),
  });
  if (!applied) return fail('No applied candidate was available for camera evidence checks.');
  const captured = before.viewer;
  const capturedMatches =
    equal(captured?.current, { snapshot: expectedRequest.plan.from, aspect: 1 }) &&
    equal(captured?.savedViews, [
      { id: 'east-view', name: 'East audience', snapshot: expectedRequest.plan.to },
    ]);
  let baseline: CameraMoveReport, candidate: CameraMoveReport;
  try {
    baseline = await inspectCameraMove(before.project, expectedRequest, { signal });
    candidate = await inspectCameraMove(applied, expectedRequest, { signal });
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return fail('Camera samples could not be evaluated at the specified exact clocks.');
  }
  const beforeCounts = counts(baseline),
    afterCounts = counts(candidate);
  const mapping = baseline.samples.map((row) => ({
    cameraTime: row.cameraTime,
    showTime: row.showTime,
    yaw: row.snapshot.pose.yaw,
  }));
  const camerasMatch = [baseline, candidate].every(
    (report) =>
      equal(report.request, expectedRequest) &&
      report.samples.every((row, index) =>
        equal(row.snapshot, { pose: { ...pose, yaw: index * 45 }, venue })
      )
  );
  const stages = events
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
  const first = stages[0],
    last = stages.at(-1);
  const countedOperations = stages.reduce(
    (sum, { event }) => sum + Number(record(event.details)?.addedOperations),
    0
  );
  const validBefore = first
    ? events
        .slice(0, first.index)
        .find((event) => validMeasurement(event, events, before.project, 0, beforeLights))
    : undefined;
  const validAfter = last
    ? events
        .slice(last.index + 1)
        .find((event) => validMeasurement(event, events, applied, operationCount, afterLights))
    : undefined;
  return {
    findings: [
      {
        name: names[0],
        passed: capturedMatches && camerasMatch && equal(mapping, expectedMapping),
        detail:
          'Exact North→East camera times [0,4,8] must map to show [1,2,3], yaw [0,45,90], fixed venue and captured aspect1.',
      },
      {
        name: names[1],
        passed:
          equal(beforeCounts, { geometry, lit: beforeLights }) &&
          equal(baseline.summary, summary(beforeLights)),
        detail: `Independent expected geometry [5,4,5] and baseline lights [2,1,2]; measured ${JSON.stringify(beforeCounts)}.`,
      },
      {
        name: names[2],
        passed:
          equal(afterCounts, { geometry, lit: afterLights }) &&
          equal(candidate.summary, summary(afterLights)),
        detail: `Independent expected final lights [4,3,4] with unchanged geometry; measured ${JSON.stringify(afterCounts)}.`,
      },
      {
        name: names[3],
        passed: equal(protectedContent(before.project), protectedContent(applied)),
        detail:
          'Only brightness at the six requested keys may differ; geometry, other channels, selected outside light5, unselected dark4 and dormant9 must remain intact.',
      },
      {
        name: names[4],
        passed: Boolean(
          validBefore &&
            validAfter &&
            Number.isInteger(operationCount) &&
            operationCount > 0 &&
            countedOperations === operationCount
        ),
        detail:
          'Successful paired camera tool evidence must precede the first edit and follow the last, with exact endpoints, both clocks, aspect, sampled counts, summary and draft provenance.',
      },
    ],
    evidence: {
      request: structuredClone(expectedRequest),
      mapping,
      before: beforeCounts,
      after: afterCounts,
      trace: {
        beforeEventId: validBefore?.id ?? null,
        afterEventId: validAfter?.id ?? null,
        firstStageEventId: first?.event.id ?? null,
        lastStageEventId: last?.event.id ?? null,
      },
    },
  };
}
