import { describe, expect, it } from 'vitest';
import {
  createAudienceHighlight,
  audienceHighlightIsCurrent,
  writeAudienceHighlightPositions,
} from './audience-highlight';
import { selectAudienceDrones, type AudienceSelectionReport } from './audience-selection';
import { defaultProject } from './model';

function fixture() {
  const project = structuredClone(defaultProject);
  project.id = 'audience-highlight';
  project.revision = 7;
  project.droneCount = 5;
  project.cues = [
    {
      ...project.cues[0],
      id: 'before',
      duration: 2,
      transition: 0,
      droneEdits: {
        1: { position: [0, 10, 1] },
        2: { position: [0, -10, 1] },
        3: { position: [0, 20, 1] },
        4: { position: [20, 0, 1] },
        5: { position: [0, 30, 1], brightness: 0 },
      },
    },
  ];
  project.cues.push({
    ...structuredClone(project.cues[0]),
    id: 'incoming',
    duration: 4,
    transition: 2,
    transitionEasing: 'linear',
  });
  const report: AudienceSelectionReport = {
    projectId: project.id,
    revision: 7,
    droneCount: 5,
    request: {
      time: 3,
      snapshot: {
        pose: { east: 0, north: 0, eyeHeight: 1, yaw: 0, pitch: 0, fov: 90 },
        venue: { east: 0, north: 70, heading: 180 },
      },
      aspect: 1,
      region: 'in_frame',
      lights: 'any',
      scopeIds: [1, 2, 3, 5, 10],
    },
    ids: [1, 3, 5],
    matchedCount: 3,
    consideredCount: 4,
    cueId: 'incoming',
    localTime: 1,
    blend: 0.5,
    limitations: ['Sampled geometric membership only.'],
  };
  return { project, report };
}

