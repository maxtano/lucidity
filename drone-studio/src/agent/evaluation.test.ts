import { describe, expect, it } from 'vitest';
import type { Operation } from '../core/commands';
import type { AgentProvider, AgentRequest } from './types';
import {
  createEvaluationFixtureProvider,
  listEvaluationCases,
  runEvaluationSuite,
} from './evaluation';

function proposalProvider(operations: Operation[]): AgentProvider {
  const steps = [
    {
      name: 'stage_operations',
      args: { operationsJson: JSON.stringify(operations), explanation: 'Evaluation candidate.' },
    },
    { name: 'review_draft', args: {} },
    {
      name: 'finish_proposal',
      args: {
        title: 'Evaluation candidate',
        description: 'This candidate follows a bounded design review, with incomplete checks.',
        changes: ['Requested candidate edit'],
      },
    },
  ];
  let index = 0;
  return {
    async complete() {
      const step = steps[index++];
      if (!step) return { output: [], calls: [], text: 'Done.' };
      const call = {
        id: `candidate-${index}`,
        name: step.name,
        arguments: JSON.stringify(step.args),
      };
      return {
        output: [
          { type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments },
        ],
        calls: [call],
        text: '',
        usage: { inputTokens: 3, outputTokens: 2 },
      };
    },
  };
}

function selectedLights(request: AgentRequest): Operation[] {
  return [
    {
      type: 'edit_drones',
      cueId: request.cueId,
      ids: request.selection,
      patch: { color: '#00bbff', flash: { hz: 2, duty: 0.25, phase: 0.125 } },
    },
  ];
}

