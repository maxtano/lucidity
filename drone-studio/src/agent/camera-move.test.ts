import { describe, expect, it, vi } from 'vitest';
import type { CameraMoveReport } from '../core/camera-move-inspection';
import { defaultProject } from '../core/model';
import { defaultAgentLimits, runAgent } from './harness';
import { agentTools, executeAgentTool } from './tools';
import type { AgentDraft, AgentProvider, AgentRequest } from './types';

type ToolReport = CameraMoveReport & { fromViewId: string; toViewId: string };
type ToolOutput = { ok: boolean; retryable?: boolean; error?: string; result?: ToolReport };
type Step = { name: string; args: unknown };
const move = {
  fromViewId: '',
  toViewId: 'east-view',
  duration: 8,
  easing: 'linear',
  start: 0,
  end: 2,
  samples: 3,
};
function request(): AgentRequest {
  const project = structuredClone(defaultProject);
  project.id = 'camera-agent-fixture';
  project.revision = 7;
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
    prompt: 'Inspect a camera move following the opening lights.',
    cueId: project.cues[0].id,
    selection: [],
    time: 0,
    viewer: {
      current: { snapshot, aspect: 1 },
      savedViews: [
        {
          id: 'east-view',
          name: 'East audience',
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
    viewer: input.viewer,
    selection: [],
    operations: [],
    explanations: [],
    reviewedOperationCount: -1,
    reviewLimited: false,
  };
}
function outputs(input: unknown[]): ToolOutput[] {
  return input
    .filter((item) => (item as { type?: string }).type === 'function_call_output')
    .map((item) => JSON.parse((item as { output: string }).output));
}
function provider(steps: Step[], visit?: (input: unknown[], index: number) => void): AgentProvider {
  let index = 0;
  return {
    async complete({ input }) {
      visit?.(input, index);
      const step = steps[index++];
      if (!step) return { calls: [], output: [], text: 'Scripted camera inspection complete.' };
      const call = { id: `camera-${index}`, name: step.name, arguments: JSON.stringify(step.args) };
      return {
        calls: [call],
        text: '',
        output: [
          { type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments },
        ],
      };
    },
  };
}
function invoke(state: AgentDraft, args: unknown = move, signal?: AbortSignal) {
  return Promise.resolve().then(() =>
    executeAgentTool('inspect_camera_move', args, state, defaultAgentLimits, signal)
  ) as Promise<ToolReport>;
}

describe('read-only camera move agent inspection', () => {
  it('runs through the real harness with independently known geometry and exact compact evidence', async () => {
    const input = request(),
      before = structuredClone(input);
    let report: ToolReport | undefined;
    const result = await runAgent(input, {
      provider: provider([{ name: 'inspect_camera_move', args: move }], (items) => {
        report = outputs(items).at(-1)?.result;
      }),
    });
    expect(result.status).toBe('completed');
    expect(result.proposal).toBeUndefined();
    expect(report).toMatchObject({
      projectId: input.project.id,
      revision: 7,
      fromViewId: '',
      toViewId: 'east-view',
      request: {
        plan: {
          from: input.viewer!.current.snapshot,
          to: input.viewer!.savedViews[0].snapshot,
          duration: 8,
          easing: 'linear',
        },
        aspect: 1,
        fromName: 'Captured current viewpoint',
        toName: 'East audience',
        start: 0,
        end: 2,
        samples: 3,
      },
    });
    // Drone 1 follows north→northeast→east with the camera. Drone 2 enters the
    // east-facing final frame lit; at the midpoint it is45° outside a30° half-FOV.
    expect(
      report!.samples.map((row) => [row.cameraTime, row.showTime, row.snapshot.pose.yaw])
    ).toEqual([
      [0, 0, 0],
      [4, 1, 45],
      [8, 2, 90],
    ]);
    expect(report!.samples.map((row) => row.totals.inFrustum)).toEqual([1, 1, 2]);
    expect(report!.samples.map((row) => row.totals.inFrustumLightsOn)).toEqual([1, 1, 2]);
    expect(report!.summary).toEqual({
      minInFrameLights: 1,
      maxInFrameLights: 2,
      meanInFrameLights: 4 / 3,
      minIndex: 0,
      maxIndex: 2,
    });
    const details = result.events.find(
      (event) => event.type === 'tool_result' && event.tool === 'inspect_camera_move'
    )!.details;
    expect(details).toEqual({
      provenance: { projectId: input.project.id, baseRevision: 7, revision: 7, operationCount: 0 },
      projectId: input.project.id,
      revision: 7,
      fromViewId: '',
      toViewId: 'east-view',
      request: report!.request,
      mapping: [
        { cameraTime: 0, showTime: 0, inFrameLights: 1 },
        { cameraTime: 4, showTime: 1, inFrameLights: 1 },
        { cameraTime: 8, showTime: 2, inFrameLights: 2 },
      ],
      summary: report!.summary,
      limitations: report!.limitations,
    });
    expect(JSON.stringify(details)).not.toContain('"totals":');
    expect(JSON.stringify(report)).not.toContain('"drones":');
    expect(JSON.stringify(details).length).toBeLessThan(6000);
    expect(input).toEqual(before);
    expect(agentTools).toHaveLength(15);
    expect(
      agentTools.find((tool) => tool.name === 'inspect_camera_move')!.parameters
    ).toMatchObject({
      additionalProperties: false,
      required: ['fromViewId', 'toViewId', 'duration', 'easing', 'start', 'end', 'samples'],
    });
  });

  it('holds show time while sampling camera motion, with dark geometry counted separately', async () => {
    const report = await invoke(draft(), { ...move, end: 0 });
    expect(report.samples.map((row) => row.showTime)).toEqual([0, 0, 0]);
    expect(report.samples.map((row) => row.totals.inFrustum)).toEqual([1, 0, 1]);
    expect(report.samples.map((row) => row.totals.inFrustumLightsOn)).toEqual([1, 0, 0]);
    expect(report.summary).toEqual({
      minInFrameLights: 0,
      maxInFrameLights: 1,
      meanInFrameLights: 1 / 3,
      minIndex: 1,
      maxIndex: 0,
    });
  });

  it('inspects the current private draft without invalidating its completed review', async () => {
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
      commands = state.operations;
    const report = await invoke(state);
    expect(report.revision).toBe(8);
    expect(report.samples.map((row) => row.totals.inFrustumLightsOn)).toEqual([0, 0, 1]);
    expect(state).toEqual(before);
    expect(state.review).toBe(review);
    expect(state.operations).toBe(commands);
    expect(() =>
      executeAgentTool(
        'finish_proposal',
        {
          title: 'Existing blackout',
          description: 'Sampled a camera move after design review.',
          changes: ['Existing blackout'],
        },
        state,
        defaultAgentLimits
      )
    ).not.toThrow();
  });

  it('finishes a reviewed proposal after camera inspection without another edit or review', async () => {
    const input = request(),
      before = structuredClone(input);
    const result = await runAgent(input, {
      provider: provider([
        {
          name: 'stage_operations',
          args: {
            operationsJson: JSON.stringify([{ type: 'rename', name: 'Reviewed camera study' }]),
            explanation: 'Name this study.',
          },
        },
        { name: 'review_draft', args: {} },
        { name: 'inspect_camera_move', args: move },
        {
          name: 'finish_proposal',
          args: {
            title: 'Camera study',
            description: 'Sampled camera geometry; no camera track authored.',
            changes: ['Rename the study'],
          },
        },
      ]),
    });
    expect(result.status).toBe('completed');
    expect(result.proposal?.operations).toEqual([
      { type: 'rename', name: 'Reviewed camera study' },
    ]);
    expect(
      result.events.find(
        (event) => event.tool === 'inspect_camera_move' && event.type === 'tool_result'
      )!.details
    ).toMatchObject({ provenance: { baseRevision: 7, revision: 8, operationCount: 1 } });
    expect(input).toEqual(before);
  });

  it('repairs an unknown saved ID with captured discovery and can inspect toward current view', async () => {
    let records: ToolOutput[] = [];
    const result = await runAgent(request(), {
      provider: provider(
        [
          { name: 'inspect_camera_move', args: { ...move, fromViewId: 'missing' } },
          { name: 'inspect_show', args: {} },
          { name: 'inspect_camera_move', args: { ...move, fromViewId: 'east-view', toViewId: '' } },
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
      result: {
        fromViewId: 'east-view',
        toViewId: '',
        request: { plan: { from: { pose: { yaw: 90 } }, to: { pose: { yaw: 0 } } } },
      },
    });
    expect(result.proposal).toBeUndefined();
  });

  it.each([
    { duration: 0.9 },
    { duration: 31 },
    { duration: Infinity },
    { easing: 'ease-in' },
    { start: -1 },
    { start: 2, end: 1 },
    { end: 5 },
    { start: NaN },
    { samples: 1 },
    { samples: 13 },
    { samples: 2.5 },
    { end: undefined },
    { fromViewId: 'x'.repeat(81) },
    { toViewId: 'missing' },
    { autoplay: true },
  ])('rejects malformed arguments without changing draft or context: %j', async (patch) => {
    const state = draft(),
      before = structuredClone(state);
    await expect(invoke(state, { ...move, ...patch })).rejects.toThrow();
    expect(state).toEqual(before);
  });

  it('rejects missing context and incompatible endpoint venue layouts without guessing', async () => {
    const state = draft();
    state.viewer!.savedViews[0].snapshot.venue.north++;
    const before = structuredClone(state);
    await expect(invoke(state)).rejects.toThrow(/identical venue/);
    expect(state).toEqual(before);
    state.viewer = undefined;
    await expect(invoke(state)).rejects.toThrow('No audience viewpoint was captured');
  });

  it('owns the captured request and returned evidence without aliasing live context', async () => {
    const state = draft(),
      before = structuredClone(state);
    const report = await invoke(state);
    report.request.plan.from.pose.yaw = 180;
    report.samples[0].snapshot.venue.north = 20;
    expect(state).toEqual(before);
    expect(report.request.plan.to.pose.yaw).toBe(90);
    expect(report.samples.at(-1)!.snapshot.venue.north).toBe(70);
    const maximal = await invoke(state, { ...move, samples: 12 });
    expect(JSON.stringify(maximal).length).toBeLessThan(defaultAgentLimits.maxToolResultChars);
  });

  it('enforces the existing output budget before publishing successful trace evidence', async () => {
    const input = request(),
      before = structuredClone(input);
    let records: ToolOutput[] = [];
    const result = await runAgent(input, {
      provider: provider([{ name: 'inspect_camera_move', args: move }], (items) => {
        records = outputs(items);
      }),
      limits: { maxToolResultChars: 128 },
    });
    expect(result.status).toBe('completed');
    expect(records[0]).toMatchObject({ ok: false, retryable: true });
    expect(records[0].error).toContain('response budget');
    expect(
      result.events.some(
        (event) => event.tool === 'inspect_camera_move' && event.type === 'tool_result'
      )
    ).toBe(false);
    expect(input).toEqual(before);
  });

  it('aborts between sampled frames without running later tools or publishing late evidence', async () => {
    vi.useFakeTimers();
    try {
      const input = request(),
        before = structuredClone(input),
        controller = new AbortController();
      const complete = vi.fn(
        provider([
          { name: 'inspect_camera_move', args: { ...move, samples: 12 } },
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
          if (event.type === 'tool_start' && event.tool === 'inspect_camera_move') started = true;
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
          (event) => event.type === 'tool_result' && event.tool === 'inspect_camera_move'
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
