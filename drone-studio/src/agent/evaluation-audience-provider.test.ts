import { describe, expect, it } from 'vitest';
import { audienceEvaluation, createAudienceEvaluationProvider } from './evaluation-audience';
import { runAgent } from './harness';
import type { AgentProvider } from './types';

describe('responsive scripted audience evaluation provider', () => {
  it('chooses the current view when actual comparisons make north the weaker view', async () => {
    const { request } = audienceEvaluation.fixture();
    const edits = request.project.cues[0].droneEdits!;
    for (const id of [1, 2, 3]) edits[id].brightness = 0;
    for (const id of request.selection) {
      edits[id].position![1] = Math.abs(edits[id].position![1]);
      for (const key of edits[id].keyframes!)
        if (key.position) key.position[1] = Math.abs(key.position[1]);
    }
    const before = structuredClone(request);
    const result = await runAgent(request, { provider: createAudienceEvaluationProvider(request) });
    expect(result.status).toBe('completed');
    const inspection = result.events.find(
      (event) => event.type === 'tool_result' && event.tool === 'inspect_viewpoint'
    );
    expect(inspection?.details).toMatchObject({ viewId: '' });
    expect(result.proposal?.operations).toEqual(
      [0, 1, 2].map((time) => ({
        type: 'set_keyframe',
        cueId: request.cueId,
        ids: [4, 5],
        keyframe: { time, brightness: 1 },
      }))
    );
    expect(result.message).toContain('not a model-quality result');
    expect(request).toEqual(before);
  });

  it('intersects actual dark in-frustum rows with the supplied selection rather than hard-coding IDs', async () => {
    const { request } = audienceEvaluation.fixture();
    request.selection = [4, 6];
    for (const key of request.project.cues[0].droneEdits![4].keyframes!)
      if (key.time <= 2) key.brightness = 1;
    const before = structuredClone(request);
    const result = await runAgent(request, { provider: createAudienceEvaluationProvider(request) });
    expect(result.status).toBe('completed');
    expect(result.proposal?.operations).toEqual(
      [0, 1, 2].map((time) => ({
        type: 'set_keyframe',
        cueId: request.cueId,
        ids: [6],
        keyframe: { time, brightness: 1 },
      }))
    );
    expect(request).toEqual(before);
  });

  it('fails without staging when the measured weaker view contains no selected dark drones', async () => {
    const { request } = audienceEvaluation.fixture();
    request.selection = [1, 2, 3];
    const before = structuredClone(request);
    const result = await runAgent(request, { provider: createAudienceEvaluationProvider(request) });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('no selected dark drones');
    expect(result.proposal).toBeUndefined();
    expect(
      result.events.filter((event) => event.type === 'tool_start').map((event) => event.tool)
    ).toEqual(['compare_viewpoints', 'inspect_viewpoint']);
    expect(request).toEqual(before);
  });

  it('refuses a proposal when the returned after-comparison fails one required sample', async () => {
    const { request } = audienceEvaluation.fixture();
    const before = structuredClone(request);
    const fixture = createAudienceEvaluationProvider(request);
    const provider: AgentProvider = {
      async complete(input) {
        const changed = structuredClone(input.input);
        for (const item of changed) {
          const entry = item as { type?: string; call_id?: string; output?: string };
          if (entry.type !== 'function_call_output' || entry.call_id !== 'audience-fixture-4')
            continue;
          const output = JSON.parse(entry.output!);
          const weak = output.result.views.find((view: { id: string }) => view.id === 'south-view');
          weak.samples[1].totals.inFrustumLightsOn = 1;
          entry.output = JSON.stringify(output);
        }
        return fixture.complete({ ...input, input: changed });
      },
    };
    const result = await runAgent(request, { provider });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('did not improve every weaker-view sample');
    expect(result.proposal).toBeUndefined();
    expect(result.events.some((event) => event.tool === 'finish_proposal')).toBe(false);
    expect(request).toEqual(before);
  });

  it('creates fresh independent fixtures and manually expected documents', () => {
    const first = audienceEvaluation.fixture(),
      second = audienceEvaluation.fixture();
    expect(first.request.project.revision).toBe(7);
    expect(first.expected).not.toBe(first.request.project);
    for (const id of [4, 5]) {
      expect(
        first.expected.cues[0].droneEdits![id].keyframes!.slice(0, 3).map((key) => key.brightness)
      ).toEqual([1, 1, 1]);
      expect(
        first.request.project.cues[0]
          .droneEdits![id].keyframes!.slice(0, 3)
          .map((key) => key.brightness)
      ).toEqual([0, 0, 0]);
      expect(first.expected.cues[0].droneEdits![id].keyframes![3]).toEqual(
        first.request.project.cues[0].droneEdits![id].keyframes![3]
      );
    }
    expect(first.expected.cues[0].droneEdits![6]).toEqual(
      first.request.project.cues[0].droneEdits![6]
    );
    expect(first.expected.cues[0].droneEdits![9]).toEqual(
      first.request.project.cues[0].droneEdits![9]
    );
    first.request.viewer!.savedViews[0].snapshot.pose.yaw = 45;
    first.expected.cues[0].droneEdits![4].keyframes![0].brightness = 0.5;
    expect(second.request.viewer!.savedViews[0].snapshot.pose.yaw).toBe(180);
    expect(second.expected.cues[0].droneEdits![4].keyframes![0].brightness).toBe(1);
  });
});
