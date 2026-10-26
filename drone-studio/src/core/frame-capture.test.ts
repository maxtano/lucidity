import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultProject } from './model';
import {
  buildCaptureMetadata,
  DEFAULT_FRAME_CAPTURE_TIMEOUT_MS,
  encodeAudiencePng,
  MAX_CAPTURE_PNG_BYTES,
  type CaptureMetadataInput,
  type PngBlobSource,
} from './frame-capture';

function input(): CaptureMetadataInput {
  const project = structuredClone(defaultProject);
  project.id = 'capture-fixture';
  project.name = 'Audience study';
  project.revision = 17;
  project.droneCount = 3;
  project.cues = [
    { ...project.cues[0], id: 'opening', name: 'Opening', duration: 2, transition: 0 },
    { ...project.cues[1], id: 'closing', name: 'Closing', duration: 3, transition: 0 },
  ];
  return {
    project,
    version: 'draft',
    sharedTime: 3.25,
    sampledTime: 3.25,
    viewer: {
      pose: {
        east: 2.5,
        north: -4.125,
        eyeHeight: 1.75,
        yaw: 27.1234567890123,
        pitch: 35.125,
        fov: 75.25,
      },
      venue: { east: 0, north: 70, heading: 180 },
    },
    aspect: 16 / 9,
    framing: 'captured',
    raster: { width: 1600, height: 900 },
    appearance: { glow: 0.85, exposure: 1.15 },
    createdAt: '2026-09-27T06:00:00.000Z',
  };
}
function png(): Blob {
  // A real encoded 1×1 PNG; the encoder checks the signature without decoding pixels.
  const encoded =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGFEAAAAASUVORK5CYII=';
  return new Blob([Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))], {
    type: 'image/png',
  });
}
function deferred() {
  let callback: ((blob: Blob | null) => void) | undefined;
  const toBlob = vi.fn((next: (blob: Blob | null) => void, _type?: string) => {
    callback = next;
  });
  return {
    source: { toBlob } satisfies PngBlobSource,
    toBlob,
    deliver: (blob: Blob | null) => {
      if (!callback) throw new Error('Encoder was not invoked.');
      callback(blob);
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('owned audience frame capture metadata', () => {
  it('records exact scene/camera/appearance identity with a versioned format', () => {
    const args = input(),
      original = structuredClone(args);
    const metadata = buildCaptureMetadata(args);
    expect(metadata).toEqual({
      format: 'lucidity.audience-frame',
      schemaVersion: 1,
      project: { id: 'capture-fixture', name: 'Audience study', revision: 17 },
      version: 'draft',
      sharedTime: 3.25,
      sampledTime: 3.25,
      held: false,
      scene: { id: 'closing', name: 'Closing', index: 1, localTime: 1.25 },
      droneCount: 3,
      viewer: args.viewer,
      aspect: 16 / 9,
      framing: 'captured',
      raster: { width: 1600, height: 900 },
      appearance: { glow: 0.85, exposure: 1.15 },
      createdAt: '2026-09-27T06:00:00.000Z',
    });
    expect(args).toEqual(original);
    args.viewer.pose.yaw = 90;
    args.raster.width = 1;
    args.appearance.glow = 0;
    args.project.cues[1].name = 'Changed later';
    expect(metadata.viewer.pose.yaw).toBe(27.1234567890123);
    expect(metadata.raster.width).toBe(1600);
    expect(metadata.appearance.glow).toBe(0.85);
    expect(metadata.scene.name).toBe('Closing');
    metadata.viewer.venue.north = 123;
    expect(args.viewer.venue.north).toBe(70);
  });

  it('uses the next scene at a boundary and distinguishes the exact endpoint from a later hold', () => {
    const args = input();
    expect(
      buildCaptureMetadata({ ...args, version: 'base', sharedTime: 2, sampledTime: 2 })
    ).toMatchObject({
      version: 'base',
      held: false,
      scene: { id: 'closing', index: 1, localTime: 0 },
    });
    expect(buildCaptureMetadata({ ...args, sharedTime: 5, sampledTime: 5 })).toMatchObject({
      held: false,
      scene: { localTime: 3 },
    });
    expect(buildCaptureMetadata({ ...args, sharedTime: 8, sampledTime: 5 })).toMatchObject({
      sharedTime: 8,
      sampledTime: 5,
      held: true,
      scene: { localTime: 3 },
    });
  });

  it('preserves an exact decimal final scene endpoint despite global subtraction roundoff', () => {
    const args = input();
    args.project.cues[0].duration = 24;
    args.project.cues[1].duration = 6.4;
    expect(30.4 - 24).not.toBe(6.4);
    expect(buildCaptureMetadata({ ...args, sharedTime: 40, sampledTime: 30.4 })).toMatchObject({
      held: true,
      scene: { localTime: 6.4 },
    });
  });

  it.each([
    [3, 2],
    [2, 3],
    [6, 4],
    [6, 6],
    [-1, -1],
    [NaN, 1],
    [1, Infinity],
    [1801, 5],
  ])('rejects inconsistent/invalid shared and sampled time %s / %s', (sharedTime, sampledTime) => {
    expect(() => buildCaptureMetadata({ ...input(), sharedTime, sampledTime })).toThrow();
  });

  it('accepts the raster pixel limit but rejects fractional, empty, oversized, and nonfinite dimensions', () => {
    expect(
      buildCaptureMetadata({ ...input(), raster: { width: 4000, height: 4000 } }).raster
    ).toEqual({ width: 4000, height: 4000 });
    for (const raster of [
      { width: 4001, height: 4000 },
      { width: 0, height: 900 },
      { width: 1600, height: -1 },
      { width: 1600.5, height: 900 },
      { width: NaN, height: 900 },
      { width: 1600, height: Infinity },
    ])
      expect(() => buildCaptureMetadata({ ...input(), raster })).toThrow();
  });

  it('rejects noncanonical camera/aspect and appearance values without correcting them', () => {
    const mutations: ((args: CaptureMetadataInput) => void)[] = [
      (args) => {
        args.viewer.pose.yaw = 360;
      },
      (args) => {
        args.viewer.pose.pitch = 90;
      },
      (args) => {
        args.viewer.pose.eyeHeight = 0;
      },
      (args) => {
        args.viewer.pose.fov = NaN;
      },
      (args) => {
        args.viewer.venue.heading = -1;
      },
      (args) => {
        Object.assign(args.viewer.pose, { roll: 3 });
      },
      (args) => {
        args.aspect = 0;
      },
      (args) => {
        args.aspect = 1e-39;
      },
      (args) => {
        args.aspect = 101;
      },
      (args) => {
        args.appearance.glow = 1.81;
      },
      (args) => {
        args.appearance.glow = -1;
      },
      (args) => {
        args.appearance.exposure = 0.49;
      },
      (args) => {
        args.appearance.exposure = 2.01;
      },
      (args) => {
        args.appearance.exposure = Infinity;
      },
      (args) => {
        args.framing = 'other' as 'viewport';
      },
      (args) => {
        args.version = 'other' as 'base';
      },
    ];
    for (const mutate of mutations) {
      const args = input();
      mutate(args);
      const before = structuredClone(args);
      expect(() => buildCaptureMetadata(args)).toThrow();
      expect(args).toEqual(before);
    }
  });

  it('bounds project identity, names, revision, fleet, scene identity, and duration', () => {
    const mutations: ((args: CaptureMetadataInput) => void)[] = [
      (args) => {
        args.project.id = '';
      },
      (args) => {
        args.project.name = ' padded ';
      },
      (args) => {
        args.project.name = 'n'.repeat(81);
      },
      (args) => {
        args.project.revision = -1;
      },
      (args) => {
        args.project.revision = 1.5;
      },
      (args) => {
        args.project.droneCount = 100001;
      },
      (args) => {
        args.project.cues = [];
      },
      (args) => {
        args.project.cues[1].id = args.project.cues[0].id;
      },
      (args) => {
        args.project.cues[1].name = '';
      },
      (args) => {
        args.project.cues[1].duration = 0;
      },
      (args) => {
        args.project.cues[1].duration = Infinity;
      },
      (args) => {
        args.project.cues[1].duration = 1800;
      },
    ];
    for (const mutate of mutations) {
      const args = input();
      mutate(args);
      expect(() => buildCaptureMetadata(args)).toThrow();
    }
  });

  it('owns canonical timestamps and rejects ambiguous date text', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-27T07:12:34.567Z'));
    const args = input();
    delete args.createdAt;
    expect(buildCaptureMetadata(args).createdAt).toBe('2026-09-27T07:12:34.567Z');
    for (const createdAt of [
      'yesterday',
      '',
      '2026-09-27',
      '2026-09-27T07:12:34Z',
      '2026-09-27T07:12:34.567+00:00',
    ])
      expect(() => buildCaptureMetadata({ ...args, createdAt })).toThrow(/timestamp/);
    expect(() => buildCaptureMetadata({ ...args, createdAt: null as unknown as string })).toThrow();
  });

  it('does not scan or copy unrelated authored drone payloads to describe a frame', () => {
    const args = input();
    const payload = vi.fn(() => {
      throw new Error('Drone payload must not be read.');
    });
    Object.defineProperty(args.project.cues[0], 'droneEdits', { get: payload });
    Object.defineProperty(args.project.cues[1], 'droneEdits', { get: payload });
    expect(buildCaptureMetadata(args).scene.name).toBe('Closing');
    expect(payload).not.toHaveBeenCalled();
  });
});

describe('cancellable local PNG encoding', () => {
  it('invokes toBlob synchronously with PNG format, validates its signature, and releases resources', async () => {
    vi.useFakeTimers();
    const controller = new AbortController(),
      source = deferred(),
      blob = png();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = encodeAudiencePng(source.source, { signal: controller.signal });
    expect(source.toBlob).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 'image/png');
    expect(vi.getTimerCount()).toBe(1);
    source.deliver(blob);
    await expect(pending).resolves.toBe(blob);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    controller.abort();
    source.deliver(null);
    await expect(pending).resolves.toBe(blob);
  });

  it('rejects an already cancelled request without invoking the canvas', async () => {
    vi.useFakeTimers();
    const controller = new AbortController(),
      source = deferred();
    controller.abort('not exported');
    await expect(
      encodeAudiencePng(source.source, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(source.toBlob).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a pending encoder, clears its timer/listener, and ignores a late callback', async () => {
    vi.useFakeTimers();
    const controller = new AbortController(),
      source = deferred();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = encodeAudiencePng(source.source, { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    source.deliver(png());
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('cancels during asynchronous signature validation and ignores its eventual completion', async () => {
    vi.useFakeTimers();
    const controller = new AbortController(),
      source = deferred(),
      blob = png();
    let release: ((value: ArrayBuffer) => void) | undefined;
    vi.spyOn(blob, 'slice').mockReturnValue({
      arrayBuffer: () =>
        new Promise<ArrayBuffer>((resolve) => {
          release = resolve;
        }),
    } as Blob);
    const pending = encodeAudiencePng(source.source, { signal: controller.signal });
    source.deliver(blob);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    release!(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer);
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out an encoder that never calls back at the default deadline and ignores late data', async () => {
    vi.useFakeTimers();
    const controller = new AbortController(),
      source = deferred();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = encodeAudiencePng(source.source, { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(DEFAULT_FRAME_CAPTURE_TIMEOUT_MS - 1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    source.deliver(png());
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('bounds a custom deadline and still times out after an unresolved header read', async () => {
    vi.useFakeTimers();
    const source = deferred(),
      blob = png();
    vi.spyOn(blob, 'slice').mockReturnValue({
      arrayBuffer: () => new Promise<ArrayBuffer>(() => {}),
    } as Blob);
    const pending = encodeAudiencePng(source.source, { timeoutMs: 25 });
    source.deliver(blob);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
    for (const timeoutMs of [0, -1, 1.5, NaN, Infinity, 60001]) {
      const invalid = deferred();
      await expect(encodeAudiencePng(invalid.source, { timeoutMs })).rejects.toThrow(/timeout/);
      expect(invalid.toBlob).not.toHaveBeenCalled();
    }
  });

  it('rejects null, empty, non-PNG MIME, and spoofed PNG contents', async () => {
    vi.useFakeTimers();
    for (const blob of [
      null,
      new Blob([], { type: 'image/png' }),
      new Blob(['data'], { type: 'image/jpeg' }),
      new Blob(['not a PNG'], { type: 'image/png' }),
      new Blob([new Uint8Array([137, 80])], { type: 'image/png' }),
    ]) {
      const source = deferred(),
        pending = encodeAudiencePng(source.source);
      source.deliver(blob);
      await expect(pending).rejects.toThrow(/image|PNG/);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('rejects oversized real blobs before reading their header', async () => {
    vi.useFakeTimers();
    const blob = new Blob([new Uint8Array(MAX_CAPTURE_PNG_BYTES + 1)], { type: 'image/png' });
    const slice = vi.spyOn(blob, 'slice');
    const source = deferred(),
      pending = encodeAudiencePng(source.source);
    source.deliver(blob);
    await expect(pending).rejects.toThrow(/32 MiB/);
    expect(slice).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates canvas security errors and header-read failures while cleaning up', async () => {
    vi.useFakeTimers();
    const failure = new DOMException('Canvas cannot be exported.', 'SecurityError');
    await expect(
      encodeAudiencePng({
        toBlob: () => {
          throw failure;
        },
      })
    ).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
    const blob = png(),
      source = deferred();
    vi.spyOn(blob, 'slice').mockReturnValue({
      arrayBuffer: () => Promise.reject(new Error('Header read failed.')),
    } as Blob);
    const pending = encodeAudiencePng(source.source);
    source.deliver(blob);
    await expect(pending).rejects.toThrow('Header read failed.');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses only the first callback, including a synchronous canvas callback', async () => {
    vi.useFakeTimers();
    const first = png(),
      later = png();
    await expect(
      encodeAudiencePng({
        toBlob(callback) {
          callback(first);
          callback(later);
          callback(null);
        },
      })
    ).resolves.toBe(first);
    expect(vi.getTimerCount()).toBe(0);
  });
});
