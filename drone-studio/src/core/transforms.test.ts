import { describe, expect, it } from 'vitest';
import { applyOperations, type Operation } from './commands';
import { evaluateDrone } from './animation';
import { formation } from './formations';
import { defaultProject, type Project } from './model';

function project(count = 4): Project {
  const result = structuredClone(defaultProject);
  result.droneCount = count;
  result.cues = [{ ...result.cues[0], duration: 10, transition: 0 }];
  return result;
}
function transform(input: Project, fields: Record<string, unknown> = {}) {
  return {
    type: 'transform_drones',
    cueId: input.cues[0].id,
    ids: [1, 2],
    translation: [3, -2, 5],
    scope: 'base_and_keys',
    ...fields,
  };
}

describe('relative drone translations', () => {
  it('moves 800 independent paths in one command, retaining arbitrary times and every other channel', () => {
    const input = project(800);
    input.cues[0].droneEdits = Object.fromEntries(
      Array.from({ length: 800 }, (_, i) => [
        i + 1,
        {
          position: [i, -i, 50],
          color: '#102030',
          brightness: 0.7,
          flash: { hz: 2, duty: 0.4, phase: 0.1 },
          keyframes: [0.123456, 5, 13].map((time, j) => ({
            time,
            easing: 'smooth',
            position: [i + j, -i - j, 50 + j],
            color: '#abcdef',
            brightness: j / 2,
          })),
        },
      ])
    );
    const before = structuredClone(input);
    const result = applyOperations(input, [
      transform(input, { ids: Array.from({ length: 800 }, (_, i) => i + 1) }),
    ]);
    expect(input).toEqual(before);
    expect(result.revision).toBe(input.revision + 1);
    for (let id = 1; id <= 800; id++) {
      const original = input.cues[0].droneEdits![id];
      const translated = result.cues[0].droneEdits![id];
      expect(translated).toEqual({
        ...original,
        position: [id - 1 + 3, -(id - 1) - 2, 55],
        keyframes: original.keyframes!.map((key) => ({
          ...key,
          position: key.position!.map((value, axis) => value + [3, -2, 5][axis]),
        })),
      });
    }
  });

  it('uses each original full-fleet generated position without collapsing the group', () => {
    const input = project(20);
    const generated = formation(input.cues[0], input.droneCount);
    const result = applyOperations(input, [transform(input, { ids: [2, 19, 2] })]);
    for (const id of [2, 19])
      expect(result.cues[0].droneEdits![id].position).toEqual(
        Array.from(generated.subarray((id - 1) * 3, id * 3)).map(
          (value, axis) => value + [3, -2, 5][axis]
        )
      );
    expect(Object.keys(result.cues[0].droneEdits!)).toEqual(['2', '19']);
  });

  it('translates dormant authored bases and keys without inventing dormant generated positions', () => {
    const input = project();
    input.cues[0].droneEdits = {
      10: { position: [10, 20, 30], keyframes: [{ time: 20, color: '#ffffff' }] },
      20: {
        brightness: 0.2,
        keyframes: [
          { time: 2, position: [4, 5, 6] },
          { time: 17, position: [7, 8, 9] },
        ],
      },
    };
    const result = applyOperations(input, [transform(input, { ids: [10, 20] })]);
    expect(result.cues[0].droneEdits![10]).toEqual({
      position: [13, 18, 35],
      keyframes: [{ time: 20, color: '#ffffff' }],
    });
    expect(result.cues[0].droneEdits![20]).toEqual({
      brightness: 0.2,
      keyframes: [
        { time: 2, position: [7, 3, 11] },
        { time: 17, position: [10, 6, 14] },
      ],
    });
    const before = structuredClone(input);
    expect(() => applyOperations(input, [transform(input, { ids: [10, 30] })])).toThrow('dormant');
    expect(input).toEqual(before);
  });

  it('samples each path at local time and merges only position into an existing key', () => {
    const input = project();
    input.cues[0].droneEdits = {
      1: {
        color: '#123456',
        keyframes: [
          { time: 0, position: [0, 0, 20] },
          { time: 5, color: '#ff0000', brightness: 0.25, easing: 'hold' },
          { time: 10, position: [10, 20, 40] },
        ],
      },
      2: { position: [100, 5, 60], flash: { hz: 3, duty: 0.5, phase: 0 } },
      3: { position: [1, 2, 3] },
    };
    const result = applyOperations(input, [transform(input, { scope: 'key_at_time', time: 5 })]);
    expect(result.cues[0].droneEdits![1].keyframes![1]).toEqual({
      time: 5,
      color: '#ff0000',
      brightness: 0.25,
      easing: 'hold',
      position: [8, 8, 35],
    });
    expect(result.cues[0].droneEdits![2]).toEqual({
      ...input.cues[0].droneEdits![2],
      keyframes: [{ time: 5, position: [103, 3, 65] }],
    });
    expect(result.cues[0].droneEdits![3]).toEqual(input.cues[0].droneEdits![3]);
    expect(result.cues[0].droneEdits![1].keyframes![0]).toEqual(
      input.cues[0].droneEdits![1].keyframes![0]
    );
  });

  it('uses exact timestamps for tightly spaced retimed keys and rejects ambiguous rounded times', () => {
    const input = project();
    input.cues[0].droneEdits = {
      1: {
        keyframes: [
          { time: 1, position: [0, 0, 1], color: '#ff0000' },
          { time: 1.0000005, position: [2, 0, 1], color: '#0000ff' },
        ],
      },
    };
    const result = applyOperations(input, [
      transform(input, { ids: [1], scope: 'key_at_time', time: 1.0000005 }),
    ]);
    expect(result.cues[0].droneEdits![1].keyframes).toEqual([
      input.cues[0].droneEdits![1].keyframes![0],
      { time: 1.0000005, position: [5, -2, 6], color: '#0000ff' },
    ]);
    expect(() =>
      applyOperations(input, [
        transform(input, { ids: [1], scope: 'key_at_time', time: 1.00000025 }),
      ])
    ).toThrow('ambiguous');
  });

  it('supports dormant keyed targets and preserves their time context', () => {
    const input = project();
    input.cues[0].droneEdits = {
      100: {
        keyframes: [
          { time: 2, position: [0, 0, 10] },
          { time: 8, position: [12, 6, 16] },
        ],
      },
    };
    const result = applyOperations(input, [
      transform(input, { ids: [100], scope: 'key_at_time', time: 5 }),
    ]);
    const edit = result.cues[0].droneEdits![100];
    expect(edit.position).toBeUndefined();
    expect(evaluateDrone(edit, 5, [0, 0, 0], [1, 1, 1]).position).toEqual([9, 1, 18]);
  });

  it('validates scope/time and finite translation before committing any command', () => {
    const input = project();
    for (const fields of [
      { scope: 'key_at_time' },
      { time: 1 },
      { translation: [Infinity, 0, 0] },
      { scope: 'key_at_time', time: -1 },
      { translation: [0, 1] },
    ])
      expect(() => applyOperations(input, [transform(input, fields)])).toThrow();
    const huge = { ...transform(input), translation: [Number.MAX_VALUE, 0, 0] } as Operation;
    input.cues[0].droneEdits = { 1: { position: [Number.MAX_VALUE, 0, 0] } };
    expect(() => applyOperations(input, [huge])).toThrow();
  });
});

