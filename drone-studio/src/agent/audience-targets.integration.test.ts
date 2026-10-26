import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultProject } from '../core/model';
import { applyOperations } from '../core/commands';
import { defaultAgentLimits, runAgent } from './harness';
import { executeAgentTool, type AudienceSelectionPage } from './tools';
import type { AgentDraft, AgentProvider, AgentRequest } from './types';

function request(): AgentRequest {
  const project = structuredClone(defaultProject);
  project.id = 'atomic-audience-targets';
  project.revision = 7;
  project.droneCount = 600;
  project.cues = [
    {
      ...project.cues[0],
      id: 'scene',
      duration: 1800,
      transition: 0,
      scale: 1,
      altitude: 100,
      droneEdits: {
        1: {
          color: '#aabbcc',
          keyframes: [
            { time: 0, position: [0, 0, 100] },
            { time: 1800, position: [0, 0, 100] },
          ],
        },
      },
    },
  ];
  return {
    project,
    cueId: 'scene',
    selection: [2, 257],
    time: 0,
    prompt: 'Scripted complete audience edit.',
    viewer: {
      current: {
        snapshot: {
          pose: { east: 0, north: 0, eyeHeight: 1, yaw: 0, pitch: 89, fov: 90 },
          venue: { east: 0, north: 70, heading: 180 },
        },
        aspect: 1,
      },
      savedViews: [],
    },
  };
}
const criteria = {
  time: 0,
  viewId: '',
  region: 'overhead',
  lights: 'any',
  scope: 'fleet',
  offset: 0,
  limit: 1,
};
type Step = { name: string; args: unknown };
type Output = {
  ok: boolean;
  error?: string;
  result?: Record<string, unknown> & { targetId?: string };
};
function outputs(input: unknown[]): Output[] {
  return input
    .filter((item) => (item as { type?: string }).type === 'function_call_output')
    .map((item) => JSON.parse((item as { output: string }).output));
}
function scripted(next: (records: Output[], turn: number) => Step | Step[] | null): AgentProvider {
  let turn = 0,
    call = 0;
  return {
    async complete({ input }) {
      const step = next(outputs(input), turn++);
      if (!step) return { calls: [], output: [], text: 'Scripted read-only check complete.' };
      const calls = (Array.isArray(step) ? step : [step]).map((item) => ({
        id: `target-call-${++call}`,
        name: item.name,
        arguments: JSON.stringify(item.args),
      }));
      return {
        calls,
        output: calls.map((item) => ({
          type: 'function_call',
          call_id: item.id,
          name: item.name,
          arguments: item.arguments,
        })),
        text: '',
      };
    },
  };
}
function stage(targetId: string, explanation = 'Brighten every query match.'): Step {
  return {
    name: 'stage_audience_operation',
    args: {
      targetId,
      operationJson: JSON.stringify({
        type: 'edit_drones',
        cueId: 'scene',
        patch: { brightness: 0.5 },
      }),
      explanation,
    },
  };
}
const review = { name: 'review_draft', args: {} };
const finish = {
  name: 'finish_proposal',
  args: {
    title: 'Full audience edit',
    description:
      'Scripted fixture, not a model-quality result. Review is incomplete at the workload bound.',
    changes: ['Edit every exact audience match.'],
  },
};
async function pageBudget() {
  const source = request();
  const state: AgentDraft = {
    base: source.project,
    project: source.project,
    selection: source.selection,
    viewer: source.viewer,
    operations: [],
    explanations: [],
    reviewedOperationCount: -1,
    reviewLimited: false,
  };
  const page = (await executeAgentTool(
    'inspect_audience_selection',
    criteria,
    state,
    defaultAgentLimits
  )) as AudienceSelectionPage;
  return JSON.stringify(page).length + 20;
}
afterEach(() => vi.restoreAllMocks());

