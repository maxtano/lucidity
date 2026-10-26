import { describe, expect, it, vi } from 'vitest';
import type { AudienceComparisonReport } from '../core/audience-comparison';
import { defaultProject } from '../core/model';
import { defaultAgentLimits, runAgent } from './harness';
import { agentTools, executeAgentTool } from './tools';
import type { AgentDraft, AgentProvider, AgentRequest } from './types';

function request(): AgentRequest {
  const project = structuredClone(defaultProject);
  project.droneCount = 2;
  project.cues = [
    {
      ...project.cues[0],
      duration: 4,
      transition: 0,
      droneEdits: {
        1: {
          color: '#ff0000',
          keyframes: [
            { time: 0, position: [0, 20, 2] },
            { time: 2, position: [20, 0, 2] },
          ],
        },
        2: {
          position: [20, 0, 2],
          color: '#00ff00',
          keyframes: [
            { time: 0, brightness: 0 },
            { time: 2, brightness: 1 },
          ],
        },
      },
    },
  ];
  const snapshot = {
    pose: { east: 0, north: 0, eyeHeight: 2, yaw: 0, pitch: 0, fov: 60 },
    venue: { east: 0, north: 70, heading: 180 },
  };
  return {
    project,
    prompt: 'Compare the north and east saved viewpoints across the opening.',
    cueId: project.cues[0].id,
    selection: [],
    time: 0,
    viewer: {
      current: { snapshot, aspect: 1 },
      savedViews: [
        { id: 'north-view', name: 'North view', snapshot: structuredClone(snapshot) },
        {
          id: 'east-view',
          name: 'East view',
          snapshot: { ...structuredClone(snapshot), pose: { ...snapshot.pose, yaw: 90 } },
        },
      ],
    },
  };
}
function draft(): AgentDraft {
  const input = request();
  return {
    base: input.project,
    project: input.project,
    selection: [],
    viewer: input.viewer,
    operations: [],
    explanations: [],
    reviewedOperationCount: -1,
    reviewLimited: false,
  };
}
const comparison = { start: 0, end: 2, samples: 3, viewIds: ['north-view', 'east-view'] };
type Step = { name: string; args: unknown };
type ToolOutput = {
  ok: boolean;
  error?: string;
  retryable?: boolean;
  result?: AudienceComparisonReport;
};
function outputs(input: unknown[]): ToolOutput[] {
  return input
    .filter((item) => (item as { type?: string }).type === 'function_call_output')
    .map((item) => JSON.parse((item as { output: string }).output));
}
function fixtureProvider(
  steps: Step[],
  visit?: (input: unknown[], step: number) => void
): AgentProvider {
  let index = 0;
  return {
    async complete({ input }) {
      visit?.(input, index);
      const step = steps[index++];
      if (!step)
        return {
          output: [],
          calls: [],
          text: 'Scripted audience comparison fixture; not a model-quality assessment.',
        };
      const call = {
        id: `comparison-${index}`,
        name: step.name,
        arguments: JSON.stringify(step.args),
      };
      return {
        output: [
          { type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments },
        ],
        calls: [call],
        text: '',
      };
    },
  };
}

