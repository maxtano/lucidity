import { describe, expect, it } from 'vitest';
import { defaultProject, type Project } from '../core/model';
import type { ViewerSnapshot } from '../core/viewer';
import { buildAgentReviewMoments } from './review-moments';
import type { AgentEvent, AgentResult } from './types';

function fixture() {
  const base = structuredClone(defaultProject);
  base.id = 'review-moments';
  base.revision = 7;
  base.droneCount = 3;
  base.cues = [{ ...base.cues[0], duration: 10, transition: 0 }];
  const draft = structuredClone(base);
  draft.revision = 8;
  draft.cues[0].duration = 8;
  const result: AgentResult = {
    runId: 'owned-run',
    status: 'completed',
    message: 'Proposal ready.',
    proposal: {
      projectId: base.id,
      revision: base.revision,
      title: 'Measured draft',
      description: 'Preview only.',
      changes: ['Two changes.'],
      operations: [
        { type: 'edit_drones', cueId: base.cues[0].id, ids: [1], patch: { brightness: 0.5 } },
        { type: 'retime_cue', id: base.cues[0].id, speed: 1.25 },
      ],
    },
    events: [],
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  return { base, draft, result };
}
const snapshot = (): ViewerSnapshot => ({
  pose: { east: 1.125, north: -2.25, eyeHeight: 1.75, yaw: 25.125, pitch: 35.25, fov: 90 },
  venue: { east: 0, north: 70, heading: 180 },
});
function inspection(operationCount = 0, time = 1) {
  return {
    provenance: {
      projectId: 'review-moments',
      baseRevision: 7,
      revision: operationCount ? 8 : 7,
      operationCount,
    },
    viewId: '',
    viewName: 'Captured current viewpoint',
    snapshot: snapshot(),
    aspect: 1.6,
    time,
    totals: {
      droneCount: 3,
      front: 2,
      right: 1,
      rear: 0,
      left: 0,
      overhead: 1,
      inFrustum: 2,
      lightsOn: 3,
      inFrustumLightsOn: 2,
    },
  };
}
function comparison(operationCount = 2) {
  return {
    provenance: inspection(operationCount).provenance,
    projectId: 'review-moments',
    revision: operationCount ? 8 : 7,
    start: 0,
    end: 2,
    times: [0, 1, 2],
    views: [
      {
        id: 'balcony',
        name: 'Balcony',
        snapshot: snapshot(),
        aspect: 1.6,
        summary: {
          minInFrameLights: 1,
          maxInFrameLights: 3,
          meanInFrameLights: 2,
          minAt: 0,
          maxAt: 2,
        },
      },
    ],
  };
}
function add(
  result: AgentResult,
  tool: 'inspect_viewpoint' | 'compare_viewpoints',
  details: unknown
) {
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
      message: 'Completed.',
    }
  );
}

