import { describe, expect, it } from 'vitest';
import { defaultProject } from '../core/model';
import { DEFAULT_VIEWER_POSE, DEFAULT_VENUE_PLACEMENT } from '../core/viewer';
import { reviewFrameReadiness, type ReviewFrameIntent } from './review-frame-request';

function fixture() {
  const intent: ReviewFrameIntent = {
    project: structuredClone(defaultProject),
    version: 'draft',
    sharedTime: 12.125,
    sampledTime: 12.125,
    initialSharedTime: 12,
    initialSampledTime: 12,
    viewer: { pose: { ...DEFAULT_VIEWER_POSE }, venue: { ...DEFAULT_VENUE_PLACEMENT } },
    aspect: 1.6,
    framing: 'captured',
    appearance: { glow: 0.85, exposure: 1.15 },
  };
  const current = {
    project: intent.project,
    version: intent.version,
    sharedTime: intent.sharedTime,
    sampledTime: intent.sampledTime,
    viewer: structuredClone(intent.viewer),
    aspect: intent.aspect,
    framing: intent.framing,
    appearance: { ...intent.appearance },
    playing: false,
    mode: 'audience' as const,
    available: true,
  };
  return { intent, current };
}

describe('rendered review frame request matching', () => {
  it('waits for pause publication then accepts exactly its settled frame', () => {
    const { intent, current } = fixture();
    expect(
      reviewFrameReadiness(intent, { ...current, sharedTime: 12, sampledTime: 12, playing: true })
    ).toBe('waiting');
    expect(reviewFrameReadiness(intent, current)).toBe('ready');
    expect(reviewFrameReadiness(intent, { ...current, playing: true })).toBe('changed');
  });
  it('distinguishes held sample time from the still-settling shared time', () => {
    const { intent, current } = fixture();
    Object.assign(intent, {
      sharedTime: 45.125,
      sampledTime: 43.2,
      initialSharedTime: 45,
      initialSampledTime: 43.2,
    });
    expect(reviewFrameReadiness(intent, { ...current, sharedTime: 45, sampledTime: 43.2 })).toBe(
      'waiting'
    );
    expect(
      reviewFrameReadiness(intent, { ...current, sharedTime: 45.125, sampledTime: 43.2 })
    ).toBe('ready');
    expect(reviewFrameReadiness(intent, { ...current, sharedTime: 46, sampledTime: 43.2 })).toBe(
      'changed'
    );
  });
  it('requires the exact owned document and side, not matching revision headers', () => {
    const { intent, current } = fixture();
    expect(
      reviewFrameReadiness(intent, { ...current, project: structuredClone(current.project) })
    ).toBe('changed');
    expect(reviewFrameReadiness(intent, { ...current, version: 'base' })).toBe('changed');
    expect(reviewFrameReadiness(intent, { ...current, version: undefined })).toBe('changed');
  });
  it('rejects a new seek even if paused and within the same scene', () => {
    const { intent, current } = fixture();
    expect(reviewFrameReadiness(intent, { ...current, sharedTime: 13, sampledTime: 13 })).toBe(
      'changed'
    );
    expect(reviewFrameReadiness(intent, { ...current, sharedTime: NaN })).toBe('changed');
  });
  it('rejects any changed audience camera or venue channel', () => {
    const { intent, current } = fixture();
    for (const key of ['east', 'north', 'eyeHeight', 'yaw', 'pitch', 'fov'] as const) {
      const viewer = structuredClone(current.viewer);
      viewer.pose[key] += 0.1;
      expect(reviewFrameReadiness(intent, { ...current, viewer })).toBe('changed');
    }
    for (const key of ['east', 'north', 'heading'] as const) {
      const viewer = structuredClone(current.viewer);
      viewer.venue[key] += 0.1;
      expect(reviewFrameReadiness(intent, { ...current, viewer })).toBe('changed');
    }
  });
  it('rejects unavailable, Design, changed framing, and changed appearance', () => {
    const { intent, current } = fixture();
    for (const change of [
      { available: false },
      { viewer: undefined },
      { mode: 'design' as const },
      { aspect: 1.7 },
      { framing: 'viewport' as const },
      { appearance: { ...current.appearance, glow: 0 } },
      { appearance: { ...current.appearance, exposure: 2 } },
    ])
      expect(reviewFrameReadiness(intent, { ...current, ...change })).toBe('changed');
  });
  it('accepts equal camera values regardless of object order without mutating either input', () => {
    const { intent, current } = fixture();
    const before = structuredClone(intent);
    const pose = current.viewer.pose;
    current.viewer.pose = {
      fov: pose.fov,
      pitch: pose.pitch,
      yaw: pose.yaw,
      eyeHeight: pose.eyeHeight,
      north: pose.north,
      east: pose.east,
    };
    expect(reviewFrameReadiness(intent, current)).toBe('ready');
    expect(intent).toEqual(before);
  });
});
