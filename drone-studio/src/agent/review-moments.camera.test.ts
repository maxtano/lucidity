import { describe, expect, it } from 'vitest';
import { applyOperations } from '../core/commands';
import { defaultProject } from '../core/model';
import { inspectAudienceFrame } from '../core/audience-inspection';
import { runAgent } from './harness';
import { buildAgentReviewMoments } from './review-moments';
import type { AgentProvider, AgentRequest, AgentResult, AgentViewerContext } from './types';

function viewer(): AgentViewerContext {
  return {
    current: {
      snapshot: {
        pose: { east: 0, north: 0, eyeHeight: 1, yaw: 350, pitch: 0, fov: 60 },
        venue: { east: 0, north: 70, heading: 180 },
      },
      aspect: 1.75,
    },
    savedViews: [
      {
        id: 'end',
        name: 'Upper seats',
        snapshot: {
          pose: { east: 20, north: 10, eyeHeight: 3, yaw: 10, pitch: 40, fov: 100 },
          venue: { east: 0, north: 70, heading: 180 },
        },
      },
    ],
  };
}

function fixture() {
  const base = structuredClone(defaultProject);
  base.id = 'camera-review';
  base.revision = 7;
  base.droneCount = 3;
  base.cues = [{ ...base.cues[0], id: 'scene', duration: 10, transition: 0 }];
  const draft = structuredClone(base);
  draft.revision = 8;
  draft.cues[0].duration = 8;
  const result: AgentResult = {
    runId: 'camera-run',
    status: 'completed',
    message: 'Measured proposal.',
    viewer: viewer(),
    proposal: {
      projectId: base.id,
      revision: base.revision,
      title: 'Measured draft',
      description: 'Two commands.',
      changes: ['Lighting and timing.'],
      operations: [
        { type: 'edit_drones', cueId: 'scene', ids: [1], patch: { brightness: 0.5 } },
        { type: 'retime_cue', id: 'scene', speed: 1.25 },
      ],
    },
    events: [],
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  return { base, draft, result };
}

function trace(operationCount = 2) {
  const context = viewer();
  return {
    provenance: {
      projectId: 'camera-review',
      baseRevision: 7,
      revision: operationCount ? 8 : 7,
      operationCount,
    },
    projectId: 'camera-review',
    revision: operationCount ? 8 : 7,
    fromViewId: '',
    toViewId: 'end',
    request: {
      plan: {
        from: context.current.snapshot,
        to: context.savedViews[0].snapshot,
        duration: 8,
        easing: 'linear' as 'linear' | 'smooth',
      },
      aspect: context.current.aspect,
      fromName: 'Captured current viewpoint',
      toName: 'Upper seats',
      start: 0,
      end: 4,
      samples: 5,
    },
    mapping: [2, 0, 3, 1, 3].map((inFrameLights, index) => ({
      cameraTime: index * 2,
      showTime: index,
      inFrameLights,
    })),
    summary: {
      minInFrameLights: 0,
      maxInFrameLights: 3,
      meanInFrameLights: 9 / 5,
      minIndex: 1,
      maxIndex: 2,
    },
    limitations: ['Discrete geometric samples.'],
  };
}

function add(result: AgentResult, details: unknown, tool = 'inspect_camera_move') {
  const id = result.events.length + 1,
    callId = `call-${id}`;
  result.events.push(
    { id, at: '2026-09-27T00:00:00.000Z', type: 'tool_start', tool, callId, message: 'Running.' },
    {
      id: id + 1,
      at: '2026-09-27T00:00:00.000Z',
      type: 'tool_result',
      tool,
      callId,
      details,
      message: 'Measured.',
    }
  );
}

function ordinaryInspection(result: AgentResult) {
  add(
    result,
    {
      provenance: trace(0).provenance,
      viewId: '',
      viewName: 'Captured current viewpoint',
      ...viewer().current,
      time: 0,
      totals: {
        droneCount: 3,
        front: 3,
        right: 0,
        rear: 0,
        left: 0,
        overhead: 0,
        inFrustum: 3,
        lightsOn: 3,
        inFrustumLightsOn: 3,
      },
    },
    'inspect_viewpoint'
  );
}

describe('camera paths as measured agent review moments', () => {
  it('derives owned exact poses from both clocks and earliest extrema on both document versions', () => {
    const { base, draft, result } = fixture();
    add(result, trace(0));
    add(result, trace(2));
    const original = structuredClone({ base, draft, result });
    const moments = buildAgentReviewMoments(base, draft, result);
    expect(moments).toHaveLength(4);
    expect(moments[0]).toEqual({
      id: 'camera-run:4:1:minimum',
      version: 'draft',
      tool: 'inspect_camera_move',
      eventId: 4,
      callId: 'call-3',
      time: 1,
      viewId: '',
      viewName: 'Captured current viewpoint → Upper seats',
      snapshot: {
        pose: { east: 5, north: 2.5, eyeHeight: 1.5, yaw: 355, pitch: 10, fov: 70 },
        venue: { east: 0, north: 70, heading: 180 },
      },
      aspect: 1.75,
      kind: 'minimum',
      inFrameLights: 0,
      droneCount: 3,
      camera: {
        elapsed: 2,
        duration: 8,
        easing: 'linear',
        sampleIndex: 1,
        sampleCount: 5,
        fromViewId: '',
        toViewId: 'end',
        fromName: 'Captured current viewpoint',
        toName: 'Upper seats',
      },
    });
    expect(moments[1]).toMatchObject({
      kind: 'maximum',
      time: 2,
      inFrameLights: 3,
      snapshot: { pose: { east: 10, north: 5, eyeHeight: 2, yaw: 0, pitch: 20, fov: 80 } },
      camera: { elapsed: 4, sampleIndex: 2 },
    });
    expect(moments.slice(2).map(({ version }) => version)).toEqual(['base', 'base']);
    expect({ base, draft, result }).toEqual(original);
    expect(buildAgentReviewMoments(base, draft, result)).toEqual(moments);
    moments[0].snapshot.venue.north = 999;
    moments[0].camera!.fromName = 'Changed only the output';
    expect(result).toEqual(original.result);
    expect(moments[1].snapshot.venue.north).toBe(70);
    result.viewer!.current.snapshot.pose.yaw = 100;
    expect(moments[2].snapshot.pose.yaw).toBe(355);
  });

  it('retains two distinct camera poses at one held show time, using smooth easing and the +180 tie', () => {
    const { base, draft, result } = fixture(),
      data = trace();
    data.request.plan.easing = 'smooth';
    data.request.plan.from.pose.yaw = 0;
    data.request.plan.to.pose.yaw = 180;
    result.viewer!.current.snapshot.pose.yaw = 0;
    result.viewer!.savedViews[0].snapshot.pose.yaw = 180;
    data.request.start = data.request.end = 8;
    data.mapping.forEach((row) => {
      row.showTime = 8;
    });
    add(result, data);
    const moments = buildAgentReviewMoments(base, draft, result);
    expect(
      moments.map(({ time, snapshot, camera }) => [time, snapshot.pose.yaw, camera!.elapsed])
    ).toEqual([
      [8, 28.125, 2],
      [8, 90, 4],
    ]);
    expect(moments[0].snapshot.pose.east).toBe(3.125);
    expect(moments[0].camera!.easing).toBe('smooth');
  });

  it('preserves exact endpoint snapshots and fractional mapping values without rounding', () => {
    const { base, draft, result } = fixture(),
      data = trace();
    data.request.samples = 2;
    data.request.plan.duration = 1.3;
    data.request.start = 0.1;
    data.request.end = 0.3;
    data.mapping = [
      { cameraTime: 0, showTime: 0.1, inFrameLights: 3 },
      { cameraTime: 1.3, showTime: 0.3, inFrameLights: 0 },
    ];
    data.summary = {
      minInFrameLights: 0,
      maxInFrameLights: 3,
      meanInFrameLights: 1.5,
      minIndex: 1,
      maxIndex: 0,
    };
    add(result, data);
    const [minimum, maximum] = buildAgentReviewMoments(base, draft, result);
    expect(minimum.snapshot).toEqual(data.request.plan.to);
    expect(maximum.snapshot).toEqual(data.request.plan.from);
    expect(minimum.time).toBe(0.3);
    expect(minimum.camera!.elapsed).toBe(1.3);
    expect(maximum.time).toBe(0.1);
  });

  it('deduplicates equal extrema at the earliest sample, including a stationary held path', () => {
    const { base, draft, result } = fixture(),
      data = trace();
    data.toViewId = '';
    data.request.toName = data.request.fromName;
    data.request.plan.to = structuredClone(data.request.plan.from);
    data.request.start = data.request.end = 1;
    data.mapping.forEach((row) => {
      row.showTime = 1;
      row.inFrameLights = 2;
    });
    data.summary = {
      minInFrameLights: 2,
      maxInFrameLights: 2,
      meanInFrameLights: 2,
      minIndex: 0,
      maxIndex: 0,
    };
    add(result, data);
    expect(buildAgentReviewMoments(base, draft, result)).toMatchObject([
      { kind: 'minimum', time: 1, camera: { elapsed: 0, sampleIndex: 0, toViewId: '' } },
    ]);
    expect(buildAgentReviewMoments(base, draft, result)).toHaveLength(1);
  });

  it('rejects intermediate and continued-seed measurements unless the full command count is final', () => {
    const { base, draft, result } = fixture();
    add(result, trace(1));
    add(result, trace(2));
    expect(buildAgentReviewMoments(base, draft, result).map(({ eventId }) => eventId)).toEqual([
      4, 4,
    ]);
    result.proposal!.operations.push({ type: 'set_tempo', bpm: 120 });
    expect(buildAgentReviewMoments(base, draft, result)).toEqual([]);
  });

  it('ignores missing or malformed result captures while retaining valid non-camera siblings', () => {
    for (const change of [
      (result: AgentResult) => {
        delete result.viewer;
      },
      (result: AgentResult) => {
        result.viewer!.current.aspect = NaN;
      },
      (result: AgentResult) => {
        result.viewer!.savedViews.push(structuredClone(result.viewer!.savedViews[0]));
      },
      (result: AgentResult) => {
        result.viewer!.current.snapshot.pose.yaw = 360;
      },
    ]) {
      const { base, draft, result } = fixture();
      ordinaryInspection(result);
      add(result, trace());
      change(result);
      expect(buildAgentReviewMoments(base, draft, result).map(({ tool }) => tool)).toEqual([
        'inspect_viewpoint',
      ]);
    }
  });

  it.each([
    [
      'unknown endpoint',
      (d: ReturnType<typeof trace>) => {
        d.toViewId = 'missing';
      },
    ],
    [
      'wrong current label',
      (d: ReturnType<typeof trace>) => {
        d.request.fromName = 'Current view';
      },
    ],
    [
      'wrong saved label',
      (d: ReturnType<typeof trace>) => {
        d.request.toName = 'Changed bookmark';
      },
    ],
    [
      'wrong saved pose',
      (d: ReturnType<typeof trace>) => {
        d.request.plan.to.pose.east += 1;
      },
    ],
    [
      'wrong captured pose',
      (d: ReturnType<typeof trace>) => {
        d.request.plan.from.pose.yaw += 1;
      },
    ],
    [
      'wrong aspect',
      (d: ReturnType<typeof trace>) => {
        d.request.aspect = 2;
      },
    ],
    [
      'moving venue',
      (d: ReturnType<typeof trace>) => {
        d.request.plan.to.venue.north += 1;
      },
    ],
    [
      'noncanonical pose',
      (d: ReturnType<typeof trace>) => {
        d.request.plan.from.pose.yaw = 360;
      },
    ],
    [
      'unbounded ID',
      (d: ReturnType<typeof trace>) => {
        d.fromViewId = 'x'.repeat(81);
      },
    ],
    [
      'untrimmed label',
      (d: ReturnType<typeof trace>) => {
        d.request.toName = ' Upper seats';
      },
    ],
    [
      'unbounded duration',
      (d: ReturnType<typeof trace>) => {
        d.request.plan.duration = 31;
      },
    ],
    [
      'invalid easing',
      (d: ReturnType<typeof trace>) => {
        Object.assign(d.request.plan, { easing: 'elastic' });
      },
    ],
    [
      'unknown plan field',
      (d: ReturnType<typeof trace>) => {
        Object.assign(d.request.plan, { extra: true });
      },
    ],
    [
      'stale provenance',
      (d: ReturnType<typeof trace>) => {
        d.provenance.baseRevision = 6;
      },
    ],
    [
      'wrong project',
      (d: ReturnType<typeof trace>) => {
        d.projectId = 'another-show';
      },
    ],
    [
      'wrong revision',
      (d: ReturnType<typeof trace>) => {
        d.revision = 7;
      },
    ],
    [
      'forged base revision',
      (d: ReturnType<typeof trace>) => {
        d.provenance.revision = 7;
      },
    ],
    [
      'negative operation count',
      (d: ReturnType<typeof trace>) => {
        d.provenance.operationCount = -1;
      },
    ],
    [
      'reversed range',
      (d: ReturnType<typeof trace>) => {
        d.request.start = 5;
      },
    ],
    [
      'out of draft range',
      (d: ReturnType<typeof trace>) => {
        d.request.end = 9;
      },
    ],
    [
      'wrong sample count',
      (d: ReturnType<typeof trace>) => {
        d.request.samples = 4;
      },
    ],
    [
      'too many samples',
      (d: ReturnType<typeof trace>) => {
        d.request.samples = 13;
      },
    ],
    [
      'wrong camera midpoint',
      (d: ReturnType<typeof trace>) => {
        d.mapping[2].cameraTime = 3.999;
      },
    ],
    [
      'wrong show midpoint',
      (d: ReturnType<typeof trace>) => {
        d.mapping[2].showTime = 2.001;
      },
    ],
    [
      'wrong camera endpoint',
      (d: ReturnType<typeof trace>) => {
        d.mapping[4].cameraTime = 8.001;
      },
    ],
    [
      'wrong show endpoint',
      (d: ReturnType<typeof trace>) => {
        d.mapping[4].showTime = 4.001;
      },
    ],
    [
      'missing count',
      (d: ReturnType<typeof trace>) => {
        Reflect.deleteProperty(d.mapping[0], 'inFrameLights');
      },
    ],
    [
      'negative count',
      (d: ReturnType<typeof trace>) => {
        d.mapping[0].inFrameLights = -1;
      },
    ],
    [
      'fractional count',
      (d: ReturnType<typeof trace>) => {
        d.mapping[0].inFrameLights = 1.5;
      },
    ],
    [
      'count above fleet',
      (d: ReturnType<typeof trace>) => {
        d.mapping[0].inFrameLights = 4;
      },
    ],
    [
      'nonfinite row',
      (d: ReturnType<typeof trace>) => {
        d.mapping[0].showTime = Infinity;
      },
    ],
    [
      'unknown row field',
      (d: ReturnType<typeof trace>) => {
        Object.assign(d.mapping[0], { hidden: true });
      },
    ],
    [
      'wrong minimum',
      (d: ReturnType<typeof trace>) => {
        d.summary.minInFrameLights = 1;
      },
    ],
    [
      'wrong maximum',
      (d: ReturnType<typeof trace>) => {
        d.summary.maxInFrameLights = 2;
      },
    ],
    [
      'plausible incorrect mean',
      (d: ReturnType<typeof trace>) => {
        d.summary.meanInFrameLights = 2;
      },
    ],
    [
      'wrong minimum sample',
      (d: ReturnType<typeof trace>) => {
        d.summary.minIndex = 0;
      },
    ],
    [
      'later tied maximum',
      (d: ReturnType<typeof trace>) => {
        d.summary.maxIndex = 4;
      },
    ],
    [
      'outside summary index',
      (d: ReturnType<typeof trace>) => {
        d.summary.maxIndex = 5;
      },
    ],
  ])('fails closed for %s without discarding valid sibling path evidence', (_label, change) => {
    const { base, draft, result } = fixture();
    add(result, trace());
    const invalid = trace();
    change(invalid);
    add(result, invalid);
    expect(buildAgentReviewMoments(base, draft, result).map(({ eventId }) => eventId)).toEqual([
      2, 2,
    ]);
  });

  it('rejects a changed venue even when both endpoints match the captured viewer context', () => {
    const { base, draft, result } = fixture(),
      data = trace();
    data.request.plan.to.venue.heading = 90;
    result.viewer!.savedViews[0].snapshot.venue.heading = 90;
    add(result, data);
    expect(buildAgentReviewMoments(base, draft, result)).toEqual([]);
  });

  it('requires unique successful paired calls and ignores prose suggesting a navigation target', () => {
    for (const corrupt of [
      (result: AgentResult) => {
        result.events.shift();
      },
      (result: AgentResult) => {
        result.events[0].tool = 'inspect_viewpoint';
      },
      (result: AgentResult) => {
        result.events[1].callId = 'unpaired';
      },
      (result: AgentResult) => {
        result.events[1].id = result.events[0].id;
      },
      (result: AgentResult) => {
        result.events.push({ ...result.events[1], id: 3, type: 'validation_error' });
      },
      (result: AgentResult) => {
        result.events.push({ ...result.events[1], id: 3 });
      },
      (result: AgentResult) => {
        result.status = 'failed';
      },
      (result: AgentResult) => {
        result.proposal!.revision = 6;
      },
    ]) {
      const { base, draft, result } = fixture();
      add(result, trace());
      result.message = 'Open the end camera at show time 4; this is a valid measurement.';
      corrupt(result);
      expect(buildAgentReviewMoments(base, draft, result)).toEqual([]);
    }
  });

  it('checks all events before the cap and keeps recent evidence with a place for both versions', () => {
    const { base, draft, result } = fixture();
    add(result, trace(0));
    for (let index = 0; index < 10; index++) {
      const data = trace();
      data.request.start += index / 10;
      data.request.end += index / 10;
      data.mapping.forEach((row, sampleIndex) => {
        row.showTime =
          sampleIndex === 0
            ? data.request.start
            : sampleIndex === 4
              ? data.request.end
              : data.request.start + (data.request.end - data.request.start) * (sampleIndex / 4);
      });
      add(result, data);
    }
    for (let index = 0; index < 10; index++) {
      const invalid = trace();
      invalid.summary.meanInFrameLights = 2;
      add(result, invalid);
    }
    const moments = buildAgentReviewMoments(base, draft, result);
    expect(moments).toHaveLength(12);
    expect(moments[0].eventId).toBe(22);
    expect(moments.some(({ version }) => version === 'base')).toBe(true);
    expect(moments.every(({ eventId }) => eventId <= 22)).toBe(true);
  });
});

function provider(calls: { tool: string; args: object }[]): AgentProvider {
  let index = 0;
  return {
    async complete() {
      const next = calls[index++];
      if (!next) throw new Error('Scripted provider exhausted.');
      const call = {
        id: `fixture-${index}`,
        name: next.tool,
        arguments: JSON.stringify(next.args),
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

describe('camera review moments from the real harness', () => {
  it('binds before/final-draft samples to deeply owned run captures and actual shared evaluator counts', async () => {
    const { base } = fixture();
    base.cues[0].droneEdits = {
      '1': { position: [0, 10, 1], color: '#ffffff', brightness: 1 },
      '2': { position: [10, 0, 1], color: '#ffffff', brightness: 1 },
      '3': { position: [10, 0, 2], color: '#ffffff', brightness: 0 },
    };
    const context = viewer();
    context.current.snapshot.pose = { east: 0, north: 0, eyeHeight: 1, yaw: 0, pitch: 0, fov: 45 };
    context.savedViews[0].snapshot.pose = { ...context.current.snapshot.pose, yaw: 90 };
    const request: AgentRequest = {
      project: base,
      cueId: 'scene',
      selection: [3],
      time: 0,
      prompt: 'Scripted fixture: measure a camera path around the selected-light edit.',
      viewer: context,
    };
    const args = {
      fromViewId: '',
      toViewId: 'end',
      duration: 6,
      easing: 'linear',
      start: 0,
      end: 2,
      samples: 3,
    };
    const original = structuredClone(request);
    const result = await runAgent(request, {
      provider: provider([
        { tool: 'inspect_camera_move', args },
        {
          tool: 'stage_operations',
          args: {
            operationsJson: JSON.stringify([
              { type: 'edit_drones', cueId: 'scene', ids: [3], patch: { brightness: 1 } },
            ]),
            explanation: 'Light the selected drone.',
          },
        },
        { tool: 'inspect_camera_move', args },
        { tool: 'review_draft', args: {} },
        {
          tool: 'finish_proposal',
          args: {
            title: 'Measured lighting',
            description: 'Scripted fixture, not a model-quality result.',
            changes: ['Light drone 3.'],
          },
        },
      ]),
    });
    expect(result.status).toBe('completed');
    expect(result.viewer).toEqual(original.viewer);
    expect(result.viewer).not.toBe(request.viewer);
    expect(result.viewer!.current.snapshot.pose).not.toBe(request.viewer!.current.snapshot.pose);
    expect(result.viewer!.savedViews[0].snapshot.venue).not.toBe(
      request.viewer!.savedViews[0].snapshot.venue
    );
    const draft = applyOperations(base, result.proposal!.operations, result.proposal!.revision);
    const moments = buildAgentReviewMoments(base, draft, result);
    expect(moments.length).toBeGreaterThanOrEqual(2);
    expect(new Set(moments.map(({ version }) => version))).toEqual(new Set(['base', 'draft']));
    for (const moment of moments) {
      expect(moment.inFrameLights).toBe(
        inspectAudienceFrame(
          moment.version === 'base' ? base : draft,
          moment.time,
          moment.snapshot,
          moment.aspect,
          1
        ).totals.inFrustumLightsOn
      );
      expect(moment.camera!.elapsed).toBe(moment.time * 3);
    }
    const traceBeforeMutations = structuredClone(result.events);
    request.viewer!.current.snapshot.pose.yaw = 125;
    request.viewer!.savedViews[0].name = 'Edited after completion';
    expect(result.viewer).toEqual(original.viewer);
    result.viewer!.current.snapshot.pose.yaw = 225;
    result.viewer!.savedViews[0].snapshot.venue.east = 20;
    expect(result.events).toEqual(traceBeforeMutations);
    expect(moments.some(({ snapshot }) => snapshot.pose.yaw === 225)).toBe(false);
    expect(buildAgentReviewMoments(base, draft, result)).toEqual([]);
  });
});
