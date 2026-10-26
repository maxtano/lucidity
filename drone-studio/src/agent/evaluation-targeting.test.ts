import { describe, expect, it } from 'vitest';
import { applyOperations, type Operation } from '../core/commands';
import { createEvaluationFixtureProvider, runEvaluationSuite } from './evaluation';
import {
  targetingEvaluation,
  targetingEvaluationSpec,
  createTargetingEvaluationProvider,
} from './evaluation-targeting';
import { evaluateAudienceTargeting } from './evaluation-targeting-oracle';
import type { AgentProvider, AgentRequest } from './types';

const CASE = 'audience-full-targeting',
  criteria = targetingEvaluationSpec.criteria;
const allMatches = Array.from({ length: 200 }, (_, index) => index * 3 + 1);
type Step = { name: string; args: unknown };
function response(steps: Step[], index: number) {
  const calls = steps.map((step, offset) => ({
    id: `target-candidate-${index}-${offset}`,
    name: step.name,
    arguments: JSON.stringify(step.args),
  }));
  return {
    calls,
    output: calls.map((call) => ({
      type: 'function_call',
      call_id: call.id,
      name: call.name,
      arguments: call.arguments,
    })),
    text: '',
  };
}
function lastResult(input: unknown[]): Record<string, unknown> {
  const row = [...input]
    .reverse()
    .find((item) => (item as { type?: string }).type === 'function_call_output') as {
    output: string;
  };
  return JSON.parse(row.output).result;
}
const finish: Step = {
  name: 'finish_proposal',
  args: {
    title: 'Targeting candidate',
    description: 'Measured complete target and reviewed edits; no flight qualification.',
    changes: ['Brighten measured lights'],
  },
};
function candidate(
  request: AgentRequest,
  options: {
    operations?: Operation[];
    patch?: object;
    extraQuery?: boolean;
    after?: boolean;
    late?: Operation[];
  } = {}
): AgentProvider {
  const query = { name: 'inspect_audience_selection', args: criteria };
  const steps: (Step | ((input: unknown[]) => Step))[] = [
    query,
    ...(options.extraQuery ? [query] : []),
    (input) =>
      options.operations
        ? {
            name: 'stage_operations',
            args: {
              operationsJson: JSON.stringify(options.operations),
              explanation: 'Candidate explicit IDs.',
            },
          }
        : {
            name: 'stage_audience_operation',
            args: {
              targetId: lastResult(input).targetId,
              operationJson: JSON.stringify({
                type: 'edit_drones',
                cueId: request.cueId,
                patch: options.patch ?? { brightness: 1 },
              }),
              explanation: 'Use the full measured set.',
            },
          },
    ...(options.after === false ? [] : [query]),
    ...(options.late
      ? [
          {
            name: 'stage_operations',
            args: {
              operationsJson: JSON.stringify(options.late),
              explanation: 'Late candidate change.',
            },
          },
        ]
      : []),
    { name: 'review_draft', args: {} },
    finish,
  ];
  let index = 0;
  return {
    async complete({ input }) {
      const next = steps[index++];
      return next
        ? response([typeof next === 'function' ? next(input) : next], index)
        : { calls: [], output: [], text: 'Done.' };
    },
  };
}
const run = (factory: (request: AgentRequest) => AgentProvider) =>
  runEvaluationSuite({ caseIds: [CASE], providerFactory: factory });

