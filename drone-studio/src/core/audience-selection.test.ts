import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShowEvaluator } from './animation';
import { createAudienceFrameClassifier, inspectAudienceFrame } from './audience-inspection';
import {
  selectAudienceDrones,
  type AudienceSelectionRequest,
  type AudienceSelectionReport,
} from './audience-selection';
import { defaultProject, type Project, type Vector3Tuple } from './model';

function project(positions: Vector3Tuple[] = [[0, 10, 1]]): Project {
  const value = structuredClone(defaultProject);
  value.id = 'audience-selection';
  value.revision = 7;
  value.droneCount = positions.length;
  value.cues = [
    {
      ...value.cues[0],
      id: 'selection-scene',
      duration: 4,
      transition: 0,
      droneEdits: Object.fromEntries(
        positions.map((position, index) => [index + 1, { position, color: '#ffffff' }])
      ),
    },
  ];
  return value;
}
function request(patch: Partial<AudienceSelectionRequest> = {}): AudienceSelectionRequest {
  return {
    time: 0,
    snapshot: {
      pose: { east: 0, north: 0, eyeHeight: 1, yaw: 0, pitch: 0, fov: 90 },
      venue: { east: 0, north: 70, heading: 180 },
    },
    aspect: 1,
    region: 'in_frame',
    lights: 'any',
    ...patch,
  };
}
function compassProject() {
  const value = project([
    [0, 10, 1],
    [10, 0, 1],
    [0, -10, 1],
    [-10, 0, 1],
    [0, 0, 11],
    [10, 10, 1],
    [10, -10, 1],
    [-10, -10, 1],
    [-10, 10, 1],
  ]);
  value.cues[0].droneEdits![2].brightness = 0;
  value.cues[0].droneEdits![5].color = '#000000';
  return value;
}
function largeProject(count: number) {
  const value = project();
  value.droneCount = count;
  value.cues[0].scale = 1;
  value.cues[0].altitude = 100;
  delete value.cues[0].droneEdits;
  return value;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('complete audience drone selection', () => {
  it('selects independently known ENU quadrants, including exact boundaries and overlapping overhead', async () => {
    const value = compassProject();
    const expected = {
      in_frame: [1, 6, 9],
      front: [1, 5, 9],
      right: [2, 6],
      rear: [3, 7],
      left: [4, 8],
      overhead: [5],
    };
    for (const [region, ids] of Object.entries(expected)) {
      const result = await selectAudienceDrones(
        value,
        request({ region: region as AudienceSelectionRequest['region'] })
      );
      expect(result.ids).toEqual(ids);
      expect(result).toMatchObject({
        projectId: value.id,
        revision: 7,
        cueId: 'selection-scene',
        localTime: 0,
        blend: 1,
        consideredCount: 9,
        droneCount: 9,
        matchedCount: ids.length,
      });
    }
    const geometric = inspectAudienceFrame(value, 0, request().snapshot, 1, 32);
    expect(geometric.totals).toMatchObject({
      inFrustum: 3,
      front: 3,
      right: 2,
      rear: 2,
      left: 2,
      overhead: 1,
    });
  });

  it('intersects geometry with actual positive RGB and keeps stage quadrants independent of yaw', async () => {
    const value = compassProject();
    expect(
      (await selectAudienceDrones(value, request({ region: 'front', lights: 'on' }))).ids
    ).toEqual([1, 9]);
    expect(
      (await selectAudienceDrones(value, request({ region: 'front', lights: 'off' }))).ids
    ).toEqual([5]);
    const east = request({ lights: 'off' });
    east.snapshot.pose.yaw = 90;
    expect((await selectAudienceDrones(value, east)).ids).toEqual([2]);
    expect(
      (await selectAudienceDrones(value, { ...east, region: 'front', lights: 'any' })).ids
    ).toEqual([1, 5, 9]);
    east.snapshot.venue = { east: 70, north: 0, heading: 12 };
    expect(
      (await selectAudienceDrones(value, { ...east, region: 'front', lights: 'any' })).ids
    ).toEqual([2, 5, 6]);
    east.snapshot.venue.heading = 271;
    expect(
      (await selectAudienceDrones(value, { ...east, region: 'front', lights: 'any' })).ids
    ).toEqual([2, 5, 6]);
  });

  it('uses camera depth, pitch, FOV and exact supplied aspect for frustum membership', async () => {
    const value = project([
      [0, 0, 1],
      [0, 0.05, 1],
      [0, 0.1, 1],
      [0, 5000, 1],
      [0, 5001, 1],
      [0, -10, 1],
      [15, 10, 1],
      [0, 10, 11],
    ]);
    expect((await selectAudienceDrones(value, request())).ids).toEqual([3, 4, 8]);
    expect((await selectAudienceDrones(value, request({ aspect: 2 }))).ids).toEqual([3, 4, 7, 8]);
    const tilted = request();
    tilted.snapshot.pose.pitch = 45;
    tilted.snapshot.pose.fov = 60;
    expect((await selectAudienceDrones(value, tilted)).ids).toEqual([8]);
  });

  it('uses incoming blended geometry and evaluated brightness/flash rather than authored base properties', async () => {
    const value = project([
      [0, 10, 1],
      [0, 10, 1],
    ]);
    value.cues[0].duration = 1;
    value.cues[0].droneEdits![1] = { position: [0, 10, 1], color: '#ff0000', brightness: 0.5 };
    value.cues[0].droneEdits![2] = {
      position: [0, 10, 1],
      color: '#ffffff',
      flash: { hz: 1, duty: 0.5, phase: 0.5 },
    };
    value.cues.push({
      ...value.cues[0],
      id: 'incoming',
      duration: 2,
      transition: 2,
      transitionEasing: 'linear',
      droneEdits: {
        1: {
          color: '#0000ff',
          keyframes: [
            { time: 0, position: [0, 20, 1], brightness: 0 },
            { time: 2, position: [0, 40, 1], brightness: 1 },
          ],
        },
        2: { position: [0, 30, 1], color: '#ffffff', flash: { hz: 1, duty: 0.5, phase: 0.5 } },
      },
    });
    const on = await selectAudienceDrones(value, request({ time: 2, lights: 'on' }));
    expect(on).toMatchObject({
      ids: [1],
      matchedCount: 1,
      consideredCount: 2,
      cueId: 'incoming',
      localTime: 1,
      blend: 0.5,
    });
    expect((await selectAudienceDrones(value, request({ time: 2, lights: 'off' }))).ids).toEqual([
      2,
    ]);
    expect((await selectAudienceDrones(value, request({ time: 2.5, lights: 'on' }))).ids).toEqual([
      1, 2,
    ]);
    const evaluated = inspectAudienceFrame(value, 2, request().snapshot, 1, 2);
    expect(evaluated.drones[0].position).toEqual([0, 20, 1]);
    expect(evaluated.drones[0].color).toEqual([0.25, 0, 0.25]);
  });

  it('follows keyed position and keyed light channels at exact scene and show endpoints', async () => {
    const value = project();
    value.cues[0].duration = 2;
    value.cues[0].droneEdits![1] = {
      color: '#ffffff',
      keyframes: [
        { time: 0, position: [0, 10, 1], brightness: 1 },
        { time: 2, position: [0, -10, 1], brightness: 0 },
      ],
    };
    expect((await selectAudienceDrones(value, request({ time: 0, lights: 'on' }))).ids).toEqual([
      1,
    ]);
    expect((await selectAudienceDrones(value, request({ time: 1, lights: 'on' }))).ids).toEqual([]);
    const end = await selectAudienceDrones(
      value,
      request({ time: 2, region: 'rear', lights: 'off' })
    );
    expect(end).toMatchObject({ ids: [1], localTime: 2, blend: 1 });
  });

  it('owns, deduplicates and sorts historical scope while excluding dormant IDs from considered counts', async () => {
    const value = compassProject(),
      input = request({ region: 'front', scopeIds: [100000, 9, 5, 1, 9, 10] });
    const original = structuredClone({ value, input });
    const result = await selectAudienceDrones(value, input);
    expect(result.request.scopeIds).toEqual([1, 5, 9, 10, 100000]);
    expect(result.ids).toEqual([1, 5, 9]);
    expect(result).toMatchObject({ consideredCount: 3, matchedCount: 3, droneCount: 9 });
    expect({ value, input }).toEqual(original);
    result.ids.push(2);
    result.request.scopeIds!.push(3);
    result.request.snapshot.pose.yaw = 180;
    expect({ value, input }).toEqual(original);
  });

  it('distinguishes an omitted fleet scope from an explicit empty or entirely dormant scope', async () => {
    const value = compassProject(),
      spy = vi.spyOn(ShowEvaluator.prototype, 'frame');
    for (const scopeIds of [[], [10, 100000]]) {
      const progress = vi.fn();
      const result = await selectAudienceDrones(value, request({ scopeIds }), {
        onProgress: progress,
      });
      expect(result).toMatchObject({ ids: [], matchedCount: 0, consideredCount: 0, droneCount: 9 });
      expect(progress).toHaveBeenCalledExactlyOnceWith(0, 0);
    }
    expect(spy).not.toHaveBeenCalled();
    const all = await selectAudienceDrones(value, request());
    expect(all.consideredCount).toBe(9);
    expect(all.request).not.toHaveProperty('scopeIds');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not truncate a large irregular scope or renumber its stable IDs', async () => {
    const value = largeProject(1000);
    const scopeIds = Array.from({ length: 257 }, (_, index) => 1 + ((index * 73 + 41) % 1000));
    const result = await selectAudienceDrones(value, request({ region: 'overhead', scopeIds }));
    expect(result.ids).toEqual([...scopeIds].sort((a, b) => a - b));
    expect(result).toMatchObject({ matchedCount: 257, consideredCount: 257 });
    expect(scopeIds[0]).toBe(42);
  });

  it('returns all100,000 matches with bounded progress chunks and shared inspection totals', async () => {
    const value = largeProject(100000),
      input = request({ region: 'overhead', lights: 'on' });
    const progress: [number, number][] = [];
    const result = await selectAudienceDrones(value, input, {
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(result.ids).toEqual(Array.from({ length: 100000 }, (_, index) => index + 1));
    expect(result).toMatchObject({
      matchedCount: 100000,
      consideredCount: 100000,
      droneCount: 100000,
    });
    expect(progress[0]).toEqual([0, 100000]);
    expect(progress.at(-1)).toEqual([100000, 100000]);
    expect(
      progress.every(
        ([done, total], index) =>
          total === 100000 &&
          (!index || (done > progress[index - 1][0] && done - progress[index - 1][0] <= 1024))
      )
    ).toBe(true);
    expect(inspectAudienceFrame(value, 0, input.snapshot, 1, 1).totals.overhead).toBe(
      result.matchedCount
    );
  });

  it('captures project and request before the first callback or await', async () => {
    const value = compassProject(),
      input = request({ region: 'front', scopeIds: [9, 5, 1] });
    const original = structuredClone({ value, input });
    const result = await selectAudienceDrones(value, input, {
      onProgress(done) {
        if (done !== 0) return;
        value.droneCount = 1;
        value.revision = 99;
        value.cues[0].droneEdits![1].position = [0, -10, 1];
        input.snapshot.pose.yaw = 180;
        input.snapshot.venue.north = -70;
        input.scopeIds!.splice(0, input.scopeIds!.length, 2);
        input.lights = 'off';
      },
    });
    expect(result).toMatchObject({
      revision: 7,
      ids: [1, 5, 9],
      consideredCount: 3,
      droneCount: 9,
    });
    expect(result.request).toEqual({ ...original.input, scopeIds: [1, 5, 9] });
  });

  it('rejects malformed scopes and noncanonical capture/criteria before evaluation or progress', async () => {
    const mutations: ((input: AudienceSelectionRequest) => void)[] = [
      (input) => {
        input.scopeIds = [0];
      },
      (input) => {
        input.scopeIds = [-1];
      },
      (input) => {
        input.scopeIds = [1.5];
      },
      (input) => {
        input.scopeIds = [100001];
      },
      (input) => {
        input.scopeIds = [NaN];
      },
      (input) => {
        input.scopeIds = Array(2);
      },
      (input) => {
        input.scopeIds = Array(100001).fill(1);
      },
      (input) => {
        Object.assign(input, { scopeIds: '1' });
      },
      (input) => {
        Object.assign(input, { region: 'near' });
      },
      (input) => {
        Object.assign(input, { lights: 'bright' });
      },
      (input) => {
        input.time = 5;
      },
      (input) => {
        input.time = -1;
      },
      (input) => {
        input.time = NaN;
      },
      (input) => {
        input.aspect = 0;
      },
      (input) => {
        input.aspect = 101;
      },
      (input) => {
        input.snapshot.pose.yaw = 360;
      },
      (input) => {
        input.snapshot.pose.pitch = 90;
      },
      (input) => {
        input.snapshot.venue.heading = -1;
      },
      (input) => {
        Object.assign(input.snapshot.pose, { roll: 1 });
      },
      (input) => {
        Object.assign(input, { hidden: true });
      },
      (input) => {
        Reflect.deleteProperty(input, 'lights');
      },
    ];
    const spy = vi.spyOn(ShowEvaluator.prototype, 'frame'),
      progress = vi.fn();
    for (const mutate of mutations) {
      const input = request();
      mutate(input);
      await expect(
        selectAudienceDrones(project(), input, { onProgress: progress })
      ).rejects.toThrow();
    }
    expect(spy).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });

  it('preflights all active key work even for a tiny scope before preparing any frame', async () => {
    const value = largeProject(130);
    const keys = Array.from({ length: 2048 }, (_, index) => ({ time: index / 2, brightness: 0.5 }));
    value.cues[0].droneEdits = Object.fromEntries(
      Array.from({ length: 130 }, (_, index) => [index + 1, { keyframes: keys }])
    );
    const spy = vi.spyOn(ShowEvaluator.prototype, 'frame'),
      progress = vi.fn();
    await expect(
      selectAudienceDrones(value, request({ scopeIds: [1] }), { onProgress: progress })
    ).rejects.toThrow('budget');
    expect(spy).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
    value.droneCount = 1;
    expect(
      (await selectAudienceDrones(value, request({ region: 'overhead', scopeIds: [1, 130] })))
        .consideredCount
    ).toBe(1);
  });

  it('rejects invalid fleets and finite authored coordinates that overflow evaluation buffers', async () => {
    const spy = vi.spyOn(ShowEvaluator.prototype, 'frame');
    for (const count of [0, 1.5, 100001]) {
      const value = project();
      value.droneCount = count;
      await expect(selectAudienceDrones(value, request())).rejects.toThrow('active fleet');
    }
    expect(spy).not.toHaveBeenCalled();
    await expect(
      selectAudienceDrones(project([[Number.MAX_VALUE, 10, 1]]), request())
    ).rejects.toThrow('finite numerical');
  });

  it('cancels before evaluation, between chunks, and after the last chunk without publishing partial results', async () => {
    const spy = vi.spyOn(ShowEvaluator.prototype, 'frame');
    const already = new AbortController();
    already.abort();
    await expect(
      selectAudienceDrones(project(), request(), { signal: already.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(spy).not.toHaveBeenCalled();
    for (const cancelAt of [0, 1024, 2050]) {
      const controller = new AbortController(),
        calls: number[] = [];
      spy.mockClear();
      await expect(
        selectAudienceDrones(largeProject(2050), request({ region: 'overhead' }), {
          signal: controller.signal,
          onProgress(done) {
            calls.push(done);
            if (done === cancelAt) setTimeout(() => controller.abort(), 0);
          },
        })
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(calls.at(-1)).toBe(cancelAt);
      expect(spy).toHaveBeenCalledTimes(cancelAt === 0 ? 0 : 1);
    }
  });

  it('isolates progress-observer failures and leaves returned sets independent from classifier rows', async () => {
    const value = compassProject(),
      input = request();
    expect(
      (
        await selectAudienceDrones(value, input, {
          onProgress() {
            throw new Error('observer');
          },
        })
      ).ids
    ).toEqual([1, 6, 9]);
    const classifier = createAudienceFrameClassifier(value, 0, input.snapshot, 1);
    const first = classifier.classify(1);
    first.position[1] = -100;
    expect(classifier.classify(1).position).toEqual([0, 10, 1]);
    for (const id of [0, 1.5, 10]) expect(() => classifier.classify(id)).toThrow('active drone ID');
  });

  it('posts the standard worker progress/result/error protocol with complete owned IDs', async () => {
    const postMessage = vi.fn();
    const worker = {
      onmessage: null as null | ((event: MessageEvent) => Promise<void>),
      postMessage,
    };
    vi.stubGlobal('self', worker);
    await import('./audience-selection.worker');
    const value = compassProject(),
      input = request({ region: 'front', scopeIds: [9, 5, 1, 99] });
    await worker.onmessage!({ data: { id: 42, project: value, request: input } } as MessageEvent);
    expect(postMessage).toHaveBeenCalledWith({ id: 42, type: 'progress', completed: 0, total: 3 });
    expect(postMessage).toHaveBeenCalledWith({ id: 42, type: 'progress', completed: 3, total: 3 });
    const completed = postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message.type === 'result') as {
      id: number;
      report: AudienceSelectionReport;
    };
    expect(completed).toMatchObject({
      id: 42,
      report: { ids: [1, 5, 9], consideredCount: 3, matchedCount: 3 },
    });
    postMessage.mockClear();
    await worker.onmessage!({
      data: { id: 43, project: value, request: { ...input, time: 99 } },
    } as MessageEvent);
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({
      id: 43,
      type: 'error',
      message: 'Audience selection time must be within the show.',
    });
  });
});