describe('measured agent review moments', () => {
  it('returns owned exact camera evidence for the base and final draft with stable references', () => {
    const { base, draft, result } = fixture();
    const before = inspection(0, 9),
      after = inspection(2, 7);
    add(result, 'inspect_viewpoint', before);
    add(result, 'inspect_viewpoint', after);
    const original = structuredClone({ base, draft, result });
    const moments = buildAgentReviewMoments(base, draft, result);
    expect(moments).toEqual([
      {
        id: 'owned-run:4:0:inspection',
        version: 'draft',
        tool: 'inspect_viewpoint',
        eventId: 4,
        callId: 'call-3',
        time: 7,
        viewId: '',
        viewName: 'Captured current viewpoint',
        snapshot: snapshot(),
        aspect: 1.6,
        kind: 'inspection',
        inFrameLights: 2,
        droneCount: 3,
      },
      {
        id: 'owned-run:2:0:inspection',
        version: 'base',
        tool: 'inspect_viewpoint',
        eventId: 2,
        callId: 'call-1',
        time: 9,
        viewId: '',
        viewName: 'Captured current viewpoint',
        snapshot: snapshot(),
        aspect: 1.6,
        kind: 'inspection',
        inFrameLights: 2,
        droneCount: 3,
      },
    ]);
    expect(buildAgentReviewMoments(base, draft, result)).toEqual(moments);
    expect({ base, draft, result }).toEqual(original);
    before.snapshot.pose.yaw = 90;
    expect(moments[1].snapshot.pose.yaw).toBe(25.125);
    moments[0].snapshot.venue.north = -50;
    expect(after.snapshot.venue.north).toBe(70);
  });

  it('derives comparison extrema only from measured sample times, retaining both sides', () => {
    const { base, draft, result } = fixture();
    add(result, 'compare_viewpoints', comparison(0));
    add(result, 'compare_viewpoints', comparison(2));
    expect(
      buildAgentReviewMoments(base, draft, result).map(
        ({ version, kind, time, inFrameLights }) => ({ version, kind, time, inFrameLights })
      )
    ).toEqual([
      { version: 'draft', kind: 'minimum', time: 0, inFrameLights: 1 },
      { version: 'draft', kind: 'maximum', time: 2, inFrameLights: 3 },
      { version: 'base', kind: 'minimum', time: 0, inFrameLights: 1 },
      { version: 'base', kind: 'maximum', time: 2, inFrameLights: 3 },
    ]);
  });

  it('deduplicates equal extrema at their earliest measured sample', () => {
    const { base, draft, result } = fixture(),
      data = comparison();
    data.views[0].summary = {
      minInFrameLights: 2,
      maxInFrameLights: 2,
      meanInFrameLights: 2,
      minAt: 0,
      maxAt: 0,
    };
    add(result, 'compare_viewpoints', data);
    expect(buildAgentReviewMoments(base, draft, result)).toMatchObject([
      { kind: 'minimum', time: 0, inFrameLights: 2, version: 'draft' },
    ]);
  });

  it('omits intermediate drafts, including a continued run seed, instead of mistaking shared revision for final', () => {
    const { base, draft, result } = fixture();
    add(result, 'inspect_viewpoint', inspection(1, 0));
    add(result, 'compare_viewpoints', comparison(1));
    add(result, 'inspect_viewpoint', inspection(2, 2));
    expect(buildAgentReviewMoments(base, draft, result)).toMatchObject([
      { version: 'draft', eventId: 6, time: 2 },
    ]);
    result.events = result.events.slice(0, 4);
    expect(buildAgentReviewMoments(base, draft, result)).toEqual([]);
  });

  it('accepts a continued seed as final only when its complete operation count is the final proposal', () => {
    const { base, draft, result } = fixture();
    add(result, 'inspect_viewpoint', inspection(2));
    expect(buildAgentReviewMoments(base, draft, result)).toMatchObject([{ version: 'draft' }]);
    result.proposal!.operations.push({ type: 'set_tempo', bpm: 120 });
    expect(buildAgentReviewMoments(base, draft, result)).toEqual([]);
  });

  it('ignores legacy and recovery traces without provenance, even if prose claims a measurement', () => {
    const { base, draft, result } = fixture();
    const old = inspection() as Record<string, unknown>;
    delete old.provenance;
    add(result, 'inspect_viewpoint', old);
    result.message = 'Open the final draft at 6 seconds facing south.';
    result.proposal!.description = result.message;
    result.events.push({
      id: 3,
      at: '',
      type: 'completed',
      message: result.message,
      details: { time: 6, snapshot: snapshot() },
    });
    expect(buildAgentReviewMoments(base, draft, result)).toEqual([]);
  });

  it.each(['failed', 'cancelled'] as const)('omits evidence from a %s run', (status) => {
    const { base, draft, result } = fixture();
    add(result, 'inspect_viewpoint', inspection());
    result.status = status;
    expect(buildAgentReviewMoments(base, draft, result)).toEqual([]);
  });

  it('rejects incompatible proposal/doc identities and invalid fleet/duration without throwing', () => {
    const original = fixture();
    add(original.result, 'inspect_viewpoint', inspection());
    const mutations: ((value: ReturnType<typeof fixture>) => void)[] = [
      ({ result }) => {
        result.proposal = undefined;
      },
      ({ result }) => {
        result.proposal!.projectId = 'different';
      },
      ({ result }) => {
        result.proposal!.revision = 8;
      },
      ({ result }) => {
        result.proposal!.operations = [];
      },
      ({ result }) => {
        result.runId = '';
      },
      ({ base }) => {
        base.revision = Number.MAX_SAFE_INTEGER;
      },
      ({ draft }) => {
        draft.id = 'different';
      },
      ({ draft }) => {
        draft.revision = 7;
      },
      ({ base }) => {
        base.droneCount = 0;
      },
      ({ draft }) => {
        draft.droneCount = 100001;
      },
      ({ base }) => {
        base.cues[0].duration = Infinity;
      },
    ];
    for (const mutate of mutations) {
      const input = structuredClone(original);
      mutate(input);
      expect(buildAgentReviewMoments(input.base, input.draft, input.result)).toEqual([]);
    }
  });

  it('requires correct project, base revision, measured revision, and integral operation count', () => {
    for (const patch of [
      { projectId: 'other' },
      { baseRevision: 8 },
      { revision: 7 },
      { operationCount: -1 },
      { operationCount: 0.5 },
      { operationCount: 129 },
    ]) {
      const { base, draft, result } = fixture(),
        data = inspection(2);
      Object.assign(data.provenance, patch);
      add(result, 'inspect_viewpoint', data);
      expect(buildAgentReviewMoments(base, draft, result)).toEqual([]);
    }
  });

  it('validates against the matching version duration and fleet, including exact endpoints', () => {
    const { base, draft, result } = fixture();
    add(result, 'inspect_viewpoint', inspection(0, 10));
    add(result, 'inspect_viewpoint', inspection(2, 8));
    add(result, 'inspect_viewpoint', inspection(2, 9));
    expect(
      buildAgentReviewMoments(base, draft, result).map(({ version, time }) => [version, time])
    ).toEqual([
      ['draft', 8],
      ['base', 10],
    ]);
    draft.droneCount = 2;
    expect(buildAgentReviewMoments(base, draft, result).map(({ version }) => version)).toEqual([
      'base',
    ]);
  });

  it('rejects noncanonical camera values rather than normalizing them', () => {
    const patches: ((data: ReturnType<typeof inspection>) => void)[] = [
      (data) => {
        data.snapshot.pose.yaw = 360;
      },
      (data) => {
        data.snapshot.pose.pitch = 90;
      },
      (data) => {
        data.snapshot.pose.fov = 101;
      },
      (data) => {
        data.snapshot.pose.eyeHeight = 0.1;
      },
      (data) => {
        data.snapshot.pose.east = 501;
      },
      (data) => {
        data.snapshot.venue.heading = -1;
      },
      (data) => {
        data.snapshot.venue.north = Infinity;
      },
      (data) => {
        data.snapshot.pose.yaw = NaN;
      },
      (data) => {
        Object.assign(data.snapshot.pose, { roll: 30 });
      },
      (data) => {
        data.aspect = 0;
      },
      (data) => {
        data.aspect = 101;
      },
      (data) => {
        data.viewName = ' padded ';
      },
      (data) => {
        data.viewId = 'x'.repeat(81);
      },
      (data) => {
        data.time = -1;
      },
      (data) => {
        data.time = Infinity;
      },
    ];
    for (const patch of patches) {
      const { base, draft, result } = fixture(),
        data = inspection();
      patch(data);
      add(result, 'inspect_viewpoint', data);
      expect(buildAgentReviewMoments(base, draft, result)).toEqual([]);
    }
  });

  it('rejects inconsistent and malformed inspection totals', () => {
    for (const patch of [
      { droneCount: 4 },
      { front: 3 },
      { overhead: 4 },
      { inFrustum: 1 },
      { lightsOn: 1 },
      { inFrustumLightsOn: 4 },
      { inFrustumLightsOn: -1 },
      { inFrustumLightsOn: 1.5 },
      { inFrustumLightsOn: NaN },
    ]) {
      const { base, draft, result } = fixture(),
        data = inspection();
      Object.assign(data.totals, patch);
      add(result, 'inspect_viewpoint', data);
      expect(buildAgentReviewMoments(base, draft, result)).toEqual([]);
    }
  });

  it('rejects malformed comparison time grids, summaries, identity, and duplicate viewpoints', () => {
    const patches: ((data: ReturnType<typeof comparison>) => void)[] = [
      (data) => {
        data.projectId = 'other';
      },
      (data) => {
        data.revision = 7;
      },
      (data) => {
        data.start = 0.5;
      },
      (data) => {
        data.end = 3;
      },
      (data) => {
        data.times = [0, 0, 2];
      },
      (data) => {
        data.times = [0, 2, 1];
        data.end = 1;
      },
      (data) => {
        data.times = [0, Infinity, 2];
      },
      (data) => {
        data.times = [0];
        data.end = 0;
      },
      (data) => {
        data.times = [0, 1, 9];
        data.end = 9;
      },
      (data) => {
        data.views.push(structuredClone(data.views[0]));
      },
      (data) => {
        data.views[0].summary.minAt = 0.5;
      },
      (data) => {
        data.views[0].summary.maxAt = 0;
      },
      (data) => {
        data.views[0].summary.maxInFrameLights = 4;
      },
      (data) => {
        data.views[0].summary.minInFrameLights = 4;
      },
      (data) => {
        data.views[0].summary.meanInFrameLights = 3.01;
      },
      (data) => {
        data.views[0].summary.meanInFrameLights = NaN;
      },
      (data) => {
        data.views[0].snapshot.pose.yaw = -1;
      },
      (data) => {
        data.views[0].summary = {
          minInFrameLights: 2,
          maxInFrameLights: 2,
          meanInFrameLights: 2,
          minAt: 1,
          maxAt: 1,
        };
      },
    ];
    for (const patch of patches) {
      const { base, draft, result } = fixture(),
        data = comparison();
      patch(data);
      add(result, 'compare_viewpoints', data);
      expect(buildAgentReviewMoments(base, draft, result)).toEqual([]);
    }
  });

  it('requires an unambiguous earlier successful tool start with matching tool and call ID', () => {
    const patches: ((events: AgentEvent[]) => void)[] = [
      (events) => {
        events.shift();
      },
      (events) => {
        events.reverse();
      },
      (events) => {
        events[0].tool = 'sample_frame';
      },
      (events) => {
        events[0].callId = 'another';
      },
      (events) => {
        events[1].callId = 'x'.repeat(201);
      },
      (events) => {
        events[0].id = events[1].id;
      },
      (events) => {
        events[0].id = 3;
      },
      (events) => {
        events[1].id = 1.5;
      },
      (events) => {
        events.push({ ...events[0], id: 3 });
      },
      (events) => {
        events.push({ ...events[1], id: 3 });
      },
      (events) => {
        events.push({ ...events[0], id: 3, type: 'validation_error' });
      },
      (events) => {
        events.push({ id: 2, type: 'phase', at: '', message: '' });
      },
    ];
    for (const patch of patches) {
      const { base, draft, result } = fixture();
      add(result, 'inspect_viewpoint', inspection());
      patch(result.events);
      expect(buildAgentReviewMoments(base, draft, result)).toEqual([]);
    }
  });

  it('deduplicates identical geometry/time/aspect across names and tools, preferring the latest evidence', () => {
    const { base, draft, result } = fixture();
    add(result, 'inspect_viewpoint', inspection(2, 0));
    const changedName = inspection(2, 0);
    changedName.viewName = 'Same camera renamed';
    changedName.viewId = 'same-camera';
    add(result, 'inspect_viewpoint', changedName);
    add(result, 'compare_viewpoints', comparison());
    const moments = buildAgentReviewMoments(base, draft, result);
    expect(moments).toHaveLength(2);
    expect(moments.every((moment) => moment.eventId === 6)).toBe(true);
    const differentAspect = inspection(2, 0);
    differentAspect.aspect = 1;
    add(result, 'inspect_viewpoint', differentAspect);
    expect(buildAgentReviewMoments(base, draft, result)).toHaveLength(3);
  });

  it('caps after validation, prioritizes recent records, and preserves older valid Before evidence', () => {
    const { base, draft, result } = fixture();
    add(result, 'inspect_viewpoint', inspection(0, 0));
    for (let i = 1; i <= 16; i++) add(result, 'inspect_viewpoint', inspection(2, i / 4));
    for (let i = 0; i < 20; i++) {
      const malformed = inspection(2, i / 4);
      malformed.aspect = 0;
      add(result, 'inspect_viewpoint', malformed);
    }
    const moments = buildAgentReviewMoments(base, draft, result);
    expect(moments).toHaveLength(12);
    expect(moments[0]).toMatchObject({ version: 'draft', time: 4, eventId: 34 });
    expect(moments.at(-1)).toMatchObject({ version: 'base', time: 0, eventId: 2 });
    expect(
      moments.filter((moment) => moment.version === 'draft').map((moment) => moment.time)
    ).toEqual([4, 3.75, 3.5, 3.25, 3, 2.75, 2.5, 2.25, 2, 1.75, 1.5]);
    expect(new Set(moments.map((moment) => moment.id)).size).toBe(12);
  });

  it('fails closed for excessively large traces or malformed top-level records without breaking preview', () => {
    const { base, draft, result } = fixture();
    for (let i = 0; i < 129; i++) add(result, 'inspect_viewpoint', inspection());
    expect(buildAgentReviewMoments(base, draft, result)).toEqual([]);
    expect(buildAgentReviewMoments(base, draft, null as unknown as AgentResult)).toEqual([]);
    expect(buildAgentReviewMoments(null as unknown as Project, draft, result)).toEqual([]);
    result.events = [null, {}, 1] as unknown as AgentEvent[];
    add(result, 'inspect_viewpoint', inspection());
    expect(buildAgentReviewMoments(base, draft, result)).toHaveLength(1);
  });
});
