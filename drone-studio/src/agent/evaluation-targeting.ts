import type { Operation } from '../core/commands';
import { defaultProject, type Project, type Vector3Tuple } from '../core/model';
import type { AgentProvider, AgentRequest } from './types';

const snapshot = {
  pose: { east: 0, north: 0, eyeHeight: 2, yaw: 0, pitch: 0, fov: 60 },
  venue: { east: 0, north: 70, heading: 180 },
};
export const targetingEvaluationSpec = {
  criteria: {
    time: 1,
    viewId: '',
    region: 'in_frame',
    lights: 'off',
    scope: 'fleet',
    offset: 0,
    limit: 128,
  },
  snapshot: structuredClone(snapshot),
  aspect: 1,
  selection: [2, 3, 599, 600],
};
export const targetingEvaluation = {
  id: 'audience-full-targeting',
  title: 'Edit the complete measured audience target beyond the first page',
  prompt:
    'Use inspect_audience_selection at show time 1, captured current view (empty viewId), region in_frame, lights off, scope fleet, offset 0, limit 128. The full matching set may exceed that page. Use the actual returned targetId with stage_audience_operation to set STATIC BASE brightness to 1 for the entire matched set in Opening. operationJson must omit ids so the owned target supplies every ID. Do not target the original artist selection or only the returned page, and do not infer IDs from ranges. Preserve geometry, every keyframe and other light channel, nonmatching active drones, dormant edits, and all scene/show settings. After the final edit, query the same criteria again and verify no dark in-frame matches remain. Review and return an unapplied proposal. This is one geometric sample, not visibility or flight certification.',
  fixture(): { request: AgentRequest; expected: Project; operations: Operation[] } {
    const project = structuredClone(defaultProject);
    project.id = 'audience-targeting-fixture';
    project.name = 'Full audience targeting fixture';
    project.revision = 7;
    project.droneCount = 600;
    project.bpm = 120;
    project.cues = [
      {
        ...project.cues[0],
        id: 'opening',
        name: 'Opening',
        duration: 4,
        transition: 0,
        transitionEasing: 'linear',
        metadata: { note: 'Keep nonmatches and original selection intact.' },
        droneEdits: Object.fromEntries(
          Array.from({ length: 600 }, (_, index) => {
            const id = index + 1,
              row = Math.floor(index / 3),
              north = 80 + Math.floor(row / 20) * 2;
            return [
              id,
              {
                position: [
                  ((row % 20) - 9.5) * 3 + (id % 3 === 2 ? 1.2 : 0),
                  id % 3 === 0 ? -north : north,
                  10 + Math.floor(row / 20) * 3,
                ] as Vector3Tuple,
                color: ['#dd5599', '#33aaff', '#ffbb44'][id % 3],
                brightness: id % 3 === 2 ? 0.7 : 0,
                flash: { hz: 0, duty: 0.3, phase: id / 1000 },
              },
            ];
          })
        ),
      },
    ];
    for (const id of [1, 133, 598, 2, 3]) {
      const edit = project.cues[0].droneEdits![id];
      edit.keyframes = [
        {
          time: 0,
          position: [...edit.position!] as Vector3Tuple,
          color: '#55ccaa',
          easing: 'smooth',
        },
        {
          time: 2,
          position: [...edit.position!] as Vector3Tuple,
          color: '#cc88ff',
          easing: 'hold',
        },
        { time: 6, position: [40, 100, 30], color: '#123456', easing: 'linear' },
      ];
    }
    project.cues[0].droneEdits![900] = {
      position: [-120, 90, 40],
      color: '#654321',
      brightness: 0.42,
      flash: { hz: 3, duty: 0.4, phase: 0.125 },
      keyframes: [
        { time: 6, position: [-100, 100, 50], color: '#123456', brightness: 0.3, easing: 'hold' },
      ],
    };
    const request: AgentRequest = {
      project,
      prompt: targetingEvaluation.prompt,
      cueId: 'opening',
      time: 1,
      selection: [2, 3, 599, 600],
      viewer: { current: { snapshot: structuredClone(snapshot), aspect: 1 }, savedViews: [] },
    };
    const expected = structuredClone(project);
    const ids = Array.from({ length: 200 }, (_, index) => 1 + 3 * index);
    for (const id of ids) expected.cues[0].droneEdits![id].brightness = 1;
    const operations: Operation[] = [
      { type: 'edit_drones', cueId: 'opening', ids, patch: { brightness: 1 } },
    ];
    return { request, expected, operations };
  },
};

