import type {
  AudienceComparisonReport,
  AudienceComparisonRequest,
} from '../core/audience-comparison';
import type { Operation } from '../core/commands';
import { defaultProject, type Project } from '../core/model';
import type { AgentProvider, AgentRequest } from './types';

const northView: AudienceComparisonRequest['views'][number] = {
  id: '',
  name: 'Captured current viewpoint',
  aspect: 1.6,
  snapshot: {
    pose: { east: 0, north: 0, eyeHeight: 2, yaw: 0, pitch: 0, fov: 75 },
    venue: { east: 0, north: 70, heading: 180 },
  },
};
const southView: AudienceComparisonRequest['views'][number] = {
  ...structuredClone(northView),
  id: 'south-view',
  name: 'South audience',
  snapshot: {
    ...structuredClone(northView.snapshot),
    pose: { ...northView.snapshot.pose, yaw: 180 },
  },
};

/** Public analytic fixture specification; the oracle derives its own geometry/light checks. */
export const audienceEvaluationSpec = {
  start: 0,
  end: 2,
  samples: 3,
  times: [0, 1, 2],
  viewIds: ['', 'south-view'],
  currentViewId: '',
  unrelatedViewId: '',
  weakerViewId: 'south-view',
  selection: [4, 5],
  views: [structuredClone(northView), structuredClone(southView)],
  before: { '': [3, 3, 3], 'south-view': [1, 1, 1] },
  after: { '': [3, 3, 3], 'south-view': [3, 3, 3] },
};

export const audienceEvaluation = {
  id: 'audience-light-refinement',
  title: 'Refine selected lights from measured audience viewpoints',
  prompt:
    'Use compare_viewpoints with start 0, end 2, and 3 samples to compare the captured current and saved South audience viewpoints at show-global times 0, 1, and 2 seconds. You may compare the views together or in separate calls. Identify the view with fewer lit drones inside its camera frustum. Inspect that view, then brighten only the selected drones that are dark and inside that weaker view: set their existing brightness keys at scene-local 0, 1, and 2 seconds to 1. Preserve every position, motion key, color, easing, flash setting, static channel, other key time, dormant edit, unselected drone, and scene/show setting. Do not brighten an unselected dark drone. Use compare_viewpoints again for the same views and times afterward and confirm the weaker view gains lit drones at every sample while the other view is unchanged. Run design review and return an unapplied proposal; describe sampled geometry rather than continuous visibility or flight readiness.',
  fixture(): { request: AgentRequest; expected: Project; operations: Operation[] } {
    const project = structuredClone(defaultProject);
    project.id = 'audience-refinement-fixture';
    project.name = 'Audience refinement fixture';
    project.revision = 7;
    project.droneCount = 7;
    project.bpm = 120;
    project.cues = [
      {
        ...project.cues[0],
        id: 'audience-opening',
        name: 'Audience opening',
        duration: 4,
        transition: 0,
        transitionEasing: 'linear',
        metadata: { note: 'Keep this reference audience study and its authored channels intact.' },
        droneEdits: {
          1: { position: [-8, 24, 8], color: '#ff5533', brightness: 0.8 },
          2: { position: [0, 28, 10], color: '#44ddff', brightness: 0.65 },
          3: { position: [8, 24, 8], color: '#aabbff', brightness: 0.9 },
          4: {
            position: [-6, -20, 7],
            color: '#dd5599',
            brightness: 0.35,
            flash: { hz: 0, duty: 0.2, phase: 0.35 },
            keyframes: [
              { time: 0, position: [-6, -20, 7], brightness: 0, easing: 'smooth' },
              { time: 1, position: [-3, -22, 8], color: '#33aaff', brightness: 0, easing: 'hold' },
              { time: 2, position: [-8, -24, 9], brightness: 0, easing: 'linear' },
              {
                time: 6,
                position: [-9, -30, 10],
                color: '#ffbb44',
                brightness: 0.42,
                easing: 'smooth',
              },
            ],
          },
          5: {
            position: [6, -20, 9],
            color: '#20bbff',
            brightness: 0.19,
            flash: { hz: 0, duty: 0.7, phase: -0.25 },
            keyframes: [
              { time: 0, position: [6, -20, 9], color: '#bb33ee', brightness: 0, easing: 'linear' },
              { time: 1, position: [8, -24, 7], color: '#44aaff', brightness: 0, easing: 'smooth' },
              { time: 2, position: [5, -26, 8], color: '#ffcc33', brightness: 0, easing: 'hold' },
              { time: 6, position: [9, -32, 12], brightness: 0.61, easing: 'linear' },
            ],
          },
          6: {
            position: [0, -22, 6],
            color: '#ffffff',
            brightness: 0,
            keyframes: [{ time: 3, color: '#ffaa88' }],
          },
          7: { position: [10, -26, 11], color: '#66ccaa', brightness: 0.7 },
          9: {
            position: [120, 120, 30],
            color: '#123456',
            brightness: 0.61,
            flash: { hz: 3, duty: 0.4, phase: 0.125 },
            keyframes: [
              {
                time: 6,
                position: [130, 125, 40],
                color: '#654321',
                brightness: 0.2,
                easing: 'hold',
              },
            ],
          },
        },
      },
    ];
    const request: AgentRequest = {
      project,
      prompt: audienceEvaluation.prompt,
      cueId: project.cues[0].id,
      selection: [4, 5],
      time: 0,
      viewer: {
        current: { snapshot: structuredClone(northView.snapshot), aspect: northView.aspect },
        savedViews: [
          { id: southView.id, name: southView.name, snapshot: structuredClone(southView.snapshot) },
        ],
      },
    };
    // An independent expected document: no command execution or generated proposal is reused.
    const expected = structuredClone(project);
    for (const id of [4, 5])
      for (const key of expected.cues[0].droneEdits![id].keyframes!)
        if (key.time === 0 || key.time === 1 || key.time === 2) key.brightness = 1;
    const operations: Operation[] = [0, 1, 2].map((time) => ({
      type: 'set_keyframe',
      cueId: request.cueId,
      ids: [4, 5],
      keyframe: { time, brightness: 1 },
    }));
    return { request, expected, operations };
  },
};