describe('creative agent evaluation', () => {
  it('passes all eleven scripted fixtures through the real harness and semantic oracle', async () => {
    const observed: string[] = [];
    const report = await runEvaluationSuite({
      providerFactory: createEvaluationFixtureProvider,
      onCase(result) {
        observed.push(result.id);
      },
    });
    expect(report.status).toBe('passed');
    expect(report.summary).toEqual({ total: 11, passed: 11, failed: 0, cancelled: 0, skipped: 0 });
    expect(report.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(observed).toEqual(listEvaluationCases().map((item) => item.id));
    for (const result of report.cases) {
      expect(result.findings.every((finding) => finding.passed)).toBe(true);
      expect(result.run.proposal?.revision).toBe(7);
      expect(result.run.proposal?.description).toContain('not a model-quality result');
      expect(result.run.events.some((event) => event.tool === 'review_draft')).toBe(true);
    }
  });

  it('rejects a plausible partial edit that drops selected IDs beyond the preview', async () => {
    const report = await runEvaluationSuite({
      caseIds: ['complete-selection'],
      providerFactory(request) {
        return proposalProvider([
          {
            type: 'edit_drones',
            cueId: request.cueId,
            ids: request.selection.slice(0, 128),
            patch: { brightness: 0.42 },
          },
        ]);
      },
    });
    expect(report.cases[0].run.status).toBe('completed');
    expect(report.status).toBe('failed');
    expect(
      report.cases[0].findings.find(
        (finding) => finding.name === 'Requested outcome and unrelated preservation'
      )
    ).toMatchObject({ passed: false });
    expect(report.cases[0].context.selectedCount).toBe(333);
  });

  it('rejects correct requested light changes coupled with an unrelated mutation', async () => {
    const report = await runEvaluationSuite({
      caseIds: ['selected-lights'],
      providerFactory(request) {
        return proposalProvider([
          ...selectedLights(request),
          { type: 'rename', name: 'Unrequested title' },
        ]);
      },
    });
    expect(report.status).toBe('failed');
    expect(report.cases[0].findings.find((finding) => !finding.passed)?.detail).toContain(
      'project.name'
    );
  });

  it('rejects global seconds written directly as a scene-local key time', async () => {
    const report = await runEvaluationSuite({
      caseIds: ['position-at-playhead'],
      providerFactory(request) {
        return proposalProvider([
          {
            type: 'set_keyframe',
            cueId: request.cueId,
            ids: request.selection,
            keyframe: { time: request.time, position: [12, -6, 48] },
          },
        ]);
      },
    });
    expect(report.cases[0].run.status).toBe('completed');
    expect(report.status).toBe('failed');
    expect(
      report.cases[0].findings.some(
        (finding) => !finding.passed && finding.detail.includes('keyframes')
      )
    ).toBe(true);
  });

  it('rejects retiming that omits dormant or trimmed keyframes', async () => {
    const report = await runEvaluationSuite({
      caseIds: ['scene-retime'],
      providerFactory(request) {
        const cue = request.project.cues.find((item) => item.id === request.cueId)!;
        const edits = structuredClone(cue.droneEdits!);
        for (const [id, edit] of Object.entries(edits)) {
          if (Number(id) <= request.project.droneCount)
            for (const key of edit.keyframes || []) if (key.time <= cue.duration) key.time /= 2;
        }
        return proposalProvider([
          {
            type: 'update_cue',
            id: cue.id,
            patch: {
              duration: cue.duration / 2,
              transition: cue.transition / 2,
              droneEdits: edits,
            },
          },
        ]);
      },
    });
    expect(report.cases[0].run.status).toBe('completed');
    expect(report.status).toBe('failed');
    expect(
      report.cases[0].findings.some(
        (finding) => !finding.passed && finding.detail.includes('keyframes')
      )
    ).toBe(true);
  });

  it.each([
    {
      label: 'wrong rotation direction',
      pivot: [10, -4, 30],
      scale: [-2, 3, 0.5],
      angleDegrees: -90,
    },
    { label: 'wrong pivot', pivot: [0, 0, 0], scale: [-2, 3, 0.5], angleDegrees: 90 },
    // Swapping the XY scale factors is equivalent here to rotating before scaling.
    {
      label: 'rotation before nonuniform scale',
      pivot: [10, -4, 30],
      scale: [3, -2, 0.5],
      angleDegrees: 90,
    },
  ])('rejects a complete group path edit with $label', async ({ pivot, scale, angleDegrees }) => {
    const report = await runEvaluationSuite({
      caseIds: ['group-path-transform'],
      providerFactory(request) {
        return proposalProvider([
          {
            type: 'transform_drones',
            cueId: request.cueId,
            ids: [...request.selection, 311],
            pivot: pivot as [number, number, number],
            scale: scale as [number, number, number],
            rotation: { axis: [0, 0, 1], angleDegrees },
            translation: [4, 5, -2],
            scope: 'base_and_keys',
          },
        ]);
      },
    });
    expect(report.cases[0].context.selectedCount).toBe(173);
    expect(report.cases[0].run.status).toBe('completed');
    expect(report.status).toBe('failed');
    expect(
      report.cases[0].findings.find(
        (finding) => finding.name === 'Requested outcome and unrelated preservation'
      )
    ).toMatchObject({ passed: false });
    expect(
      report.cases[0].findings.find((finding) => finding.name === 'Atomic application')
    ).toMatchObject({ passed: true });
  });

  it('rejects a correct full-selection group transform that omits explicitly requested dormant work', async () => {
    const report = await runEvaluationSuite({
      caseIds: ['group-path-transform'],
      providerFactory(request) {
        return proposalProvider([
          {
            type: 'transform_drones',
            cueId: request.cueId,
            ids: [...request.selection],
            pivot: [10, -4, 30],
            scale: [-2, 3, 0.5],
            rotation: { axis: [0, 0, 1], angleDegrees: 90 },
            translation: [4, 5, -2],
            scope: 'base_and_keys',
          },
        ]);
      },
    });
    expect(report.cases[0].run.status).toBe('completed');
    expect(report.status).toBe('failed');
    expect(report.cases[0].findings.find((finding) => !finding.passed)?.detail).toContain(
      'droneEdits.311'
    );
  });

  it('rejects transforming blended viewport positions instead of unblended local targets', async () => {
    const report = await runEvaluationSuite({
      caseIds: ['group-transform-at-playhead'],
      providerFactory(request) {
        // At local2, linear incoming progress is 1/2. Transforming the averages
        // with Opening gives these wrong values; the expected target oracle does not.
        return proposalProvider([
          {
            type: 'set_keyframe',
            cueId: request.cueId,
            ids: [3],
            keyframe: { time: 2, position: [115, 2, 72] },
          },
          {
            type: 'set_keyframe',
            cueId: request.cueId,
            ids: [6],
            keyframe: { time: 2, position: [89, 2, 60.5] },
          },
        ]);
      },
    });
    expect(report.cases[0].run.status).toBe('completed');
    expect(report.status).toBe('failed');
    expect(report.cases[0].findings.find((finding) => !finding.passed)?.detail).toContain(
      'position'
    );
  });

  it('accepts independently calculated keyed transforms expressed as position-only commands', async () => {
    const report = await runEvaluationSuite({
      caseIds: ['group-transform-at-playhead'],
      providerFactory(request) {
        return proposalProvider([
          {
            type: 'set_keyframe',
            cueId: request.cueId,
            ids: [3],
            keyframe: { time: 2, position: [23, 2, 41] },
          },
          {
            type: 'set_keyframe',
            cueId: request.cueId,
            ids: [6],
            keyframe: { time: 2, position: [11, 2, 48] },
          },
        ]);
      },
    });
    expect(report.status).toBe('passed');
  });

  it('accepts equivalent outcomes produced with different commands and color casing', async () => {
    const report = await runEvaluationSuite({
      caseIds: ['selected-lights'],
      providerFactory(request) {
        const edits = structuredClone(request.project.cues[0].droneEdits!);
        for (const id of request.selection)
          edits[id] = {
            ...edits[id],
            color: '#00BBFF',
            flash: { hz: 2, duty: 0.25, phase: 0.125 },
          };
        return proposalProvider([
          { type: 'update_cue', id: request.cueId, patch: { droneEdits: edits } },
        ]);
      },
    });
    expect(report.status).toBe('passed');
    expect(report.usage).toEqual({ inputTokens: 9, outputTokens: 6 });
  });

  it('fails an apparent success response that returns no reviewable edit', async () => {
    const report = await runEvaluationSuite({
      caseIds: ['selected-lights'],
      providerFactory() {
        return {
          async complete() {
            return { output: [], calls: [], text: 'I changed the colors successfully.' };
          },
        };
      },
    });
    expect(report.cases[0].run.status).toBe('completed');
    expect(report.status).toBe('failed');
    expect(
      report.cases[0].findings.find((finding) => finding.name === 'Reviewable proposal')?.passed
    ).toBe(false);
  });

  it('uses an independent baseline and detects provider-factory mutations', async () => {
    const report = await runEvaluationSuite({
      caseIds: ['selected-lights'],
      providerFactory(request, id) {
        request.project.name = 'Mutated while initializing';
        return createEvaluationFixtureProvider(request, id);
      },
    });
    expect(report.status).toBe('failed');
    expect(
      report.cases[0].findings.find((finding) => finding.name === 'Request fixture unchanged')
        ?.passed
    ).toBe(false);
    // The independent baseline still has the original name, so valid operations remain reviewable.
    expect(
      report.cases[0].findings.find((finding) => finding.name === 'Atomic application')?.passed
    ).toBe(true);
  });

  it('validates proposal identity against the original revision, not a mutated request', async () => {
    const report = await runEvaluationSuite({
      caseIds: ['selected-lights'],
      providerFactory(request, id) {
        request.project.id = 'different-project';
        request.project.revision = 99;
        return createEvaluationFixtureProvider(request, id);
      },
    });
    expect(report.status).toBe('failed');
    expect(
      report.cases[0].findings.find((finding) => finding.name === 'Original project and revision')
        ?.passed
    ).toBe(false);
    expect(
      report.cases[0].findings.find((finding) => finding.name === 'Atomic application')?.passed
    ).toBe(false);
  });

  it('runs cases serially and isolates report observers', async () => {
    const sequence: string[] = [];
    const ids = ['selected-lights', 'beat-transition'];
    const report = await runEvaluationSuite({
      caseIds: ids,
      providerFactory(request, id) {
        sequence.push(`start:${id}`);
        return createEvaluationFixtureProvider(request, id);
      },
      onCase(result) {
        sequence.push(`end:${result.id}`);
        result.status = 'failed';
        result.findings.length = 0;
        throw new Error('Observer errors do not corrupt reports.');
      },
    });
    expect(sequence).toEqual([
      'start:selected-lights',
      'end:selected-lights',
      'start:beat-transition',
      'end:beat-transition',
    ]);
    expect(report.status).toBe('passed');
    expect(report.cases.every((result) => result.findings.length > 0)).toBe(true);
  });

  it('stops cancellation without creating providers for later cases', async () => {
    const controller = new AbortController();
    const started: string[] = [];
    const report = await runEvaluationSuite({
      signal: controller.signal,
      providerFactory(_request, id) {
        started.push(id);
        return {
          complete() {
            controller.abort();
            return new Promise(() => {});
          },
        };
      },
    });
    expect(report.status).toBe('cancelled');
    expect(started).toEqual(['selected-lights']);
    expect(report.summary).toEqual({ total: 11, passed: 0, failed: 0, cancelled: 1, skipped: 10 });
    const already = await runEvaluationSuite({
      signal: controller.signal,
      providerFactory() {
        throw new Error('Should not initialize.');
      },
    });
    expect(already.summary.skipped).toBe(11);
    expect(already.cases).toEqual([]);
  });

  it('excludes raw provider continuation and redacts credential-shaped output', async () => {
    const report = await runEvaluationSuite({
      caseIds: ['selected-lights'],
      providerFactory(request, id) {
        const provider = createEvaluationFixtureProvider(request, id);
        return {
          async complete(input) {
            const response = await provider.complete(input);
            if (response.calls[0]?.name === 'finish_proposal') {
              const args = JSON.parse(response.calls[0].arguments);
              args.description += ' sk-secretEXAMPLE123456';
              response.calls[0].arguments = JSON.stringify(args);
            }
            response.output.unshift({
              type: 'reasoning',
              encrypted_content: 'raw-continuation-must-not-be-in-report',
            });
            return response;
          },
        };
      },
    });
    expect(report.status).toBe('passed');
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('raw-continuation-must-not-be-in-report');
    expect(serialized).not.toContain('sk-secretEXAMPLE123456');
    expect(serialized).toContain('[redacted credential]');
  });

  it('reports provider initialization failures without copying secret-bearing errors', async () => {
    const report = await runEvaluationSuite({
      caseIds: ['selected-lights'],
      providerFactory() {
        throw new Error('Authorization: Bearer privateSecret123');
      },
    });
    expect(report.status).toBe('failed');
    expect(JSON.stringify(report)).not.toContain('privateSecret123');
    expect(report.cases[0].run.message).toBe('The provider could not initialize.');
  });

  it('rejects unknown, empty, or duplicate case selection before provider creation', async () => {
    for (const caseIds of [[], ['unknown'], ['selected-lights', 'selected-lights']])
      await expect(
        runEvaluationSuite({ caseIds, providerFactory: createEvaluationFixtureProvider })
      ).rejects.toThrow();
    const cases = listEvaluationCases();
    cases[0].prompt = 'mutated';
    expect(listEvaluationCases()[0].prompt).not.toBe('mutated');
  });
});
