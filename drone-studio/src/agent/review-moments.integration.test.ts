import { describe, expect, it } from 'vitest';
import { applyOperations } from '../core/commands';
import { defaultProject } from '../core/model';
import { inspectAudienceFrame } from '../core/audience-inspection';
import { DEFAULT_VIEWER_POSE, DEFAULT_VENUE_PLACEMENT } from '../core/viewer';
import { createRehearsalProvider, runAgent } from './harness';
import { buildAgentReviewMoments } from './review-moments';
import type { AgentProvider, AgentRequest } from './types';

function fixture(): AgentRequest {
  const project = structuredClone(defaultProject);
  project.revision = 9;
  project.droneCount = 7;
  project.cues = [
    { ...project.cues[0], id: 'opening', duration: 4, transition: 0 },
    { ...project.cues[1], id: 'detail', duration: 6, transition: 2 },
  ];
  return {
    project,
    prompt: 'Inspect the audience before and after the edit.',
    cueId: 'detail',
    selection: [],
    time: 6,
    viewer: {
      current: {
        snapshot: { pose: { ...DEFAULT_VIEWER_POSE }, venue: { ...DEFAULT_VENUE_PLACEMENT } },
        aspect: 1.6,
      },
      savedViews: [
        {
          id: 'rear',
          name: 'Rear audience',
          snapshot: {
            pose: { ...DEFAULT_VIEWER_POSE, yaw: 180 },
            venue: { ...DEFAULT_VENUE_PLACEMENT },
          },
        },
      ],
    },
  };
}

function provider(calls: { id: string; tool: string; args: object }[]): AgentProvider {
  let step = 0;
  return {
    async complete() {
      const next = calls[step++];
      if (!next) throw new Error('Fixture exhausted before a completed proposal.');
      const call = { id: next.id, name: next.tool, arguments: JSON.stringify(next.args) };
      return {
        output: [
          { type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments },
        ],
        calls: [call],
        text: '',
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

describe('review moments from completed harness runs', () => {
  it('exposes the default rehearsal inspection as Before using actual captured measurements', async () => {
    const request = fixture();
    const original = structuredClone(request);
    const result = await runAgent(request, { provider: createRehearsalProvider(request) });
    expect(result.status).toBe('completed');
    const draft = applyOperations(
      request.project,
      result.proposal!.operations,
      result.proposal!.revision
    );
    const moments = buildAgentReviewMoments(request.project, draft, result);
    expect(moments).toHaveLength(1);
    const expected = inspectAudienceFrame(
      request.project,
      6,
      request.viewer!.current.snapshot,
      1.6,
      1
    );
    expect(moments[0]).toMatchObject({
      version: 'base',
      tool: 'inspect_viewpoint',
      kind: 'inspection',
      time: 6,
      viewId: '',
      snapshot: request.viewer!.current.snapshot,
      aspect: 1.6,
      inFrameLights: expected.totals.inFrustumLightsOn,
      droneCount: 7,
    });
    expect(result.events.find((event) => event.id === moments[0].eventId)).toMatchObject({
      type: 'tool_result',
      callId: moments[0].callId,
      tool: 'inspect_viewpoint',
    });
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(request).toEqual(original);
  });

  it('omits an intermediate draft even when it shares the final draft revision', async () => {
    const request = fixture();
    const result = await runAgent(request, {
      provider: provider([
        { id: 'before', tool: 'inspect_viewpoint', args: { time: 0.5, viewId: '', limit: 1 } },
        {
          id: 'first-edit',
          tool: 'stage_operations',
          args: {
            operationsJson: JSON.stringify([{ type: 'retime_cue', id: 'detail', speed: 2 }]),
            explanation: 'Speed up the scene.',
          },
        },
        {
          id: 'intermediate',
          tool: 'inspect_viewpoint',
          args: { time: 1, viewId: 'rear', limit: 1 },
        },
        {
          id: 'second-edit',
          tool: 'stage_operations',
          args: {
            operationsJson: JSON.stringify([{ type: 'retime_cue', id: 'detail', speed: 0.5 }]),
            explanation: 'Restore original timing.',
          },
        },
        { id: 'after', tool: 'inspect_viewpoint', args: { time: 6, viewId: 'rear', limit: 1 } },
        {
          id: 'compare',
          tool: 'compare_viewpoints',
          args: { start: 1, end: 3, samples: 3, viewIds: ['', 'rear'] },
        },
        { id: 'review', tool: 'review_draft', args: {} },
        {
          id: 'finish',
          tool: 'finish_proposal',
          args: {
            title: 'Review the measured views',
            description:
              'Two timing commands return the show to its original timing. Numerical audience measurements are available.',
            changes: ['Inspect original and completed draft audience views.'],
          },
        },
      ]),
    });
    expect(result.status).toBe('completed');
    const draft = applyOperations(
      request.project,
      result.proposal!.operations,
      result.proposal!.revision
    );
    const moments = buildAgentReviewMoments(request.project, draft, result);
    expect(moments.some((moment) => moment.callId === 'before' && moment.version === 'base')).toBe(
      true
    );
    expect(moments.some((moment) => moment.callId === 'intermediate')).toBe(false);
    const after = moments.find((moment) => moment.callId === 'after')!;
    const expected = inspectAudienceFrame(draft, 6, request.viewer!.savedViews[0].snapshot, 1.6, 1);
    expect(after).toMatchObject({
      version: 'draft',
      time: 6,
      inFrameLights: expected.totals.inFrustumLightsOn,
    });
    const comparisons = moments.filter((moment) => moment.callId === 'compare');
    expect(comparisons.length).toBeGreaterThanOrEqual(2);
    for (const moment of comparisons) {
      expect(moment.version).toBe('draft');
      expect([1, 2, 3]).toContain(moment.time);
      expect(moment.inFrameLights).toBe(
        inspectAudienceFrame(draft, moment.time, moment.snapshot, moment.aspect, 1).totals
          .inFrustumLightsOn
      );
    }
  });

  it('does not relabel a continued draft inspection as the original show', async () => {
    const request = fixture();
    request.previousDraft = {
      projectId: request.project.id,
      revision: request.project.revision,
      operations: [{ type: 'retime_cue', id: 'detail', speed: 1.25 }],
    };
    const result = await runAgent(request, { provider: createRehearsalProvider(request) });
    expect(result.status).toBe('completed');
    expect(result.proposal!.operations).toHaveLength(2);
    const draft = applyOperations(
      request.project,
      result.proposal!.operations,
      result.proposal!.revision
    );
    expect(buildAgentReviewMoments(request.project, draft, result)).toEqual([]);
  });
});
