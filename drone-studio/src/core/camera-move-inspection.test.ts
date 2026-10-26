import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShowEvaluator } from './animation';
import { createCameraAuditionPlan } from './camera-audition';
import { inspectCameraMove, type CameraMoveRequest } from './camera-move-inspection';
import { defaultProject, type Project, type Vector3Tuple } from './model';
import type { ViewerSnapshot } from './viewer';

function project(
  positions: Vector3Tuple[] = [
    [-5.773502692, 10, 1],
    [0, 10, 1],
    [5.773502692, 10, 1],
    [0, -10, 1],
  ]
): Project {
  const value = structuredClone(defaultProject);
  value.id = 'camera-inspection-fixture';
  value.revision = 9;
  value.droneCount = positions.length;
  value.cues = [
    {
      ...value.cues[0],
      id: 'opening',
      duration: 3,
      transition: 0,
      droneEdits: Object.fromEntries(
        positions.map((position, index) => [
          index + 1,
          { position, color: '#ffffff', brightness: index === 2 ? 0 : 1 },
        ])
      ),
    },
  ];
  return value;
}
function snapshot(yaw: number): ViewerSnapshot {
  return {
    pose: { east: 0, north: 0, eyeHeight: 1, yaw, pitch: 0, fov: 45 },
    venue: { east: 0, north: 70, heading: 180 },
  };
}
function request(): CameraMoveRequest {
  return {
    plan: createCameraAuditionPlan(snapshot(350), snapshot(10), 8, 'linear'),
    aspect: 1,
    fromName: 'Left audience',
    toName: 'Right audience',
    start: 0,
    end: 2,
    samples: 3,
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('sampled composition along a private camera move', () => {
  it('measures the short yaw arc using independently placed±30° drones and keeps darkness separate', async () => {
    const progress: [number, number][] = [];
    const result = await inspectCameraMove(project(), request(), {
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(result).toMatchObject({
      projectId: 'camera-inspection-fixture',
      revision: 9,
      request: request(),
    });
    expect(
      result.samples.map((row) => [row.cameraTime, row.showTime, row.snapshot.pose.yaw])
    ).toEqual([
      [0, 0, 350],
      [4, 1, 0],
      [8, 2, 10],
    ]);
    expect(result.samples.map((row) => row.totals.inFrustum)).toEqual([2, 1, 2]);
    expect(result.samples.map((row) => row.totals.inFrustumLightsOn)).toEqual([2, 1, 1]);
    expect(result.summary).toEqual({
      minInFrameLights: 1,
      maxInFrameLights: 2,
      meanInFrameLights: 4 / 3,
      minIndex: 1,
      maxIndex: 0,
    });
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    for (const row of result.samples) {
      expect(row.totals).toMatchObject({
        droneCount: 4,
        front: 3,
        rear: 1,
        right: 0,
        left: 0,
        lightsOn: 3,
      });
      expect(row).not.toHaveProperty('drones');
    }
    expect(result.limitations.join(' ')).toContain('not continuous coverage');
  });

  it('evaluates temporal position/brightness keys and flashing lights on the mapped show clock', async () => {
    const value = project([
      [0, 10, 1],
      [0, 10, 1],
      [0, 10, 1],
    ]);
    value.cues[0].droneEdits = {
      1: {
        position: [0, 10, 1],
        color: '#ffffff',
        keyframes: [
          { time: 0, brightness: 0 },
          { time: 0.5, brightness: 1 },
          { time: 1, brightness: 0 },
        ],
      },
      2: {
        color: '#ffffff',
        keyframes: [
          { time: 0, position: [0, 10, 1] },
          { time: 0.5, position: [10, 0, 1] },
          { time: 1, position: [0, 10, 1] },
        ],
      },
      3: { position: [0, 10, 1], color: '#ffffff', flash: { hz: 1, duty: 0.5, phase: 0.5 } },
    };
    const input = request();
    input.plan = createCameraAuditionPlan(snapshot(0), snapshot(0), 12, 'linear');
    input.end = 1;
    const result = await inspectCameraMove(value, input);
    expect(result.samples.map((row) => [row.cameraTime, row.showTime])).toEqual([
      [0, 0],
      [6, 0.5],
      [12, 1],
    ]);
    expect(result.samples.map((row) => row.totals.inFrustumLightsOn)).toEqual([1, 2, 1]);
    expect(result.samples.map((row) => row.totals.inFrustum)).toEqual([3, 2, 3]);
    expect(result.samples.map((row) => row.totals.lightsOn)).toEqual([1, 3, 1]);
  });

  it('includes actual incoming scene blending rather than inspecting only unblended scene targets', async () => {
    const value = project([
      [0, 10, 1],
      [0, 10, 1],
    ]);
    value.cues[0].duration = 1;
    value.cues[0].droneEdits![2].brightness = 0;
    value.cues.push({
      ...value.cues[0],
      id: 'next',
      duration: 2,
      transition: 2,
      transitionEasing: 'linear',
      droneEdits: {
        1: { position: [30, 10, 1], color: '#ffffff' },
        2: { position: [0, 10, 1], color: '#ffffff', brightness: 1 },
      },
    });
    const input = request();
    input.plan = createCameraAuditionPlan(snapshot(0), snapshot(0), 8, 'linear');
    input.start = 1;
    input.end = 3;
    const result = await inspectCameraMove(value, input);
    expect(result.samples.map((row) => row.totals.inFrustum)).toEqual([2, 1, 1]);
    expect(result.samples.map((row) => row.totals.lightsOn)).toEqual([1, 2, 2]);
    expect(result.samples.map((row) => row.totals.inFrustumLightsOn)).toEqual([1, 1, 1]);
    expect(result.summary).toEqual({
      minInFrameLights: 1,
      maxInFrameLights: 1,
      meanInFrameLights: 1,
      minIndex: 0,
      maxIndex: 0,
    });
  });

  it('keeps a held final show frame while moving the camera through the positive180° tie', async () => {
    const value = project([
      [0, 10, 1],
      [10, 0, 1],
      [0, -10, 1],
    ]);
    value.cues[0].droneEdits![3].brightness = 1;
    const input = request();
    input.start = input.end = 3;
    input.plan = createCameraAuditionPlan(snapshot(0), snapshot(180), 10, 'linear');
    const result = await inspectCameraMove(value, input);
    expect(
      result.samples.map((row) => [row.cameraTime, row.showTime, row.snapshot.pose.yaw])
    ).toEqual([
      [0, 3, 0],
      [5, 3, 90],
      [10, 3, 180],
    ]);
    expect(result.samples.map((row) => row.totals.inFrustumLightsOn)).toEqual([1, 1, 1]);
    expect(result.samples[0].snapshot).toEqual(input.plan.from);
    expect(result.samples.at(-1)!.snapshot).toEqual(input.plan.to);
    expect(result.summary.minIndex).toBe(0);
    expect(result.summary.maxIndex).toBe(0);
  });

  it('preserves exact fractional endpoints and maps easing only onto camera pose, not either time grid', async () => {
    const input = request();
    input.start = 0.1;
    input.end = 0.3;
    input.samples = 5;
    input.plan = createCameraAuditionPlan(snapshot(0), snapshot(80), 1.25, 'smooth');
    const result = await inspectCameraMove(project(), input);
    expect(result.samples.map((row) => row.cameraTime)).toEqual([0, 0.3125, 0.625, 0.9375, 1.25]);
    expect(result.samples[0].showTime).toBe(0.1);
    expect(result.samples.at(-1)!.showTime).toBe(0.3);
    expect(result.samples.map((row) => row.snapshot.pose.yaw)).toEqual([0, 12.5, 40, 67.5, 80]);
    expect(result.samples[1].showTime).toBeCloseTo(0.15, 15);
    expect(result.samples[3].showTime).toBeCloseTo(0.25, 15);
  });

  it('uses the captured aspect for perspective membership while leaving camera geometry unchanged', async () => {
    const value = project([[15, 10, 1]]),
      input = request();
    const view = snapshot(0);
    view.pose.fov = 90;
    input.plan = createCameraAuditionPlan(view, view, 2, 'linear');
    const narrow = await inspectCameraMove(value, input);
    const wide = await inspectCameraMove(value, { ...input, aspect: 2 });
    expect(narrow.samples.map((row) => row.totals.inFrustumLightsOn)).toEqual([0, 0, 0]);
    expect(wide.samples.map((row) => row.totals.inFrustumLightsOn)).toEqual([1, 1, 1]);
    expect(narrow.samples.map((row) => row.snapshot)).toEqual(
      wide.samples.map((row) => row.snapshot)
    );
  });

  it('owns project, plan, labels, and request bounds before progress callbacks or asynchronous edits', async () => {
    const value = project(),
      input = request(),
      original = structuredClone({ value, input });
    const control = await inspectCameraMove(original.value, original.input);
    const result = await inspectCameraMove(value, input, {
      onProgress(done) {
        if (done === 1) {
          value.id = 'changed';
          value.revision = 99;
          value.cues[0].droneEdits![1].brightness = 0;
          value.cues[0].droneEdits![2].position = [0, -10, 1];
          input.plan.from.pose.yaw = 180;
          input.plan.to.venue.north = -70;
          input.plan.duration = 30;
          input.aspect = 100;
          input.fromName = 'Changed';
          input.toName = 'Other';
          input.start = 2;
          input.end = 3;
          input.samples = 12;
        }
      },
    });
    expect(result).toEqual(control);
    expect(original.value).toEqual(project());
    expect(original.input).toEqual(request());
    result.request.plan.from.pose.east = 77;
    expect(result.samples[0].snapshot.pose.east).toBe(0);
    result.samples[0].snapshot.venue.north = 33;
    expect(result.samples[1].snapshot.venue.north).toBe(70);
    expect(result.request.plan.from.venue.north).toBe(70);
  });

  it('validates plan, labels, interval, aspect, and sample count before any evaluator runs', async () => {
    const mutations: ((input: CameraMoveRequest) => void)[] = [
      (input) => {
        input.start = -1;
      },
      (input) => {
        input.end = 4;
      },
      (input) => {
        input.start = 2;
        input.end = 1;
      },
      (input) => {
        input.start = NaN;
      },
      (input) => {
        input.end = Infinity;
      },
      (input) => {
        input.samples = 1;
      },
      (input) => {
        input.samples = 13;
      },
      (input) => {
        input.samples = 2.5;
      },
      (input) => {
        input.aspect = 0;
      },
      (input) => {
        input.aspect = 101;
      },
      (input) => {
        input.fromName = ' padded ';
      },
      (input) => {
        input.toName = '';
      },
      (input) => {
        input.toName = 'n'.repeat(49);
      },
      (input) => {
        input.plan.duration = 0;
      },
      (input) => {
        input.plan.easing = 'other' as 'linear';
      },
      (input) => {
        input.plan.to.pose.yaw = 360;
      },
      (input) => {
        input.plan.from.pose.pitch = 90;
      },
      (input) => {
        input.plan.to.venue.east = 1;
      },
      (input) => {
        Object.assign(input.plan, { extra: true });
      },
    ];
    const spy = vi.spyOn(ShowEvaluator.prototype, 'frame'),
      progress = vi.fn();
    for (const mutate of mutations) {
      const input = request();
      mutate(input);
      await expect(inspectCameraMove(project(), input, { onProgress: progress })).rejects.toThrow();
    }
    expect(spy).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });

  it('defensively rejects excessive point work and invalid fleet sizes before evaluation', async () => {
    const value = project();
    value.droneCount = 200001;
    const input = request();
    input.samples = 12;
    const spy = vi.spyOn(ShowEvaluator.prototype, 'frame');
    await expect(inspectCameraMove(value, input)).rejects.toThrow('2,000,000 point');
    value.droneCount = 100001;
    input.samples = 2;
    await expect(inspectCameraMove(value, input)).rejects.toThrow('1–100,000');
    expect(spy).not.toHaveBeenCalled();
  });

  it('preflights aggregate key work across repeated held frames before any partial sample', async () => {
    const value = project();
    value.droneCount = 70;
    const keys = Array.from({ length: 2048 }, (_, index) => ({ time: index / 2, brightness: 0.5 }));
    value.cues[0].droneEdits = Object.fromEntries(
      Array.from({ length: 70 }, (_, index) => [index + 1, { keyframes: keys }])
    );
    const input = request();
    input.samples = 8;
    input.start = input.end = 1;
    const spy = vi.spyOn(ShowEvaluator.prototype, 'frame'),
      progress = vi.fn();
    await expect(inspectCameraMove(value, input, { onProgress: progress })).rejects.toThrow(
      '20,000,000 aggregate'
    );
    expect(spy).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });

  it('preflights a heavy later scene before the first otherwise cheap frame', async () => {
    const value = project();
    value.droneCount = 130;
    value.cues[0].duration = 1;
    const keys = Array.from({ length: 2048 }, (_, index) => ({ time: index / 2, brightness: 0.5 }));
    value.cues.push({
      ...value.cues[0],
      id: 'heavy',
      duration: 2,
      droneEdits: Object.fromEntries(
        Array.from({ length: 130 }, (_, index) => [index + 1, { keyframes: keys }])
      ),
    });
    const spy = vi.spyOn(ShowEvaluator.prototype, 'frame'),
      progress = vi.fn();
    await expect(inspectCameraMove(value, request(), { onProgress: progress })).rejects.toThrow(
      'key-evaluation budget'
    );
    expect(spy).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });

  it('covers100,000 active drones while returning only bounded aggregate sample rows', async () => {
    const value = project();
    value.droneCount = 100000;
    const input = request();
    input.samples = 2;
    const result = await inspectCameraMove(value, input);
    expect(result.samples).toHaveLength(2);
    for (const row of result.samples) {
      expect(row.totals.droneCount).toBe(100000);
      expect(row.totals.front + row.totals.right + row.totals.rear + row.totals.left).toBe(100000);
    }
    expect(JSON.stringify(result).length).toBeLessThan(5000);
    expect(JSON.stringify(result)).not.toContain('"drones":');
  });

  it('cancels before evaluation or between rows with no partial report, including the final yield', async () => {
    const spy = vi.spyOn(ShowEvaluator.prototype, 'frame');
    const before = new AbortController();
    before.abort();
    const preProgress = vi.fn();
    await expect(
      inspectCameraMove(project(), request(), { signal: before.signal, onProgress: preProgress })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(spy).not.toHaveBeenCalled();
    expect(preProgress).not.toHaveBeenCalled();
    for (const cancelAt of [1, 3]) {
      const controller = new AbortController(),
        progress: number[] = [];
      spy.mockClear();
      await expect(
        inspectCameraMove(project(), request(), {
          signal: controller.signal,
          onProgress(done) {
            progress.push(done);
            if (done === cancelAt) setTimeout(() => controller.abort(), 0);
          },
        })
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(progress).toEqual(Array.from({ length: cancelAt }, (_, index) => index + 1));
      expect(spy).toHaveBeenCalledTimes(cancelAt);
    }
  });

  it('isolates progress observer failures from measured results', async () => {
    const normal = await inspectCameraMove(project(), request());
    expect(
      await inspectCameraMove(project(), request(), {
        onProgress() {
          throw new Error('Observer failed.');
        },
      })
    ).toEqual(normal);
  });

  it('uses the established worker job protocol for progress, result, and validation errors', async () => {
    const surface = {
      onmessage: null as
        | ((
            event: MessageEvent<{ id: number; project: Project; request: CameraMoveRequest }>
          ) => Promise<void>)
        | null,
      postMessage: vi.fn(),
    };
    vi.stubGlobal('self', surface);
    await import('./camera-move-inspection.worker');
    await surface.onmessage!({
      data: { id: 42, project: project(), request: request() },
    } as MessageEvent);
    expect(surface.postMessage.mock.calls.slice(0, 3).map(([message]) => message)).toEqual([
      { id: 42, type: 'progress', completed: 1, total: 3 },
      { id: 42, type: 'progress', completed: 2, total: 3 },
      { id: 42, type: 'progress', completed: 3, total: 3 },
    ]);
    expect(surface.postMessage.mock.calls[3][0]).toMatchObject({
      id: 42,
      type: 'result',
      report: { projectId: 'camera-inspection-fixture' },
    });
    surface.postMessage.mockClear();
    await surface.onmessage!({
      data: { id: 43, project: project(), request: { ...request(), start: -1 } },
    } as MessageEvent);
    expect(surface.postMessage).toHaveBeenCalledExactlyOnceWith({
      id: 43,
      type: 'error',
      message: expect.stringContaining('interval'),
    });
  });
});
