import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from './engine';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function buffer(duration = 20): AudioBuffer {
  return { duration, getChannelData: () => new Float32Array(512).fill(0.2) } as unknown as AudioBuffer;
}

function file(name: string, marker = 1): File {
  return {
    name, size: 1,
    arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([marker]).buffer),
  } as unknown as File;
}

function makeSource() {
  return {
    buffer: null as AudioBuffer | null, loop: false,
    connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(),
  };
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 100;
  destination = {};
  sources: ReturnType<typeof makeSource>[] = [];
  resume = vi.fn<() => Promise<void>>().mockResolvedValue();
  close = vi.fn<() => Promise<void>>().mockResolvedValue();
  decodeAudioData = vi.fn<(data: ArrayBuffer) => Promise<AudioBuffer>>().mockResolvedValue(buffer());

  constructor() { FakeAudioContext.instances.push(this); }
  createGain() { return { gain: { value: 1 }, connect: vi.fn() }; }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return buffer(length / sampleRate);
  }
  createBufferSource() {
    const source = makeSource();
    this.sources.push(source);
    return source;
  }
}

function fixture() {
  const engine = new AudioEngine();
  engine.loadDemo();
  return { engine, context: FakeAudioContext.instances.at(-1)! };
}

beforeEach(() => {
  FakeAudioContext.instances = [];
  vi.stubGlobal('AudioContext', FakeAudioContext);
});
afterEach(() => vi.unstubAllGlobals());

describe('audio request ordering', () => {
  it('does not create a source when Pause cancels a pending context resume', async () => {
    const { engine, context } = fixture();
    const resume = deferred<void>();
    context.resume.mockReturnValueOnce(resume.promise);
    const playing = engine.play(7);
    engine.pause();
    resume.resolve();
    expect(await playing).toBe(false);
    expect(context.sources).toHaveLength(0);
    expect(await engine.play(12)).toBe(true);
    expect(context.sources[0].start).toHaveBeenCalledWith(0, 12);
  });

  it('cannot revive a disposed engine after resume, and permits a fresh context afterward', async () => {
    const { engine, context } = fixture();
    const resume = deferred<void>();
    context.resume.mockReturnValueOnce(resume.promise);
    const playing = engine.play(4);
    engine.dispose();
    resume.resolve();
    expect(await playing).toBe(false);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(context.sources).toHaveLength(0);
    engine.loadDemo();
    expect(await engine.play(3)).toBe(true);
    const replacement = FakeAudioContext.instances.at(-1)!;
    expect(replacement).not.toBe(context);
    expect(replacement.sources[0].start).toHaveBeenCalledWith(0, 3);
  });

  it('lets the newest seek win when an earlier resume finishes afterward', async () => {
    const { engine, context } = fixture();
    const firstResume = deferred<void>(), secondResume = deferred<void>();
    context.resume.mockReturnValueOnce(firstResume.promise).mockReturnValueOnce(secondResume.promise);
    const first = engine.play(2), second = engine.play(9);
    secondResume.resolve();
    expect(await second).toBe(true);
    firstResume.resolve();
    expect(await first).toBe(false);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].start).toHaveBeenCalledWith(0, 9);
    expect(context.sources[0].stop).not.toHaveBeenCalled();
    expect(engine.time()).toBe(9);
  });

  it('cancels pending playback when a new soundtrack is installed', async () => {
    const { engine, context } = fixture();
    const resume = deferred<void>();
    context.resume.mockReturnValueOnce(resume.promise);
    const playing = engine.play(4);
    const soundtrack = buffer(24);
    context.decodeAudioData.mockResolvedValue(soundtrack);
    expect(await engine.loadFile(file('new.wav'))).toMatchObject({ name: 'new', kind: 'file' });
    resume.resolve();
    expect(await playing).toBe(false);
    expect(context.sources).toHaveLength(0);
    await engine.play(2);
    expect(context.sources[0].buffer).toBe(soundtrack);
  });

  it('keeps the latest selected file when an older decode completes last', async () => {
    const { engine, context } = fixture();
    const decodeA = deferred<AudioBuffer>(), decodeB = deferred<AudioBuffer>();
    context.decodeAudioData.mockImplementation(data => new Uint8Array(data)[0] === 1 ? decodeA.promise : decodeB.promise);
    const first = engine.loadFile(file('first.wav', 1));
    await Promise.resolve();
    const second = engine.loadFile(file('second.wav', 2));
    await Promise.resolve();
    expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
    const latest = buffer(30);
    decodeB.resolve(latest);
    expect(await second).toMatchObject({ name: 'second', duration: 30 });
    decodeA.resolve(buffer(10));
    expect(await first).toBeNull();
    await engine.play(0);
    expect(context.sources[0].buffer).toBe(latest);
    expect(context.sources[0].loop).toBe(false);
  });

  it('does not even decode a file whose read was superseded by another selection', async () => {
    const { engine, context } = fixture();
    const read = deferred<ArrayBuffer>();
    const oldFile = { ...file('old.wav'), arrayBuffer: () => read.promise } as File;
    const first = engine.loadFile(oldFile);
    const latest = buffer(42);
    context.decodeAudioData.mockResolvedValue(latest);
    expect(await engine.loadFile(file('latest.wav'))).toMatchObject({ name: 'latest' });
    read.resolve(new Uint8Array([2]).buffer);
    expect(await first).toBeNull();
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
    await engine.play(0);
    expect(context.sources[0].buffer).toBe(latest);
  });

  it('ignores an old context decode after disposal and a fresh demo load', async () => {
    const { engine, context } = fixture();
    const decode = deferred<AudioBuffer>();
    context.decodeAudioData.mockReturnValue(decode.promise);
    const pending = engine.loadFile(file('old-project.wav'));
    await Promise.resolve();
    engine.dispose();
    engine.loadDemo();
    const oldBuffer = buffer(15);
    decode.resolve(oldBuffer);
    expect(await pending).toBeNull();
    await engine.play(0);
    const replacement = FakeAudioContext.instances.at(-1)!;
    expect(replacement.sources[0].loop).toBe(true);
    expect(replacement.sources[0].buffer).not.toBe(oldBuffer);
  });

  it('preserves the installed soundtrack when the latest selection is invalid', async () => {
    const { engine, context } = fixture();
    const installed = buffer(16);
    context.decodeAudioData.mockResolvedValueOnce(installed);
    await engine.loadFile(file('installed.wav'));
    const decode = deferred<AudioBuffer>();
    context.decodeAudioData.mockReturnValueOnce(decode.promise);
    const older = engine.loadFile(file('superseded.wav'));
    await Promise.resolve();
    await expect(engine.loadFile({ ...file('oversized.wav'), size: 80_000_001 } as File))
      .rejects.toThrow(/smaller than 80 MB/);
    decode.resolve(buffer(20));
    expect(await older).toBeNull();
    await engine.play(0);
    expect(context.sources[0].buffer).toBe(installed);
  });

  it('keeps the existing buffer when decoded duration validation fails', async () => {
    const { engine, context } = fixture();
    const installed = buffer(16);
    context.decodeAudioData.mockResolvedValueOnce(installed);
    await engine.loadFile(file('installed.wav'));
    context.decodeAudioData.mockResolvedValueOnce(buffer(1801));
    await expect(engine.loadFile(file('too-long.wav'))).rejects.toThrow(/shorter than 30 minutes/);
    await engine.play(0);
    expect(context.sources[0].buffer).toBe(installed);
  });
});