describe('explicit-pivot drone rotation and scaling', () => {
  it('scales before rotating right-handed around a pivot, then translates each path', () => {
    const input = project();
    input.cues[0].droneEdits = {
      1: {
        position: [3, 5, 7],
        color: '#112233',
        brightness: 0.7,
        keyframes: [
          { time: 0.123, position: [2, 3, 4], easing: 'hold', color: '#abcdef' },
          { time: 12, brightness: 0.2 },
        ],
      },
      2: { position: [8, 9, 10] },
    };
    const before = structuredClone(input);
    const result = applyOperations(input, [
      transform(input, {
        ids: [1],
        pivot: [1, 2, 3],
        scale: [2, 3, 4],
        rotation: { axis: [0, 0, 7], angleDegrees: 90 },
        translation: [10, 20, 30],
      }),
    ]);
    expect(result.cues[0].droneEdits![1]).toEqual({
      ...input.cues[0].droneEdits![1],
      position: [2, 26, 49],
      keyframes: [
        { time: 0.123, position: [8, 24, 37], easing: 'hold', color: '#abcdef' },
        { time: 12, brightness: 0.2 },
      ],
    });
    expect(result.cues[0].droneEdits![2]).toEqual(input.cues[0].droneEdits![2]);
    expect(input).toEqual(before);
  });

  it('uses exact cardinal angles in ENU and leaves nearby angles unsnapped', () => {
    const input = project();
    input.cues[0].droneEdits = { 1: { position: [1, 2, 3] } };
    for (const [axis, angleDegrees, expected] of [
      [[0, 0, 1], 90, [-2, 1, 3]],
      [[0, 0, 1], -90, [2, -1, 3]],
      [[0, 0, 1], 450, [-2, 1, 3]],
      [[0, 0, 1], 180, [-1, -2, 3]],
      [[1, 0, 0], 90, [1, -3, 2]],
      [[0, 1, 0], 90, [3, 2, -1]],
    ] as const) {
      const result = applyOperations(input, [
        transform(input, {
          ids: [1],
          translation: [0, 0, 0],
          pivot: [0, 0, 0],
          rotation: { axis, angleDegrees },
        }),
      ]);
      expect(result.cues[0].droneEdits![1].position).toEqual(expected);
    }
    const nearby = applyOperations(input, [
      transform(input, {
        ids: [1],
        translation: [0, 0, 0],
        pivot: [0, 0, 0],
        rotation: { axis: [0, 0, 1], angleDegrees: 90 + 1e-8 },
      }),
    ]);
    expect(nearby.cues[0].droneEdits![1].position).not.toEqual([-2, 1, 3]);
    expect(nearby.cues[0].droneEdits![1].position![0]).toBeCloseTo(-2, 8);
  });

  it('normalizes arbitrary, enormous, and subnormal nonzero axes without overflow', () => {
    const input = project();
    input.cues[0].droneEdits = { 1: { position: [1, 0, 0] } };
    for (const magnitude of [1, Number.MAX_VALUE, Number.MIN_VALUE]) {
      const result = applyOperations(input, [
        transform(input, {
          ids: [1],
          translation: [0, 0, 0],
          pivot: [0, 0, 0],
          rotation: { axis: [magnitude, magnitude, magnitude], angleDegrees: 120 },
        }),
      ]);
      const point = result.cues[0].droneEdits![1].position!;
      point.forEach((value, axis) => expect(value).toBeCloseTo([0, 1, 0][axis], 14));
    }
    const hugeAngle = applyOperations(input, [
      transform(input, {
        ids: [1],
        translation: [0, 0, 0],
        pivot: [0, 0, 0],
        rotation: { axis: [0, 0, 1], angleDegrees: Number.MAX_VALUE },
      }),
    ]);
    const radians = (Number.MAX_VALUE % 360) * (Math.PI / 180);
    expect(hugeAngle.cues[0].droneEdits![1].position).toEqual([
      Math.cos(radians),
      Math.sin(radians),
      0,
    ]);
  });

  it('supports nonuniform reflection and exact collapse, including otherwise overflowing offsets', () => {
    const input = project();
    input.cues[0].droneEdits = {
      1: { position: [3, 4, 5] },
      2: { position: [Number.MAX_VALUE, 4, 5] },
    };
    const reflected = applyOperations(input, [
      transform(input, { ids: [1], translation: [0, 0, 0], pivot: [1, 2, 3], scale: [-2, 0, 0.5] }),
    ]);
    expect(reflected.cues[0].droneEdits![1].position).toEqual([-3, 2, 4]);
    const collapsed = applyOperations(input, [
      transform(input, {
        ids: [2],
        translation: [0, 0, 0],
        pivot: [-Number.MAX_VALUE, 2, 3],
        scale: [0, 0, 0],
      }),
    ]);
    expect(collapsed.cues[0].droneEdits![2].position).toEqual([-Number.MAX_VALUE, 2, 3]);
  });

  it('keeps identity transforms exact without distant-pivot cancellation or signed-zero changes', () => {
    const input = project();
    input.cues[0].droneEdits = {
      1: {
        position: [0.123456789123, -0, Number.MAX_VALUE],
        keyframes: [{ time: 2, position: [3.141592653589793, 1e-300, -Number.MAX_VALUE] }],
      },
    };
    for (const fields of [
      { scale: [1, 1, 1] },
      { rotation: { axis: [1, 2, 3], angleDegrees: 360 } },
      { scale: [-1, -1, 1], rotation: { axis: [0, 0, 1], angleDegrees: 180 } },
    ]) {
      const result = applyOperations(input, [
        transform(input, {
          ids: [1],
          translation: [0, 0, 0],
          pivot: [Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE],
          ...fields,
        }),
      ]);
      expect(result.cues[0].droneEdits![1]).toEqual(input.cues[0].droneEdits![1]);
      expect(Object.is(result.cues[0].droneEdits![1].position![1], -0)).toBe(true);
    }
  });

  it('rotates independent full-fleet generated positions and dormant authored geometry', () => {
    const input = project(20);
    input.cues[0].droneEdits = {
      100: { color: '#abcdef', keyframes: [{ time: 14, position: [2, 3, 4], easing: 'smooth' }] },
    };
    const generated = formation(input.cues[0], input.droneCount);
    const result = applyOperations(input, [
      transform(input, {
        ids: [2, 19, 100],
        translation: [0, 0, 0],
        pivot: [0, 0, 0],
        rotation: { axis: [0, 0, 1], angleDegrees: 90 },
      }),
    ]);
    for (const id of [2, 19])
      expect(result.cues[0].droneEdits![id].position).toEqual([
        -generated[(id - 1) * 3 + 1],
        generated[(id - 1) * 3],
        generated[(id - 1) * 3 + 2],
      ]);
    expect(result.cues[0].droneEdits![100]).toEqual({
      color: '#abcdef',
      keyframes: [{ time: 14, position: [-3, 2, 4], easing: 'smooth' }],
    });
    expect(result.cues[0].droneEdits![100].position).toBeUndefined();
  });

  it('transforms a sampled local-time target and merges position without changing other key channels', () => {
    const input = project();
    input.cues[0].droneEdits = {
      1: {
        brightness: 0.8,
        keyframes: [
          { time: 0, position: [0, 2, 4] },
          { time: 5, color: '#abcdef', easing: 'hold', flash: { hz: 2, duty: 0.5, phase: 0.1 } },
          { time: 10, position: [4, 6, 8] },
        ],
      },
    };
    const result = applyOperations(input, [
      transform(input, {
        ids: [1],
        scope: 'key_at_time',
        time: 5,
        translation: [1, -1, 2],
        pivot: [1, 1, 1],
        scale: [2, 1, 0.5],
        rotation: { axis: [0, 0, 1], angleDegrees: 90 },
      }),
    ]);
    expect(result.cues[0].droneEdits![1].keyframes![1]).toEqual({
      ...input.cues[0].droneEdits![1].keyframes![1],
      position: [-1, 2, 5.5],
    });
    expect(result.cues[0].droneEdits![1].keyframes![0]).toEqual(
      input.cues[0].droneEdits![1].keyframes![0]
    );
    expect(result.cues[0].droneEdits![1].keyframes![2]).toEqual(
      input.cues[0].droneEdits![1].keyframes![2]
    );
    expect(result.cues[0].droneEdits![1].brightness).toBe(0.8);
  });

  it('rejects missing/meaningless pivots, invalid axes and nonfinite inputs atomically', () => {
    const input = project();
    const before = structuredClone(input);
    for (const fields of [
      { scale: [2, 1, 1] },
      { rotation: { axis: [0, 0, 1], angleDegrees: 0 } },
      { pivot: [0, 0, 0] },
      { pivot: [0, 0, 0], scale: [1, NaN, 1] },
      { pivot: [0, 0, 0], rotation: { axis: [0, 0, 0], angleDegrees: 0 } },
      { pivot: [Infinity, 0, 0], scale: [1, 1, 1] },
      { pivot: [0, 0, 0], rotation: { axis: [0, Infinity, 1], angleDegrees: 30 } },
      { pivot: [0, 0, 0], rotation: { axis: [0, 0, 1], angleDegrees: Infinity } },
    ])
      expect(() =>
        applyOperations(input, [
          { type: 'rename', name: 'Never committed' },
          transform(input, fields),
        ])
      ).toThrow();
    expect(input).toEqual(before);
  });

  it('rejects scale, pivot-offset, rotation, and translation overflow without partial commits', () => {
    const input = project();
    input.cues[0].droneEdits = {
      1: { position: [1, 2, 3] },
      2: { position: [Number.MAX_VALUE, Number.MAX_VALUE, 4] },
    };
    const before = structuredClone(input);
    for (const fields of [
      { translation: [0, 0, 0], pivot: [0, 0, 0], scale: [2, 1, 1] },
      { translation: [0, 0, 0], pivot: [-Number.MAX_VALUE, 0, 0], scale: [0.5, 1, 1] },
      { translation: [0, 0, 0], pivot: [0, 0, 0], rotation: { axis: [0, 0, 1], angleDegrees: 45 } },
      { translation: [Number.MAX_VALUE, 0, 0] },
    ])
      expect(() => applyOperations(input, [transform(input, fields)])).toThrow(/overflow/);
    expect(input).toEqual(before);
  });
});
