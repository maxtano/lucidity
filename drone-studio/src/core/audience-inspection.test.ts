import { describe, expect, it, vi } from 'vitest';
import { ShowEvaluator } from './animation';
import { assertAudienceInspectionBudget, inspectAudienceFrame } from './audience-inspection';
import { defaultProject, type Project, type Vector3Tuple } from './model';
import { DEFAULT_VENUE_PLACEMENT, DEFAULT_VIEWER_POSE, type ViewerSnapshot } from './viewer';

function snapshot(): ViewerSnapshot {
  return {
    pose: { ...DEFAULT_VIEWER_POSE, eyeHeight: 1, yaw: 0, pitch: 0, fov: 90 },
    venue: { ...DEFAULT_VENUE_PLACEMENT },
  };
}
function project(positions: Vector3Tuple[]): Project {
  const value = structuredClone(defaultProject);
  value.droneCount = positions.length;
  value.cues = [
    {
      ...value.cues[0],
      id: 'audience',
      duration: 4,
      transition: 0,
      droneEdits: Object.fromEntries(
        positions.map((position, index) => [index + 1, { position, color: '#ffffff' }])
      ),
    },
  ];
  return value;
}

describe('analytical audience frame inspection', () => {
  it('counts ENU quadrants and overhead independently of look direction and dark lights', () => {
    const input = project([
      [0, 10, 1],
      [10, 0, 1],
      [0, -10, 1],
      [-10, 0, 1],
      [0, 0, 11],
      [10, 10, 1],
    ]);
    input.cues[0].droneEdits![2].brightness = 0;
    const view = snapshot();
    const before = structuredClone({ input, view });
    const result = inspectAudienceFrame(input, 0, view, 1, 32);
    expect(result.totals).toEqual({
      droneCount: 6,
      front: 2,
      right: 2,
      rear: 1,
      left: 1,
      overhead: 1,
      inFrustum: 2,
      lightsOn: 5,
      inFrustumLightsOn: 2,
    });
    expect(result.drones.map((drone) => drone.bearing)).toEqual([0, 90, 180, 270, 0, 45]);
    expect(result.drones[4].elevation).toBe(90);
    expect(result.drones[1]).toMatchObject({ visible: false, lightsOn: false, color: [0, 0, 0] });
    view.pose.yaw = 90;
    const east = inspectAudienceFrame(input, 0, view, 1, 32);
    expect(east.totals).toEqual({ ...result.totals, inFrustumLightsOn: 1 });
    expect(east.drones[1]).toMatchObject({ visible: true, lightsOn: false });
    expect(input).toEqual(before.input);
    view.pose.yaw = 0;
    expect(view).toEqual(before.view);
  });

  it('uses bearing to arbitrary stage centre, independently of stage front heading', () => {
    const input = project([
      [5, 10, 1],
      [15, 0, 1],
      [5, -10, 1],
      [-5, 0, 1],
    ]);
    const view = snapshot();
    view.pose.east = 5;
    view.venue = { east: 100, north: 0, heading: 270 };
    const result = inspectAudienceFrame(input, 0, view, 1, 32);
    expect(result.stageBearing).toBe(90);
    expect(result.totals).toMatchObject({ front: 1, right: 1, rear: 1, left: 1 });
    view.venue.heading = 0;
    expect(inspectAudienceFrame(input, 0, view, 1, 32)).toEqual(result);
  });

  it('applies camera pitch and aspect to a perspective frustum instead of counting all forward points', () => {
    const input = project([
      [0, 10, 11],
      [0, 10, 1],
      [15, 10, 1],
      [0, -10, 1],
    ]);
    const view = snapshot();
    view.pose.fov = 60;
    expect(
      inspectAudienceFrame(input, 0, view, 1, 32).drones.map((drone) => drone.visible)
    ).toEqual([false, true, false, false]);
    view.pose.pitch = 45;
    expect(
      inspectAudienceFrame(input, 0, view, 1, 32).drones.map((drone) => drone.visible)
    ).toEqual([true, false, false, false]);
    view.pose.pitch = 0;
    view.pose.fov = 90;
    expect(inspectAudienceFrame(input, 0, view, 2, 32).drones[2].visible).toBe(true);
    expect(inspectAudienceFrame(input, 0, view, 1, 32).drones[2].visible).toBe(false);
  });

  it('uses forward camera depth for near/far clipping and excludes points at or behind the eye', () => {
    const input = project([
      [0, 0, 1],
      [0, 0.05, 1],
      [0, 0.1, 1],
      [0, 5000, 1],
      [0, 5001, 1],
      [0, -1, 1],
      [4000, 4000, 1],
    ]);
    const result = inspectAudienceFrame(input, 0, snapshot(), 1, 32);
    expect(result.drones.map((drone) => drone.visible)).toEqual([
      false,
      false,
      true,
      true,
      false,
      false,
      true,
    ]);
    expect(
      result.drones.every(
        (drone) => Number.isFinite(drone.bearing) && Number.isFinite(drone.elevation)
      )
    ).toBe(true);
    expect(result.totals.inFrustum).toBe(3);
  });

  it('evaluates incoming motion/light blend, keyed brightness, flash, and global beat modulation', () => {
    const input = project([
      [0, 10, 1],
      [0, 10, 1],
    ]);
    input.cues[0].duration = 1;
    input.cues[0].droneEdits![1] = { position: [0, 10, 1], color: '#ff0000', brightness: 0.5 };
    input.cues[0].droneEdits![2] = {
      position: [0, 10, 1],
      color: '#ffffff',
      flash: { hz: 1, duty: 0.5, phase: 0.5 },
    };
    input.cues.push({
      ...input.cues[0],
      id: 'next',
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
    const result = inspectAudienceFrame(input, 2, snapshot(), 1, 32);
    expect(result).toMatchObject({ cueId: 'next', localTime: 1, blend: 0.5 });
    expect(result.drones[0]).toMatchObject({
      position: [0, 20, 1],
      color: [0.25, 0, 0.25],
      lightsOn: true,
    });
    expect(result.drones[1]).toMatchObject({
      position: [0, 20, 1],
      color: [0, 0, 0],
      visible: true,
      lightsOn: false,
    });
    expect(result.totals).toMatchObject({ inFrustum: 2, lightsOn: 1, inFrustumLightsOn: 1 });
    const modulated = inspectAudienceFrame(input, 2.25, snapshot(), 1, 32);
    expect(modulated.drones[0].color[0]).toBeCloseTo(0.15, 12);
    expect(modulated.drones[0].color[2]).toBeCloseTo(0.3125, 12);
  });

  it('returns bounded deterministic representatives while totals cover all 100,000 active drones', () => {
    const input = structuredClone(defaultProject);
    input.droneCount = 100000;
    input.cues = [{ ...input.cues[0], duration: 4, transition: 0 }];
    const result = inspectAudienceFrame(input, 0, snapshot(), 16 / 9, 5);
    expect(result.drones.map((drone) => drone.id)).toEqual([1, 25000, 50000, 75000, 100000]);
    expect(
      result.totals.front + result.totals.right + result.totals.rear + result.totals.left
    ).toBe(100000);
    expect(result.totals.lightsOn).toBe(100000);
    expect(JSON.stringify(result).length).toBeLessThan(6000);
  });

  it('rejects noncanonical or nonfinite inputs without modifying the captured snapshot', () => {
    const input = project([[0, 10, 1]]);
    const view = snapshot();
    for (const patch of [
      { yaw: 360 },
      { east: 501 },
      { pitch: 90 },
      { fov: 101 },
      { eyeHeight: 0.2 },
      { north: NaN },
    ]) {
      const invalid = { ...view, pose: { ...view.pose, ...patch } };
      expect(() => inspectAudienceFrame(input, 0, invalid, 1, 1)).toThrow();
    }
    expect(() =>
      inspectAudienceFrame(input, 0, { ...view, venue: { ...view.venue, heading: 360 } }, 1, 1)
    ).toThrow('canonical');
    for (const aspect of [0, -1, 101, Infinity, NaN])
      expect(() => inspectAudienceFrame(input, 0, view, aspect, 1)).toThrow('aspect');
    for (const limit of [0, 1.5, 33, NaN])
      expect(() => inspectAudienceFrame(input, 0, view, 1, limit)).toThrow('limit');
    for (const time of [-1, 5, Infinity, NaN])
      expect(() => inspectAudienceFrame(input, time, view, 1, 1)).toThrow('time');
    expect(view).toEqual(snapshot());
  });

  it('rejects active key work before evaluating frames, ignoring unrelated cues and dormant IDs', () => {
    const input = project([[0, 10, 1]]);
    input.droneCount = 130;
    const keys = Array.from({ length: 2048 }, (_, index) => ({ time: index / 2, brightness: 0.5 }));
    input.cues[0].droneEdits = Object.fromEntries(
      Array.from({ length: 130 }, (_, index) => [index + 1, { keyframes: keys }])
    );
    const spy = vi.spyOn(ShowEvaluator.prototype, 'frame');
    try {
      expect(() => inspectAudienceFrame(input, 0, snapshot(), 1, 1)).toThrow('budget');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    input.droneCount = 1;
    expect(() => assertAudienceInspectionBudget(input, 0)).not.toThrow();
    const original = project([[0, 10, 1]]);
    original.cues.push({ ...input.cues[0], id: 'later', droneEdits: input.cues[0].droneEdits });
    original.droneCount = 130;
    expect(() => assertAudienceInspectionBudget(original, 0)).not.toThrow();
    expect(() => assertAudienceInspectionBudget(original, 4)).toThrow('budget');
  });

  it('fails clearly if authored coordinates overflow the shared float-buffer representation', () => {
    const input = project([[Number.MAX_VALUE, 10, 1]]);
    expect(() => inspectAudienceFrame(input, 0, snapshot(), 1, 1)).toThrow('finite numerical');
  });
});
