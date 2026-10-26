import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { inspectAudienceFrame } from './audience-inspection';
import { defaultProject, type Vector3Tuple } from './model';
import type { ViewerSnapshot } from './viewer';
import { audienceFrame, isAudienceFrameAspect } from './viewer-frame';

describe('captured-aspect audience frame', () => {
  it('uses the whole viewport when its aspect already matches the capture', () => {
    expect(audienceFrame(1600, 900, 16 / 9)).toEqual({
      x: 0,
      y: 0,
      width: 1600,
      height: 900,
      aspect: 16 / 9,
    });
    expect(audienceFrame(75.5, 75.5, 1)).toEqual({
      x: 0,
      y: 0,
      width: 75.5,
      height: 75.5,
      aspect: 1,
    });
  });

  it('centers pillarboxing in a wider viewport and letterboxing in a taller viewport', () => {
    expect(audienceFrame(1200, 600, 1)).toEqual({
      x: 300,
      y: 0,
      width: 600,
      height: 600,
      aspect: 1,
    });
    expect(audienceFrame(600, 1200, 2)).toEqual({
      x: 0,
      y: 450,
      width: 600,
      height: 300,
      aspect: 2,
    });
    expect(audienceFrame(600, 1200, 0.25)).toEqual({
      x: 150,
      y: 0,
      width: 300,
      height: 1200,
      aspect: 0.25,
    });
  });

  it('preserves fractional CSS dimensions and exact projection aspect rather than raster rounding', () => {
    const aspect = 16 / 9;
    const frame = audienceFrame(401.25, 300.5, aspect)!;
    expect(frame).toEqual({
      x: 0,
      y: 37.3984375,
      width: 401.25,
      height: 225.703125,
      aspect,
    });
    expect(frame.aspect).toBe(aspect);
    expect(Math.round(frame.width) / Math.round(frame.height)).not.toBe(aspect);
    const tall = audienceFrame(500.125, 201.25, 1.6)!;
    expect(tall).toEqual({ x: 89.0625, y: 0, width: 322, height: 201.25, aspect: 1.6 });
  });

  it('fits a newly resized viewport without retaining or mutating any earlier frame', () => {
    const first = audienceFrame(1200, 600, 1.5)!;
    const resized = audienceFrame(600, 900, 1.5)!;
    expect(first).toEqual({ x: 150, y: 0, width: 900, height: 600, aspect: 1.5 });
    expect(resized).toEqual({ x: 0, y: 250, width: 600, height: 400, aspect: 1.5 });
    resized.width = 1;
    expect(audienceFrame(600, 900, 1.5)!.width).toBe(600);
    expect(first.width).toBe(900);
  });

  it.each([undefined, null, 0, -1, NaN, Infinity, -Infinity, 100.00001])(
    'falls back to the entire viewport for absent or unsupported aspect %s',
    (aspect) => {
      expect(audienceFrame(750.5, 400.25, aspect)).toEqual({
        x: 0,
        y: 0,
        width: 750.5,
        height: 400.25,
        aspect: 750.5 / 400.25,
      });
    }
  );

  it('validates captured aspect independently of the unrestricted natural viewport shape', () => {
    for (const aspect of [1e-37, 0.0001, 0.5, 1, 16 / 9, 100])
      expect(isAudienceFrameAspect(aspect)).toBe(true);
    for (const aspect of [
      undefined,
      null,
      '',
      '1.6',
      true,
      {},
      0,
      -1,
      NaN,
      Infinity,
      101,
      Number.MIN_VALUE,
      1e-309,
      1e-300,
      1e-39,
    ])
      expect(isAudienceFrameAspect(aspect)).toBe(false);
    expect(audienceFrame(1000, 1)).toEqual({ x: 0, y: 0, width: 1000, height: 1, aspect: 1000 });
    expect(audienceFrame(1000, 1, 100)).toEqual({
      x: 450,
      y: 0,
      width: 100,
      height: 1,
      aspect: 100,
    });
  });

  it.each([
    [0, 100],
    [100, 0],
    [-1, 100],
    [100, -1],
    [NaN, 100],
    [100, NaN],
    [Infinity, 100],
    [100, Infinity],
    [-Infinity, 100],
    [100, -Infinity],
  ])('returns null for an empty or invalid viewport %s × %s', (width, height) => {
    expect(audienceFrame(width, height)).toBeNull();
    expect(audienceFrame(width, height, 1.6)).toBeNull();
  });

  it('retains positive subpixel dimensions without introducing a minimum framing size', () => {
    expect(audienceFrame(100, 100, 1e-12)).toEqual({
      x: (100 - 1e-10) / 2,
      y: 0,
      width: 1e-10,
      height: 100,
      aspect: 1e-12,
    });
    expect(audienceFrame(0.25, 100, 100)).toEqual({
      x: 0,
      y: (100 - 0.0025) / 2,
      width: 0.25,
      height: 0.0025,
      aspect: 100,
    });
    expect(audienceFrame(1, 1, 1e-37)).toEqual({
      x: 0.5,
      y: 0,
      width: 1e-37,
      height: 1,
      aspect: 1e-37,
    });
  });

  it('avoids finite-input overflow and explicitly rejects unrepresentable underflow', () => {
    const maximum = Number.MAX_VALUE,
      minimum = Number.MIN_VALUE;
    expect(audienceFrame(maximum, maximum, 100)).toEqual({
      x: 0,
      y: (maximum - maximum / 100) / 2,
      width: maximum,
      height: maximum / 100,
      aspect: 100,
    });
    expect(audienceFrame(maximum, minimum, 1)).toEqual({
      x: maximum / 2,
      y: 0,
      width: minimum,
      height: minimum,
      aspect: 1,
    });
    expect(audienceFrame(minimum, maximum, 1)).toEqual({
      x: 0,
      y: maximum / 2,
      width: minimum,
      height: minimum,
      aspect: 1,
    });
    expect(audienceFrame(minimum, 1, 100)).toBeNull();
    expect(audienceFrame(1, minimum, 1e-37)).toBeNull();
    expect(audienceFrame(maximum, minimum)).toBeNull();
    expect(audienceFrame(minimum, maximum)).toBeNull();
  });

  it('rejects captured aspects that overflow Three.js projection coefficients uploaded as Float32', () => {
    for (const aspect of [1e-37, 0.0001, 1, 100]) {
      expect(isAudienceFrameAspect(aspect)).toBe(true);
      for (const fov of [45, 75, 100]) {
        const camera = new PerspectiveCamera(fov, aspect, 0.1, 5000);
        expect(camera.projectionMatrix.elements.map(Math.fround).every(Number.isFinite)).toBe(true);
      }
    }
    for (const aspect of [Number.MIN_VALUE, 1e-309, 1e-300, 1e-39]) {
      expect(isAudienceFrameAspect(aspect)).toBe(false);
      const camera = new PerspectiveCamera(45, aspect, 0.1, 5000);
      expect(camera.projectionMatrix.elements.map(Math.fround).every(Number.isFinite)).toBe(false);
      expect(audienceFrame(1000, 500, aspect)).toEqual({
        x: 0,
        y: 0,
        width: 1000,
        height: 500,
        aspect: 2,
      });
    }
  });
});

