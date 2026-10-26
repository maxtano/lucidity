import type { CameraMoveReport } from '../core/camera-move-inspection';
import type { Operation } from '../core/commands';
import { defaultProject, type Project, type Vector3Tuple } from '../core/model';
import type { AgentProvider, AgentRequest } from './types';

const current = {
  pose: { east: 0, north: 0, eyeHeight: 2, yaw: 0, pitch: 0, fov: 60 },
  venue: { east: 0, north: 70, heading: 180 },
};
const destination = { ...structuredClone(current), pose: { ...current.pose, yaw: 90 } };
export const cameraEvaluationSpec = {
  arguments: {
    fromViewId: '',
    toViewId: 'east-view',
    duration: 8,
    easing: 'linear' as const,
    start: 1,
    end: 3,
    samples: 3,
  },
  from: structuredClone(current),
  to: structuredClone(destination),
  aspect: 1,
  cameraTimes: [0, 4, 8],
  showTimes: [1, 2, 3],
  selection: [2, 3, 5],
};

export const cameraEvaluation = {
  id: 'camera-light-refinement',
  title: 'Refine selected lights along a measured camera move',
  prompt:
    'Use inspect_camera_move before editing: from the captured current view (empty ID) to saved East audience (east-view), duration 8 camera seconds, linear easing, show start 1, end 3, and 3 samples. Camera elapsed times 0/4/8 map to show times 1/2/3; these are different clocks. Inspect the captured current viewpoint at show time 1 to identify which selected drones are both in frame and dark. Brighten only those selected dark in-frame drones by setting their existing brightness keys at scene-local 1, 2, and 3 seconds to 1. Leave selected dark drones outside that starting frame unchanged. Preserve every position, motion key, color, easing, flash, static channel, other key time, unselected or dormant edit, and scene/show setting. Use inspect_camera_move again with exactly the same endpoints, duration, easing, show interval and samples after the final edits; confirm more lit drones at every sampled camera moment with unchanged geometry. Review and return an unapplied proposal. Describe sampled geometry, not rendered visibility, continuous coverage, or flight readiness.',
  fixture(): { request: AgentRequest; expected: Project; operations: Operation[] } {
    const project = structuredClone(defaultProject);
    project.id = 'camera-refinement-fixture';
    project.name = 'Camera refinement fixture';
    project.revision = 7;
    project.droneCount = 7;
    project.bpm = 120;
    const paths: Record<number, Vector3Tuple[]> = {
      1: [
        [0, 20, 2],
        [20, 20, 2],
        [20, 0, 2],
      ],
      2: [
        [-2, 20, 3],
        [18, 22, 4],
        [20, 2, 3],
      ],
      3: [
        [2, 24, 4],
        [24, 20, 3],
        [24, -2, 4],
      ],
      4: [
        [0, 24, 3],
        [22, 22, 3],
        [24, 0, 3],
      ],
    };
    project.cues = [
      {
        ...project.cues[0],
        id: 'camera-opening',
        name: 'Camera opening',
        duration: 4,
        transition: 0,
        transitionEasing: 'linear',
        metadata: { note: 'Preserve both clocks and all authored channels.' },
        droneEdits: {
          ...Object.fromEntries(
            [1, 2, 3, 4].map((id) => [
              id,
              {
                position: paths[id][0],
                color: ['#ffaa33', '#33aaff', '#aa55ff', '#ffffff'][id - 1],
                brightness: id === 1 ? 0.8 : 0.35,
                flash: { hz: 0, duty: 0.2 + id * 0.1, phase: id * 0.125 },
                keyframes: [
                  ...[1, 2, 3].map((time, index) => ({
                    time,
                    position: paths[id][index],
                    brightness: id === 1 ? 0.8 : 0,
                    color: ['#dd55aa', '#33bbff', '#ffbb44'][index],
                    easing: (['linear', 'smooth', 'hold'] as const)[index],
                  })),
                  {
                    time: 6,
                    position: [30 + id, 10, 5] as Vector3Tuple,
                    brightness: 0.42,
                    color: '#123456',
                    easing: 'smooth' as const,
                  },
                ],
              },
            ])
          ),
          5: {
            position: [0, -30, 2],
            color: '#ff66aa',
            brightness: 0,
            keyframes: [
              { time: 1, brightness: 0 },
              { time: 2, brightness: 0 },
              { time: 3, brightness: 0 },
            ],
          },
          6: { position: [0, 30, 2], color: '#aaff66', brightness: 0.7 },
          7: { position: [30, 0, 2], color: '#66aaff', brightness: 0.65 },
          9: {
            position: [-70, -90, 30],
            color: '#654321',
            brightness: 0.2,
            flash: { hz: 3, duty: 0.3, phase: 0.125 },
            keyframes: [{ time: 6, position: [-80, -90, 40], brightness: 0.61, easing: 'hold' }],
          },
        },
      },
    ];
    const request: AgentRequest = {
      project,
      prompt: cameraEvaluation.prompt,
      cueId: 'camera-opening',
      selection: [2, 3, 5],
      time: 1,
      viewer: {
        current: { snapshot: structuredClone(current), aspect: 1 },
        savedViews: [
          { id: 'east-view', name: 'East audience', snapshot: structuredClone(destination) },
        ],
      },
    };
    // Authored expectation is built directly, independently of command execution.
    const expected = structuredClone(project);
    for (const id of [2, 3])
      for (const key of expected.cues[0].droneEdits![id].keyframes!)
        if ([1, 2, 3].includes(key.time)) key.brightness = 1;
    const operations: Operation[] = [1, 2, 3].map((time) => ({
      type: 'set_keyframe',
      cueId: request.cueId,
      ids: [2, 3],
      keyframe: { time, brightness: 1 },
    }));
    return { request, expected, operations };
  },
};