describe('complete audience targeting evaluation', () => {
  it('uses the actual opaque target for all 200 matches while preserving nonmatches and original selection', async () => {
    const report = await runEvaluationSuite({
      caseIds: [CASE],
      providerFactory: createEvaluationFixtureProvider,
    });
    expect(report.status).toBe('passed');
    expect(report.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    const result = report.cases[0];
    expect(result.findings).toHaveLength(10);
    expect(result.targetingEvidence).toMatchObject({
      matchedIdsBefore: allMatches,
      matchedIdsAfter: [],
      changedDroneIds: allMatches,
      originalSelection: [2, 3, 599, 600],
    });
    const queries = result.run.events.filter(
      (event) => event.type === 'tool_result' && event.tool === 'inspect_audience_selection'
    );
    expect(queries[0].details).toMatchObject({
      ids: allMatches.slice(0, 128),
      matchedCount: 200,
      hasMore: true,
      nextOffset: 128,
      targetId: expect.any(String),
    });
    expect(queries[1].details).toMatchObject({ ids: [], matchedCount: 0, targetId: null });
    expect(result.run.proposal!.operations[0]).toMatchObject({
      type: 'edit_drones',
      ids: allMatches,
      patch: { brightness: 1 },
    });
    const trace = result.targetingEvidence!.trace;
    expect(trace.beforeEventId).toBeLessThan(trace.targetStageEventId!);
    expect(trace.targetStageEventId).toBeLessThan(trace.afterEventId!);
  });

  it('accepts a second baseline query and binds the handle actually used, not merely the first query', async () => {
    const report = await run((request) => candidate(request, { extraQuery: true }));
    expect(report.status).toBe('passed');
    const queryEvents = report.cases[0].run.events.filter(
      (event) => event.type === 'tool_result' && event.tool === 'inspect_audience_selection'
    );
    expect(report.cases[0].targetingEvidence!.trace.beforeEventId).toBe(queryEvents[1].id);
  });

  it.each([
    ['first page only', allMatches.slice(0, 128)],
    ['original artist selection', [2, 3, 599, 600]],
    ['inferred continuous range', Array.from({ length: 200 }, (_, index) => index + 1)],
    ['omitted final match', allMatches.slice(0, -1)],
    ['unrelated extra match', [...allMatches, 2]],
  ])('rejects plausible incomplete or wrong ID targeting: %s', async (_name, ids) => {
    const report = await run((request) =>
      candidate(request, {
        operations: [{ type: 'edit_drones', cueId: request.cueId, ids, patch: { brightness: 1 } }],
      })
    );
    expect(report.cases[0].run.status).toBe('completed');
    expect(report.status).toBe('failed');
    expect(
      report.cases[0].findings.find(
        (finding) => finding.name === 'Requested outcome and unrelated preservation'
      )?.passed
    ).toBe(false);
  });

  it('rejects a correct authored result that bypasses the explicitly requested full-target handle', async () => {
    const report = await run((request) =>
      candidate(request, {
        operations: [
          { type: 'edit_drones', cueId: request.cueId, ids: allMatches, patch: { brightness: 1 } },
        ],
      })
    );
    expect(report.cases[0].findings.filter((finding) => !finding.passed)).toEqual([
      expect.objectContaining({ name: 'Measured target handle and final evidence' }),
    ]);
  });

  it.each([
    { brightness: 0.2 },
    { brightness: 1, color: '#ffffff' },
    { brightness: 1, keyframes: [] },
  ])('rejects incorrect target channels even when no dark matches remain: %j', async (patch) => {
    const report = await run((request) => candidate(request, { patch }));
    expect(report.status).toBe('failed');
    expect(
      report.cases[0].findings.find(
        (finding) => finding.name === 'No remaining dark in-frame matches'
      )?.passed
    ).toBe(true);
    expect(
      report.cases[0].findings.find(
        (finding) => finding.name === 'Requested outcome and unrelated preservation'
      )?.passed
    ).toBe(false);
  });

  it.each(['missing', 'late'] as const)(
    'rejects %s final evidence for an otherwise correct document',
    async (mode) => {
      const report = await run((request) =>
        candidate(
          request,
          mode === 'missing'
            ? { after: false }
            : { late: [{ type: 'rename', name: request.project.name }] }
        )
      );
      expect(report.cases[0].findings.filter((finding) => !finding.passed)).toEqual([
        expect.objectContaining({ name: 'Measured target handle and final evidence' }),
      ]);
    }
  );

  it.each([
    'targetId',
    'matchedCount',
    'source',
    'stagedOperations',
    'baseRevision',
    'validation_error',
    'prior_edit',
  ] as const)('rejects tampered bound-target trace: %s', async (kind) => {
    const report = await runEvaluationSuite({
      caseIds: [CASE],
      providerFactory: createEvaluationFixtureProvider,
    });
    const fixture = targetingEvaluation.fixture(),
      events = structuredClone(report.cases[0].run.events);
    const stage = events.find(
      (event) => event.type === 'tool_result' && event.tool === 'stage_audience_operation'
    )!;
    const detail = stage.details as {
      targetId: string;
      matchedCount: number;
      stagedOperations: number;
      baseRevision: number;
      target: { request: { aspect: number } };
    };
    if (kind === 'targetId') detail.targetId = 'unrelated-handle';
    if (kind === 'matchedCount') detail.matchedCount = 128;
    if (kind === 'source') detail.target.request.aspect = 2;
    if (kind === 'stagedOperations') detail.stagedOperations = 2;
    if (kind === 'baseRevision') detail.baseRevision = 99;
    if (kind === 'validation_error')
      events.push({ ...stage, id: stage.id + 100, type: 'validation_error' });
    if (kind === 'prior_edit') {
      const index = events.findIndex(
        (event) => event.type === 'tool_start' && event.callId === stage.callId
      );
      events.splice(
        index,
        0,
        {
          ...stage,
          type: 'tool_start',
          tool: 'stage_operations',
          callId: 'prior-edit',
          details: undefined,
        },
        {
          ...stage,
          tool: 'stage_operations',
          callId: 'prior-edit',
          details: { addedOperations: 1, stagedOperations: 1, baseRevision: 7 },
        }
      );
      events.forEach((event, i) => {
        event.id = i + 1;
      });
    }
    const result = await evaluateAudienceTargeting(
      fixture.request,
      applyOperations(fixture.request.project, fixture.operations, 7),
      events,
      fixture.operations.length
    );
    expect(result.findings.filter((finding) => !finding.passed)).toEqual([
      expect.objectContaining({ name: 'Measured target handle and final evidence' }),
    ]);
  });

  it.each(['target', 'incomplete', 'verification'] as const)(
    'conditional provider refuses unsuitable actual %s evidence',
    async (kind) => {
      const report = await run((request) => {
        const conditional = createTargetingEvaluationProvider(request);
        let index = 0;
        return {
          async complete(context) {
            const input = structuredClone(context.input),
              step = index++;
            if (
              (step === 1 && kind !== 'verification') ||
              (step === 3 && kind === 'verification')
            ) {
              const item = [...input]
                .reverse()
                .find((value) => (value as { type?: string }).type === 'function_call_output') as {
                output: string;
              };
              const output = JSON.parse(item.output);
              if (kind === 'target') output.result.targetId = null;
              if (kind === 'incomplete') output.result.matchedCount = 128;
              if (kind === 'verification') output.result.matchedCount = 1;
              item.output = JSON.stringify(output);
            }
            return conditional.complete({ ...context, input });
          },
        };
      });
      expect(report.status).toBe('failed');
      expect(report.cases[0].run.proposal).toBeUndefined();
    }
  );
});

/** Same authored camera/audience outcomes via the new staging tool, using fresh handles after each edit. */
function targetKeyProvider(request: AgentRequest, audience: boolean, late: boolean): AgentProvider {
  const measurement: Step = audience
    ? {
        name: 'compare_viewpoints',
        args: { start: 0, end: 2, samples: 3, viewIds: ['', 'south-view'] },
      }
    : {
        name: 'inspect_camera_move',
        args: {
          fromViewId: '',
          toViewId: 'east-view',
          duration: 8,
          easing: 'linear',
          start: 1,
          end: 3,
          samples: 3,
        },
      };
  const query: Step = {
    name: 'inspect_audience_selection',
    args: {
      time: audience ? 0 : 1,
      viewId: audience ? 'south-view' : '',
      region: 'in_frame',
      lights: 'any',
      scope: 'selection',
      offset: 0,
      limit: 128,
    },
  };
  let turn = 0;
  const stage = (input: unknown[], key: number): Step => ({
    name: 'stage_audience_operation',
    args: {
      targetId: lastResult(input).targetId,
      operationJson: JSON.stringify({
        type: 'set_keyframe',
        cueId: request.cueId,
        keyframe: { time: key, brightness: 1 },
      }),
      explanation: 'Equivalent full target key edit.',
    },
  });
  return {
    async complete({ input }) {
      const index = turn++;
      if (index === 0) return response([measurement], index);
      if (index === 1) return response([query], index);
      if (index === 2 || index === 3)
        return response([stage(input, index - (audience ? 2 : 1)), query], index);
      if (index === 4)
        return response(
          [stage(input, audience ? 2 : 3), measurement, ...(late ? [query] : [])],
          index
        );
      if (index === 5 && late) return response([stage(input, audience ? 2 : 3)], index);
      if (index === (late ? 6 : 5)) return response([{ name: 'review_draft', args: {} }], index);
      if (index === (late ? 7 : 6)) return response([finish], index);
      return { calls: [], output: [], text: 'Done.' };
    },
  };
}
describe('existing evidence oracles recognize audience-target staging boundaries', () => {
  it.each(['audience-light-refinement', 'camera-light-refinement'])(
    'accepts equivalent audience-target edits for %s',
    async (caseId) => {
      const report = await runEvaluationSuite({
        caseIds: [caseId],
        providerFactory: (request) =>
          targetKeyProvider(request, caseId.startsWith('audience'), false),
      });
      expect(report.status).toBe('passed');
      expect(
        report.cases[0].run.events.filter(
          (event) => event.type === 'tool_result' && event.tool === 'stage_audience_operation'
        )
      ).toHaveLength(3);
    }
  );
  it.each(['audience-light-refinement', 'camera-light-refinement'])(
    'rejects a stale final measurement followed by audience-target staging for %s',
    async (caseId) => {
      const report = await runEvaluationSuite({
        caseIds: [caseId],
        providerFactory: (request) =>
          targetKeyProvider(request, caseId.startsWith('audience'), true),
      });
      expect(report.cases[0].run.status).toBe('completed');
      expect(report.cases[0].findings.filter((finding) => !finding.passed)).toEqual([
        expect.objectContaining({
          name: caseId.startsWith('audience')
            ? 'Captured comparisons before and after editing'
            : 'Camera comparisons before and after editing',
        }),
      ]);
    }
  );
});
