import { describe, expect, it, vi } from 'vitest';
import { ShowEvaluator } from './animation';
import { compareAudienceViews, type AudienceComparisonRequest } from './audience-comparison';
import { defaultProject, type Project } from './model';
import { DEFAULT_VENUE_PLACEMENT, DEFAULT_VIEWER_POSE } from './viewer';

function project(): Project {
  const value = structuredClone(defaultProject);
  value.id = 'comparison-fixture';
  value.revision = 9;
  value.droneCount = 4;
  value.cues = [{ ...value.cues[0], duration: 3, transition: 0, droneEdits: {
    1: { position: [0, 10, 1], color: '#ffffff' },
    2: { color: '#ffffff', keyframes: [
      { time: 0, position: [0, 10, 1] }, { time: 1, position: [10, 0, 1] }, { time: 2, position: [0, -10, 1] },
    ] },
    3: { position: [0, -10, 1], color: '#ffffff', keyframes: [
      { time: 0, brightness: 0 }, { time: 1, brightness: 1 }, { time: 2, brightness: 0 },
    ] },
    4: { position: [10, 0, 1], color: '#ffffff' },
  } }];
  return value;
}
function request(): AudienceComparisonRequest {
  const snapshot = { pose: { ...DEFAULT_VIEWER_POSE, eyeHeight: 1, pitch: 0, fov: 60 }, venue: { ...DEFAULT_VENUE_PLACEMENT } };
  return { start: 0, end: 2, samples: 3, views: [
    { id: '', name: 'Current', snapshot, aspect: 1 },
    { id: 'rear', name: 'Rear view', snapshot: { ...snapshot, pose: { ...snapshot.pose, yaw: 180 } }, aspect: 1 },
  ] };
}