function toolResult(input: unknown[], id: string): Record<string, unknown> {
  const item = [...input]
    .reverse()
    .find(
      (value) =>
        value &&
        typeof value === 'object' &&
        (value as { type?: unknown }).type === 'function_call_output' &&
        (value as { call_id?: unknown }).call_id === id
    ) as { output?: unknown } | undefined;
  if (typeof item?.output !== 'string')
    throw new Error('Targeting fixture is missing tool evidence.');
  const output = JSON.parse(item.output);
  if (!output.ok || !output.result || typeof output.result !== 'object')
    throw new Error('Targeting fixture stopped after a tool error.');
  return output.result;
}

/** Consume an opaque runtime target; never reconstruct the complete set from its first page. */
export function createTargetingEvaluationProvider(request: AgentRequest): AgentProvider {
  const captured = structuredClone(request);
  let step = 0,
    previous = '',
    targetId = '',
    matchedCount = 0;
  const fail = (message: string): never => {
    throw new Error(`Targeting fixture: ${message}`);
  };
  const call = (name: string, args: unknown) => {
    previous = `targeting-fixture-${step}`;
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
          return call('inspect_audience_selection', targetingEvaluationSpec.criteria);
        case 1: {
          const page = toolResult(input, previous);
          if (
            page.projectId !== captured.project.id ||
            page.revision !== captured.project.revision ||
            page.stagedOperations !== 0 ||
            typeof page.targetId !== 'string' ||
            !page.targetId ||
            !Number.isInteger(page.matchedCount) ||
            !Array.isArray(page.ids) ||
            page.ids.length !== 128 ||
            Number(page.matchedCount) <= page.ids.length ||
            page.hasMore !== true
          )
            return fail('expected an owned full target larger than the first 128-ID page.');
          targetId = page.targetId;
          matchedCount = Number(page.matchedCount);
          return call('stage_audience_operation', {
            targetId,
            operationJson: JSON.stringify({
              type: 'edit_drones',
              cueId: captured.cueId,
              patch: { brightness: 1 },
            }),
            explanation:
              'Use the measured full audience target, including matches outside its first page.',
          });
        }
        case 2: {
          const staged = toolResult(input, previous);
          if (
            staged.targetId !== targetId ||
            staged.matchedCount !== matchedCount ||
            staged.addedOperations !== 1
          )
            return fail('staging did not confirm the complete measured target.');
          return call('inspect_audience_selection', targetingEvaluationSpec.criteria);
        }
        case 3: {
          const after = toolResult(input, previous);
          if (
            after.projectId !== captured.project.id ||
            after.revision !== captured.project.revision + 1 ||
            after.stagedOperations !== 1 ||
            after.matchedCount !== 0 ||
            after.targetId !== null ||
            !Array.isArray(after.ids) ||
            after.ids.length ||
            after.hasMore !== false
          )
            return fail('remeasurement still found dark in-frame targets or the wrong draft.');
          return call('review_draft', {});
        }
        case 4:
          toolResult(input, previous);
          return call('finish_proposal', {
            title: 'Scripted fixture: full audience targeting',
            description:
              'The actual measured target handle supplied the full matching set beyond the first page. After staging, the same geometric/light query had no remaining matches. This is not a model-quality result, continuous visibility or flight readiness; design review can contain issues or incomplete checks.',
            changes: [
              `Set base brightness to 1 for all ${matchedCount} measured matched drones`,
              'Preserve original artist selection, nonmatching drones, dormant work and all other authored channels',
            ],
          });
        default:
          return { calls: [], output: [], text: 'Targeting fixture ended.' };
      }
    },
  };
}
