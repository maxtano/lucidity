import { describe, expect, it, vi } from 'vitest';
import { applyOperations } from '../core/commands';
import { defaultProject } from '../core/model';
import { defaultAgentLimits, runAgent } from './harness';
import { agentTools, executeAgentTool, type AudienceSelectionPage } from './tools';
import type { AgentDraft, AgentProvider, AgentRequest } from './types';

const criteria = {
  time: 1,
  viewId: '',
  region: 'in_frame',
  lights: 'off',
  scope: 'fleet',
  offset: 0,
  limit: 40,
};
const expectedIds = Array.from({ length: 400 }, (_, index) => index + 1).filter(
  (id) => id % 3 !== 0 && id % 2 === 1
);
function request(): AgentRequest {
  const project = structuredClone(defaultProject);
  project.id = 'audience-selection-fixture';
  project.revision = 7;
  project.droneCount = 400;
  project.cues = [
    {
      ...project.cues[0],
      id: 'opening',
      duration: 4,
      transition: 0,
      droneEdits: Object.fromEntries(
        Array.from({ length: 400 }, (_, index) => {
          const id = index + 1;
          return [
            id,
            {
              position: [(id % 5) - 2, id % 3 === 0 ? -30 : 30, 3],
              color: '#aabbff',
              brightness: id % 2 ? 0 : 0.8,
            },
          ];
        })
      ),
    },
  ];
  project.cues[0].droneEdits![1].keyframes = [
    { time: 0, color: '#cc33ff' },
    { time: 2, color: '#33aaff', easing: 'smooth' },
  ];
  project.cues[0].droneEdits![500] = {
    position: [90, 80, 50],
    color: '#123456',
    brightness: 0.42,
    keyframes: [{ time: 6, position: [100, 100, 60], color: '#654321', easing: 'hold' }],
  };
  const snapshot = {
    pose: { east: 0, north: 0, eyeHeight: 2, yaw: 0, pitch: 0, fov: 60 },
    venue: { east: 0, north: 70, heading: 180 },
  };
  return {
    project,
    prompt: 'Find every dark in-frame drone, then brighten only those exact IDs.',
    cueId: 'opening',
    selection: [399, 1, 257, 301, 128, 11, 200, 398],
    time: 1,
    viewer: {
      current: { snapshot, aspect: 1 },
      savedViews: [
        {
          id: 'rear-view',
          name: 'Rear audience',
          snapshot: { ...structuredClone(snapshot), pose: { ...snapshot.pose, yaw: 180 } },
        },
      ],
    },
  };
}
function draft(): AgentDraft {
  const source = request();
  return {
    base: source.project,
    project: source.project,
    viewer: source.viewer,
    selection: source.selection,
    operations: [],
    explanations: [],
    reviewedOperationCount: -1,
    reviewLimited: false,
  };
}
function inspect(state: AgentDraft, args: unknown = criteria, signal?: AbortSignal) {
  return Promise.resolve().then(() =>
    executeAgentTool('inspect_audience_selection', args, state, defaultAgentLimits, signal)
  ) as Promise<AudienceSelectionPage>;
}
type Step = { name: string; args: unknown };
type Output = { ok: boolean; error?: string; retryable?: boolean; result?: AudienceSelectionPage };
function outputs(items: unknown[]): Output[] {
  return items
    .filter((item) => (item as { type?: string }).type === 'function_call_output')
    .map((item) => JSON.parse((item as { output: string }).output));
}
function call(step: Step, index: number) {
  const result = {
    id: `audience-selection-${index}`,
    name: step.name,
    arguments: JSON.stringify(step.args),
  };
  return {
    calls: [result],
    output: [
      { type: 'function_call', call_id: result.id, name: result.name, arguments: result.arguments },
    ],
    text: '',
  };
}
function provider(steps: Step[], visit?: (items: unknown[], index: number) => void): AgentProvider {
  let index = 0;
  return {
    async complete({ input }) {
      visit?.(input, index);
      const step = steps[index++];
      return step
        ? call(step, index)
        : { calls: [], output: [], text: 'Read-only audience filtering complete.' };
    },
  };
}