describe('sampled audience comparisons', () => {
  it('summarizes independently varying in-frame lights for each view, with earliest min/max ties', async () => {
    const progress: [number, number][] = [];
    const report = await compareAudienceViews(project(), request(), { onProgress: (done, total) => progress.push([done, total]) });
    expect(report).toMatchObject({ projectId: 'comparison-fixture', revision: 9, times: [0, 1, 2] });
    expect(report.views.map((view) => view.samples.map((sample) => sample.totals.inFrustumLightsOn)))
      .toEqual([[2, 1, 1], [0, 1, 1]]);
    expect(report.views[0].summary).toEqual({ minInFrameLights: 1, maxInFrameLights: 2, meanInFrameLights: 4 / 3, minAt: 1, maxAt: 0 });
    expect(report.views[1].summary).toEqual({ minInFrameLights: 0, maxInFrameLights: 1, meanInFrameLights: 2 / 3, minAt: 0, maxAt: 1 });
    expect(progress).toEqual(Array.from({ length: 6 }, (_, index) => [index + 1, 6]));
    for (const view of report.views)
      for (const sample of view.samples) {
        expect(sample.totals.droneCount).toBe(4);
        expect(sample.totals.front + sample.totals.right + sample.totals.rear + sample.totals.left).toBe(4);
        expect(sample).not.toHaveProperty('drones');
      }
    expect(report.limitations.join(' ')).toContain('not continuous coverage');
  });

  it('includes exact interval endpoints for fractional sampling', async () => {
    const input = request();
    input.start = 0.1;
    input.end = 0.3;
    input.samples = 4;
    input.views = input.views.slice(0, 1);
    const report = await compareAudienceViews(project(), input);
    expect(report.times).toHaveLength(4);
    expect(report.times[0]).toBe(input.start);
    expect(report.times.at(-1)).toBe(input.end);
    expect(report.views[0].samples.map((sample) => sample.time)).toEqual(report.times);
    expect(report.times[1]).toBeCloseTo(1 / 6, 14);
  });

  it('owns project and viewpoint snapshots before yielding and does not mutate callers', async () => {
    const base = project(), input = request();
    const originalBase = structuredClone(base), originalRequest = structuredClone(input);
    const control = await compareAudienceViews(originalBase, originalRequest);
    const report = await compareAudienceViews(base, input, { onProgress(done) {
      if (done === 1) {
        base.id = 'changed-after-start';
        base.revision = 999;
        base.cues[0].droneEdits![1].color = '#000000';
        base.cues[0].droneEdits![2].keyframes![2].position = [0, 10, 1];
        input.views[0].snapshot.pose.yaw = 180;
        input.views[0].name = 'Changed';
        input.views[1].snapshot.venue.north = -70;
        input.views.length = 1;
        input.start = 2;
      }
    } });
    expect(report).toEqual(control);
    expect(originalBase).toEqual(project());
    expect(originalRequest).toEqual(request());
    report.views[0].snapshot.pose.east = 77;
    expect(originalRequest.views[0].snapshot.pose.east).toBe(0);
  });

  it('preflights every view and request bound before any evaluator runs', async () => {
    const invalid: AudienceComparisonRequest[] = [
      { ...request(), start: -1 }, { ...request(), start: 2, end: 2 },
      { ...request(), start: 2, end: 1 }, { ...request(), end: 4 },
      { ...request(), start: NaN }, { ...request(), end: Infinity },
      ...[1, 13, 2.5, NaN].map((samples) => ({ ...request(), samples })),
      { ...request(), views: [] },
      { ...request(), views: Array.from({ length: 5 }, (_, index) => ({ ...request().views[0], id: `v${index}` })) },
      { ...request(), views: [request().views[0], request().views[0]] },
    ];
    const badPose = request(); badPose.views[1].snapshot.pose.yaw = 360; invalid.push(badPose);
    const badAspect = request(); badAspect.views[1].aspect = 0; invalid.push(badAspect);
    const badName = request(); badName.views[0].name = ' x '; invalid.push(badName);
    const spy = vi.spyOn(ShowEvaluator.prototype, 'frame');
    try {
      for (const candidate of invalid) await expect(compareAudienceViews(project(), candidate)).rejects.toThrow();
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it('enforces total point work across all samples and views before evaluation', async () => {
    const base = project(); base.droneCount = 100000;
    const input = request(); input.samples = 12;
    const spy = vi.spyOn(ShowEvaluator.prototype, 'frame');
    try {
      await expect(compareAudienceViews(base, input)).rejects.toThrow('2,000,000 point');
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it('counts repeated views in the aggregate key-work budget even with identical poses', async () => {
    const base = project(); base.droneCount = 70;
    const keys = Array.from({ length: 2048 }, (_, index) => ({ time: index / 2, brightness: 0.5 }));
    base.cues[0].droneEdits = Object.fromEntries(Array.from({ length: 70 }, (_, index) => [index + 1, { keyframes: keys }]));
    const input = request(); input.samples = 2;
    input.views = Array.from({ length: 4 }, (_, index) => ({ ...input.views[0], id: `identical-${index}` }));
    const spy = vi.spyOn(ShowEvaluator.prototype, 'frame');
    try {
      await expect(compareAudienceViews(base, input)).rejects.toThrow('20,000,000 aggregate');
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it('rejects a heavy later frame before returning any earlier partial inspection', async () => {
    const base = project(); base.droneCount = 130; base.cues[0].duration = 1;
    const keys = Array.from({ length: 2048 }, (_, index) => ({ time: index / 2, brightness: 0.5 }));
    base.cues.push({ ...base.cues[0], id: 'heavy', duration: 2,
      droneEdits: Object.fromEntries(Array.from({ length: 130 }, (_, index) => [index + 1, { keyframes: keys }])) });
    const progress = vi.fn();
    const spy = vi.spyOn(ShowEvaluator.prototype, 'frame');
    try {
      await expect(compareAudienceViews(base, request(), { onProgress: progress })).rejects.toThrow('key-evaluation budget');
      expect(spy).not.toHaveBeenCalled();
      expect(progress).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it('rejects already-cancelled work without evaluating or calling progress', async () => {
    const controller = new AbortController(); controller.abort();
    const progress = vi.fn();
    const spy = vi.spyOn(ShowEvaluator.prototype, 'frame');
    try {
      await expect(compareAudienceViews(project(), request(), { signal: controller.signal, onProgress: progress }))
        .rejects.toMatchObject({ name: 'AbortError' });
      expect(spy).not.toHaveBeenCalled();
      expect(progress).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it('yields to timer cancellation after progress and publishes no partial report', async () => {
    const controller = new AbortController();
    const progress: number[] = [];
    const spy = vi.spyOn(ShowEvaluator.prototype, 'frame');
    try {
      await expect(compareAudienceViews(project(), request(), {
        signal: controller.signal,
        onProgress(done) { progress.push(done); if (done === 1) setTimeout(() => controller.abort(), 0); },
      })).rejects.toMatchObject({ name: 'AbortError' });
      expect(progress).toEqual([1]);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
  });

  it('isolates a failed progress observer from deterministic sampled results', async () => {
    const normal = await compareAudienceViews(project(), request());
    expect(await compareAudienceViews(project(), request(), { onProgress() { throw new Error('Observer failed'); } })).toEqual(normal);
  });
});