function resultFor(input: unknown[], id: string): unknown {
  const item = [...input]
    .reverse()
    .find(
      (value) =>
        value &&
        typeof value === 'object' &&
        (value as { type?: unknown }).type === 'function_call_output' &&
        (value as { call_id?: unknown }).call_id === id
    ) as { output?: unknown } | undefined;
  if (typeof item?.output !== 'string') throw new Error('Camera fixture is missing a tool result.');
  const output = JSON.parse(item.output);
  if (output.ok !== true) throw new Error('Camera fixture stopped after a tool error.');
  return output.result;
}

/** Conditional scripted evidence consumption; never a model-quality claim or canned tool result. */
export function createCameraEvaluationProvider(request: AgentRequest): AgentProvider {
  const captured = structuredClone(request);
  let step = 0,
    previous = '';
  let before: CameraMoveReport | undefined;
  let targets: number[] = [];
  const fail = (message: string): never => {
    throw new Error(`Camera fixture: ${message}`);
  };
  const readMove = (value: unknown): CameraMoveReport => {
    const report = value as CameraMoveReport;
    if (
      !report ||
      report.projectId !== captured.project.id ||
      report.request?.start !== 1 ||
      report.request?.end !== 3 ||
      report.request?.plan.duration !== 8 ||
      report.request?.plan.easing !== 'linear' ||
      !Array.isArray(report.samples) ||
      report.samples.length !== 3 ||
      report.samples.some(
        (row, index) =>
          row.cameraTime !== [0, 4, 8][index] ||
          row.showTime !== [1, 2, 3][index] ||
          !Number.isInteger(row.totals?.inFrustumLightsOn) ||
          row.totals.inFrustumLightsOn < 0 ||
          row.totals.inFrustumLightsOn > row.totals.inFrustum ||
          row.totals.inFrustum > captured.project.droneCount
      )
    )
      return fail('camera report did not describe the requested clocks and bounded counts.');
    return structuredClone(report);
  };
  const call = (name: string, args: unknown) => {
    previous = `camera-fixture-${step}`;
    const item = { id: previous, name, arguments: JSON.stringify(args) };
    return {
      calls: [item],
      output: [{ type: 'function_call', call_id: item.id, name, arguments: item.arguments }],
      text: '',
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  };
  return {
    async complete({ input }) {
      switch (step++) {
        case 0:
          return call('inspect_camera_move', cameraEvaluationSpec.arguments);
        case 1:
          before = readMove(resultFor(input, previous));
          if (before.samples.some((row) => row.totals.inFrustumLightsOn >= row.totals.inFrustum))
            return fail('measurements do not show dark in-frame points at every sample.');
          return call('inspect_viewpoint', { time: 1, viewId: '', limit: 32 });
        case 2: {
          const inspection = resultFor(input, previous) as {
            time: number;
            viewId: string;
            drones: { id: number; visible: boolean; lightsOn: boolean }[];
          };
          if (
            inspection.time !== 1 ||
            inspection.viewId !== '' ||
            !Array.isArray(inspection.drones) ||
            inspection.drones.length !== captured.project.droneCount ||
            new Set(inspection.drones.map((row) => row.id)).size !== captured.project.droneCount
          )
            return fail('start-view inspection did not return the complete fixture fleet.');
          targets = inspection.drones
            .filter((row) => captured.selection.includes(row.id) && row.visible && !row.lightsOn)
            .map((row) => row.id)
            .sort((a, b) => a - b);
          if (!targets.length)
            return fail('no selected dark points are inside the starting frame.');
          return call('stage_operations', {
            operationsJson: JSON.stringify(
              [1, 2, 3].map((time) => ({
                type: 'set_keyframe',
                cueId: captured.cueId,
                ids: targets,
                keyframe: { time, brightness: 1 },
              }))
            ),
            explanation:
              'Brighten only the selected dark points measured inside the starting frame; preserve all other channels.',
          });
        }
        case 3:
          resultFor(input, previous);
          return call('inspect_camera_move', cameraEvaluationSpec.arguments);
        case 4: {
          const after = readMove(resultFor(input, previous));
          if (
            after.samples.some(
              (row, index) =>
                row.totals.inFrustum !== before!.samples[index].totals.inFrustum ||
                row.totals.inFrustumLightsOn !==
                  before!.samples[index].totals.inFrustumLightsOn + targets.length
            )
          )
            return fail(
              'remeasurement did not preserve geometry and improve every sampled light count.'
            );
          return call('review_draft', {});
        }
        case 5:
          resultFor(input, previous);
          return call('finish_proposal', {
            title: 'Scripted fixture: camera light refinement',
            description:
              'A deterministic fixture consumed actual camera and viewpoint evidence, brightened selected dark in-frame lights, and measured again. Samples improved with unchanged geometry. This is not a model-quality result, continuous visibility, or flight readiness; design review may contain issues or incomplete checks.',
            changes: [
              `Set existing brightness keys at show/scene 1, 2, 3 seconds for measured drones ${targets.join(', ')}`,
              'Preserve geometry, unselected/outside/dormant lights and all other authored work',
            ],
          });
        default:
          return { calls: [], output: [], text: 'Camera fixture ended.' };
      }
    },
  };
}