describe('bounded read-only viewpoint comparison tool', () => {
  it('compares saved views through the real harness and returns compact trace evidence', async () => {
    const input = request();
    const before = structuredClone(input);
    let report: AudienceComparisonReport | undefined;
    const result = await runAgent(input, {
      provider: fixtureProvider(
        [
          { name: 'inspect_show', args: {} },
          { name: 'compare_viewpoints', args: comparison },
        ],
        (items) => {
          report = outputs(items).at(-1)?.result;
        }
      ),
    });
    expect(result.status).toBe('completed');
    expect(result.proposal).toBeUndefined();
    expect(result.message).toContain('Scripted');
    expect(report).toMatchObject({
      projectId: input.project.id,
      revision: input.project.revision,
      times: [0, 1, 2],
    });
    expect(
      report!.views.map((view) => view.samples.map((sample) => sample.totals.inFrustumLightsOn))
    ).toEqual([
      [1, 0, 0],
      [0, 1, 2],
    ]);
    expect(report!.views[0].summary).toEqual({
      minInFrameLights: 0,
      maxInFrameLights: 1,
      meanInFrameLights: 1 / 3,
      minAt: 1,
      maxAt: 0,
    });
    expect(report!.views[1].summary).toEqual({
      minInFrameLights: 0,
      maxInFrameLights: 2,
      meanInFrameLights: 1,
      minAt: 0,
      maxAt: 2,
    });
    const details = result.events.find(
      (event) => event.type === 'tool_result' && event.tool === 'compare_viewpoints'
    )!.details;
    expect(details).toMatchObject({
      projectId: input.project.id,
      revision: input.project.revision,
      start: 0,
      end: 2,
      times: [0, 1, 2],
      views: [
        {
          id: 'north-view',
          aspect: 1,
          snapshot: input.viewer!.savedViews[0].snapshot,
          summary: report!.views[0].summary,
        },
        { id: 'east-view' },
      ],
    });
    expect(JSON.stringify(details)).not.toContain('"samples":');
    expect(JSON.stringify(details).length).toBeLessThan(5000);
    expect(JSON.stringify(report)).not.toContain('"drones":');
    expect(input).toEqual(before);
    expect(agentTools).toHaveLength(15);
    expect(agentTools.find((tool) => tool.name === 'compare_viewpoints')!.parameters).toMatchObject(
      { additionalProperties: false, required: ['start', 'end', 'samples', 'viewIds'] }
    );
  });

  it('reads the current private draft and preserves exact reviewed state', async () => {
    const state = draft();
    executeAgentTool(
      'stage_operations',
      {
        operationsJson: JSON.stringify([
          {
            type: 'edit_drones',
            cueId: state.project.cues[0].id,
            ids: [1],
            patch: { brightness: 0 },
          },
        ]),
        explanation: 'Existing draft blackout.',
      },
      state,
      defaultAgentLimits
    );
    executeAgentTool('review_draft', {}, state, defaultAgentLimits);
    const before = structuredClone(state),
      review = state.review,
      operations = state.operations;
    const report = (await executeAgentTool(
      'compare_viewpoints',
      comparison,
      state,
      defaultAgentLimits
    )) as AudienceComparisonReport;
    expect(
      report.views.map((view) => view.samples.map((sample) => sample.totals.inFrustumLightsOn))
    ).toEqual([
      [0, 0, 0],
      [0, 1, 1],
    ]);
    expect(state).toEqual(before);
    expect(state.review).toBe(review);
    expect(state.operations).toBe(operations);
    expect(() =>
      executeAgentTool(
        'finish_proposal',
        {
          title: 'Existing draft',
          description: 'Compared sampled geometry.',
          changes: ['Existing blackout'],
        },
        state,
        defaultAgentLimits
      )
    ).not.toThrow();
    expect(state.base.cues[0].droneEdits![1].brightness).toBeUndefined();
  });

  it('retains captured request copies when the caller changes camera/bookmarks during a run', async () => {
    const input = request();
    let report: AudienceComparisonReport | undefined;
    const result = await runAgent(input, {
      provider: fixtureProvider(
        [{ name: 'compare_viewpoints', args: comparison }],
        (items, step) => {
          if (step === 0) {
            input.viewer!.current.aspect = 4;
            input.viewer!.savedViews[0].snapshot.pose.yaw = 180;
            input.viewer!.savedViews[1].name = 'Changed afterward';
          } else report = outputs(items)[0].result;
        }
      ),
    });
    expect(result.status).toBe('completed');
    expect(report!.views[0]).toMatchObject({ aspect: 1, snapshot: { pose: { yaw: 0 } } });
    expect(report!.views[1]).toMatchObject({
      name: 'East view',
      aspect: 1,
      snapshot: { pose: { yaw: 90 } },
    });
  });

  it('repairs an unknown ID using captured discovery and keeps the comparison read-only', async () => {
    let toolOutputs: ToolOutput[] = [];
    const result = await runAgent(request(), {
      provider: fixtureProvider(
        [
          { name: 'compare_viewpoints', args: { ...comparison, viewIds: ['missing'] } },
          { name: 'inspect_show', args: {} },
          { name: 'compare_viewpoints', args: { ...comparison, viewIds: ['', 'east-view'] } },
        ],
        (items) => {
          toolOutputs = outputs(items);
        }
      ),
    });
    expect(result.status).toBe('completed');
    expect(toolOutputs[0]).toMatchObject({ ok: false, retryable: true });
    expect(toolOutputs[0].error).toContain('inspect_show');
    expect(toolOutputs[2]).toMatchObject({
      ok: true,
      result: { views: [{ id: '' }, { id: 'east-view' }] },
    });
    expect(result.proposal).toBeUndefined();
  });

  it.each([
    { viewIds: [] },
    { viewIds: ['', ''] },
    { viewIds: ['a', 'b', 'c', 'd', 'e'] },
    { viewIds: ['x'.repeat(81)] },
    { samples: 1 },
    { samples: 13 },
    { samples: 2.5 },
    { start: -1 },
    { end: 0 },
    { start: 2, end: 1 },
    { end: 5 },
    { end: Infinity },
    { roll: 0 },
  ])('rejects malformed range or view bounds without modifying state: %j', async (patch) => {
    const state = draft(),
      before = structuredClone(state);
    await expect(
      Promise.resolve().then(() =>
        executeAgentTool(
          'compare_viewpoints',
          { ...comparison, ...patch },
          state,
          defaultAgentLimits
        )
      )
    ).rejects.toThrow();
    expect(state).toEqual(before);
  });

  it('reports absent captured context without guessing a camera', () => {
    const state = draft();
    state.viewer = undefined;
    expect(() =>
      executeAgentTool('compare_viewpoints', comparison, state, defaultAgentLimits)
    ).toThrow('No audience viewpoint was captured');
  });

  it('enforces the tool result budget after an awaited comparison', async () => {
    const input = request(),
      before = structuredClone(input);
    let toolOutputs: ToolOutput[] = [];
    const result = await runAgent(input, {
      provider: fixtureProvider([{ name: 'compare_viewpoints', args: comparison }], (items) => {
        toolOutputs = outputs(items);
      }),
      limits: { maxToolResultChars: 128 },
    });
    expect(result.status).toBe('completed');
    expect(toolOutputs[0]).toMatchObject({ ok: false, retryable: true });
    expect(toolOutputs[0].error).toContain('response budget');
    expect(
      result.events.some(
        (event) => event.type === 'tool_result' && event.tool === 'compare_viewpoints'
      )
    ).toBe(false);
    expect(result.proposal).toBeUndefined();
    expect(input).toEqual(before);
  });

  it('aborts an in-progress comparison without subsequent tools or a late proposal', async () => {
    vi.useFakeTimers();
    try {
      const input = request(),
        before = structuredClone(input),
        controller = new AbortController();
      const complete = vi.fn(
        fixtureProvider([
          { name: 'compare_viewpoints', args: comparison },
          {
            name: 'stage_operations',
            args: {
              operationsJson: JSON.stringify([{ type: 'rename', name: 'Must never run' }]),
              explanation: 'Must not run after cancellation.',
            },
          },
        ]).complete
      );
      let started = false;
      const pending = runAgent(input, {
        provider: { complete },
        signal: controller.signal,
        onEvent(event) {
          if (event.type === 'tool_start' && event.tool === 'compare_viewpoints') started = true;
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(started).toBe(true);
      controller.abort();
      const result = await pending;
      expect(result.status).toBe('cancelled');
      expect(result.proposal).toBeUndefined();
      expect(complete).toHaveBeenCalledTimes(1);
      expect(
        result.events.some(
          (event) => event.type === 'tool_result' && event.tool === 'compare_viewpoints'
        )
      ).toBe(false);
      await vi.runAllTimersAsync();
      expect(complete).toHaveBeenCalledTimes(1);
      expect(input).toEqual(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