describe('audience target harness transactions', () => {
  it('consumes an actual handle for all600 IDs, with owned capture, exact one-command proposal and unchanged artist selection', async () => {
    const source = request(),
      original = structuredClone(source);
    let records: Output[] = [];
    const result = await runAgent(source, {
      provider: scripted((items, turn) => {
        records = items;
        if (turn === 0) return { name: 'inspect_audience_selection', args: criteria };
        if (turn === 1) {
          expect(items[0].result).toMatchObject({ ids: [1], matchedCount: 600, hasMore: true });
          return stage(items[0].result!.targetId!);
        }
        if (turn === 2) return review;
        if (turn === 3) return finish;
        throw new Error('Unexpected scripted provider turn.');
      }),
    });
    expect(result.status).toBe('completed');
    expect(records.every((item) => item.ok)).toBe(true);
    expect(result.proposal!.operations).toEqual([
      {
        type: 'edit_drones',
        cueId: 'scene',
        ids: Array.from({ length: 600 }, (_, index) => index + 1),
        patch: { brightness: 0.5 },
      },
    ]);
    const applied = applyOperations(source.project, result.proposal!.operations, 7);
    const expected = structuredClone(original.project);
    expected.revision++;
    for (let id = 1; id <= 600; id++)
      expected.cues[0].droneEdits![id] = { ...expected.cues[0].droneEdits![id], brightness: 0.5 };
    expect(applied).toEqual(expected);
    expect(source).toEqual(original);
    const queryEvent = result.events.find(
      (event) => event.type === 'tool_result' && event.tool === 'inspect_audience_selection'
    )!;
    const stageEvent = result.events.find(
      (event) => event.type === 'tool_result' && event.tool === 'stage_audience_operation'
    )!;
    expect(stageEvent.details).toMatchObject({
      targetId: records[0].result!.targetId,
      matchedCount: 600,
      stagedOperations: 1,
      target: {
        projectId: source.project.id,
        revision: 7,
        stagedOperations: 0,
        viewId: '',
        request: { scope: 'fleet' },
      },
    });
    expect(queryEvent.details).toMatchObject({ targetId: records[0].result!.targetId, ids: [1] });
    expect(JSON.stringify(result.proposal!.operations)).not.toContain(records[0].result!.targetId!);
    expect(JSON.stringify(stageEvent.details)).not.toContain('"ids"');
  });

  it('rolls back an over-budget query registration and eviction, retaining the oldest valid target', async () => {
    const budget = await pageBudget(),
      issued: string[] = [];
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      const id =
        `00000000-0000-4000-8000-${String(issued.length + 1).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`;
      issued.push(id);
      return id;
    });
    let records: Output[] = [];
    const result = await runAgent(request(), {
      limits: { maxToolResultChars: budget },
      provider: scripted((items, turn) => {
        records = items;
        if (turn === 0)
          return Array.from({ length: 8 }, () => ({
            name: 'inspect_audience_selection',
            args: criteria,
          }));
        if (turn === 1) {
          expect(items).toHaveLength(8);
          expect(items.every((item) => item.ok)).toBe(true);
          return { name: 'inspect_audience_selection', args: { ...criteria, limit: 128 } };
        }
        if (turn === 2) {
          expect(items[8]).toMatchObject({ ok: false });
          expect(items[8].error).toContain('response budget');
          return stage(issued.at(-1)!); // The newly registered token must have been rolled back.
        }
        if (turn === 3) {
          expect(items[9].error).toContain('unknown or expired');
          return stage(items[0].result!.targetId!); // Oldest record was only temporarily evicted.
        }
        if (turn === 4) return review;
        if (turn === 5) return finish;
        throw new Error('Unexpected scripted provider turn.');
      }),
    });
    expect(result.status).toBe('completed');
    expect(records[10]).toMatchObject({
      ok: true,
      result: { matchedCount: 600, stagedOperations: 1 },
    });
    expect(result.proposal!.operations).toHaveLength(1);
    expect(
      result.events.filter(
        (event) => event.type === 'tool_result' && event.tool === 'inspect_audience_selection'
      )
    ).toHaveLength(8);
    expect(result.events.filter((event) => event.type === 'validation_error')).toHaveLength(2);
  });

  it('restores the target and prior draft when a successful stage result exceeds its output budget', async () => {
    const budget = await pageBudget();
    let records: Output[] = [];
    const result = await runAgent(request(), {
      limits: { maxToolResultChars: budget },
      provider: scripted((items, turn) => {
        records = items;
        if (turn === 0) return { name: 'inspect_audience_selection', args: criteria };
        if (turn === 1) return stage(items[0].result!.targetId!, 'x'.repeat(2000));
        if (turn === 2) {
          expect(items[1]).toMatchObject({ ok: false });
          expect(items[1].error).toContain('response budget');
          return stage(items[0].result!.targetId!);
        }
        if (turn === 3) return review;
        if (turn === 4) return finish;
        throw new Error('Unexpected scripted provider turn.');
      }),
    });
    expect(result.status).toBe('completed');
    expect(records[2]).toMatchObject({
      ok: true,
      result: { stagedOperations: 1, matchedCount: 600 },
    });
    expect(result.proposal!.operations).toHaveLength(1);
    expect(
      result.events.filter(
        (event) => event.type === 'tool_result' && event.tool === 'stage_audience_operation'
      )
    ).toHaveLength(1);
  });

  it('never reuses a target across runs or changes a proposal after cancellation', async () => {
    let token = '';
    const first = await runAgent(request(), {
      provider: scripted((items, turn) => {
        if (!turn) return { name: 'inspect_audience_selection', args: criteria };
        token = items[0].result!.targetId!;
        return null;
      }),
    });
    expect(first.status).toBe('completed');
    expect(token).not.toBe('');
    let records: Output[] = [];
    const second = await runAgent(request(), {
      provider: scripted((items, turn) => {
        records = items;
        return turn ? null : stage(token);
      }),
    });
    expect(second.proposal).toBeUndefined();
    expect(records[0].error).toContain('unknown or expired');
    const controller = new AbortController();
    const third = await runAgent(request(), {
      signal: controller.signal,
      provider: scripted((items, turn) =>
        turn
          ? stage(items[0].result!.targetId!)
          : { name: 'inspect_audience_selection', args: criteria }
      ),
      onEvent(event) {
        if (event.type === 'tool_result' && event.tool === 'inspect_audience_selection')
          controller.abort();
      },
    });
    expect(third.status).toBe('cancelled');
    expect(third.proposal).toBeUndefined();
    expect(third.events.some((event) => event.tool === 'stage_audience_operation')).toBe(false);
  });
});
