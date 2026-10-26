import { describe, expect, it } from 'vitest';
import { normalizeViewerSnapshot, type ViewerSnapshot } from './viewer';
import {
  createCameraAuditionPlan,
  sampleCameraAudition,
  sampleCameraAuditionClock,
  type CameraAuditionPlan,
} from './camera-audition';

function endpoints(): { from: ViewerSnapshot; to: ViewerSnapshot } {
  const venue = { east: 0, north: 70, heading: 180 };
  return {
    from: {
      pose: { east: -100, north: 50, eyeHeight: 1, yaw: 350, pitch: -10, fov: 50 },
      venue: { ...venue },
    },
    to: {
      pose: { east: 100, north: -50, eyeHeight: 3, yaw: 10, pitch: 50, fov: 90 },
      venue: { ...venue },
    },
  };
}
function plan(easing: 'linear' | 'smooth' = 'linear') {
  const { from, to } = endpoints();
  return createCameraAuditionPlan(from, to, 8, easing);
}

describe('private audience camera path', () => {
  it('interpolates ENU position, eye height, pitch, FOV and the short yaw arc with a fixed venue', () => {
    const path = plan(),
      original = structuredClone(path);
    expect(sampleCameraAudition(path, 4)).toEqual({
      pose: { east: 0, north: 0, eyeHeight: 2, yaw: 0, pitch: 20, fov: 70 },
      venue: { east: 0, north: 70, heading: 180 },
    });
    expect(sampleCameraAudition(path, 2).pose).toEqual({
      east: -50,
      north: 25,
      eyeHeight: 1.5,
      yaw: 355,
      pitch: 5,
      fov: 60,
    });
    expect(path).toEqual(original);
  });

  it('uses cubic smoothstep with exact midpoint and slower motion near either endpoint', () => {
    const smooth = plan('smooth'),
      linear = plan();
    expect(sampleCameraAudition(smooth, 2).pose).toEqual({
      east: -68.75,
      north: 34.375,
      eyeHeight: 1.3125,
      yaw: 353.125,
      pitch: -0.625,
      fov: 56.25,
    });
    expect(sampleCameraAudition(smooth, 4)).toEqual(sampleCameraAudition(linear, 4));
    expect(sampleCameraAudition(smooth, 6).pose.east).toBe(68.75);
    expect(sampleCameraAudition(smooth, 0.01).pose.east - smooth.from.pose.east).toBeLessThan(
      sampleCameraAudition(linear, 0.01).pose.east - linear.from.pose.east
    );
    expect(smooth.to.pose.east - sampleCameraAudition(smooth, 7.99).pose.east).toBeLessThan(
      linear.to.pose.east - sampleCameraAudition(linear, 7.99).pose.east
    );
  });

  it('wraps clockwise and counterclockwise across north without taking the long route', () => {
    const { from, to } = endpoints();
    const forward = createCameraAuditionPlan(from, to, 8, 'linear');
    const reverse = createCameraAuditionPlan(to, from, 8, 'linear');
    expect([0, 2, 4, 6, 8].map((time) => sampleCameraAudition(forward, time).pose.yaw)).toEqual([
      350, 355, 0, 5, 10,
    ]);
    expect([0, 2, 4, 6, 8].map((time) => sampleCameraAudition(reverse, time).pose.yaw)).toEqual([
      10, 5, 0, 355, 350,
    ]);
  });

  it.each([
    [0, 180, 90],
    [180, 0, 270],
    [270, 90, 0],
    [90, 270, 180],
  ])('uses a deterministic positive180° arc for opposite yaw %s→%s', (start, end, halfway) => {
    const { from, to } = endpoints();
    from.pose.yaw = start;
    to.pose.yaw = end;
    const path = createCameraAuditionPlan(from, to, 2, 'linear');
    expect(sampleCameraAudition(path, 1).pose.yaw).toBe(halfway);
  });

  it('keeps canonical fractional angles and handles wrap rounding near north', () => {
    const { from, to } = endpoints();
    from.pose.yaw = 12.3456789012345;
    to.pose.yaw = from.pose.yaw;
    const path = createCameraAuditionPlan(from, to, 8, 'smooth');
    for (const time of [0, 0.001, 2, 5.375, 8])
      expect(sampleCameraAudition(path, time).pose.yaw).toBe(from.pose.yaw);
    from.pose.yaw = 0.1;
    to.pose.yaw = 359.9;
    const wrapped = sampleCameraAudition(createCameraAuditionPlan(from, to, 8, 'linear'), 4);
    expect(wrapped.pose.yaw).toBe(0);
  });

  it('clamps finite elapsed values to exact owned endpoints, preserving their original numbers', () => {
    const path = plan();
    path.from.pose.east = -0;
    path.to.pose.pitch = 37.1234567890123;
    for (const time of [-Number.MAX_VALUE, -1, 0]) {
      const result = sampleCameraAudition(path, time);
      expect(result).toEqual(path.from);
      expect(result).not.toBe(path.from);
      expect(Object.is(result.pose.east, -0)).toBe(true);
    }
    for (const time of [8, 8.1, Number.MAX_VALUE]) {
      const result = sampleCameraAudition(path, time);
      expect(result).toEqual(path.to);
      expect(result.pose).not.toBe(path.to.pose);
      result.venue.east = 3;
      expect(path.to.venue.east).toBe(0);
    }
  });

  it('owns both endpoints and every returned pose without references shared with the caller', () => {
    const { from, to } = endpoints(),
      original = structuredClone({ from, to });
    const path = createCameraAuditionPlan(from, to, 8, 'linear');
    from.pose.east = 400;
    to.venue.north = 10;
    expect(path.from).toEqual(original.from);
    expect(path.to).toEqual(original.to);
    path.from.pose.north = 3;
    expect(from.pose.north).toBe(50);
    const first = sampleCameraAudition(path, 4),
      again = sampleCameraAudition(path, 4);
    first.pose.yaw = 100;
    first.venue.heading = 0;
    expect(again.pose.yaw).toBe(0);
    expect(again.venue.heading).toBe(180);
    const same = createCameraAuditionPlan(original.from, original.from, 1, 'linear');
    same.from.pose.east = 300;
    expect(same.to.pose.east).toBe(-100);
  });

  it('keeps all intermediate poses within canonical bounds at the extreme valid endpoints', () => {
    const { from, to } = endpoints();
    from.pose = { east: -500, north: 500, eyeHeight: 0.5, yaw: 359.999999999, pitch: -20, fov: 45 };
    to.pose = { east: 500, north: -500, eyeHeight: 5, yaw: 0.000000001, pitch: 89, fov: 100 };
    for (const easing of ['linear', 'smooth'] as const) {
      const path = createCameraAuditionPlan(from, to, 30, easing);
      for (let index = 0; index <= 120; index++) {
        const value = sampleCameraAudition(path, index / 4);
        expect(value).toEqual(normalizeViewerSnapshot(value));
        expect(value.venue).toEqual(from.venue);
      }
    }
  });

  it('rejects any venue change before constructing or sampling a path', () => {
    for (const key of ['east', 'north', 'heading'] as const) {
      const { from, to } = endpoints();
      to.venue[key] += 1;
      const before = structuredClone({ from, to });
      expect(() => createCameraAuditionPlan(from, to, 5, 'linear')).toThrow(/identical venue/);
      expect({ from, to }).toEqual(before);
    }
    const path = plan();
    path.to.venue.north = 71;
    expect(() => sampleCameraAudition(path, 4)).toThrow(/identical venue/);
  });

  it('rejects invalid duration/easing and noncanonical poses rather than silently normalizing them', () => {
    const { from, to } = endpoints();
    for (const duration of [0, 0.999, 30.001, NaN, Infinity, -Infinity])
      expect(() => createCameraAuditionPlan(from, to, duration, 'linear')).toThrow(/duration/);
    for (const duration of [1, 1.125, 30])
      expect(createCameraAuditionPlan(from, to, duration, 'smooth').duration).toBe(duration);
    expect(() => createCameraAuditionPlan(from, to, 5, 'ease' as 'linear')).toThrow(/easing/);
    for (const patch of [
      { yaw: 360 },
      { yaw: -1 },
      { east: 501 },
      { north: -501 },
      { eyeHeight: 0.49 },
      { pitch: 89.1 },
      { fov: 100.1 },
      { yaw: NaN },
      { pitch: Infinity },
    ]) {
      const invalid = { ...from, pose: { ...from.pose, ...patch } };
      expect(() => createCameraAuditionPlan(invalid, to, 5, 'linear')).toThrow();
    }
    const invalidVenue = { ...from, venue: { ...from.venue, heading: 360 } };
    expect(() => createCameraAuditionPlan(invalidVenue, to, 5, 'linear')).toThrow(/canonical/);
    expect(() =>
      createCameraAuditionPlan(null as unknown as ViewerSnapshot, to, 5, 'linear')
    ).toThrow(/snapshot/);
    expect(() =>
      createCameraAuditionPlan(
        { ...from, pose: { ...from.pose, roll: 0 } } as ViewerSnapshot,
        to,
        5,
        'linear'
      )
    ).toThrow(/unknown fields/);
  });

  it.each([NaN, Infinity, -Infinity])('rejects nonfinite sample elapsed %s', (elapsed) => {
    expect(() => sampleCameraAudition(plan(), elapsed)).toThrow(/elapsed.*finite/);
  });
});

