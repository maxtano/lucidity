import { describe, expect, it } from 'vitest';
import { defaultProject } from '../core/model';
import { draftPreviewTiming } from './draft-preview';
import {
  advanceDraftPlayback,
  DRAFT_PREVIEW_SPEEDS,
  draftPlaybackStart,
  validateDraftAuditionRange,
  type DraftAuditionRange,
} from './draft-preview-playback';

describe('private audition range validation', () => {
  it('returns an owned exact range, including fractional endpoints', () => {
    const original = Object.freeze({ start: 0.1, end: 3.125 });
    const result = validateDraftAuditionRange(original, 3.125);
    expect(result).toEqual(original);
    expect(result).not.toBe(original);
    result.start = 2;
    expect(original.start).toBe(0.1);
    expect(
      validateDraftAuditionRange({ start: 0, end: Number.MIN_VALUE }, Number.MIN_VALUE)
    ).toEqual({ start: 0, end: Number.MIN_VALUE });
  });

  it.each([
    { start: -0.01, end: 2 },
    { start: 2, end: 2 },
    { start: 3, end: 2 },
    { start: 0, end: 10.0000001 },
    { start: NaN, end: 2 },
    { start: 0, end: Infinity },
    { start: -Infinity, end: 1 },
  ])('rejects invalid range %j without correcting it', (range) => {
    const before = { ...range };
    expect(() => validateDraftAuditionRange(range, 10)).toThrow(/range/);
    expect(range).toEqual(before);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])('rejects invalid duration %s', (duration) => {
    expect(() => validateDraftAuditionRange({ start: 0, end: 1 }, duration)).toThrow(/duration/);
    expect(() => draftPlaybackStart(0, duration)).toThrow(/duration/);
    expect(() =>
      advanceDraftPlayback({ startTime: 0, elapsedSeconds: 0, speed: 1, duration })
    ).toThrow(/duration/);
  });
});

describe('starting and resuming a private preview run', () => {
  it('restarts a finished whole show, preserves an interior time, and clamps negative time', () => {
    expect(draftPlaybackStart(10, 10)).toBe(0);
    expect(draftPlaybackStart(Number.MAX_VALUE, 10)).toBe(0);
    expect(draftPlaybackStart(9.875, 10)).toBe(9.875);
    expect(draftPlaybackStart(-2, 10)).toBe(0);
    expect(draftPlaybackStart(0, 10)).toBe(0);
  });

  it('resumes only inside the half-open loop and otherwise starts at its beginning', () => {
    const range = { start: 2.5, end: 8.25 };
    for (const time of [-1, 0, 2.49, 8.25, 9, Number.MAX_VALUE])
      expect(draftPlaybackStart(time, 10, range)).toBe(2.5);
    for (const time of [2.5, 4.125, 8.249999])
      expect(draftPlaybackStart(time, 10, range)).toBe(time);
  });

  it.each([NaN, Infinity, -Infinity])('rejects a nonfinite anchor %s', (time) => {
    expect(() => draftPlaybackStart(time, 10)).toThrow(/time.*finite/);
    expect(() => draftPlaybackStart(time, 10, { start: 2, end: 8 })).toThrow(/time.*finite/);
    expect(() =>
      advanceDraftPlayback({ startTime: time, elapsedSeconds: 0, speed: 1, duration: 10 })
    ).toThrow(/time.*finite/);
  });
});

