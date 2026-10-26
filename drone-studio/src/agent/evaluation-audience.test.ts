import { describe, expect, it } from 'vitest';
import { applyOperations, type Operation } from '../core/commands';
import type { AgentEvent, AgentProvider, AgentRequest } from './types';
import { createEvaluationFixtureProvider, runEvaluationSuite } from './evaluation';

const CASE_ID = 'audience-light-refinement';
const comparison = { start: 0, end: 2, samples: 3, viewIds: ['', 'south-view'] };
type CandidateOptions = {
  before?: boolean;
  after?: boolean;
  comparison?: typeof comparison;
  beforeComparisons?: (typeof comparison)[];
  afterComparisons?: (typeof comparison)[];
  batches?: Operation[][];
  afterComparisonBatches?: Operation[][];
};

/** The desired keys are calculated independently of the fixture's expected document. */
function requestedKeys(request: AgentRequest): Operation[] {
  return [0, 1, 2].map((time) => ({
    type: 'set_keyframe',
    cueId: request.cueId,
    ids: [4, 5],
    keyframe: { time, brightness: 1 },
  }));
}

function candidateProvider(operations: Operation[], options: CandidateOptions = {}): AgentProvider {
  const args = options.comparison ?? comparison;
  const stage = (batch: Operation[]) => ({
    name: 'stage_operations',
    args: {
      operationsJson: JSON.stringify(batch),
      explanation: 'Audience evaluation candidate.',
    },
  });
  const steps: { name: string; args: object }[] = [
    ...(options.before === false
      ? []
      : (options.beforeComparisons ?? [args]).map((range) => ({
          name: 'compare_viewpoints',
          args: range,
        }))),
    ...(options.batches ?? [operations]).map(stage),
    ...(options.after === false
      ? []
      : (options.afterComparisons ?? [args]).map((range) => ({
          name: 'compare_viewpoints',
          args: range,
        }))),
    ...(options.afterComparisonBatches ?? []).map(stage),
    { name: 'review_draft', args: {} },
    {
      name: 'finish_proposal',
      args: {
        title: 'Audience light refinement candidate',
        description:
          'A sampled creative comparison followed by draft review. No continuous coverage or flight readiness is claimed.',
        changes: ['Refine selected light channels for the captured audience view.'],
      },
    },
  ];
  let index = 0;
  return {
    async complete() {
      const step = steps[index++];
      if (!step) return { output: [], calls: [], text: 'Candidate finished.' };
      const call = {
        id: `audience-candidate-${index}`,
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

function compareEvents(events: AgentEvent[]) {
  return events.filter(
    (event) => event.type === 'tool_result' && event.tool === 'compare_viewpoints'
  );
}

describe('audience-aware creative evaluation adversaries', () => {
  it('accepts equivalent split staging followed by comparison of the final draft', async () => {
    const report = await runEvaluationSuite({
      caseIds: [CASE_ID],
      providerFactory(request) {
        const operations = requestedKeys(request);
        return candidateProvider(operations, {
          batches: operations.map((operation) => [operation]),
        });
      },
    });
    expect(report.status).toBe('passed');
    const result = report.cases[0];
    const staging = result.run.events.filter(
      (event) => event.type === 'tool_result' && event.tool === 'stage_operations'
    );
    expect(staging).toHaveLength(3);
    const comparisons = compareEvents(result.run.events);
    expect(comparisons).toHaveLength(2);
    expect(result.audienceEvidence?.trace).toMatchObject({
      beforeComparisonEventId: comparisons[0].id,
      afterComparisonEventId: comparisons[1].id,
      firstStageEventId: staging[0].id,
      lastStageEventId: staging[2].id,
    });
    expect(comparisons[1].id).toBeGreaterThan(staging[2].id);
    expect(result.findings.every((finding) => finding.passed)).toBe(true);
  });

  it('accepts independent single-view measurements around split staging', async () => {
    const report = await runEvaluationSuite({
      caseIds: [CASE_ID],
      providerFactory(request) {
        const operations = requestedKeys(request);
        return candidateProvider(operations, {
          batches: operations.map((operation) => [operation]),
          beforeComparisons: ['south-view', ''].map((id) => ({ ...comparison, viewIds: [id] })),
          afterComparisons: ['', 'south-view'].map((id) => ({ ...comparison, viewIds: [id] })),
        });
      },
    });
    expect(report.status).toBe('passed');
    const result = report.cases[0];
    const comparisons = compareEvents(result.run.events);
    expect(comparisons).toHaveLength(4);
    const staging = result.run.events.filter(
      (event) => event.type === 'tool_result' && event.tool === 'stage_operations'
    );
    expect(staging).toHaveLength(3);
    expect(result.audienceEvidence?.trace).toMatchObject({
      beforeComparisonEventIds: [comparisons[0].id, comparisons[1].id],
      afterComparisonEventIds: [comparisons[2].id, comparisons[3].id],
      firstStageEventId: staging[0].id,
      lastStageEventId: staging[2].id,
    });
    expect(comparisons[1].id).toBeLessThan(staging[0].id);
    expect(comparisons[2].id).toBeGreaterThan(staging[2].id);
    expect(result.findings.every((finding) => finding.passed)).toBe(true);
  });

  it.each(['before', 'after'] as const)(
    'rejects repeated current-view measurements that omit the weaker view %s editing',
    async (phase) => {
      const complete = ['', 'south-view'].map((id) => ({ ...comparison, viewIds: [id] }));
      const repeatedCurrent = ['', ''].map((id) => ({ ...comparison, viewIds: [id] }));
      const report = await runEvaluationSuite({
        caseIds: [CASE_ID],
        providerFactory(request) {
          return candidateProvider(requestedKeys(request), {
            beforeComparisons: phase === 'before' ? repeatedCurrent : complete,
            afterComparisons: phase === 'after' ? repeatedCurrent : complete,
          });
        },
      });
      const result = report.cases[0];
      expect(result.run.status).toBe('completed');
      expect(compareEvents(result.run.events)).toHaveLength(4);
      expect(
        result.findings.find(
          (finding) => finding.name === 'Requested outcome and unrelated preservation'
        )
      ).toMatchObject({ passed: true });
      expect(result.findings.filter((finding) => !finding.passed)).toEqual([
        expect.objectContaining({
          name: 'Captured comparisons before and after editing',
          passed: false,
        }),
      ]);
      expect(report.status).toBe('failed');
    }
  );

  it('rejects stale comparison evidence after later edits restore the same valid final document', async () => {
    const report = await runEvaluationSuite({
      caseIds: [CASE_ID],
      providerFactory(request) {
        return candidateProvider(requestedKeys(request), {
          afterComparisonBatches: [0, 1].map((brightness) => [
            {
              type: 'set_keyframe',
              cueId: request.cueId,
              ids: [4, 5],
              keyframe: { time: 1, brightness },
            },
          ]),
        });
      },
    });
    expect(report.status).toBe('failed');
    const result = report.cases[0];
    expect(result.run.status).toBe('completed');
    expect(
      result.findings.find(
        (finding) => finding.name === 'Requested outcome and unrelated preservation'
      )
    ).toMatchObject({ passed: true });
    expect(
      result.findings.find(
        (finding) => finding.name === 'Captured comparisons before and after editing'
      )
    ).toMatchObject({ passed: false });
    expect(result.findings.filter((finding) => !finding.passed)).toHaveLength(1);
    const comparisons = compareEvents(result.run.events);
    expect(comparisons).toHaveLength(2);
    expect(result.audienceEvidence?.trace.afterComparisonEventId).toBeNull();
    expect(result.audienceEvidence?.trace.lastStageEventId).toBeGreaterThan(comparisons[1].id);
  });

  it('passes measured before/after refinement through the real harness without changing its request', async () => {
    let owned: AgentRequest | undefined;
    let baseline: AgentRequest | undefined;
    const report = await runEvaluationSuite({
      caseIds: [CASE_ID],
      providerFactory(request, id) {
        owned = request;
        baseline = structuredClone(request);
        return createEvaluationFixtureProvider(request, id);
      },
    });
    expect(report.status).toBe('passed');
    expect(report.summary).toMatchObject({ total: 1, passed: 1, failed: 0 });
    const result = report.cases[0];
    expect(result.findings.every((finding) => finding.passed)).toBe(true);
    expect(owned).toEqual(baseline);
    expect(result.run.proposal?.revision).toBe(baseline!.project.revision);
    const comparisons = compareEvents(result.run.events);
    expect(comparisons).toHaveLength(2);
    const staging = result.run.events.filter(
      (event) => event.type === 'tool_result' && event.tool === 'stage_operations'
    );
    expect(staging).toHaveLength(1);
    expect(comparisons[0].id).toBeLessThan(staging[0].id);
    expect(comparisons[1].id).toBeGreaterThan(staging[0].id);
    expect(result.audienceEvidence).toMatchObject({
      times: [0, 1, 2],
      views: [
        {
          id: '',
          before: { geometry: [3, 3, 3], lit: [3, 3, 3] },
          after: { geometry: [3, 3, 3], lit: [3, 3, 3] },
        },
        {
          id: 'south-view',
          before: { geometry: [4, 4, 4], lit: [1, 1, 1] },
          after: { geometry: [4, 4, 4], lit: [3, 3, 3] },
        },
      ],
      trace: {
        beforeComparisonEventId: comparisons[0].id,
        afterComparisonEventId: comparisons[1].id,
        firstStageEventId: staging[0].id,
        lastStageEventId: staging[0].id,
      },
    });
    for (const [index, event] of comparisons.entries()) {
      expect(event.details).toMatchObject({
        times: [0, 1, 2],
        views: [
          { id: '', summary: { minInFrameLights: 3, maxInFrameLights: 3, meanInFrameLights: 3 } },
          {
            id: 'south-view',
            summary: {
              minInFrameLights: index ? 3 : 1,
              maxInFrameLights: index ? 3 : 1,
              meanInFrameLights: index ? 3 : 1,
            },
          },
        ],
      });
    }
    const applied = applyOperations(
      baseline!.project,
      result.run.proposal!.operations,
      baseline!.project.revision
    );
    const originalCue = baseline!.project.cues.find((cue) => cue.id === baseline!.cueId)!;
    const changedCue = applied.cues.find((cue) => cue.id === baseline!.cueId)!;
    expect(changedCue.droneEdits!['6']).toEqual(originalCue.droneEdits!['6']);
    expect(changedCue.droneEdits!['9']).toEqual(originalCue.droneEdits!['9']);
    for (const id of [4, 5]) {
      const restored = structuredClone(changedCue.droneEdits![id]);
      for (const key of restored.keyframes ?? []) {
        const original = originalCue.droneEdits![id].keyframes!.find(
          (candidate) => candidate.time === key.time
        )!;
        if ([0, 1, 2].includes(key.time)) key.brightness = original.brightness;
      }
      expect(restored).toEqual(originalCue.droneEdits![id]);
    }
    expect(owned).toEqual(baseline);
  });

  it.each([
    { label: 'the already brighter north view', ids: [1, 2] },
    { label: 'the unselected dark south decoy as well', ids: [4, 5, 6] },
  ])('rejects a plausible light edit targeting $label', async ({ ids }) => {
    const report = await runEvaluationSuite({
      caseIds: [CASE_ID],
      providerFactory(request) {
        return candidateProvider(
          [0, 1, 2].map((time) => ({
            type: 'set_keyframe',
            cueId: request.cueId,
            ids,
            keyframe: { time, brightness: 1 },
          }))
        );
      },
    });
    expect(report.cases[0].run.status).toBe('completed');
    expect(compareEvents(report.cases[0].run.events)).toHaveLength(2);
    expect(report.status).toBe('failed');
    expect(
      report.cases[0].findings.find(
        (finding) => finding.name === 'Requested outcome and unrelated preservation'
      )
    ).toMatchObject({ passed: false });
    expect(
      report.cases[0].findings.find((finding) => finding.name === 'Request fixture unchanged')
    ).toMatchObject({ passed: true });
  });

  it('rejects flattening authored brightness curves and erasing their other keyed channels', async () => {
    const report = await runEvaluationSuite({
      caseIds: [CASE_ID],
      providerFactory(request) {
        const cue = request.project.cues.find((candidate) => candidate.id === request.cueId)!;
        const droneEdits = structuredClone(cue.droneEdits!);
        for (const id of [4, 5]) droneEdits[id].keyframes = [{ time: 0, brightness: 1 }];
        return candidateProvider([
          { type: 'update_cue', id: request.cueId, patch: { droneEdits } },
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
  });

  it('rejects placing the final brightness key after the requested sample boundary', async () => {
    const report = await runEvaluationSuite({
      caseIds: [CASE_ID],
      providerFactory(request) {
        return candidateProvider(
          [0, 1, 3].map((time) => ({
            type: 'set_keyframe',
            cueId: request.cueId,
            ids: [4, 5],
            keyframe: { time, brightness: 1 },
          }))
        );
      },
    });
    expect(report.cases[0].run.status).toBe('completed');
    expect(report.status).toBe('failed');
    expect(
      report.cases[0].findings.find(
        (finding) => finding.name === 'Requested outcome and unrelated preservation'
      )
    ).toMatchObject({ passed: false });
  });

  it.each(['position', 'color'] as const)(
    'rejects an otherwise correct refinement with unrelated %s mutation',
    async (channel) => {
      const report = await runEvaluationSuite({
        caseIds: [CASE_ID],
        providerFactory(request) {
          const original = request.project.cues.find((cue) => cue.id === request.cueId)!
            .droneEdits!['7'];
          const patch =
            channel === 'position'
              ? {
                  position: [
                    original.position![0] + 0.25,
                    original.position![1],
                    original.position![2],
                  ] as [number, number, number],
                }
              : { color: '#f0c080' };
          return candidateProvider([
            ...requestedKeys(request),
            { type: 'edit_drones', cueId: request.cueId, ids: [7], patch },
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
      const after = compareEvents(report.cases[0].run.events).at(-1)!;
      // Matching lit counts alone cannot excuse a mutation to authored motion or colour.
      expect(after.details).toMatchObject({
        views: [
          { id: '', summary: { minInFrameLights: 3, maxInFrameLights: 3 } },
          { id: 'south-view', summary: { minInFrameLights: 3, maxInFrameLights: 3 } },
        ],
      });
    }
  );

  it.each([
    { label: 'before measurement', options: { before: false } },
    { label: 'after measurement', options: { after: false } },
    { label: 'requested sample times', options: { comparison: { ...comparison, end: 3 } } },
    { label: 'weaker captured view', options: { comparison: { ...comparison, viewIds: [''] } } },
  ])('rejects correct authored edits without the $label', async ({ options }) => {
    const report = await runEvaluationSuite({
      caseIds: [CASE_ID],
      providerFactory(request) {
        return candidateProvider(requestedKeys(request), options);
      },
    });
    expect(report.cases[0].run.status).toBe('completed');
    expect(
      report.cases[0].findings.find(
        (finding) => finding.name === 'Requested outcome and unrelated preservation'
      )
    ).toMatchObject({ passed: true });
    expect(report.status).toBe('failed');
    expect(
      report.cases[0].findings.find(
        (finding) => finding.name === 'Captured comparisons before and after editing'
      )
    ).toMatchObject({ passed: false });
  });

  it('rejects a reviewed no-op even when both comparison calls complete', async () => {
    const report = await runEvaluationSuite({
      caseIds: [CASE_ID],
      providerFactory(request) {
        return candidateProvider([
          {
            type: 'set_keyframe',
            cueId: request.cueId,
            ids: [4, 5],
            keyframe: { time: 0, brightness: 0 },
          },
        ]);
      },
    });
    expect(report.cases[0].run.status).toBe('completed');
    expect(
      report.cases[0].findings.find((finding) => finding.name === 'Reviewable proposal')
    ).toMatchObject({ passed: true });
    expect(compareEvents(report.cases[0].run.events)).toHaveLength(2);
    expect(report.status).toBe('failed');
  });

  it('rejects language-only claims of fixing the dim audience view', async () => {
    const report = await runEvaluationSuite({
      caseIds: [CASE_ID],
      providerFactory() {
        return {
          async complete() {
            return {
              output: [],
              calls: [],
              text: 'I compared both views, brightened the south lights, preserved all existing animation, and verified the improvement.',
            };
          },
        };
      },
    });
    expect(report.cases[0].run.status).toBe('completed');
    expect(report.status).toBe('failed');
    expect(report.cases[0].run.proposal).toBeUndefined();
    expect(
      report.cases[0].findings.find((finding) => finding.name === 'Reviewable proposal')
    ).toMatchObject({ passed: false });
    expect(compareEvents(report.cases[0].run.events)).toHaveLength(0);
  });
});