function toolResult(input: unknown[], callId: string): unknown {
  const result = [...input]
    .reverse()
    .find(
      (item) =>
        item &&
        typeof item === 'object' &&
        (item as { type?: unknown }).type === 'function_call_output' &&
        (item as { call_id?: unknown }).call_id === callId
    ) as { output?: unknown } | undefined;
  if (typeof result?.output !== 'string')
    throw new Error('Scripted audience fixture is missing a tool result.');
  const output = JSON.parse(result.output) as { ok?: unknown; result?: unknown; error?: unknown };
  if (output.ok !== true)
    throw new Error(
      `Scripted audience fixture stopped after a tool error: ${typeof output.error === 'string' ? output.error : 'invalid output'}`
    );
  return output.result;
}

/** This conditional fixture consumes tool evidence; it is not a model or a creative-quality test. */
export function createAudienceEvaluationProvider(request: AgentRequest): AgentProvider {
  const captured = structuredClone(request);
  if (!captured.viewer) throw new Error('The audience fixture needs captured viewpoints.');
  const viewIds = ['', ...captured.viewer.savedViews.map((view) => view.id)];
  if (viewIds.length !== 2)
    throw new Error('The audience fixture expects exactly two captured viewpoints.');
  const times = [0, 1, 2];
  const comparison = { start: 0, end: 2, samples: 3, viewIds };
  const selected = new Set(captured.selection);
  let step = 0;
  let before: AudienceComparisonReport | undefined;
  let weakerId: string | undefined;
  let targetIds: number[] = [];
  let previousCallId = '';
  const fail = (message: string): never => {
    throw new Error(`Scripted audience fixture: ${message}`);
  };
  const readComparison = (value: unknown): AudienceComparisonReport => {
    const report = value as AudienceComparisonReport | undefined;
    if (
      !report ||
      report.projectId !== captured.project.id ||
      !Array.isArray(report.times) ||
      report.times.length !== times.length ||
      report.times.some((time, index) => time !== times[index]) ||
      !Array.isArray(report.views) ||
      report.views.length !== viewIds.length
    )
      return fail('comparison did not return the requested project, times, and views.');
    for (const id of viewIds) {
      const matches = report.views.filter((view) => view.id === id);
      if (matches.length !== 1) return fail('comparison returned missing or duplicate viewpoints.');
      const samples = matches[0].samples;
      if (
        !Array.isArray(samples) ||
        samples.length !== times.length ||
        samples.some(
          (sample, index) =>
            sample.time !== times[index] ||
            !Number.isInteger(sample.totals?.inFrustumLightsOn) ||
            sample.totals.inFrustumLightsOn < 0 ||
            sample.totals.inFrustumLightsOn > captured.project.droneCount
        )
      )
        return fail('comparison returned invalid sampled light counts.');
    }
    return structuredClone(report);
  };
  const response = (name: string, args: unknown) => {
    const id = `audience-fixture-${step}`;
    previousCallId = id;
    const call = { id, name, arguments: JSON.stringify(args) };
    return {
      output: [{ type: 'function_call', call_id: id, name, arguments: call.arguments }],
      calls: [call],
      text: '',
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  };
  return {
    async complete({ input }) {
      switch (step++) {
        case 0:
          return response('compare_viewpoints', comparison);
        case 1: {
          before = readComparison(toolResult(input, previousCallId));
          const totals = before.views
            .map((view) => ({
              id: view.id,
              lit: view.samples.reduce((sum, sample) => sum + sample.totals.inFrustumLightsOn, 0),
            }))
            .sort((a, b) => a.lit - b.lit);
          if (totals[0].lit === totals[1].lit)
            return fail('the measurements do not identify a uniquely weaker view.');
          weakerId = totals[0].id;
          return response('inspect_viewpoint', { time: times[0], viewId: weakerId, limit: 32 });
        }
        case 2: {
          const inspection = toolResult(input, previousCallId) as {
            time?: unknown;
            viewId?: unknown;
            drones?: { id: number; visible: boolean; lightsOn: boolean }[];
          };
          if (
            inspection.time !== times[0] ||
            inspection.viewId !== weakerId ||
            !Array.isArray(inspection.drones)
          )
            return fail('inspection did not describe the measured weaker viewpoint.');
          const rows = inspection.drones;
          if (
            rows.length !== captured.project.droneCount ||
            new Set(rows.map((row) => row.id)).size !== rows.length ||
            rows.some(
              (row) =>
                !Number.isInteger(row.id) ||
                row.id < 1 ||
                row.id > captured.project.droneCount ||
                typeof row.visible !== 'boolean' ||
                typeof row.lightsOn !== 'boolean'
            )
          )
            return fail('inspection did not return the complete bounded fixture fleet.');
          targetIds = rows
            .filter((row) => selected.has(row.id) && row.visible && !row.lightsOn)
            .map((row) => row.id)
            .sort((a, b) => a - b);
          if (!targetIds.length)
            return fail('the weaker view has no selected dark drones to refine.');
          const operations: Operation[] = times.map((time) => ({
            type: 'set_keyframe',
            cueId: captured.cueId,
            ids: [...targetIds],
            keyframe: { time, brightness: 1 },
          }));
          return response('stage_operations', {
            operationsJson: JSON.stringify(operations),
            explanation:
              'Scripted fixture: brighten only selected dark drones found inside the measured weaker view, preserving existing key channels.',
          });
        }
        case 3:
          toolResult(input, previousCallId);
          return response('compare_viewpoints', comparison);
        case 4: {
          const after = readComparison(toolResult(input, previousCallId));
          for (const oldView of before!.views) {
            const next = after.views.find((view) => view.id === oldView.id)!;
            for (let index = 0; index < times.length; index++) {
              const prior = oldView.samples[index].totals.inFrustumLightsOn;
              const current = next.samples[index].totals.inFrustumLightsOn;
              if (oldView.id === weakerId ? current <= prior : current !== prior)
                return fail(
                  'the measured refinement did not improve every weaker-view sample while preserving the other view.'
                );
            }
          }
          return response('review_draft', {});
        }
        case 5:
          toolResult(input, previousCallId);
          return response('finish_proposal', {
            title: 'Scripted fixture: audience light refinement',
            description:
              'Deterministic audience-aware fixture using actual comparison and inspection outputs; this is not a model-quality result. Selected dark lights improve the weaker captured view at all three sampled moments while the other view retains its sampled lit counts. Design review may have issues or incomplete checks; sampled geometry is not continuous visibility or flight readiness.',
            changes: [
              `Set brightness to 1 at existing 0, 1, and 2 second keys for selected inspected drones ${targetIds.join(', ')}`,
              'Preserve all other authored channels, keys, and unselected or dormant drones',
            ],
          });
        default:
          return {
            output: [],
            calls: [],
            text: 'Scripted audience fixture ended.',
            usage: { inputTokens: 0, outputTokens: 0 },
          };
      }
    },
  };
}
