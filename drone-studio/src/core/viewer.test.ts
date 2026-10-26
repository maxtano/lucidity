import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEWER_POSE,
  DEFAULT_VENUE_PLACEMENT,
  headingToPoint,
  headingToStage,
  normalizeVenuePlacement,
  normalizeViewerSnapshot,
  normalizeViewerPose,
  viewDirectionLabel,
  viewerDirection,
  type ViewerPose,
  type VenuePlacement,
} from './viewer';

describe('immersive viewer camera math', () => {
  it('starts at a human eye height facing North and keeps defaults immutable', () => {
    expect(DEFAULT_VIEWER_POSE).toEqual({
      east: 0,
      north: 0,
      eyeHeight: 1.7,
      yaw: 0,
      pitch: 35,
      fov: 90,
    });
    expect(Object.isFrozen(DEFAULT_VIEWER_POSE)).toBe(true);
    const normalized = normalizeViewerPose(DEFAULT_VIEWER_POSE);
    expect(normalized).toEqual(DEFAULT_VIEWER_POSE);
    expect(normalized).not.toBe(DEFAULT_VIEWER_POSE);
  });

  it.each([
    [-720, 0],
    [-450, 270],
    [-360, 0],
    [-1, 359],
    [0, 0],
    [360, 0],
    [721, 1],
  ])('wraps yaw %s to %s degrees', (yaw, expected) => {
    const pose = { ...DEFAULT_VIEWER_POSE, yaw };
    expect(normalizeViewerPose(pose).yaw).toBe(expected);
    expect(pose.yaw).toBe(yaw);
    expect(Object.is(normalizeViewerPose(pose).yaw, -0)).toBe(false);
  });

  it('clamps movement, eye height, pitch, and field of view at both limits', () => {
    expect(
      normalizeViewerPose({ east: -1000, north: 1000, eyeHeight: 0, yaw: 0, pitch: 100, fov: 120 })
    ).toEqual({ east: -500, north: 500, eyeHeight: 0.5, yaw: 0, pitch: 89, fov: 100 });
    expect(
      normalizeViewerPose({ east: 1000, north: -1000, eyeHeight: 10, yaw: 0, pitch: -90, fov: 20 })
    ).toEqual({ east: 500, north: -500, eyeHeight: 5, yaw: 0, pitch: -20, fov: 45 });
  });

  it('rejects every nonfinite pose component instead of passing NaN to a renderer', () => {
    for (const key of Object.keys(DEFAULT_VIEWER_POSE) as (keyof ViewerPose)[])
      for (const value of [NaN, Infinity, -Infinity])
        expect(() => normalizeViewerPose({ ...DEFAULT_VIEWER_POSE, [key]: value })).toThrow(
          'finite'
        );
    expect(() => viewerDirection(Infinity, 0)).toThrow('finite');
    expect(() => viewerDirection(0, NaN)).toThrow('finite');
    expect(() => headingToStage(0, 0, NaN)).toThrow('finite');
    expect(() => headingToStage(Infinity, 0, 100)).toThrow('finite');
    expect(() => headingToStage(0, -Infinity, 100)).toThrow('finite');
    expect(() => viewDirectionLabel(NaN, 0)).toThrow('finite');
    expect(() => viewDirectionLabel(0, Infinity)).toThrow('finite');
  });

  it.each([
    [0, [0, 0, -1]],
    [90, [1, 0, 0]],
    [180, [0, 0, 1]],
    [270, [-1, 0, 0]],
  ] as [number, number[]][])('maps compass yaw %s into ENU world coordinates', (yaw, expected) => {
    viewerDirection(yaw, 0).forEach((value, axis) => expect(value).toBeCloseTo(expected[axis], 12));
  });

  it('produces unit directions through a complete turn and clamps pitch away from vertical', () => {
    for (let yaw = -720; yaw <= 720; yaw += 7)
      for (const pitch of [-1000, -20, 0, 22, 89, 1000]) {
        const [east, up, south] = viewerDirection(yaw, pitch);
        expect(Math.hypot(east, up, south)).toBeCloseTo(1, 12);
        expect(Math.hypot(east, south)).toBeGreaterThan(0.017);
      }
    expect(viewerDirection(90, 1000)).toEqual(viewerDirection(90, 89));
    expect(viewerDirection(90, -1000)).toEqual(viewerDirection(90, -20));
    expect(viewerDirection(45, 22)[1]).toBeGreaterThan(0);
  });

  it.each([
    [0, 0, 100, 0],
    [-10, 100, 100, 90],
    [0, 200, 100, 180],
    [10, 100, 100, 270],
    [-100, 0, 100, 45],
    [100, 0, 100, 315],
    [0, 100, 100, 0],
  ])('finds a wrapped stage bearing from [%s,%s] to North%s', (east, north, distance, expected) => {
    expect(headingToStage(east, north, distance)).toBeCloseTo(expected, 12);
  });

  it('points at the stage from arbitrary viewer positions without assuming the origin', () => {
    for (const [east, north, stage] of [
      [23, -45, 120],
      [-60, 200, 150],
      [90, 32, -30],
    ]) {
      const bearing = headingToStage(east, north, stage);
      const direction = viewerDirection(bearing, 0);
      const length = Math.hypot(east, stage - north);
      expect(direction[0]).toBeCloseTo(-east / length, 12);
      expect(direction[2]).toBeCloseTo(-(stage - north) / length, 12);
      expect(viewDirectionLabel(bearing, bearing)).toBe('Stage ahead');
      expect(viewDirectionLabel(bearing + 90, bearing)).toBe('Right of stage');
      expect(viewDirectionLabel(bearing + 180, bearing)).toBe('Behind you');
      expect(viewDirectionLabel(bearing - 90, bearing)).toBe('Left of stage');
    }
    expect(headingToStage(1e308, -1e308, 1e308)).toBeCloseTo(333.434948822922, 10);
  });

  it.each([
    [0, 'Stage ahead'],
    [44.99, 'Stage ahead'],
    [45, 'Right of stage'],
    [134.99, 'Right of stage'],
    [135, 'Behind you'],
    [224.99, 'Behind you'],
    [225, 'Left of stage'],
    [314.99, 'Left of stage'],
    [315, 'Stage ahead'],
    [360, 'Stage ahead'],
    [-90, 'Left of stage'],
  ])('labels relative heading %s deterministically at quadrant boundaries', (relative, label) => {
    expect(viewDirectionLabel(350 + relative, 350)).toBe(label);
  });
});

