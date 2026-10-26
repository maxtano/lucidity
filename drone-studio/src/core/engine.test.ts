import { describe, expect, it } from 'vitest';
import {
  defaultProject,
  frameAt,
  projectSchema,
  shapes,
  smooth,
  totalDuration,
  type Project,
} from './model';
import { colors, formation, interpolate } from './formations';
import { applyOperations, propose } from './commands';
import { lightIntensity, parseProjectFile, projectBundle, trajectoryCsv } from './export';
import { separationConflict, validateProject } from './validation';

const fresh = (): Project => structuredClone(defaultProject);
const tiny = (): Project => ({
  ...fresh(),
  droneCount: 2,
  cues: [{ ...defaultProject.cues[0], duration: 4, transition: 3 }],
});

describe('Project integrity and commands', () => {
  it.each([0, -1, 1.2, 100001, Infinity, NaN])('rejects invalid fleet size %s', (count) => {
    expect(() => projectSchema.parse({ ...fresh(), droneCount: count })).toThrow();
  });
  it.each([1, 100000])('accepts boundary fleet size %s', (droneCount) => {
    expect(projectSchema.parse({ ...fresh(), droneCount }).droneCount).toBe(droneCount);
  });
  it('rejects duplicate cue IDs and invalid transitions', () => {
    const p = fresh();
    p.cues[1].id = p.cues[0].id;
    expect(() => projectSchema.parse(p)).toThrow();
    p.cues[1].id = 'second';
    p.cues[1].transition = 25;
    expect(() => projectSchema.parse(p)).toThrow();
  });
  it('applies an atomic batch, increments revision, and preserves its input', () => {
    const p = fresh();
    const next = applyOperations(p, [
      { type: 'set_fleet', count: 1200 },
      { type: 'set_tempo', bpm: 100 },
    ]);
    expect([next.droneCount, next.bpm, next.revision]).toEqual([1200, 100, 1]);
    expect(p).toEqual(defaultProject);
  });
  it('rejects an invalid batch without partially applying it', () => {
    const p = fresh();
    expect(() =>
      applyOperations(p, [
        { type: 'set_fleet', count: 1200 },
        { type: 'update_cue', id: 'absent', patch: { altitude: 80 } },
      ])
    ).toThrow();
    expect(p).toEqual(defaultProject);
  });
  it('rejects stale proposals and deleting the last cue', () => {
    expect(() => applyOperations(fresh(), [{ type: 'set_fleet', count: 40 }], 3)).toThrow(
      /out of date/
    );
    const p = tiny();
    expect(() => applyOperations(p, [{ type: 'remove_cue', id: p.cues[0].id }])).toThrow();
  });
  it('reorders while preserving identity and total duration', () => {
    const p = fresh(),
      n = applyOperations(p, [{ type: 'move_cue', id: 'in-orbit', direction: 'up' }]);
    expect(n.cues[0].id).toBe('in-orbit');
    expect(totalDuration(n)).toBe(totalDuration(p));
  });
});
describe('Deterministic choreography', () => {
  it.each(shapes)('generates stable finite %s positions at small fleet sizes', (shape) => {
    for (const count of [1, 2, 31, 800]) {
      const cue = { ...defaultProject.cues[1], shape },
        a = formation(cue, count);
      expect(a.length).toBe(count * 3);
      expect(a.every(Number.isFinite)).toBe(true);
      expect(a).toEqual(formation(cue, count));
    }
  });
  it('generates every point at 100,000 drones without sampling', () => {
    const points = formation(defaultProject.cues[1], 100000);
    expect(points.length).toBe(300000);
    expect(points.every(Number.isFinite)).toBe(true);
  });
  it('places a one-drone grid at the formation center', () => {
    expect(Array.from(formation(defaultProject.cues[0], 1))).toEqual([0, 0, 60]);
  });
  it('uses bounded, deterministic RGB colors', () => {
    const rgb = colors('aurora', 100);
    expect(rgb.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(rgb).toEqual(colors('aurora', 100));
  });
  it('has bounded interpolation, correct cue boundaries, and a final frame', () => {
    expect([smooth(-2), smooth(0), smooth(0.5), smooth(1), smooth(3)]).toEqual([0, 0, 0.5, 1, 1]);
    expect(frameAt(fresh(), 16).cue.id).toBe('in-orbit');
    expect(frameAt(fresh(), 16).progress).toBe(0);
    expect(frameAt(fresh(), 32).progress).toBe(1);
    expect(frameAt(fresh(), 10000).cue.id).toBe('afterglow');
  });
  it('is position-continuous at scene boundaries', () => {
    const p = fresh(),
      before = frameAt(p, 15.999999),
      after = frameAt(p, 16);
    const a = interpolate(formation(before.previous, 5), formation(before.cue, 5), before.progress),
      b = interpolate(formation(after.previous, 5), formation(after.cue, 5), after.progress);
    expect(a).toEqual(b);
  });
});
describe('Agent proposals', () => {
  it('prepares a complete brief without mutating the project', () => {
    const p = fresh(),
      proposal = propose('Create a 96 second cosmic show with 1,200 drones', p);
    const next = applyOperations(p, proposal.operations, proposal.revision);
    expect(totalDuration(next)).toBe(96);
    expect(next.droneCount).toBe(1200);
    expect(p).toEqual(defaultProject);
  });
  it('preserves the requested formation order', () => {
    const next = applyOperations(
      fresh(),
      propose('Create a heart then a sphere then a wave', fresh()).operations
    );
    expect(next.cues.map((c) => c.shape)).toEqual(['heart', 'sphere', 'wave']);
  });
  it('supports warm colors, extra scenes, and slower transitions', () => {
    expect(
      applyOperations(
        fresh(),
        propose('Make the colors feel warmer', fresh()).operations
      ).cues.every((c) => c.palette === 'ember')
    ).toBe(true);
    expect(
      applyOperations(fresh(), propose('Add a double helix', fresh()).operations).cues.at(-1)?.shape
    ).toBe('helix');
    expect(totalDuration(applyOperations(fresh(), propose('Slow down', fresh()).operations))).toBe(
      192
    );
  });
  it('explains unsupported requests and rejects out-of-range counts', () => {
    expect(() => propose('paint a photorealistic tiger', fresh())).toThrow(/brief parser/);
    expect(() => propose('Use 500000 drones', fresh())).toThrow();
  });
});
describe('Design checks', () => {
  it('finds close pairs across negative cell boundaries', () => {
    expect(separationConflict(new Float32Array([-0.1, 0, 0, 0.1, 0, 0]), 2)?.distance).toBeCloseTo(
      0.2
    );
    expect(separationConflict(new Float32Array([-5, 0, 0, 5, 0, 0]), 2)).toBeNull();
  });
  it('catches a crossing even when endpoints are clear', () => {
    const a = new Float32Array([-5, 0, 60, 5, 0, 60]),
      b = new Float32Array([5, 0, 60, -5, 0, 60]);
    expect(separationConflict(a, 2)).toBeNull();
    expect(separationConflict(b, 2)).toBeNull();
    expect(separationConflict(interpolate(a, b, 0.5), 2)?.distance).toBe(0);
  });
  it('never certifies a preview as flight ready', () => {
    const r = validateProject(tiny());
    expect(r.flightReady).toBe(false);
    expect(r.status).toBe('incomplete');
    expect(r.checks.find((c) => c.name === 'Flight lifecycle')?.status).toBe('incomplete');
  });
  it('flags altitude, speed, and acceleration violations', () => {
    const p = tiny();
    p.cues.push({ ...p.cues[0], id: 'second', altitude: 220, transition: 1 });
    const r = validateProject(p);
    expect(
      r.checks
        .filter((c) => ['Stage volume', 'Peak speed', 'Peak acceleration'].includes(c.name))
        .every((c) => c.status === 'fail')
    ).toBe(true);
  });
  it('marks unsupported separation analysis as incomplete', () => {
    const p = { ...tiny(), droneCount: 2001 };
    const r = validateProject(p);
    expect(r.separationSamples).toBe(0);
    expect(r.checks.find((c) => c.name === 'Drone separation')?.status).toBe('incomplete');
  });
});
describe('Portable export', () => {
  it('round-trips an editable bundle and drops stale validation', () => {
    const p = tiny(),
      report = validateProject(p);
    const bundle = projectBundle(p, report);
    expect(parseProjectFile(JSON.stringify(bundle))).toEqual(p);
    expect(projectBundle({ ...p, revision: 1 }, report).validation).toBeNull();
    expect(bundle.flightReady).toBe(false);
  });
  it('rejects malformed and unknown project versions', () => {
    expect(() => parseProjectFile('{oops')).toThrow();
    expect(() => parseProjectFile(JSON.stringify({ ...tiny(), version: 5 }))).toThrow();
    expect(() =>
      parseProjectFile(JSON.stringify({ format: 'other', formatVersion: 1, project: tiny() }))
    ).toThrow();
  });
  it('exports each drone at start and end in ENU with the same RGB pulse', () => {
    const p = tiny(),
      csv = trajectoryCsv(p),
      lines = csv.split('\n'),
      first = lines[2].split(',').map(Number),
      last = lines.at(-1)!.split(',').map(Number);
    expect(lines.length).toBe(2 + 9 * 2);
    expect(first.slice(0, 2)).toEqual([0, 1]);
    expect(last.slice(0, 2)).toEqual([4, 2]);
    expect(first[4]).toBe(60);
    const rgb = colors(p.cues[0].palette, 2);
    expect(first[5]).toBe(Math.round(rgb[0] * lightIntensity(0, p.bpm) * 255));
  });
  it('includes an exact endpoint for fractional show durations', () => {
    const p = tiny();
    p.cues[0].duration = 4.2;
    expect(trajectoryCsv(p).split('\n').at(-1)?.split(',')[0]).toBe('4.200');
  });
  it('rejects unbounded CSV materialization', () => {
    expect(() => trajectoryCsv({ ...fresh(), droneCount: 100000 })).toThrow(/350,000/);
  });
});