describe('captured perspective invariance during resize', () => {
  it('keeps independent Three.js projection and shared audience counts constant across viewport shapes', () => {
    const positions: Vector3Tuple[] = [
      [0, 10, 2],
      [15, 10, 2],
      [-19, 10, 2],
      [21, 10, 2],
      [0, 10, 13],
      [0, -10, 2],
      [0, 0.05, 2],
      [0, 5001, 2],
    ];
    const project = structuredClone(defaultProject);
    project.droneCount = positions.length;
    project.cues = [
      {
        ...project.cues[0],
        duration: 4,
        transition: 0,
        droneEdits: Object.fromEntries(
          positions.map((position, index) => [
            index + 1,
            { position, color: '#ffffff', brightness: index === 2 ? 0 : 1 },
          ])
        ),
      },
    ];
    const snapshot: ViewerSnapshot = {
      pose: { east: 0, north: 0, eyeHeight: 2, yaw: 0, pitch: 0, fov: 90 },
      venue: { east: 0, north: 70, heading: 180 },
    };
    const projectVisibility = (aspect: number) => {
      const camera = new PerspectiveCamera(90, aspect, 0.1, 5000);
      camera.position.set(0, 2, 0);
      camera.lookAt(0, 2, -1);
      camera.updateMatrixWorld(true);
      return positions.map(([east, north, up]) => {
        const point = new Vector3(east, up, -north).project(camera);
        return (
          north > 0 && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && Math.abs(point.z) <= 1
        );
      });
    };
    const expected = [true, true, true, false, false, false, false, false];
    const original = structuredClone({ project, snapshot });
    for (const [width, height] of [
      [1600, 800],
      [800, 1600],
      [3000, 500],
      [399.5, 243.75],
      [1.25, 10],
      [500, 0.125],
    ]) {
      const frame = audienceFrame(width, height, 2)!;
      expect(frame.aspect).toBe(2);
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.width).toBeLessThanOrEqual(width);
      expect(frame.height).toBeLessThanOrEqual(height);
      expect(projectVisibility(frame.aspect)).toEqual(expected);
      const inspection = inspectAudienceFrame(project, 0, snapshot, frame.aspect, 32);
      expect(inspection.drones.map((drone) => drone.visible)).toEqual(expected);
      expect(inspection.totals).toMatchObject({ inFrustum: 3, inFrustumLightsOn: 2 });
    }
    // Resizing the camera aspect itself changes membership: letterboxing is what
    // preserves the captured projection, not a coincidental invariant scene.
    expect(projectVisibility(audienceFrame(800, 1600)!.aspect)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(projectVisibility(audienceFrame(3000, 500)!.aspect)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect({ project, snapshot }).toEqual(original);
  });
});