describe('owned audience highlights', () => {
  it('accepts actual full-query results and preserves every captured criterion and scene value', async () => {
    const { project, report } = fixture();
    const measured = await selectAudienceDrones(project, report.request);
    const highlight = createAudienceHighlight(project, measured);
    expect(highlight).toEqual({ ...measured, ids: [1, 3, 5] });
    expect(highlight.request.snapshot).toEqual(report.request.snapshot);
    expect(highlight.request.scopeIds).toEqual([1, 2, 3, 5, 10]);
    expect(highlight).not.toBe(measured);
  });

  it('clones and deeply freezes IDs, camera, scope and report metadata without freezing caller objects', () => {
    const { project, report } = fixture(),
      before = structuredClone({ project, report });
    const highlight = createAudienceHighlight(project, report);
    expect({ project, report }).toEqual(before);
    expect(
      [
        highlight,
        highlight.ids,
        highlight.request,
        highlight.request.snapshot,
        highlight.request.snapshot.pose,
        highlight.request.snapshot.venue,
        highlight.request.scopeIds,
        highlight.limitations,
      ].every(Object.isFrozen)
    ).toBe(true);
    expect(
      [project, report, report.ids, report.request, report.request.snapshot.pose].some(
        Object.isFrozen
      )
    ).toBe(false);
    report.ids[0] = 2;
    report.request.scopeIds![0] = 2;
    report.request.snapshot.pose.yaw = 90;
    report.request.snapshot.venue.heading = 0;
    report.limitations[0] = 'Changed input';
    expect(highlight.ids).toEqual([1, 3, 5]);
    expect(highlight.request.scopeIds).toEqual([1, 2, 3, 5, 10]);
    expect(highlight.request.snapshot.pose.yaw).toBe(0);
    expect(highlight.request.snapshot.venue.heading).toBe(180);
    expect(highlight.limitations).toEqual(before.report.limitations);
    expect(() => {
      (highlight.ids as number[]).push(4);
    }).toThrow();
    expect(() => {
      highlight.request.snapshot.pose.yaw = 180;
    }).toThrow();
  });

  it('checks project ID, revision and fleet in constant time without reading IDs or project scenes', () => {
    const { project, report } = fixture(),
      highlight = createAudienceHighlight(project, report);
    expect(audienceHighlightIsCurrent(highlight, project)).toBe(true);
    for (const patch of [{ id: 'other' }, { revision: 8 }, { droneCount: 4 }])
      expect(audienceHighlightIsCurrent(highlight, { ...project, ...patch })).toBe(false);
    expect(audienceHighlightIsCurrent(null, project)).toBe(false);
    expect(audienceHighlightIsCurrent(undefined, project)).toBe(false);
    const target = { ...highlight };
    Object.defineProperty(target, 'ids', {
      get() {
        throw new Error('Must not scan membership.');
      },
    });
    const document = { ...project };
    Object.defineProperty(document, 'cues', {
      get() {
        throw new Error('Must not scan show.');
      },
    });
    expect(audienceHighlightIsCurrent(target, document)).toBe(true);
    // Content identity within one revision is the editor's responsibility; this is a quick guard.
    expect(audienceHighlightIsCurrent(highlight, structuredClone(project))).toBe(true);
  });

  it('keeps explicit empty and dormant-only scopes empty, and accepts no-scope full-fleet counts', () => {
    for (const scopeIds of [[], [10, 100000]]) {
      const { project, report } = fixture();
      report.request.scopeIds = scopeIds;
      report.ids = [];
      report.matchedCount = 0;
      report.consideredCount = 0;
      expect(createAudienceHighlight(project, report)).toMatchObject({
        ids: [],
        matchedCount: 0,
        consideredCount: 0,
        request: { scopeIds },
      });
    }
    const { project, report } = fixture();
    delete report.request.scopeIds;
    report.consideredCount = 5;
    expect(createAudienceHighlight(project, report).request).not.toHaveProperty('scopeIds');
  });

  it.each([
    [
      'different project',
      (r: AudienceSelectionReport) => {
        r.projectId = 'other';
      },
    ],
    [
      'stale revision',
      (r: AudienceSelectionReport) => {
        r.revision = 6;
      },
    ],
    [
      'wrong fleet',
      (r: AudienceSelectionReport) => {
        r.droneCount = 4;
      },
    ],
    [
      'partial page',
      (r: AudienceSelectionReport) => {
        r.ids = [1];
      },
    ],
    [
      'duplicate ID',
      (r: AudienceSelectionReport) => {
        r.ids = [1, 1, 5];
      },
    ],
    [
      'unsorted IDs',
      (r: AudienceSelectionReport) => {
        r.ids = [3, 1, 5];
      },
    ],
    [
      'dormant match',
      (r: AudienceSelectionReport) => {
        r.ids = [1, 3, 10];
      },
    ],
    [
      'fractional ID',
      (r: AudienceSelectionReport) => {
        r.ids = [1, 3, 4.5];
      },
    ],
    [
      'sparse IDs',
      (r: AudienceSelectionReport) => {
        r.ids = Array(3);
      },
    ],
    [
      'wrong match count',
      (r: AudienceSelectionReport) => {
        r.matchedCount = 4;
      },
    ],
    [
      'wrong considered count',
      (r: AudienceSelectionReport) => {
        r.consideredCount = 5;
      },
    ],
    [
      'out-of-scope match',
      (r: AudienceSelectionReport) => {
        r.ids = [1, 3, 4];
      },
    ],
    [
      'unbounded scope ID',
      (r: AudienceSelectionReport) => {
        r.request.scopeIds = [1, 2, 3, 5, 100001];
      },
    ],
    [
      'duplicate scope',
      (r: AudienceSelectionReport) => {
        r.request.scopeIds = [1, 2, 3, 3, 5];
      },
    ],
    [
      'unsorted scope',
      (r: AudienceSelectionReport) => {
        r.request.scopeIds = [1, 2, 5, 3];
      },
    ],
    [
      'wrong cue',
      (r: AudienceSelectionReport) => {
        r.cueId = 'before';
      },
    ],
    [
      'wrong scene-local time',
      (r: AudienceSelectionReport) => {
        r.localTime = 3;
      },
    ],
    [
      'wrong incoming blend',
      (r: AudienceSelectionReport) => {
        r.blend = 1;
      },
    ],
    [
      'nonfinite query time',
      (r: AudienceSelectionReport) => {
        r.request.time = NaN;
      },
    ],
    [
      'negative query time',
      (r: AudienceSelectionReport) => {
        r.request.time = -1;
      },
    ],
    [
      'query after show',
      (r: AudienceSelectionReport) => {
        r.request.time = 7;
      },
    ],
    [
      'noncanonical yaw',
      (r: AudienceSelectionReport) => {
        r.request.snapshot.pose.yaw = 360;
      },
    ],
    [
      'nonfinite eye height',
      (r: AudienceSelectionReport) => {
        r.request.snapshot.pose.eyeHeight = Infinity;
      },
    ],
    [
      'noncanonical venue',
      (r: AudienceSelectionReport) => {
        r.request.snapshot.venue.east = 501;
      },
    ],
    [
      'unknown pose field',
      (r: AudienceSelectionReport) => {
        Object.assign(r.request.snapshot.pose, { roll: 3 });
      },
    ],
    [
      'invalid aspect',
      (r: AudienceSelectionReport) => {
        r.request.aspect = 0;
      },
    ],
    [
      'invalid region',
      (r: AudienceSelectionReport) => {
        Object.assign(r.request, { region: 'near' });
      },
    ],
    [
      'invalid lighting',
      (r: AudienceSelectionReport) => {
        Object.assign(r.request, { lights: 'bright' });
      },
    ],
    [
      'unknown request field',
      (r: AudienceSelectionReport) => {
        Object.assign(r.request, { hidden: true });
      },
    ],
    [
      'missing metadata',
      (r: AudienceSelectionReport) => {
        Reflect.deleteProperty(r, 'consideredCount');
      },
    ],
    [
      'sparse limitations',
      (r: AudienceSelectionReport) => {
        r.limitations = Array(1);
      },
    ],
  ])('rejects %s without changing source data', (_label, mutate) => {
    const { project, report } = fixture();
    mutate(report);
    const before = structuredClone({ project, report });
    expect(() => createAudienceHighlight(project, report)).toThrow();
    expect({ project, report }).toEqual(before);
  });
});

