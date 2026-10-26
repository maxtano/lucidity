import { describe, expect, it, vi } from 'vitest';
import { applyOperations, type Operation } from '../core/commands';
import { defaultProject } from '../core/model';
import { runAgent } from './harness';
import type { AgentProvider, AgentRequest } from './types';

function fixture(): AgentRequest {
  const project = structuredClone(defaultProject);
  project.droneCount = 4;
  project.cues = [{ ...project.cues[0], duration: 8, transition: 0 }];
  return {
    project,
    prompt: 'Make this draft slower and brighter.',
    cueId: project.cues[0].id,
    selection: [1, 3],
    time: 7,
  };
}

type Step = { name: string; args: object };
function provider(
  steps: Step[],
  inspect?: (input: unknown[], step: number) => void
): AgentProvider {
  let index = 0;
  return {
    async complete({ input }) {
      inspect?.(input, index);
      const step = steps[index++];
      if (!step) return { output: [], calls: [], text: 'Finished.' };
      const call = {
        id: `continuation-${index}`,
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
const stage = (operations: Operation[]): Step => ({
  name: 'stage_operations',
  args: { operationsJson: JSON.stringify(operations), explanation: 'Refine the existing draft.' },
});
const review: Step = { name: 'review_draft', args: {} };
const finish: Step = {
  name: 'finish_proposal',
  args: {
    title: 'Refined light study',
    description: 'A private refinement for review.',
    changes: ['Retained the previous edits and refined timing.'],
  },
};

describe('exact private draft continuation', () => {
  it('retains exact prior edits and combines a refinement into one revision against the saved show', async () => {
    const request = fixture();
    const first: Operation = {
      type: 'edit_drones',
      cueId: request.cueId,
      ids: [1, 3],
      patch: { color: '#50d6ff' },
    };
    request.previousDraft = {
      projectId: request.project.id,
      revision: request.project.revision,
      operations: [first],
    };
    const before = structuredClone(request);
    const second: Operation = { type: 'retime_cue', id: request.cueId, speed: 0.5 };
    const result = await runAgent(request, {
      provider: provider([stage([second]), review, finish]),
    });
    expect(result.status).toBe('completed');
    expect(result.proposal?.operations).toEqual([first, second]);
    expect(result.proposal?.revision).toBe(request.project.revision);
    const applied = applyOperations(
      request.project,
      result.proposal!.operations,
      result.proposal!.revision
    );
    expect(applied.revision).toBe(request.project.revision + 1);
    expect(applied.cues[0]).toMatchObject({
      duration: 16,
      droneEdits: { 1: { color: '#50d6ff' }, 3: { color: '#50d6ff' } },
    });
    expect(request).toEqual(before);
  });

  it('presents the actual continued snapshot and clamps editor time after a draft retime', async () => {
    const request = fixture();
    request.previousDraft = {
      projectId: request.project.id,
      revision: 0,
      operations: [{ type: 'retime_cue', id: request.cueId, speed: 2 }],
    };
    let context: any;
    const result = await runAgent(request, {
      provider: provider([review, finish], (input, step) => {
        if (step === 0) context = JSON.parse((input.at(-1) as { content: string }).content);
      }),
    });
    expect(result.status).toBe('completed');
    expect(context.projectSnapshot.duration).toBe(4);
    expect(context.editorContext.time).toBe(4);
    expect(context.continuedDraft.retainedOperations).toBe(1);
    expect(result.events[0].message).toContain('1 retained commands');
  });

  it('requires a new review even when retaining a previously reviewed proposal', async () => {
    const request = fixture();
    request.previousDraft = {
      projectId: request.project.id,
      revision: 0,
      operations: [{ type: 'rename', name: 'Retained draft' }],
    };
    const result = await runAgent(request, { provider: provider([finish, review, finish]) });
    expect(result.status).toBe('completed');
    expect(
      result.events.some(
        (event) =>
          event.type === 'validation_error' && event.message.includes('Review the latest draft')
      )
    ).toBe(true);
  });

  it.each([
    { projectId: 'another-project', revision: 0 },
    { projectId: defaultProject.id, revision: 1 },
  ])(
    'rejects stale or cross-project continuation before contacting a provider: %j',
    async (identity) => {
      const request = fixture();
      request.previousDraft = { ...identity, operations: [{ type: 'rename', name: 'Wrong base' }] };
      const complete = vi.fn();
      const result = await runAgent(request, { provider: { complete } });
      expect(result.status).toBe('failed');
      expect(result.message).toContain('out of date');
      expect(result.proposal).toBeUndefined();
      expect(complete).not.toHaveBeenCalled();
    }
  );

  it('rejects malformed or over-budget retained commands without provider access or caller mutation', async () => {
    for (const operations of [
      [{ type: 'rename', name: 'Unknown extra', sideEffect: true }],
      [{ type: 'set_fleet', count: -1 }],
      [
        { type: 'rename', name: 'One' },
        { type: 'rename', name: 'Two' },
      ],
    ]) {
      const request = fixture();
      request.previousDraft = { projectId: request.project.id, revision: 0, operations };
      const before = structuredClone(request);
      const complete = vi.fn();
      const result = await runAgent(request, {
        provider: { complete },
        limits: { maxOperations: 1 },
      });
      expect(result.status).toBe('failed');
      expect(complete).not.toHaveBeenCalled();
      expect(request).toEqual(before);
    }
  });
});