describe('absolute preview playback clock', () => {
  it.each(DRAFT_PREVIEW_SPEEDS)('scales wall-clock seconds by supported rate %s', (speed) => {
    expect(advanceDraftPlayback({ startTime: 2, elapsedSeconds: 3, speed, duration: 20 })).toEqual({
      time: 2 + 3 * speed,
      ended: false,
    });
  });

  it('stops at exact EOF, including a delayed frame, and starts a new EOF anchor consistently', () => {
    const run = { startTime: 8, speed: 0.5, duration: 10 };
    expect(advanceDraftPlayback({ ...run, elapsedSeconds: 3.5 })).toEqual({
      time: 9.75,
      ended: false,
    });
    expect(advanceDraftPlayback({ ...run, elapsedSeconds: 4 })).toEqual({ time: 10, ended: true });
    expect(advanceDraftPlayback({ ...run, elapsedSeconds: 400 })).toEqual({
      time: 10,
      ended: true,
    });
    expect(advanceDraftPlayback({ ...run, startTime: 10, elapsedSeconds: 0 })).toEqual({
      time: 0,
      ended: false,
    });
    expect(advanceDraftPlayback({ ...run, startTime: -2, elapsedSeconds: 2 })).toEqual({
      time: 1,
      ended: false,
    });
  });

  it('uses absolute elapsed time so dropped frames have the same result as dense frames', () => {
    const run = { startTime: 1.5, speed: 1.5, duration: 30, range: { start: 1, end: 7 } };
    for (const elapsedSeconds of [0, 0.01, 0.25, 1, 4, 9])
      advanceDraftPlayback({ ...run, elapsedSeconds });
    expect(advanceDraftPlayback({ ...run, elapsedSeconds: 12.5 })).toEqual({
      time: 2.25,
      ended: false,
    });
    expect(advanceDraftPlayback({ ...run, elapsedSeconds: 1000.5 })).toEqual({
      time: 2.25,
      ended: false,
    });
    const paused = advanceDraftPlayback({ ...run, elapsedSeconds: 9 });
    expect(advanceDraftPlayback({ ...run, startTime: paused.time, elapsedSeconds: 3.5 })).toEqual(
      advanceDraftPlayback({ ...run, elapsedSeconds: 12.5 })
    );
  });

  it('wraps exact boundaries, partial cycles, and many cycles without stopping', () => {
    const run = { startTime: 4, speed: 1, duration: 10, range: { start: 2, end: 5 } };
    expect(advanceDraftPlayback({ ...run, elapsedSeconds: 0 })).toEqual({ time: 4, ended: false });
    expect(advanceDraftPlayback({ ...run, elapsedSeconds: 1 })).toEqual({ time: 2, ended: false });
    expect(advanceDraftPlayback({ ...run, elapsedSeconds: 7.5 })).toEqual({
      time: 2.5,
      ended: false,
    });
    expect(advanceDraftPlayback({ ...run, elapsedSeconds: 301 })).toEqual({
      time: 2,
      ended: false,
    });
    expect(advanceDraftPlayback({ ...run, startTime: 5, elapsedSeconds: 0.5 })).toEqual({
      time: 2.5,
      ended: false,
    });
  });

  it('supports fractional and adjacent-float loop intervals without widening the endpoint', () => {
    const range = { start: 0.1, end: 0.3 };
    const run = { startTime: 0.1, speed: 1, duration: 1, range };
    expect(advanceDraftPlayback({ ...run, elapsedSeconds: range.end - range.start })).toEqual({
      time: 0.1,
      ended: false,
    });
    const near = advanceDraftPlayback({ ...run, elapsedSeconds: 0.2 });
    expect(near.time).toBeCloseTo(0.1, 15);
    expect(near.time).toBeGreaterThanOrEqual(range.start);
    expect(near.time).toBeLessThan(range.end);
    const narrow = { start: 1, end: 1 + Number.EPSILON };
    for (const elapsedSeconds of [0, Number.EPSILON / 2, Number.EPSILON, 1000.125]) {
      const result = advanceDraftPlayback({
        startTime: 1,
        elapsedSeconds,
        speed: 1,
        duration: 2,
        range: narrow,
      });
      expect(result).toEqual({ time: 1, ended: false });
    }
  });

  it('retains an exact anchor at zero elapsed and never mutates the supplied range', () => {
    const range = Object.freeze({ start: 0.1, end: 9.9 });
    const run = Object.freeze({
      startTime: 8.123456789012345,
      elapsedSeconds: 0,
      speed: 1.5,
      duration: 10,
      range,
    });
    expect(advanceDraftPlayback(run)).toEqual({ time: run.startTime, ended: false });
    expect(range).toEqual({ start: 0.1, end: 9.9 });
  });

  it('rebases speed and resume clocks without a time jump or double-counted elapsed time', () => {
    const duration = 20;
    const settled = advanceDraftPlayback({ startTime: 2, elapsedSeconds: 2, speed: 0.5, duration });
    expect(settled).toEqual({ time: 3, ended: false });
    expect(
      advanceDraftPlayback({ startTime: settled.time, elapsedSeconds: 0, speed: 2, duration })
    ).toEqual({ time: 3, ended: false });
    const faster = advanceDraftPlayback({
      startTime: settled.time,
      elapsedSeconds: 2,
      speed: 2,
      duration,
    });
    expect(faster).toEqual({ time: 7, ended: false });
    const resume = draftPlaybackStart(faster.time, duration);
    expect(
      advanceDraftPlayback({ startTime: resume, elapsedSeconds: 0.5, speed: 1, duration })
    ).toEqual({ time: 7.5, ended: false });
  });

  it('rebases a changed speed after wrapping, and disables looping at the full shared duration', () => {
    const duration = 10,
      range = { start: 2, end: 5 };
    const settled = advanceDraftPlayback({
      startTime: 4,
      elapsedSeconds: 1.5,
      speed: 1,
      duration,
      range,
    });
    expect(settled.time).toBe(2.5);
    expect(
      advanceDraftPlayback({
        startTime: settled.time,
        elapsedSeconds: 2,
        speed: 2,
        duration,
        range,
      })
    ).toEqual({ time: 3.5, ended: false });
    expect(advanceDraftPlayback({ startTime: 4, elapsedSeconds: 2, speed: 1, duration })).toEqual({
      time: 6,
      ended: false,
    });
    expect(advanceDraftPlayback({ startTime: 4, elapsedSeconds: 6, speed: 1, duration })).toEqual({
      time: 10,
      ended: true,
    });
    expect(range).toEqual({ start: 2, end: 5 });
  });

  it('holds the shorter document while preserving the shared loop, then resumes it on wrap', () => {
    const base = structuredClone(defaultProject),
      draft = structuredClone(defaultProject);
    base.cues = [{ ...base.cues[0], duration: 10, transition: 0 }];
    draft.cues = [{ ...draft.cues[0], duration: 6, transition: 0 }];
    const snapshots = structuredClone({ base, draft });
    const duration = draftPreviewTiming(base, draft, 0).duration;
    const run = { startTime: 4, speed: 1, duration, range: { start: 4, end: 9 } };
    const late = advanceDraftPlayback({ ...run, elapsedSeconds: 4 });
    expect(draftPreviewTiming(base, draft, late.time)).toMatchObject({
      time: 8,
      baseTime: 8,
      draftTime: 6,
      draftEnded: true,
    });
    const wrapped = advanceDraftPlayback({ ...run, elapsedSeconds: 6 });
    expect(draftPreviewTiming(base, draft, wrapped.time)).toMatchObject({
      time: 5,
      baseTime: 5,
      draftTime: 5,
      draftEnded: false,
    });
    expect({ base, draft }).toEqual(snapshots);
  });

  it.each([0, -1, 0.75, 3, NaN, Infinity, -Infinity])('rejects unsupported speed %s', (speed) => {
    expect(() =>
      advanceDraftPlayback({ startTime: 0, elapsedSeconds: 1, speed, duration: 10 })
    ).toThrow(/speed/);
  });

  it.each([-0.01, NaN, Infinity, -Infinity])(
    'rejects invalid elapsed time %s',
    (elapsedSeconds) => {
      expect(() =>
        advanceDraftPlayback({ startTime: 0, elapsedSeconds, speed: 1, duration: 10 })
      ).toThrow(/elapsed.*finite.*nonnegative/);
    }
  );

  it('rejects multiplication overflow and avoids overflowing a large finite sum', () => {
    expect(() =>
      advanceDraftPlayback({
        startTime: 0,
        elapsedSeconds: Number.MAX_VALUE,
        speed: 2,
        duration: 10,
      })
    ).toThrow(/elapsed.*finite/);
    expect(
      advanceDraftPlayback({
        startTime: Number.MAX_VALUE / 2,
        elapsedSeconds: Number.MAX_VALUE,
        speed: 1,
        duration: Number.MAX_VALUE,
      })
    ).toEqual({ time: Number.MAX_VALUE, ended: true });
    const range = { start: Number.MAX_VALUE / 4, end: Number.MAX_VALUE };
    const result = advanceDraftPlayback({
      startTime: Number.MAX_VALUE / 2,
      elapsedSeconds: Number.MAX_VALUE,
      speed: 1,
      duration: Number.MAX_VALUE,
      range,
    });
    expect(Number.isFinite(result.time)).toBe(true);
    expect(result.time).toBeGreaterThanOrEqual(range.start);
    expect(result.time).toBeLessThan(range.end);
    expect(result.ended).toBe(false);
  });

  it('validates active ranges on every entry point and freezes the supported rate catalogue', () => {
    const range = { start: 4, end: 2 };
    expect(() => draftPlaybackStart(3, 10, range)).toThrow(/range/);
    expect(() =>
      advanceDraftPlayback({ startTime: 3, elapsedSeconds: 1, speed: 1, duration: 10, range })
    ).toThrow(/range/);
    expect(() => validateDraftAuditionRange(null as unknown as DraftAuditionRange, 10)).toThrow(
      /range/
    );
    expect(Object.isFrozen(DRAFT_PREVIEW_SPEEDS)).toBe(true);
  });
});
