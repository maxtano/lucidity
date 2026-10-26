import { describe, expect, it } from 'vitest';
import { applyOperations, type Operation } from '../core/commands';
import { createEvaluationFixtureProvider, runEvaluationSuite } from './evaluation';
import {
  cameraEvaluation,
  cameraEvaluationSpec,
  createCameraEvaluationProvider,
} from './evaluation-camera';
import { evaluateCameraRefinement } from './evaluation-camera-oracle';
import type { AgentProvider, AgentRequest } from './types';

const CASE = 'camera-light-refinement';
const args = cameraEvaluationSpec.arguments;
const keys = (request: AgentRequest, ids = [2, 3], times = [1, 2, 3]): Operation[] =>
  times.map((time) => ({
    type: 'set_keyframe',
    cueId: request.cueId,
    ids,
    keyframe: { time, brightness: 1 },
  }));
type Options = {
  before?: boolean;
  after?: boolean;
  inspectArgs?: object;
  batches?: Operation[][];
  late?: Operation[];
};
function candidate(operations: Operation[], options: Options = {}): AgentProvider {
  const inspect = { name: 'inspect_camera_move', args: options.inspectArgs ?? args };
  const stage = (batch: Operation[]) => ({
    name: 'stage_operations',
    args: {
      operationsJson: JSON.stringify(batch),
      explanation: 'Camera evaluation candidate.',
    },
  });
  const steps = [
    ...(options.before === false ? [] : [inspect]),
    ...(options.batches ?? [operations]).map(stage),
    ...(options.after === false ? [] : [inspect]),
    ...(options.late ? [stage(options.late)] : []),
    { name: 'review_draft', args: {} },
    {
      name: 'finish_proposal',
      args: {
        title: 'Camera candidate',
        description:
          'Sampled geometric inspection and reviewed edits; no continuous coverage or flight readiness.',
        changes: ['Refine selected light keys'],
      },
    },
  ];
  let index = 0;
  return {
    async complete() {
      const step = steps[index++];
      if (!step) return { output: [], calls: [], text: 'Candidate ended.' };
      const call = {
        id: `camera-candidate-${index}`,
        name: step.name,
        arguments: JSON.stringify(step.args),
      };
      return {
        calls: [call],
        output: [
          { type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments },
        ],
        text: '',
      };
    },
  };
}
const run = (providerFactory: (request: AgentRequest) => AgentProvider) =>
  runEvaluationSuite({ caseIds: [CASE], providerFactory });

