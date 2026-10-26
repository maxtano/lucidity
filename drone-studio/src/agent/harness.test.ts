import { describe, expect, it } from 'vitest';
import { defaultProject, type Project } from '../core/model';
import { applyOperations } from '../core/commands';
import { createRehearsalProvider, runAgent } from './harness';
import { agentTools, schemaToJSON } from './tools';
import { operationSchema } from '../core/commands';
import type { AgentProvider, AgentRequest } from './types';

function request(): AgentRequest {
  const project: Project = structuredClone(defaultProject);
  project.droneCount = 4;
  project.cues = [{ ...project.cues[0], duration: 4, transition: 0 }];
  return {
    project,
    prompt: 'Make the selected lights blue.',
    cueId: project.cues[0].id,
    selection: [1, 2],
    time: 1,
  };
}
type Step = { name: string; args: unknown };
function script(steps: Step[], visit?: (input: unknown[], index: number) => void): AgentProvider {
  let index = 0;
  return {
    async complete({ input }) {
      visit?.(input, index);
      const step = steps[index++];
      if (!step) return { output: [], calls: [], text: 'Done.' };
      const call = {
        id: `call-${index}`,
        name: step.name,
        arguments: typeof step.args === 'string' ? step.args : JSON.stringify(step.args),
      };
      return {
        output: [
          { type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments },
        ],
        calls: [call],
        text: '',
        usage: { inputTokens: 10, outputTokens: 2 },
      };
    },
  };
}
const stage = (operations: unknown[]): Step => ({
  name: 'stage_operations',
  args: { operationsJson: JSON.stringify(operations), explanation: 'Requested editing change.' },
});
const review: Step = { name: 'review_draft', args: {} };
const finish: Step = {
  name: 'finish_proposal',
  args: {
    title: 'Light study',
    description: 'Review before applying; design review remains incomplete.',
    changes: ['Changed selected lights'],
  },
};