describe('venue placement and viewer snapshots', () => {
  it('defines the stage front compass heading independently from its location', () => {
    expect(DEFAULT_VENUE_PLACEMENT).toEqual({ east: 0, north: 70, heading: 180 });
    expect(Object.isFrozen(DEFAULT_VENUE_PLACEMENT)).toBe(true);
    expect(normalizeVenuePlacement({ east: 1000, north: -1000, heading: -90 })).toEqual({
      east: 500,
      north: -500,
      heading: 270,
    });
    expect(normalizeVenuePlacement({ east: -1000, north: 1000, heading: 720 })).toEqual({
      east: -500,
      north: 500,
      heading: 0,
    });
  });

  it('clones complete snapshots and retains in-range angle values without repeated wrapping drift', () => {
    const snapshot = {
      pose: { ...DEFAULT_VIEWER_POSE, yaw: 12.123456789012345, pitch: 33.123456789 },
      venue: { east: 17.2, north: 41.4, heading: 271.1234567890123 },
    };
    const original = structuredClone(snapshot);
    let normalized = normalizeViewerSnapshot(snapshot);
    for (let iteration = 0; iteration < 50; iteration++)
      normalized = normalizeViewerSnapshot(normalized);
    expect(normalized).toEqual(snapshot);
    expect(normalized).not.toBe(snapshot);
    expect(normalized.pose).not.toBe(snapshot.pose);
    expect(normalized.venue).not.toBe(snapshot.venue);
    normalized.pose.yaw = 180;
    normalized.venue.north = 200;
    expect(snapshot).toEqual(original);
  });

  it('rejects nonfinite venue coordinates/headings and normalizes tiny negative angles safely', () => {
    for (const key of Object.keys(DEFAULT_VENUE_PLACEMENT) as (keyof VenuePlacement)[])
      for (const value of [NaN, Infinity, -Infinity])
        expect(() => normalizeVenuePlacement({ ...DEFAULT_VENUE_PLACEMENT, [key]: value })).toThrow(
          /finite/
        );
    expect(
      normalizeVenuePlacement({ ...DEFAULT_VENUE_PLACEMENT, heading: -Number.MIN_VALUE }).heading
    ).toBe(0);
    expect(
      Object.is(normalizeVenuePlacement({ ...DEFAULT_VENUE_PLACEMENT, heading: -0 }).heading, -0)
    ).toBe(false);
  });

  it('computes point bearings in every quadrant and remains compatible with stage-distance callers', () => {
    for (const [targetEast, targetNorth, heading] of [
      [10, 30, 0],
      [20, 20, 90],
      [10, 10, 180],
      [0, 20, 270],
      [20, 30, 45],
      [10, 20, 0],
    ])
      expect(headingToPoint(10, 20, targetEast, targetNorth)).toBeCloseTo(heading, 12);
    for (const [east, north, stage] of [
      [23, -45, 120],
      [-60, 200, 150],
      [90, 32, -30],
    ])
      expect(headingToStage(east, north, stage)).toBe(headingToPoint(east, north, 0, stage));
  });

  it('handles extreme finite coordinates and tiny displacements without overflowing or flattening them', () => {
    expect(
      headingToPoint(-Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE)
    ).toBe(45);
    expect(
      headingToPoint(-Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE)
    ).toBe(90);
    expect(headingToPoint(0, 0, Number.MIN_VALUE, Number.MIN_VALUE)).toBe(45);
    const coordinate = 1e308;
    const neighboring = coordinate + 2e292;
    expect(neighboring).toBeGreaterThan(coordinate);
    expect(headingToPoint(coordinate, coordinate, neighboring, neighboring)).toBe(45);
    for (let index = 0; index < 4; index++) {
      const input = [1, 2, 3, 4];
      input[index] = NaN;
      expect(() => headingToPoint(input[0], input[1], input[2], input[3])).toThrow(/finite/);
    }
  });
});