describe('camera-aware semantic evaluation', () => {
  it('passes the conditional fixture and records independent counts, exact clocks and evidence order', async () => {
    const report = await runEvaluationSuite({
      caseIds: [CASE],
      providerFactory: createEvaluationFixtureProvider,
    });
    expect(report.status).toBe('passed');
    expect(report.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    const result = report.cases[0];
    expect(result.findings).toHaveLength(11);
    expect(result.cameraEvidence).toMatchObject({
      before: { geometry: [5, 4, 5], lit: [2, 1, 2] },
      after: { geometry: [5, 4, 5], lit: [4, 3, 4] },
      mapping: [
        { cameraTime: 0, showTime: 1, yaw: 0 },
        { cameraTime: 4, showTime: 2, yaw: 45 },
        { cameraTime: 8, showTime: 3, yaw: 90 },
      ],
    });
    expect(
      result.run.events.filter((event) => event.type === 'tool_start').map((event) => event.tool)
    ).toEqual([
      'inspect_camera_move',
      'inspect_viewpoint',
      'stage_operations',
      'inspect_camera_move',
      'review_draft',
      'finish_proposal',
    ]);
    const trace = result.cameraEvidence!.trace;
    expect(trace.beforeEventId).toBeLessThan(trace.firstStageEventId!);
    expect(trace.afterEventId).toBeGreaterThan(trace.lastStageEventId!);
    expect(result.run.proposal!.operations).toEqual(keys(cameraEvaluation.fixture().request));
  });

  it('accepts equivalent split batches and final evidence after every successful edit', async () => {
    const report = await run((request) => {
      const operations = keys(request);
      return candidate(operations, { batches: operations.map((operation) => [operation]) });
    });
    expect(report.status).toBe('passed');
    expect(report.cases[0].cameraEvidence!.trace.firstStageEventId).not.toBe(
      report.cases[0].cameraEvidence!.trace.lastStageEventId
    );
  });

  it.each([
    ['wrong equally visible drone', (request: AgentRequest) => keys(request, [2, 4])],
    ['outside selected dark drone', (request: AgentRequest) => keys(request, [2, 3, 5])],
    ['camera clock used as key times', (request: AgentRequest) => keys(request, [2, 3], [0, 4, 8])],
    [
      'positive but wrong brightness',
      (request: AgentRequest) =>
        keys(request).map((operation) => ({
          ...operation,
          keyframe: {
            ...(operation as Extract<Operation, { type: 'set_keyframe' }>).keyframe,
            brightness: 0.2,
          },
        })) as Operation[],
    ],
    [
      'unrelated color',
      (request: AgentRequest) =>
        [
          ...keys(request),
          { type: 'edit_drones', cueId: request.cueId, ids: [6], patch: { color: '#ffffff' } },
        ] as Operation[],
    ],
    [
      'dormant edit erased',
      (request: AgentRequest) =>
        [...keys(request), { type: 'reset_drones', cueId: request.cueId, ids: [9] }] as Operation[],
    ],
    [
      'dormant selected key erased',
      (request: AgentRequest) =>
        [
          ...keys(request),
          { type: 'remove_keyframe', cueId: request.cueId, ids: [2], time: 6 },
        ] as Operation[],
    ],
    [
      'scene metadata overwritten',
      (request: AgentRequest) =>
        [
          ...keys(request),
          { type: 'update_cue', id: request.cueId, patch: { metadata: {} } },
        ] as Operation[],
    ],
  ])('rejects plausible wrong edits: %s', async (_label, operations) => {
    const report = await run((request) => candidate(operations(request)));
    expect(report.cases[0].run.status).toBe('completed');
    expect(report.status).toBe('failed');
    expect(
      report.cases[0].findings.find(
        (finding) => finding.name === 'Requested outcome and unrelated preservation'
      )?.passed
    ).toBe(false);
  });

  it.each([
    { before: false },
    { after: false },
    { inspectArgs: { ...args, duration: 6 } },
    { inspectArgs: { ...args, easing: 'smooth' } },
    { inspectArgs: { ...args, start: 0, end: 2 } },
    { inspectArgs: { ...args, toViewId: '' } },
  ])(
    'rejects correct authored edits with missing or incorrect exact camera evidence: %j',
    async (options) => {
      const report = await run((request) => candidate(keys(request), options));
      expect(report.status).toBe('failed');
      expect(report.cases[0].findings.filter((finding) => !finding.passed)).toEqual([
        expect.objectContaining({ name: 'Camera comparisons before and after editing' }),
      ]);
    }
  );

  it('rejects after evidence made stale by a later no-op edit despite the same final document', async () => {
    const report = await run((request) =>
      candidate(keys(request), {
        late: [
          { type: 'edit_drones', cueId: request.cueId, ids: [2], patch: { brightness: 0.35 } },
        ],
      })
    );
    expect(report.cases[0].findings.filter((finding) => !finding.passed)).toEqual([
      expect.objectContaining({ name: 'Camera comparisons before and after editing' }),
    ]);
  });

  it.each([
    'mapping',
    'aspect',
    'provenance',
    'pair',
    'validation_error',
    'duplicate_id',
    'start_order',
    'proposal_count',
  ] as const)('rejects tampered %s trace data even for a correct document', async (kind) => {
    const report = await runEvaluationSuite({
      caseIds: [CASE],
      providerFactory: createEvaluationFixtureProvider,
    });
    const fixture = cameraEvaluation.fixture(),
      events = structuredClone(report.cases[0].run.events);
    const measurement = events
      .filter((event) => event.type === 'tool_result' && event.tool === 'inspect_camera_move')
      .at(-1)!;
    const details = measurement.details as {
      mapping: { inFrameLights: number }[];
      request: { aspect: number };
      provenance: { operationCount: number };
    };
    if (kind === 'mapping') details.mapping[1].inFrameLights = 99;
    if (kind === 'aspect') details.request.aspect = 2;
    if (kind === 'provenance') details.provenance.operationCount = 1;
    if (kind === 'pair') events.push({ ...measurement, id: measurement.id + 100 });
    if (kind === 'validation_error')
      events.push({ ...measurement, type: 'validation_error', id: measurement.id + 100 });
    if (kind === 'duplicate_id') events.push({ ...measurement, callId: 'another-call' });
    if (kind === 'start_order')
      events.find(
        (event) => event.type === 'tool_start' && event.callId === measurement.callId
      )!.id = measurement.id + 100;
    const applied = applyOperations(fixture.request.project, fixture.operations, 7);
    const measured = await evaluateCameraRefinement(
      fixture.request,
      applied,
      events,
      kind === 'proposal_count' ? 1 : fixture.operations.length
    );
    expect(measured.findings.filter((finding) => !finding.passed)).toEqual([
      expect.objectContaining({ name: 'Camera comparisons before and after editing' }),
    ]);
  });

  it.each([1, 2, 4])(
    'conditional fixture refuses unsuitable actual tool evidence at model step %i',
    async (step) => {
      const report = await run((request) => {
        const conditional = createCameraEvaluationProvider(request);
        let index = 0;
        return {
          async complete(context) {
            const input = structuredClone(context.input);
            if (index++ === step) {
              const item = [...input]
                .reverse()
                .find((value) => (value as { type?: string }).type === 'function_call_output') as {
                output: string;
              };
              const output = JSON.parse(item.output);
              if (step === 1)
                output.result.samples.forEach(
                  (row: { totals: { inFrustum: number; inFrustumLightsOn: number } }) => {
                    row.totals.inFrustumLightsOn = row.totals.inFrustum;
                  }
                );
              if (step === 2)
                output.result.drones.forEach((row: { lightsOn: boolean }) => {
                  row.lightsOn = true;
                });
              if (step === 4)
                output.result.samples.forEach(
                  (row: { totals: { inFrustumLightsOn: number } }, i: number) => {
                    row.totals.inFrustumLightsOn = [2, 1, 2][i];
                  }
                );
              item.output = JSON.stringify(output);
            }
            return conditional.complete({ ...context, input });
          },
        };
      });
      expect(report.status).toBe('failed');
      expect(report.cases[0].run.proposal).toBeUndefined();
      if (step < 4)
        expect(report.cases[0].run.events.some((event) => event.tool === 'stage_operations')).toBe(
          false
        );
    }
  );

  it('rejects prose-only success and returns failed findings when no candidate is available', async () => {
    const report = await run(() => ({
      async complete() {
        return { calls: [], output: [], text: 'The camera lights are improved.' };
      },
    }));
    expect(report.status).toBe('failed');
    expect(report.cases[0].cameraEvidence).toBeUndefined();
    expect(report.cases[0].findings.filter((finding) => !finding.passed).length).toBeGreaterThan(5);
  });
});
