import { describe, expect, it } from 'vitest';
import { applyOperations } from '../core/commands';
import { defaultProject, type Project } from '../core/model';
import { buildDraftPreviewNavigation } from './draft-preview-navigation';
import { summarizeProjectImpact } from './impact';

function project(): Project {
  const value = structuredClone(defaultProject);
  value.droneCount = 8;
  value.cues = value.cues.slice(0, 3).map((cue, index) => ({
    ...cue,
    id: ['a', 'b', 'c'][index],
    name: ['Opening', 'Middle', 'Ending'][index],
    duration: 10,
    transition: 2,
  }));
  value.cues[0].droneEdits = {
    1: {
      position: [1, 2, 30],
      keyframes: [
        { time: 1, brightness: 0.2 },
        { time: 3, color: '#abcdef' },
        { time: 7, position: [7, 8, 40] },
        { time: 12, brightness: 0.4 },
      ],
    },
    50: { keyframes: [{ time: 2, color: '#112233' }] },
  };
  return value;
}

describe('authored-change navigation for draft preview', () => {
  it('ignores revision alone and equivalent metadata/key ordering', () => {
    const base = project();
    base.cues[0].metadata = { a: 1, nested: { first: 1, second: 2 } };
    const draft = structuredClone(base);
    draft.revision++;
    draft.cues[0].metadata = { nested: { second: 2, first: 1 }, a: 1 };
    draft.cues[0].droneEdits![1].keyframes!.reverse();
    expect(buildDraftPreviewNavigation(base, draft)).toEqual({ changes: [], globalChanges: [] });
  });

  it('navigates a scene rename without claiming unchanged keys were edited', () => {
    const base = project(),
      draft = structuredClone(base);
    draft.cues[1].name = 'A new middle';
    expect(buildDraftPreviewNavigation(base, draft)).toEqual({
      changes: [
        {
          id: 'b',
          status: 'changed',
          nameBefore: 'Middle',
          nameAfter: 'A new middle',
          properties: ['name'],
          before: {
            start: 10,
            duration: 10,
            points: [{ label: 'Scene start', time: 10, localTime: 0 }],
          },
          draft: {
            start: 10,
            duration: 10,
            points: [{ label: 'Scene start', time: 10, localTime: 0 }],
          },
        },
      ],
      globalChanges: [],
    });
  });

  it('uses per-side retimed keys and transition endpoints while excluding downstream start shifts', () => {
    const base = project();
    const draft = applyOperations(base, [{ type: 'retime_cue', id: 'a', speed: 2 }]);
    const navigation = buildDraftPreviewNavigation(base, draft);
    expect(navigation.changes.map((change) => change.id)).toEqual(['a']);
    expect(navigation.changes[0].properties).toEqual(['duration', 'transition', 'droneEdits']);
    expect(navigation.changes[0].before).toEqual({
      start: 0,
      duration: 10,
      points: [
        { label: 'Scene start', time: 0, localTime: 0 },
        { label: 'First edited key', time: 1, localTime: 1 },
        { label: 'Transition end', time: 2, localTime: 2 },
        { label: 'Last edited key', time: 7, localTime: 7 },
      ],
    });
    expect(navigation.changes[0].draft).toEqual({
      start: 0,
      duration: 5,
      points: [
        { label: 'Scene start', time: 0, localTime: 0 },
        { label: 'First edited key', time: 0.5, localTime: 0.5 },
        { label: 'Transition end', time: 1, localTime: 1 },
        { label: 'Last edited key', time: 3.5, localTime: 3.5 },
      ],
    });
  });

  it('keeps added and removed scene IDs and sides distinct without inventing retained-scene reorders', () => {
    const base = project(),
      draft = structuredClone(base);
    draft.cues = [
      {
        ...draft.cues[1],
        id: 'intro',
        name: 'New intro',
        duration: 2,
        transition: 0.5,
        droneEdits: {
          1: {
            keyframes: [
              { time: 0.25, brightness: 0.2 },
              { time: 1, brightness: 0.9 },
            ],
          },
        },
      },
      draft.cues[1],
      draft.cues[2],
    ];
    const changes = buildDraftPreviewNavigation(base, draft).changes;
    expect(changes.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 'intro', status: 'added' },
      { id: 'a', status: 'removed' },
    ]);
    expect(changes[0]).toMatchObject({
      nameBefore: null,
      nameAfter: 'New intro',
      before: null,
      draft: {
        start: 0,
        duration: 2,
        points: [
          { label: 'Scene start', time: 0, localTime: 0 },
          { label: 'First edited key', time: 0.25, localTime: 0.25 },
          { label: 'Transition end', time: 0.5, localTime: 0.5 },
          { label: 'Last edited key', time: 1, localTime: 1 },
        ],
      },
    });
    expect(changes[1]).toMatchObject({
      nameBefore: 'Opening',
      nameAfter: null,
      draft: null,
      before: { start: 0, duration: 10 },
    });
  });

  it('reports true reorders in draft order with their own Before and Draft global starts', () => {
    const base = project(),
      draft = structuredClone(base);
    draft.cues = [draft.cues[2], draft.cues[0], draft.cues[1]];
    const changes = buildDraftPreviewNavigation(base, draft).changes;
    expect(changes.map((change) => [change.id, change.before!.start, change.draft!.start])).toEqual(
      [
        ['c', 20, 0],
        ['a', 0, 10],
        ['b', 10, 20],
      ]
    );
    for (const change of changes) {
      expect(change.properties).toEqual(['order']);
      expect(change.before!.points).toHaveLength(1);
      expect(change.draft!.points).toHaveLength(1);
    }
  });

  it('navigates removed keys only on Before and newly authored keys only on Draft', () => {
    const base = project();
    base.cues[1].droneEdits = {
      1: {
        keyframes: [
          { time: 3, color: '#aa3311' },
          { time: 9, brightness: 0.8 },
        ],
      },
    };
    const draft = applyOperations(base, [
      { type: 'move_keyframe', cueId: 'b', droneId: 1, from: 3, to: 5 },
    ]);
    const changed = buildDraftPreviewNavigation(base, draft).changes[0];
    expect(changed.before!.points).toEqual([
      { label: 'Scene start', time: 10, localTime: 0 },
      { label: 'First edited key', time: 13, localTime: 3 },
    ]);
    expect(changed.draft!.points).toEqual([
      { label: 'Scene start', time: 10, localTime: 0 },
      { label: 'First edited key', time: 15, localTime: 5 },
    ]);
  });

  it('retains dormant edits as scene changes without pretending their keys are visible landmarks', () => {
    const base = project(),
      draft = structuredClone(base);
    draft.cues[0].droneEdits![1].keyframes![3].brightness = 0.6;
    draft.cues[0].droneEdits![50].keyframes![0].color = '#ffffff';
    const change = buildDraftPreviewNavigation(base, draft).changes[0];
    expect(change.properties).toEqual(['droneEdits']);
    expect(change.before!.points).toEqual([{ label: 'Scene start', time: 0, localTime: 0 }]);
    expect(change.draft!.points).toEqual(change.before!.points);
  });

  it('uses active fleet membership separately for each side', () => {
    const base = project();
    base.droneCount = 2;
    base.cues[1].droneEdits = { 3: { keyframes: [{ time: 3, brightness: 0.2 }] } };
    const draft = structuredClone(base);
    draft.droneCount = 3;
    draft.cues[1].droneEdits![3].keyframes![0].brightness = 1;
    const result = buildDraftPreviewNavigation(base, draft);
    expect(result.globalChanges).toEqual(['Fleet size: 2 → 3 drones']);
    expect(result.changes[0].before!.points).toHaveLength(1);
    expect(result.changes[0].draft!.points).toEqual([
      { label: 'Scene start', time: 10, localTime: 0 },
      { label: 'First edited key', time: 13, localTime: 3 },
    ]);
  });

  it('omits nonfinal end keys that would show the next scene, while retaining a final show endpoint', () => {
    const base = project(),
      draft = structuredClone(base);
    draft.cues[0].droneEdits![1].keyframes!.push({ time: 10, brightness: 0.1 });
    draft.cues[2].droneEdits = {
      1: {
        keyframes: [
          { time: 10, color: '#aaff11' },
          { time: 11, color: '#11ffaa' },
        ],
      },
    };
    const changes = buildDraftPreviewNavigation(base, draft).changes;
    expect(changes[0].draft!.points).toEqual([{ label: 'Scene start', time: 0, localTime: 0 }]);
    expect(changes[1].draft!.points).toEqual([
      { label: 'Scene start', time: 20, localTime: 0 },
      { label: 'First edited key', time: 30, localTime: 10 },
    ]);
  });

  it('deduplicates coincident starts, key times, and transition endpoints without dropping the start', () => {
    const base = project();
    base.cues[0].droneEdits = {
      1: {
        keyframes: [
          { time: 0, brightness: 0 },
          { time: 4, brightness: 0 },
        ],
      },
    };
    const draft = structuredClone(base);
    draft.cues[0].transition = 4;
    for (const key of draft.cues[0].droneEdits![1].keyframes!) key.brightness = 1;
    const result = buildDraftPreviewNavigation(base, draft).changes[0];
    expect(result.draft!.points).toEqual([
      { label: 'Scene start', time: 0, localTime: 0 },
      { label: 'Last edited key', time: 4, localTime: 4 },
    ]);
    expect(result.before!.points.map((point) => point.localTime)).toEqual([0, 2, 4]);
    for (const side of [result.before!, result.draft!])
      for (const point of side.points) {
        expect(Number.isFinite(point.time) && Number.isFinite(point.localTime)).toBe(true);
        expect(point.localTime).toBeGreaterThanOrEqual(0);
        expect(point.localTime).toBeLessThanOrEqual(side.duration);
      }
  });

  it('does not advertise sub-precision key jumps that round onto another global scene boundary', () => {
    const base = project();
    base.cues[0].duration = 1000;
    const draft = structuredClone(base);
    draft.cues[1].droneEdits = {
      1: {
        keyframes: [
          { time: Number.MIN_VALUE, brightness: 0.1 },
          { time: 3, brightness: 0.3 },
          { time: 10 - Number.EPSILON * 10, brightness: 0.9 },
        ],
      },
    };
    const change = buildDraftPreviewNavigation(base, draft).changes[0];
    expect(change.draft!.points).toEqual([
      { label: 'Scene start', time: 1000, localTime: 0 },
      { label: 'First edited key', time: 1003, localTime: 3 },
    ]);
  });

  it('offers the transition endpoint when only transition easing changes', () => {
    const base = project(),
      draft = structuredClone(base);
    draft.cues[1].transitionEasing = 'linear';
    const change = buildDraftPreviewNavigation(base, draft).changes[0];
    expect(change.properties).toEqual(['transitionEasing']);
    expect(change.draft!.points).toEqual([
      { label: 'Scene start', time: 10, localTime: 0 },
      { label: 'Transition end', time: 12, localTime: 2 },
    ]);
  });

  it('returns all 1,024 added/removed scene IDs while keeping the default impact panel capped at twelve', () => {
    const base = project();
    base.cues = Array.from({ length: 512 }, (_, index) => ({
      ...base.cues[1],
      id: `before-${index}`,
      duration: 1,
      transition: 0,
    }));
    const draft = structuredClone(base);
    draft.cues.forEach((cue, index) => {
      cue.id = `after-${index}`;
    });
    const result = buildDraftPreviewNavigation(base, draft);
    expect(result.changes).toHaveLength(1024);
    expect(result.changes[511]).toMatchObject({
      id: 'after-511',
      status: 'added',
      before: null,
      draft: { start: 511 },
    });
    expect(result.changes[1023]).toMatchObject({
      id: 'before-511',
      status: 'removed',
      draft: null,
      before: { start: 511 },
    });
    expect(summarizeProjectImpact(base, draft)).toMatchObject({
      changedSceneCount: 1024,
      remainingSceneCount: 1012,
    });
    expect(summarizeProjectImpact(base, draft).scenes).toHaveLength(12);
    expect(summarizeProjectImpact(base, draft, { sceneLimit: 0 }).scenes).toHaveLength(0);
    for (const sceneLimit of [-1, 1025, 1.5, NaN, Infinity])
      expect(() => summarizeProjectImpact(base, draft, { sceneLimit })).toThrow(
        'Scene detail limit'
      );
  });

  it('describes global-only edits without inventing changed scenes', () => {
    const base = project(),
      draft = structuredClone(base);
    draft.droneCount = 9;
    draft.bpm = 145;
    draft.name = 'New title';
    draft.limits.radius = 120;
    expect(buildDraftPreviewNavigation(base, draft)).toEqual({
      changes: [],
      globalChanges: [
        'Fleet size: 8 → 9 drones',
        'Tempo: 120 → 145 BPM',
        'Design limits changed',
        'Project name changed',
      ],
    });
  });

  it('never mutates inputs or shares mutable navigation records with them or another result', () => {
    const base = project(),
      draft = structuredClone(base);
    draft.cues[0].droneEdits![1].keyframes![0].brightness = 1;
    const before = structuredClone({ base, draft });
    const result = buildDraftPreviewNavigation(base, draft);
    expect({ base, draft }).toEqual(before);
    const independent = buildDraftPreviewNavigation(base, draft);
    result.changes[0].properties.push('fake');
    result.changes[0].before!.points[0].time = 999;
    result.changes[0].draft!.points[0].label = 'Different';
    expect(buildDraftPreviewNavigation(base, draft)).toEqual(independent);
    expect({ base, draft }).toEqual(before);
  });

  it('rejects documents outside scene and finite-timeline bounds', () => {
    const base = project(),
      draft = structuredClone(base);
    draft.cues = Array.from({ length: 513 }, (_, index) => ({
      ...base.cues[1],
      id: `${index}`,
      duration: 1,
    }));
    expect(() => buildDraftPreviewNavigation(base, draft)).toThrow('1–512');
    draft.cues = [structuredClone(base.cues[0])];
    draft.cues[0].duration = Infinity;
    expect(() => buildDraftPreviewNavigation(base, draft)).toThrow('finite');
    draft.cues = [structuredClone(base.cues[0]), structuredClone(base.cues[0])];
    expect(() => buildDraftPreviewNavigation(base, draft)).toThrow('unique');
  });
});