describe('audience highlight position writes', () => {
  const from = () => new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const to = () => new Float32Array([9, 10, 11, 12, 13, 14, 15, 16, 17]);

  it('writes the complete stable-ID subset in ENU→Three order at the current blend, retaining spare buffer capacity', () => {
    const a = from(),
      b = to(),
      aBefore = a.slice(),
      bBefore = b.slice();
    const output = new Float32Array(9).fill(999);
    expect(writeAudienceHighlightPositions([1, 3], a, b, 0.25, output)).toBeUndefined();
    expect(Array.from(output)).toEqual([3, 5, -4, 9, 11, -10, 999, 999, 999]);
    expect(a).toEqual(aBefore);
    expect(b).toEqual(bBefore);
    writeAudienceHighlightPositions([1, 3], a, b, 0, output);
    expect(Array.from(output.slice(0, 6))).toEqual([1, 3, -2, 7, 9, -8]);
    writeAudienceHighlightPositions([1, 3], a, b, 1, output);
    expect(Array.from(output.slice(0, 6))).toEqual([9, 11, -10, 15, 17, -16]);
  });

  it('keeps captured membership fixed while current evaluated positions move outside the original region', () => {
    const { project, report } = fixture(),
      target = createAudienceHighlight(project, report);
    const a = new Float32Array([0, 10, 1, 0, -10, 1, 0, 20, 1, 20, 0, 1, 0, 30, 1]);
    const b = new Float32Array([0, -20, 2, 0, 20, 2, 10, -30, 3, 0, 20, 2, 20, -40, 4]);
    const output = new Float32Array(9);
    writeAudienceHighlightPositions(target.ids, a, b, 1, output);
    expect(Array.from(output)).toEqual([0, 2, 20, 10, 3, 30, 20, 4, 40]);
    expect(target.ids).toEqual([1, 3, 5]);
    expect(target.request.time).toBe(3);
  });

  it('handles all100,000 IDs without truncation or source mutation', () => {
    const { project, report } = fixture();
    project.droneCount = report.droneCount = 100000;
    report.ids = Array.from({ length: 100000 }, (_, index) => index + 1);
    delete report.request.scopeIds;
    report.matchedCount = report.consideredCount = 100000;
    const target = createAudienceHighlight(project, report);
    const a = new Float32Array(300000),
      b = new Float32Array(300000),
      output = new Float32Array(300000);
    for (let index = 0; index < 100000; index++) {
      a[index * 3] = index;
      a[index * 3 + 1] = -index;
      a[index * 3 + 2] = index * 2 + 1;
      b[index * 3] = index + 8;
      b[index * 3 + 1] = -index + 4;
      b[index * 3 + 2] = index * 2 + 9;
    }
    const beforeA = a.slice(),
      beforeB = b.slice();
    writeAudienceHighlightPositions(target.ids, a, b, 0.25, output);
    const expected = new Float32Array(300000);
    for (let index = 0; index < 100000; index++) {
      expected[index * 3] = index + 2;
      expected[index * 3 + 1] = index * 2 + 3;
      expected[index * 3 + 2] = -(1 - index);
    }
    expect(output).toEqual(expected);
    expect(a).toEqual(beforeA);
    expect(b).toEqual(beforeB);
    expect(target.matchedCount).toBe(100000);
  });

  it('rejects malformed IDs, buffers and blend before writing any destination entry', () => {
    const invalid: {
      ids?: number[];
      a?: Float32Array;
      b?: Float32Array;
      blend?: number;
      output?: Float32Array;
    }[] = [
      { ids: [0, 1] },
      { ids: [1, 4] },
      { ids: [1, 1] },
      { ids: [3, 1] },
      { ids: [1, 2.5] },
      { ids: Array(2) },
      { ids: Array(100001).fill(1) },
      { blend: -0.1 },
      { blend: 1.1 },
      { blend: NaN },
      { blend: Infinity },
      { a: new Float32Array(8) },
      { b: new Float32Array(6) },
      { a: new Float32Array(300003), b: new Float32Array(300003) },
      { a: new Float64Array(9) as unknown as Float32Array },
      { output: new Float32Array(3).fill(999) },
      { output: new Float32Array(7).fill(999) },
    ];
    for (const value of invalid) {
      const output = value.output ?? new Float32Array(6).fill(999),
        before = output.slice();
      expect(() =>
        writeAudienceHighlightPositions(
          value.ids ?? [1, 3],
          value.a ?? from(),
          value.b ?? to(),
          value.blend ?? 0.5,
          output
        )
      ).toThrow();
      expect(output).toEqual(before);
    }
  });

  it('preflights nonfinite selected coordinates even when they occur after otherwise valid points', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const a = from(),
        b = to(),
        output = new Float32Array(6).fill(999);
      b[8] = bad;
      expect(() => writeAudienceHighlightPositions([1, 3], a, b, 0, output)).toThrow('finite');
      expect(Array.from(output)).toEqual([999, 999, 999, 999, 999, 999]);
    }
    const a = from(),
      b = to(),
      output = new Float32Array(3);
    a[8] = NaN;
    b[8] = Infinity;
    writeAudienceHighlightPositions([1], a, b, 0.5, output);
    expect(Array.from(output)).toEqual([5, 7, -6]); // Unselected source coordinates are not read.
  });

  it('rejects output overlap with either input, including differently offset views, without corrupting source data', () => {
    for (const useTo of [false, true]) {
      const a = from(),
        b = to(),
        source = useTo ? b : a,
        before = source.slice();
      const output = new Float32Array(source.buffer, 4, 6);
      expect(() => writeAudienceHighlightPositions([1, 3], a, b, 0.5, output)).toThrow('overlap');
      expect(source).toEqual(before);
    }
    const a = from(),
      before = a.slice();
    expect(() => writeAudienceHighlightPositions([1, 2, 3], a, to(), 0.5, a)).toThrow('overlap');
    expect(a).toEqual(before);
  });

  it('allows disjoint views of one buffer and shared read-only source views', () => {
    const buffer = new ArrayBuffer(96),
      a = new Float32Array(buffer, 0, 9),
      b = new Float32Array(buffer, 36, 9),
      output = new Float32Array(buffer, 72, 6);
    a.set(from());
    b.set(to());
    writeAudienceHighlightPositions([1, 3], a, b, 0.25, output);
    expect(Array.from(output)).toEqual([3, 5, -4, 9, 11, -10]);
    expect(a).toEqual(from());
    expect(b).toEqual(to());
    writeAudienceHighlightPositions([1, 3], a, a, 0.5, output);
    expect(Array.from(output)).toEqual([1, 3, -2, 7, 9, -8]);
  });

  it('handles empty sets and valid extreme Float32 coordinates without introducing infinities', () => {
    const output = new Float32Array([9, 8, 7]);
    writeAudienceHighlightPositions([], new Float32Array(), new Float32Array(), 1, output);
    expect(Array.from(output)).toEqual([9, 8, 7]);
    const maximum = Math.fround(3.4028234663852886e38);
    writeAudienceHighlightPositions(
      [1],
      new Float32Array([maximum, maximum, maximum]),
      new Float32Array([-maximum, -maximum, -maximum]),
      0.5,
      output
    );
    expect(Array.from(output)).toEqual([0, 0, -0]);
  });

  it('rejects shared-memory buffers that could change between validation and writing', () => {
    if (typeof SharedArrayBuffer === 'undefined') return;
    const shared = new Float32Array(new SharedArrayBuffer(36)),
      output = new Float32Array(3).fill(9);
    expect(() => writeAudienceHighlightPositions([1], shared, to(), 0.5, output)).toThrow(
      'non-shared'
    );
    expect(Array.from(output)).toEqual([9, 9, 9]);
    expect(() => writeAudienceHighlightPositions([1], from(), to(), 0.5, shared)).toThrow(
      'non-shared'
    );
  });
});