describe('private camera audition clock', () => {
  it('uses milliseconds for the wall clock and seconds for the elapsed anchor', () => {
    const path = plan();
    expect(sampleCameraAuditionClock(path, { elapsed: 1, startedAt: 5000 }, 7500)).toEqual({
      elapsed: 3.5,
      playing: true,
      snapshot: sampleCameraAudition(path, 3.5),
    });
    expect(sampleCameraAuditionClock(path, { elapsed: 1, startedAt: 5000 }, 4999)).toEqual({
      elapsed: 1,
      playing: true,
      snapshot: sampleCameraAudition(path, 1),
    });
    expect(sampleCameraAuditionClock(path, { elapsed: 1, startedAt: 5000 }, 5000).elapsed).toBe(1);
  });

  it('settles pause and resume/rebase without counting paused wall time or restarting the path', () => {
    const path = plan('smooth'),
      original = structuredClone(path);
    const settled = sampleCameraAuditionClock(path, { elapsed: 0, startedAt: 1000 }, 3500);
    const pausedClock = { elapsed: settled.elapsed, startedAt: null };
    const paused = sampleCameraAuditionClock(path, pausedClock, 100000);
    expect(paused).toEqual({ elapsed: 2.5, playing: false, snapshot: settled.snapshot });
    const resumed = sampleCameraAuditionClock(
      path,
      { elapsed: paused.elapsed, startedAt: 100000 },
      100750
    );
    expect(resumed).toEqual({
      elapsed: 3.25,
      playing: true,
      snapshot: sampleCameraAudition(path, 3.25),
    });
    expect(pausedClock).toEqual({ elapsed: 2.5, startedAt: null });
    expect(path).toEqual(original);
  });

  it('supports paused seek and explicit restarted anchors without advancing or replaying on its own', () => {
    const path = plan();
    const sought = sampleCameraAuditionClock(path, { elapsed: 6.125, startedAt: null }, 999999);
    expect(sought).toEqual({
      elapsed: 6.125,
      playing: false,
      snapshot: sampleCameraAudition(path, 6.125),
    });
    expect(
      sampleCameraAuditionClock(path, { elapsed: sought.elapsed, startedAt: 1000 }, 1125).elapsed
    ).toBe(6.25);
    const ended = sampleCameraAuditionClock(path, { elapsed: 8, startedAt: 1000 }, 2000);
    expect(ended).toEqual({ elapsed: 8, playing: false, snapshot: path.to });
    expect(sampleCameraAuditionClock(path, { elapsed: 0, startedAt: 2000 }, 2000)).toEqual({
      elapsed: 0,
      playing: true,
      snapshot: path.from,
    });
  });

  it('holds the exact endpoint on delayed frames and safely handles extreme finite timestamps', () => {
    const path = plan();
    for (const now of [8000, 8001, Number.MAX_VALUE])
      expect(sampleCameraAuditionClock(path, { elapsed: 0, startedAt: 0 }, now)).toEqual({
        elapsed: 8,
        playing: false,
        snapshot: path.to,
      });
    expect(
      sampleCameraAuditionClock(
        path,
        { elapsed: 0, startedAt: -Number.MAX_VALUE },
        Number.MAX_VALUE
      )
    ).toEqual({ elapsed: 8, playing: false, snapshot: path.to });
    expect(
      sampleCameraAuditionClock(
        path,
        { elapsed: 3, startedAt: Number.MAX_VALUE },
        -Number.MAX_VALUE
      ).elapsed
    ).toBe(3);
    expect(sampleCameraAuditionClock(path, { elapsed: -1, startedAt: null }, 1000)).toEqual({
      elapsed: 0,
      playing: false,
      snapshot: path.from,
    });
    expect(
      sampleCameraAuditionClock(path, { elapsed: Number.MAX_VALUE, startedAt: null }, 1000)
    ).toEqual({ elapsed: 8, playing: false, snapshot: path.to });
  });

  it('clones the paused and held snapshots independently and validates all clock/plan inputs', () => {
    const path = plan(),
      first = sampleCameraAuditionClock(path, { elapsed: 8, startedAt: null }, 0);
    first.snapshot.pose.east = -500;
    first.snapshot.venue.north = -500;
    expect(sampleCameraAuditionClock(path, { elapsed: 8, startedAt: null }, 0).snapshot).toEqual(
      path.to
    );
    for (const invalid of [NaN, Infinity, -Infinity]) {
      expect(() =>
        sampleCameraAuditionClock(path, { elapsed: invalid, startedAt: null }, 0)
      ).toThrow(/finite/);
      expect(() => sampleCameraAuditionClock(path, { elapsed: 0, startedAt: invalid }, 0)).toThrow(
        /finite/
      );
      expect(() =>
        sampleCameraAuditionClock(path, { elapsed: 0, startedAt: null }, invalid)
      ).toThrow(/finite/);
    }
    expect(() =>
      sampleCameraAuditionClock(path, { elapsed: 0 } as { elapsed: number; startedAt: null }, 0)
    ).toThrow(/clock/);
    const altered = { ...path, duration: 0 };
    expect(() => sampleCameraAuditionClock(altered, { elapsed: 0, startedAt: null }, 0)).toThrow(
      /duration/
    );
    expect(() => sampleCameraAudition({ ...path, extra: true } as CameraAuditionPlan, 0)).toThrow(
      /plan/
    );
  });
});