describe('bounded editor agent', () => {
  it('stages multiple atomic batches, reviews, and returns exact revision-bound commands without mutating the caller', async () => {
    const req = request();
    const before = structuredClone(req);
    const operations = [
      { type: 'edit_drones', cueId: req.cueId, ids: [1, 2], patch: { color: '#3366ff' } },
      { type: 'retime_cue', id: req.cueId, speed: 2, scaleKeyframes: true, scaleTransition: true },
    ];
    const result = await runAgent(req, {
      provider: script([stage([operations[0]]), stage([operations[1]]), review, finish]),
    });
    expect(result.status).toBe('completed');
    expect(req).toEqual(before);
    expect(result.proposal).toMatchObject({ projectId: req.project.id, revision: 0, operations });
    expect(applyOperations(req.project, result.proposal!.operations).cues[0]).toMatchObject({
      duration: 2,
      droneEdits: { 1: { color: '#3366ff' } },
    });
    expect(result.review?.flightReady).toBe(false);
    expect(result.usage).toEqual({ inputTokens: 40, outputTokens: 8 });
  });

  it('feeds malformed JSON and schema failures back for repair while leaving staged work intact', async () => {
    const req = request();
    const errors: unknown[] = [];
    const result = await runAgent(req, {
      provider: script(
        [
          { name: 'stage_operations', args: '{' },
          stage([{ type: 'set_fleet', count: -1 }]),
          stage([{ type: 'rename', name: 'Blue hour' }]),
          review,
          finish,
        ],
        (input) => {
          const last = input.at(-1) as { type?: string; output?: string };
          if (last?.type === 'function_call_output' && last.output)
            errors.push(JSON.parse(last.output));
        }
      ),
    });
    expect(result.status).toBe('completed');
    expect(errors.filter((value) => (value as { ok: boolean }).ok === false)).toHaveLength(2);
    expect(result.proposal?.operations).toEqual([{ type: 'rename', name: 'Blue hour' }]);
    expect(result.events.filter((event) => event.type === 'validation_error')).toHaveLength(2);
  });

  it('fails closed on unknown tools and undeclared command properties', async () => {
    const result = await runAgent(request(), {
      provider: script([
        { name: 'run_shell', args: { command: 'touch surprise' } },
        stage([{ type: 'rename', name: 'Wrong', execute: 'anything' }]),
        finish,
      ]),
    });
    expect(result.proposal).toBeUndefined();
    expect(
      result.events
        .filter((event) => event.type === 'validation_error')
        .map((event) => event.message)
        .join('\n')
    ).toContain('Unknown tool');
    expect(result.events.some((event) => event.message.includes('Unknown command property'))).toBe(
      true
    );
  });

  it('preserves opaque provider continuation items but never emits them in events', async () => {
    const reasoning = {
      type: 'reasoning',
      id: 'r1',
      encrypted_content: 'opaque-test-payload',
      summary: [],
    };
    let turn = 0;
    const provider: AgentProvider = {
      async complete({ input }) {
        if (turn++) {
          expect(input).toContainEqual(reasoning);
          expect(input.at(-1)).toMatchObject({ type: 'function_call_output', call_id: 'inspect1' });
          return { output: [], calls: [], text: 'The show has one scene.' };
        }
        return {
          output: [
            reasoning,
            { type: 'function_call', call_id: 'inspect1', name: 'inspect_show', arguments: '{}' },
          ],
          calls: [{ id: 'inspect1', name: 'inspect_show', arguments: '{}' }],
          text: '',
        };
      },
    };
    const result = await runAgent(request(), { provider });
    expect(result.status).toBe('completed');
    expect(JSON.stringify(result.events)).not.toContain('opaque-test-payload');
  });

  it('rejects finishing until the latest draft is reviewed', async () => {
    const result = await runAgent(request(), {
      provider: script([
        stage([{ type: 'rename', name: 'First' }]),
        finish,
        review,
        stage([{ type: 'rename', name: 'Second' }]),
        finish,
        review,
        finish,
      ]),
    });
    expect(result.status).toBe('completed');
    expect(result.proposal?.operations).toHaveLength(2);
    expect(result.events.filter((event) => event.type === 'validation_error')).toHaveLength(2);
  });

  it('rolls back every command in a batch when a later command is invalid', async () => {
    const result = await runAgent(request(), {
      provider: script([
        stage([
          { type: 'rename', name: 'Do not retain' },
          { type: 'remove_cue', id: 'missing' },
        ]),
        stage([{ type: 'set_tempo', bpm: 100 }]),
        review,
        finish,
      ]),
    });
    expect(result.proposal?.operations).toEqual([{ type: 'set_tempo', bpm: 100 }]);
  });

  it('enforces turn, tool, operation, output and context budgets', async () => {
    const req = request();
    const turnResult = await runAgent(req, {
      provider: script(Array.from({ length: 10 }, () => ({ name: 'inspect_show', args: {} }))),
      limits: { maxTurns: 2 },
    });
    expect(turnResult.message).toContain('turn budget');
    const toolResult = await runAgent(req, {
      provider: script([{ name: 'inspect_show', args: {} }, review]),
      limits: { maxToolCalls: 1 },
    });
    expect(toolResult.message).toContain('tool-call budget');
    const operationResult = await runAgent(req, {
      provider: script([
        stage([
          { type: 'rename', name: 'One' },
          { type: 'set_tempo', bpm: 100 },
        ]),
        finish,
      ]),
      limits: { maxOperations: 1 },
    });
    expect(operationResult.proposal).toBeUndefined();
    expect(
      operationResult.events.some((event) => event.message.includes('at most 1 commands'))
    ).toBe(true);
    const outputResult = await runAgent(req, {
      provider: {
        async complete() {
          return { output: [], calls: [], text: 'x'.repeat(2000) };
        },
      },
      limits: { maxResponseChars: 1000 },
    });
    expect(outputResult.message).toContain('output budget');
    const contextResult = await runAgent(req, {
      provider: script([]),
      limits: { maxContextChars: 10 },
    });
    expect(contextResult.message).toContain('context budget');
  });

  it('cancels an in-flight provider even if it ignores the abort signal', async () => {
    const controller = new AbortController();
    const pending = runAgent(request(), {
      signal: controller.signal,
      provider: { complete: () => new Promise(() => {}) },
    });
    controller.abort();
    const result = await pending;
    expect(result.status).toBe('cancelled');
    expect(result.proposal).toBeUndefined();
  });

  it('rolls back a private mutation if its tool result exceeds the budget', async () => {
    const result = await runAgent(request(), {
      provider: script([
        stage([{ type: 'rename', name: 'Never staged successfully' }]),
        review,
        finish,
      ]),
      limits: { maxToolResultChars: 1 },
    });
    expect(result.proposal).toBeUndefined();
    expect(
      result.events.some((event) => event.message.includes('Stage at least one command'))
    ).toBe(true);
  });

  it('enforces the elapsed time budget and handles already-cancelled requests', async () => {
    const result = await runAgent(request(), {
      limits: { maxRuntimeMs: 5 },
      provider: { complete: () => new Promise(() => {}) },
    });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('time budget');
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const cancelled = await runAgent(request(), {
      signal: controller.signal,
      provider: {
        async complete() {
          called = true;
          return { output: [], calls: [], text: '' };
        },
      },
    });
    expect(cancelled.status).toBe('cancelled');
    expect(called).toBe(false);
  });

  it('does not leak or accept mutation through provider inputs or event observers', async () => {
    const req = request();
    const provider = script([stage([{ type: 'rename', name: 'Intended' }]), review, finish]);
    const wrapped: AgentProvider = {
      async complete(args) {
        const result = await provider.complete(args);
        args.input.length = 0;
        args.tools.length = 0;
        return result;
      },
    };
    const result = await runAgent(req, {
      provider: wrapped,
      onEvent(event) {
        event.message = 'tampered';
        throw new Error('observer broke');
      },
    });
    expect(result.status).toBe('completed');
    expect(result.events.some((event) => event.message === 'tampered')).toBe(false);
    expect(req.project.name).toBe(defaultProject.name);
  });

  it('pages authored edits and keys without injecting a full scene into context', async () => {
    const req = request();
    req.project.cues[0].droneEdits = Object.fromEntries(
      [1, 2, 3, 4].map((id) => [
        id,
        { keyframes: [0, 1, 2, 3].map((time) => ({ time, brightness: time / 3 })) },
      ])
    );
    let resultPage: Record<string, unknown> = {};
    await runAgent(req, {
      provider: script(
        [
          {
            name: 'inspect_scene',
            args: { cueId: req.cueId, offset: 1, limit: 2, keyframeOffset: 1, keyframeLimit: 2 },
          },
        ],
        (input, index) => {
          if (index === 1)
            resultPage = JSON.parse((input.at(-1) as { output: string }).output).result;
        }
      ),
    });
    expect(resultPage).toMatchObject({
      totalEdits: 4,
      nextOffset: 3,
      edits: [
        { id: 2, keyframeCount: 4, nextKeyframeOffset: 3 },
        { id: 3, keyframeCount: 4 },
      ],
    });
    expect((resultPage.edits as { keyframes: unknown[] }[])[0].keyframes).toHaveLength(2);
  });

  it('discovers the shared command schema including timing controls', () => {
    const schema = schemaToJSON(operationSchema);
    expect(JSON.stringify(schema)).toContain('retime_cue');
    expect(JSON.stringify(schema)).toContain('transition_to_beats');
    expect(
      agentTools.every((tool) => tool.strict && tool.parameters.additionalProperties === false)
    ).toBe(true);
  });

  it('pages every arbitrary selected ID and uniformly edits the complete immutable selection', async () => {
    const req = request();
    req.project.droneCount = 997;
    // A permutation subset with gaps, whose IDs cannot be reconstructed as a simple range.
    req.selection = Array.from({ length: 333 }, (_, index) => ((index * 613 + 89) % 997) + 1);
    const selected = [...req.selection];
    const before = structuredClone(req.project);
    const pages: number[][] = [];
    let initialContext:
      | {
          editorContext: {
            selectionTruncated: boolean;
            selection: number[];
            selectionAccess: string;
          };
        }
      | undefined;
    const provider = script(
      [
        ...[0, 128, 256].map((offset) => ({
          name: 'inspect_selection',
          args: { offset, limit: 128 },
        })),
        {
          name: 'stage_selection_operation',
          args: {
            operationJson: JSON.stringify({
              type: 'edit_drones',
              cueId: req.cueId,
              patch: { color: '#00bbff' },
            }),
            explanation: 'Color every selected drone.',
          },
        },
        review,
        finish,
      ],
      (input, index) => {
        if (index === 0) {
          initialContext = JSON.parse((input.at(-1) as { content: string }).content);
          // Simulate the user changing selection while the asynchronous agent is running.
          req.selection.splice(0, req.selection.length, 1);
        }
        if (index >= 1 && index <= 3)
          pages.push(JSON.parse((input.at(-1) as { output: string }).output).result.ids);
      }
    );
    const result = await runAgent(req, { provider });
    expect(result.status).toBe('completed');
    expect(initialContext?.editorContext.selectionTruncated).toBe(true);
    expect(initialContext?.editorContext.selection).toHaveLength(128);
    expect(initialContext?.editorContext.selectionAccess).toContain('inspect_selection');
    expect(pages.flat()).toEqual(selected);
    const operation = result.proposal!.operations[0];
    expect(operation).toEqual({
      type: 'edit_drones',
      cueId: req.cueId,
      ids: selected,
      patch: { color: '#00bbff' },
    });
    const authored = applyOperations(before, result.proposal!.operations).cues[0].droneEdits!;
    expect(Object.keys(authored)).toHaveLength(selected.length);
    for (const id of selected) expect(authored[id].color).toBe('#00bbff');
    expect(req.project).toEqual(before);
  });

  it('retains dormant selected IDs after a fleet reduction and reports their scope', async () => {
    const req = request();
    req.project.droneCount = 997;
    req.selection = Array.from({ length: 301 }, (_, index) => ((index * 613 + 89) % 997) + 1);
    const selection = [...req.selection];
    let page: { activeCount: number; dormantCount: number; dormantIds: number[] } | undefined;
    const result = await runAgent(req, {
      provider: script(
        [
          stage([{ type: 'set_fleet', count: 10 }]),
          { name: 'inspect_selection', args: { offset: 0, limit: 128 } },
          { name: 'sample_frame', args: { time: 1, ids: [selection.find((id) => id > 10)!] } },
          {
            name: 'stage_selection_operation',
            args: {
              operationJson: JSON.stringify({
                type: 'set_keyframe',
                cueId: req.cueId,
                keyframe: { time: 1, color: '#ffffff' },
              }),
              explanation:
                'Key the complete captured selection, preserving dormant authored edits.',
            },
          },
          review,
          finish,
        ],
        (input, index) => {
          if (index === 2) page = JSON.parse((input.at(-1) as { output: string }).output).result;
        }
      ),
    });
    expect(result.status).toBe('completed');
    expect(page?.activeCount).toBe(selection.filter((id) => id <= 10).length);
    expect(page?.dormantCount).toBe(selection.filter((id) => id > 10).length);
    expect(page?.dormantIds).toEqual(selection.slice(0, 128).filter((id) => id > 10));
    expect(
      result.events.some((event) =>
        event.message.includes('Sample IDs must belong to the active fleet')
      )
    ).toBe(true);
    expect(result.proposal?.operations[1]).toMatchObject({ ids: selection });
    const updated = applyOperations(req.project, result.proposal!.operations);
    expect(Object.keys(updated.cues[0].droneEdits!)).toHaveLength(selection.length);
    expect(req.selection).toEqual(selection);
    expect(req.project.droneCount).toBe(997);
  });

  it('supports selection-wide key removal and reset without taking caller-supplied IDs', async () => {
    const req = request();
    req.project.cues[0].droneEdits = {
      1: { color: '#00bbff', keyframes: [{ time: 1, brightness: 0.5 }] },
      2: { keyframes: [{ time: 1, brightness: 0.5 }] },
    };
    const result = await runAgent(req, {
      provider: script([
        {
          name: 'stage_selection_operation',
          args: {
            operationJson: JSON.stringify({ type: 'reset_drones', cueId: req.cueId, ids: [3] }),
            explanation: 'Not allowed to replace the captured selection.',
          },
        },
        {
          name: 'stage_selection_operation',
          args: {
            operationJson: JSON.stringify({ type: 'rename', name: 'Not a per-drone command' }),
            explanation: 'Unsupported operation.',
          },
        },
        {
          name: 'stage_selection_operation',
          args: {
            operationJson: JSON.stringify({ type: 'remove_keyframe', cueId: req.cueId, time: 1 }),
            explanation: 'Remove the selected keys.',
          },
        },
        {
          name: 'stage_selection_operation',
          args: {
            operationJson: JSON.stringify({ type: 'reset_drones', cueId: req.cueId }),
            explanation: 'Reset selected drone edits.',
          },
        },
        review,
        finish,
      ]),
    });
    expect(result.status).toBe('completed');
    expect(result.proposal?.operations).toEqual([
      { type: 'remove_keyframe', cueId: req.cueId, time: 1, ids: [1, 2] },
      { type: 'reset_drones', cueId: req.cueId, ids: [1, 2] },
    ]);
    expect(applyOperations(req.project, result.proposal!.operations).cues[0].droneEdits).toEqual(
      {}
    );
    expect(result.events.filter((event) => event.type === 'validation_error')).toHaveLength(2);
  });

  it('rejects empty or initially inactive selection and bounds expanded authoring data', async () => {
    const empty = request();
    empty.selection = [];
    const selectOp = (operation: unknown) => ({
      name: 'stage_selection_operation',
      args: { operationJson: JSON.stringify(operation), explanation: 'Selection test.' },
    });
    const emptyResult = await runAgent(empty, {
      provider: script([
        selectOp({ type: 'edit_drones', cueId: empty.cueId, patch: { color: '#aabbcc' } }),
      ]),
    });
    expect(emptyResult.proposal).toBeUndefined();
    expect(
      emptyResult.events.some((event) => event.message.includes('captured selection is empty'))
    ).toBe(true);
    const inactive = request();
    inactive.selection = [5];
    expect((await runAgent(inactive, { provider: script([]) })).message).toContain(
      'outside the active fleet'
    );
    const large = request();
    large.project.droneCount = 100000;
    large.selection = Array.from({ length: 100000 }, (_, index) => index + 1);
    const largeResult = await runAgent(large, {
      provider: script([
        selectOp({
          type: 'edit_drones',
          cueId: large.cueId,
          patch: {
            keyframes: Array.from({ length: 400 }, (_, time) => ({ time, color: '#aabbcc' })),
          },
        }),
        finish,
      ]),
    });
    expect(largeResult.proposal).toBeUndefined();
    expect(
      largeResult.events.some((event) => event.message.includes('draft expansion budget'))
    ).toBe(true);
    expect(large.project.cues[0].droneEdits).toBeUndefined();
  });

  it('uses the real loop for the clearly labeled deterministic rehearsal', async () => {
    const req = request();
    const result = await runAgent(req, { provider: createRehearsalProvider(req) });
    expect(result.status).toBe('completed');
    expect(result.proposal?.operations).toHaveLength(3);
    expect(result.proposal?.title).toContain('Scripted');
    expect(result.message).toContain('did not interpret your brief');
    expect(
      result.events.filter((event) => event.type === 'tool_start').map((event) => event.tool)
    ).toEqual([
      'inspect_show',
      'inspect_scene',
      'command_schema',
      'stage_operations',
      'sample_frame',
      'review_draft',
      'finish_proposal',
    ]);
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('rehearses scene retiming when there is no selection', async () => {
    const req = request();
    req.selection = [];
    const result = await runAgent(req, { provider: createRehearsalProvider(req) });
    expect(result.proposal?.operations).toEqual([
      {
        type: 'retime_cue',
        id: req.cueId,
        speed: 1.25,
        scaleKeyframes: true,
        scaleTransition: true,
      },
    ]);
  });

  it('rejects stale proposal application through the shared revision guard', async () => {
    const req = request();
    const result = await runAgent(req, { provider: createRehearsalProvider(req) });
    const newer = applyOperations(req.project, [{ type: 'rename', name: 'Edited elsewhere' }]);
    expect(() =>
      applyOperations(newer, result.proposal!.operations, result.proposal!.revision)
    ).toThrow('out of date');
  });
});