describe('exact audience selection agent tool', () => {
  it('returns every matching stable ID over multiple bounded pages without leaking off-page IDs or scope', async () => {
    const state = draft(),
      before = structuredClone(state);
    let offset = 0;
    const pages: AudienceSelectionPage[] = [];
    while (true) {
      const page = await inspect(state, { ...criteria, offset });
      pages.push(page);
      expect(page).toMatchObject({
        projectId: state.project.id,
        revision: 7,
        matchedCount: 133,
        consideredCount: 400,
        droneCount: 400,
        offset,
        limit: 40,
        request: { scope: 'fleet', time: 1, region: 'in_frame', lights: 'off' },
      });
      expect(page.ids.length).toBeLessThanOrEqual(40);
      expect(JSON.stringify(page)).not.toContain('scopeIds');
      if (!page.hasMore) {
        expect(page.nextOffset).toBeNull();
        break;
      }
      expect(page.nextOffset).toBe(offset + page.ids.length);
      offset = page.nextOffset!;
    }
    expect(pages.map((page) => page.ids.length)).toEqual([40, 40, 40, 13]);
    expect(pages.flatMap((page) => page.ids)).toEqual(expectedIds);
    expect(new Set(pages.flatMap((page) => page.ids)).size).toBe(133);
    expect(await inspect(state, { ...criteria, offset: 133 })).toMatchObject({
      ids: [],
      matchedCount: 133,
      hasMore: false,
      nextOffset: null,
    });
    expect(await inspect(state, { ...criteria, offset: 1000 })).toMatchObject({
      ids: [],
      matchedCount: 133,
      hasMore: false,
      nextOffset: null,
    });
    expect({ ...state, audienceTargets: undefined }).toEqual({
      ...before,
      audienceTargets: undefined,
    });
  });

  it('intersects the complete artist selection, excludes newly dormant IDs, and preserves a completed review', async () => {
    const state = draft();
    executeAgentTool(
      'stage_operations',
      {
        operationsJson: JSON.stringify([{ type: 'set_fleet', count: 300 }]),
        explanation: 'Retain authored dormant work.',
      },
      state,
      defaultAgentLimits
    );
    executeAgentTool('review_draft', {}, state, defaultAgentLimits);
    const before = structuredClone(state),
      review = state.review,
      originalSelection = state.selection;
    const page = await inspect(state, { ...criteria, scope: 'selection', limit: 128 });
    expect(page).toMatchObject({
      ids: [1, 11, 257],
      consideredCount: 5,
      matchedCount: 3,
      droneCount: 300,
      revision: 8,
      hasMore: false,
    });
    expect(JSON.stringify(page)).not.toContain('scopeIds');
    expect(page.request.scope).toBe('selection');
    expect({ ...state, audienceTargets: undefined }).toEqual({
      ...before,
      audienceTargets: undefined,
    });
    expect(state.review).toBe(review);
    expect(state.selection).toBe(originalSelection);
    expect(() =>
      executeAgentTool(
        'finish_proposal',
        {
          title: 'Reduced fleet',
          description: 'Filtered current geometry after the design review.',
          changes: ['Reduce fleet'],
        },
        state,
        defaultAgentLimits
      )
    ).not.toThrow();
  });

  it('uses artist-selected IDs beyond the initial 128-ID context preview', async () => {
    const input = request();
    input.selection = [...expectedIds].reverse();
    let records: Output[] = [];
    const result = await runAgent(input, {
      provider: provider(
        [
          {
            name: 'inspect_audience_selection',
            args: { ...criteria, scope: 'selection', limit: 128 },
          },
          {
            name: 'inspect_audience_selection',
            args: { ...criteria, scope: 'selection', offset: 128, limit: 128 },
          },
        ],
        (items) => {
          records = outputs(items);
        }
      ),
    });
    expect(result.status).toBe('completed');
    expect(records[0].result).toMatchObject({
      matchedCount: 133,
      consideredCount: 133,
      hasMore: true,
      nextOffset: 128,
    });
    expect(records[1].result).toMatchObject({
      matchedCount: 133,
      consideredCount: 133,
      hasMore: false,
      nextOffset: null,
    });
    expect(records.flatMap((record) => record.result!.ids)).toEqual(expectedIds);
    expect(input.selection).toEqual([...expectedIds].reverse());
  });

  it('captures the operation count before yielding and distinguishes successive drafts sharing one revision', async () => {
    const state = draft();
    const pending = executeAgentTool(
      'inspect_audience_selection',
      criteria,
      state,
      defaultAgentLimits
    ) as Promise<AudienceSelectionPage>;
    const rename = (name: string) =>
      executeAgentTool(
        'stage_operations',
        {
          operationsJson: JSON.stringify([{ type: 'rename', name }]),
          explanation: 'Append a draft edit.',
        },
        state,
        defaultAgentLimits
      );
    rename('First private draft');
    await expect(pending).rejects.toThrow('stale');
    expect(state.audienceTargets).toEqual([]);
    const first = await inspect(state);
    expect(first).toMatchObject({ revision: 8, stagedOperations: 1 });
    rename('Second private draft');
    const second = await inspect(state);
    expect(second).toMatchObject({ revision: 8, stagedOperations: 2 });
    expect(first.stagedOperations).toBe(1);
    expect(first.ids).toEqual(second.ids);
  });

  it('keeps an empty selected scope empty and resolves saved geometry using captured current aspect', async () => {
    const state = draft();
    state.selection = [];
    expect(await inspect(state, { ...criteria, scope: 'selection' })).toMatchObject({
      ids: [],
      matchedCount: 0,
      consideredCount: 0,
      droneCount: 400,
    });
    const rear = await inspect(state, { ...criteria, viewId: 'rear-view', limit: 128 });
    expect(rear.ids).toEqual(
      Array.from({ length: 400 }, (_, index) => index + 1).filter(
        (id) => id % 3 === 0 && id % 2 === 1
      )
    );
    expect(rear.request).toMatchObject({ aspect: 1, snapshot: { pose: { yaw: 180 } } });
    // Stage-relative front remains North even when the camera looks South.
    const front = await inspect(state, {
      ...criteria,
      viewId: 'rear-view',
      region: 'front',
      limit: 128,
    });
    expect(front.ids).toEqual(expectedIds.slice(0, 128));
    expect(front.matchedCount).toBe(133);
  });

  it('uses full paged evidence for a precise real-harness edit, preserving nonmatches and unrelated authored channels', async () => {
    const input = request(),
      original = structuredClone(input);
    const ids: number[] = [];
    let step = 0,
      phase: 'pages' | 'stage' | 'review' | 'finish' = 'pages';
    const result = await runAgent(input, {
      provider: {
        async complete({ input: items }) {
          step++;
          if (step === 1) return call({ name: 'inspect_audience_selection', args: criteria }, step);
          if (phase === 'pages') {
            const output = outputs(items).at(-1)!;
            if (!output.ok || !output.result) throw new Error('Expected exact page evidence.');
            ids.push(...output.result.ids);
            if (output.result.hasMore)
              return call(
                {
                  name: 'inspect_audience_selection',
                  args: { ...criteria, offset: output.result.nextOffset },
                },
                step
              );
            phase = 'stage';
            return call(
              {
                name: 'stage_operations',
                args: {
                  operationsJson: JSON.stringify([
                    { type: 'edit_drones', cueId: input.cueId, ids, patch: { brightness: 1 } },
                  ]),
                  explanation: 'Brighten only the complete exact matched ID set after paging.',
                },
              },
              step
            );
          }
          if (phase === 'stage') {
            phase = 'review';
            return call({ name: 'review_draft', args: {} }, step);
          }
          if (phase === 'review') {
            phase = 'finish';
            return call(
              {
                name: 'finish_proposal',
                args: {
                  title: 'Exact audience lighting',
                  description:
                    'All pages were gathered before staging. Geometry is sampled, not flight-qualified.',
                  changes: ['Brighten exact in-frame dark IDs'],
                },
              },
              step
            );
          }
          return { calls: [], output: [], text: 'Finished.' };
        },
      },
    });
    expect(result.status).toBe('completed');
    expect(ids).toEqual(expectedIds);
    const applied = applyOperations(input.project, result.proposal!.operations, 7);
    const expected = structuredClone(input.project);
    expected.revision++;
    for (const id of expectedIds) expected.cues[0].droneEdits![id].brightness = 1;
    expect(applied).toEqual(expected);
    expect(input).toEqual(original);
    const traces = result.events.filter(
      (event) => event.type === 'tool_result' && event.tool === 'inspect_audience_selection'
    );
    expect(traces).toHaveLength(4);
    expect(traces[0].details).toMatchObject({
      provenance: { projectId: input.project.id, baseRevision: 7, revision: 7, operationCount: 0 },
      stagedOperations: 0,
      matchedCount: 133,
      consideredCount: 400,
      offset: 0,
      nextOffset: 40,
      ids: expectedIds.slice(0, 40),
      request: { snapshot: input.viewer!.current.snapshot, aspect: 1, scope: 'fleet' },
    });
    expect(JSON.stringify(traces)).not.toContain('scopeIds');
    expect(agentTools).toHaveLength(15);
    expect(
      agentTools.find((tool) => tool.name === 'inspect_audience_selection')!.parameters
    ).toMatchObject({
      additionalProperties: false,
      required: ['time', 'viewId', 'region', 'lights', 'scope', 'offset', 'limit'],
    });
  });

  it('keeps original selection semantics after a filtered query rather than retargeting stage_selection_operation', async () => {
    const state = draft();
    const page = await inspect(state, { ...criteria, scope: 'selection', limit: 128 });
    expect(page.ids).toEqual([1, 11, 257, 301]);
    executeAgentTool(
      'stage_selection_operation',
      {
        operationJson: JSON.stringify({
          type: 'edit_drones',
          cueId: 'opening',
          patch: { color: '#00aaff' },
        }),
        explanation: 'Explicitly target the original artist selection.',
      },
      state,
      defaultAgentLimits
    );
    for (const id of state.selection)
      expect(state.project.cues[0].droneEdits![id].color).toBe('#00aaff');
    expect(state.project.cues[0].droneEdits![5].color).toBe('#aabbff');
  });

  it('repairs unknown view IDs without changing state and emits bounded exact criteria', async () => {
    let records: Output[] = [];
    const input = request(),
      original = structuredClone(input);
    const result = await runAgent(input, {
      provider: provider(
        [
          { name: 'inspect_audience_selection', args: { ...criteria, viewId: 'missing' } },
          { name: 'inspect_show', args: {} },
          {
            name: 'inspect_audience_selection',
            args: { ...criteria, scope: 'selection', limit: 128 },
          },
        ],
        (items) => {
          records = outputs(items);
        }
      ),
    });
    expect(result.status).toBe('completed');
    expect(records[0]).toMatchObject({ ok: false, retryable: true });
    expect(records[0].error).toContain('inspect_show');
    expect(records[2]).toMatchObject({
      ok: true,
      result: { ids: [1, 11, 257, 301], matchedCount: 4, consideredCount: 8 },
    });
    expect(JSON.stringify(records[2]).length).toBeLessThan(6000);
    expect(result.proposal).toBeUndefined();
    expect(input).toEqual(original);
  });

  it.each([
    { time: -1 },
    { time: 5 },
    { time: Infinity },
    { region: 'all' },
    { lights: 'dim' },
    { scope: 'visible' },
    { offset: -1 },
    { offset: 0.5 },
    { limit: 0 },
    { limit: 129 },
    { limit: 2.5 },
    { viewId: 'x'.repeat(81) },
    { scopeIds: [1] },
    { limit: undefined },
  ])('rejects invalid arguments without mutation: %j', async (patch) => {
    const state = draft(),
      before = structuredClone(state);
    await expect(inspect(state, { ...criteria, ...patch })).rejects.toThrow();
    expect(state).toEqual(before);
  });

  it('requires captured context and owns returned page/camera arrays', async () => {
    const state = draft(),
      before = structuredClone(state);
    const page = await inspect(state);
    page.ids[0] = 99999;
    page.request.snapshot.pose.yaw = 180;
    expect({ ...state, audienceTargets: undefined }).toEqual({
      ...before,
      audienceTargets: undefined,
    });
    expect((await inspect(state)).ids[0]).toBe(1);
    state.viewer = undefined;
    await expect(inspect(state)).rejects.toThrow('No audience viewpoint was captured');
  });

  it('enforces the normal result budget before successful trace publication', async () => {
    let records: Output[] = [];
    const result = await runAgent(request(), {
      provider: provider([{ name: 'inspect_audience_selection', args: criteria }], (items) => {
        records = outputs(items);
      }),
      limits: { maxToolResultChars: 128 },
    });
    expect(records[0]).toMatchObject({ ok: false, retryable: true });
    expect(records[0].error).toContain('response budget');
    expect(
      result.events.some(
        (event) => event.type === 'tool_result' && event.tool === 'inspect_audience_selection'
      )
    ).toBe(false);
  });

  it('cancels classification without publishing a partial page or running later edits', async () => {
    vi.useFakeTimers();
    try {
      const input = request(),
        controller = new AbortController();
      input.project.droneCount = 100000;
      const original = structuredClone(input);
      const complete = vi.fn(
        provider([
          { name: 'inspect_audience_selection', args: criteria },
          {
            name: 'stage_operations',
            args: {
              operationsJson: JSON.stringify([{ type: 'rename', name: 'Must not run' }]),
              explanation: 'Forbidden after cancel.',
            },
          },
        ]).complete
      );
      let started = false;
      const pending = runAgent(input, {
        provider: { complete },
        signal: controller.signal,
        onEvent(event) {
          if (event.type === 'tool_start' && event.tool === 'inspect_audience_selection')
            started = true;
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
          (event) => event.type === 'tool_result' && event.tool === 'inspect_audience_selection'
        )
      ).toBe(false);
      await vi.runAllTimersAsync();
      expect(complete).toHaveBeenCalledTimes(1);
      expect(input).toEqual(original);
    } finally {
      vi.useRealTimers();
    }
  });
});
