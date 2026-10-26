import { describe, expect, it } from 'vitest';
import { applyOperations, type Operation } from '../core/commands';
import { defaultProject, type Project } from '../core/model';
import { createDraftPreview } from './draft-preview';
import { buildDraftPreviewTargets, describeDraftTargetSceneFrame } from './draft-preview-targets';
import type { AgentProposal } from './types';

function fixture(): Project {
  const project = structuredClone(defaultProject);
  project.id = 'explicit-preview-targets';
  project.revision = 7;
  project.droneCount = 3;
  project.cues = [
    {
      ...project.cues[0],
      id: 'scene',
      duration: 4,
      transition: 0,
      droneEdits: {
        1: {
          position: [0, 10, 10],
          color: '#aabbcc',
          keyframes: [{ time: 0, position: [0, 10, 10] }],
        },
        5: { position: [20, 20, 20], keyframes: [{ time: 1, color: '#abcdef', easing: 'hold' }] },
      },
    },
    { ...project.cues[1], id: 'later', duration: 4, transition: 0 },
  ];
  return project;
}
function proposal(base: Project, operations: Operation[]): AgentProposal {
  return {
    projectId: base.id,
    revision: base.revision,
    operations,
    title: 'Explicit targets',
    description: 'Target coverage, not visible differences.',
    changes: ['Preview the command targets.'],
  };
}
function pair() {
  const base = fixture(),
    draft = structuredClone(base);
  draft.revision++;
  return { base, draft };
}

describe('captured explicit proposal drone targets', () => {
  it.each([
    { type: 'edit_drones', cueId: 'scene', ids: [3, 1, 3], patch: { brightness: 0.5 } },
    {
      type: 'transform_drones',
      cueId: 'scene',
      ids: [3, 1, 3],
      translation: [1, 2, 3],
      scope: 'base_and_keys',
    },
    {
      type: 'set_keyframe',
      cueId: 'scene',
      ids: [3, 1, 3],
      keyframe: { time: 2, brightness: 0.5 },
    },
    { type: 'remove_keyframe', cueId: 'scene', ids: [3, 1, 3], time: 2 },
    { type: 'reset_drones', cueId: 'scene', ids: [3, 1, 3] },
  ] as Operation[])(
    'captures the complete sorted union for $type with duplicates counted only once',
    (operation) => {
      const { base, draft } = pair();
      expect(buildDraftPreviewTargets(base, draft, [operation])).toEqual({
        ids: [1, 3],
        perDroneOperations: 1,
        otherOperations: 0,
        base: { projectId: base.id, revision: 7, droneCount: 3, ids: [1, 3] },
        draft: { projectId: base.id, revision: 8, droneCount: 3, ids: [1, 3] },
        scenes: [
          {
            cueId: 'scene',
            nameBefore: base.cues[0].name,
            nameAfter: draft.cues[0].name,
            ids: [1, 3],
            perDroneOperations: 1,
            base: { projectId: base.id, revision: 7, droneCount: 3, ids: [1, 3] },
            draft: { projectId: base.id, revision: 8, droneCount: 3, ids: [1, 3] },
          },
        ],
      });
    }
  );

  it('includes a single explicit droneId from move_keyframe, including a no-op key move', () => {
    const base = fixture();
    const operations: Operation[] = [
      { type: 'move_keyframe', cueId: 'scene', droneId: 1, from: 0, to: 0 },
    ];
    const comparison = createDraftPreview(base, proposal(base, operations), 0);
    expect(comparison.draft.cues).toEqual(base.cues);
    expect(comparison.droneTargets).toMatchObject({
      ids: [1],
      perDroneOperations: 1,
      otherOperations: 0,
      base: { ids: [1] },
      draft: { ids: [1] },
    });
  });

  it('counts command records independently from unique drones across all six granular families', () => {
    const base = fixture();
    const operations: Operation[] = [
      { type: 'edit_drones', cueId: 'scene', ids: [5, 2, 2], patch: { brightness: 0.5 } },
      {
        type: 'transform_drones',
        cueId: 'scene',
        ids: [1, 5],
        translation: [1, 0, 0],
        scope: 'base_and_keys',
      },
      {
        type: 'set_keyframe',
        cueId: 'scene',
        ids: [3, 5],
        keyframe: { time: 2, color: '#aabbcc' },
      },
      { type: 'remove_keyframe', cueId: 'scene', ids: [2, 5], time: 99 },
      { type: 'reset_drones', cueId: 'scene', ids: [2] },
      { type: 'move_keyframe', cueId: 'scene', droneId: 1, from: 0, to: 2 },
      { type: 'set_fleet', count: 5 },
      { type: 'set_tempo', bpm: 100 },
      { type: 'update_cue', id: 'later', patch: { palette: 'ember' } },
    ];
    const comparison = createDraftPreview(base, proposal(base, operations), 1);
    expect(comparison.droneTargets).toEqual({
      ids: [1, 2, 3, 5],
      perDroneOperations: 6,
      otherOperations: 3,
      base: { projectId: base.id, revision: 7, droneCount: 3, ids: [1, 2, 3] },
      draft: { projectId: base.id, revision: 8, droneCount: 5, ids: [1, 2, 3, 5] },
      scenes: [
        {
          cueId: 'scene',
          nameBefore: base.cues[0].name,
          nameAfter: base.cues[0].name,
          ids: [1, 2, 3, 5],
          perDroneOperations: 6,
          base: { projectId: base.id, revision: 7, droneCount: 3, ids: [1, 2, 3] },
          draft: { projectId: base.id, revision: 8, droneCount: 5, ids: [1, 2, 3, 5] },
        },
      ],
    });
    expect(comparison.draft.cues[0].droneEdits![1].keyframes![0].time).toBe(2);
  });

  it('retains declared targets even when the commands are no-ops or later undo each other', () => {
    const base = fixture();
    const operations: Operation[] = [
      { type: 'edit_drones', cueId: 'scene', ids: [1], patch: { color: '#aabbcc' } },
      {
        type: 'transform_drones',
        cueId: 'scene',
        ids: [1],
        translation: [0, 0, 0],
        scope: 'base_and_keys',
      },
      { type: 'reset_drones', cueId: 'scene', ids: [2] },
      { type: 'edit_drones', cueId: 'scene', ids: [3], patch: { brightness: 0.5 } },
      { type: 'reset_drones', cueId: 'scene', ids: [3] },
    ];
    const comparison = createDraftPreview(base, proposal(base, operations), 0);
    expect(comparison.draft.cues).toEqual(base.cues);
    expect(comparison.droneTargets).toMatchObject({
      ids: [1, 2, 3],
      perDroneOperations: 5,
      otherOperations: 0,
    });
  });

  it('does not infer target IDs from global edits, whole-scene drone records, additions or replacements', () => {
    const { base, draft } = pair();
    const added = {
      ...structuredClone(base.cues[1]),
      id: 'added',
      droneEdits: { 2: { brightness: 0.5 } },
    };
    const operations: Operation[] = [
      { type: 'set_fleet', count: 100000 },
      { type: 'set_tempo', bpm: 100 },
      { type: 'rename', name: 'Different name' },
      { type: 'update_cue', id: 'scene', patch: { droneEdits: { 3: { brightness: 0.5 } } } },
      { type: 'add_cue', cue: added },
      { type: 'replace_cues', cues: [added] },
      { type: 'retime_cue', id: 'scene', speed: 2 },
      { type: 'transition_to_beats', id: 'scene', beats: 2 },
      { type: 'move_cue', id: 'scene', direction: 'down' },
      { type: 'remove_cue', id: 'scene' },
    ];
    expect(buildDraftPreviewTargets(base, draft, operations)).toMatchObject({
      ids: [],
      perDroneOperations: 0,
      otherOperations: 10,
      base: { ids: [] },
      draft: { ids: [] },
    });
    const comparison = createDraftPreview(base, proposal(base, operations.slice(0, 4)), 0);
    expect(comparison.droneTargets).toMatchObject({
      ids: [],
      perDroneOperations: 0,
      otherOperations: 4,
      draft: { droneCount: 100000, ids: [] },
    });
  });

  it.each([
    { before: 3, after: 5, baseIds: [2], draftIds: [2, 5] },
    { before: 5, after: 3, baseIds: [2, 5], draftIds: [2] },
  ])(
    'filters active targets separately for fleet $before→$after and retains the dormant union',
    ({ before, after, baseIds, draftIds }) => {
      const base = fixture();
      base.droneCount = before;
      const operations: Operation[] = [
        { type: 'edit_drones', cueId: 'scene', ids: [900, 5, 2], patch: { brightness: 0.5 } },
        { type: 'set_fleet', count: after },
      ];
      const comparison = createDraftPreview(base, proposal(base, operations), 0);
      expect(comparison.droneTargets).toMatchObject({
        ids: [2, 5, 900],
        perDroneOperations: 1,
        otherOperations: 1,
        base: { droneCount: before, ids: baseIds },
        draft: { droneCount: after, ids: draftIds },
      });
      expect(comparison.draft.cues[0].droneEdits![900].brightness).toBe(0.5);
    }
  );

  it('keeps a target dormant in both final versions after temporary fleet growth and shrink', () => {
    const base = fixture();
    const operations: Operation[] = [
      { type: 'set_fleet', count: 900 },
      { type: 'set_keyframe', cueId: 'scene', ids: [900], keyframe: { time: 1, brightness: 0.5 } },
      { type: 'set_fleet', count: 2 },
    ];
    expect(createDraftPreview(base, proposal(base, operations), 0).droneTargets).toMatchObject({
      ids: [900],
      perDroneOperations: 1,
      otherOperations: 2,
      base: { ids: [] },
      draft: { ids: [] },
    });
  });

  it('retains explicit IDs from a scene removed later in the same successful proposal', () => {
    const base = fixture();
    const operations: Operation[] = [
      { type: 'edit_drones', cueId: 'scene', ids: [1, 5], patch: { color: '#ffffff' } },
      { type: 'remove_cue', id: 'scene' },
    ];
    const comparison = createDraftPreview(base, proposal(base, operations), 0);
    expect(comparison.draft.cues.map((cue) => cue.id)).toEqual(['later']);
    expect(comparison.droneTargets).toMatchObject({
      ids: [1, 5],
      perDroneOperations: 1,
      otherOperations: 1,
      base: { ids: [1] },
      draft: { ids: [1] },
    });
  });

  it('owns and freezes all target metadata and arrays independently of commands and both documents', () => {
    const base = fixture(),
      operations: Operation[] = [{ type: 'reset_drones', cueId: 'scene', ids: [5, 3, 1] }];
    const change = proposal(base, operations),
      before = structuredClone({ base, change });
    const comparison = createDraftPreview(base, change, 1),
      targets = comparison.droneTargets!;
    expect({ base, change }).toEqual(before);
    expect(
      [
        targets,
        targets.ids,
        targets.base,
        targets.base.ids,
        targets.draft,
        targets.draft.ids,
        targets.scenes,
        targets.scenes[0],
        targets.scenes[0].ids,
        targets.scenes[0].base,
        targets.scenes[0].base.ids,
        targets.scenes[0].draft,
        targets.scenes[0].draft.ids,
      ].every(Object.isFrozen)
    ).toBe(true);
    expect(Object.isFrozen(operations[0])).toBe(false);
    if (operations[0].type === 'reset_drones') {
      expect(Object.isFrozen(operations[0].ids)).toBe(false);
      operations[0].ids[0] = 2;
    }
    base.droneCount = 9;
    base.revision = 50;
    comparison.base.droneCount = 10;
    comparison.draft.revision = 90;
    comparison.base.cues[0].name = 'Mutated before label';
    comparison.draft.cues[0].name = 'Mutated draft label';
    expect(targets).toEqual({
      ids: [1, 3, 5],
      perDroneOperations: 1,
      otherOperations: 0,
      base: { projectId: 'explicit-preview-targets', revision: 7, droneCount: 3, ids: [1, 3] },
      draft: { projectId: 'explicit-preview-targets', revision: 8, droneCount: 3, ids: [1, 3] },
      scenes: [
        {
          cueId: 'scene',
          nameBefore: before.base.cues[0].name,
          nameAfter: before.base.cues[0].name,
          ids: [1, 3, 5],
          perDroneOperations: 1,
          base: { projectId: 'explicit-preview-targets', revision: 7, droneCount: 3, ids: [1, 3] },
          draft: { projectId: 'explicit-preview-targets', revision: 8, droneCount: 3, ids: [1, 3] },
        },
      ],
    });
    expect(() => {
      (targets.ids as number[]).push(2);
    }).toThrow();
    expect(targets.base.ids).not.toBe(targets.draft.ids);
  });

  it('supports empty operation lists and full100,000-ID unions without caps or representative sampling', () => {
    const { base, draft } = pair();
    expect(buildDraftPreviewTargets(base, draft, [])).toMatchObject({
      ids: [],
      perDroneOperations: 0,
      otherOperations: 0,
      base: { ids: [] },
      draft: { ids: [] },
      scenes: [],
    });
    base.droneCount = 100000;
    const ids = Array.from({ length: 100000 }, (_, index) => 100000 - index);
    const comparison = createDraftPreview(
      base,
      proposal(base, [{ type: 'reset_drones', cueId: 'scene', ids: [...ids, 100000, 1] }]),
      0
    );
    const expected = Array.from({ length: 100000 }, (_, index) => index + 1);
    expect(comparison.droneTargets!.ids).toEqual(expected);
    expect(comparison.droneTargets!.base.ids).toEqual(expected);
    expect(comparison.droneTargets!.draft.ids).toEqual(expected);
    expect(comparison.droneTargets!.perDroneOperations).toBe(1);
    expect(comparison.droneTargets!.scenes[0].ids).toEqual(expected);
    expect(comparison.droneTargets!.scenes[0].base.ids).toEqual(expected);
    expect(comparison.droneTargets!.scenes[0].draft.ids).toEqual(expected);
    expect(ids[0]).toBe(100000);
  });

  it('validates direct helper identity/fleet bounds and authoritative operation schemas without mutating inputs', () => {
    const mutations: ((base: Project, draft: Project) => void)[] = [
      (_base, draft) => {
        draft.id = 'other';
      },
      (_base, draft) => {
        draft.revision = 7;
      },
      (base) => {
        base.revision = NaN;
      },
      (base) => {
        base.id = '';
      },
      (_base, draft) => {
        draft.droneCount = 0;
      },
      (_base, draft) => {
        draft.droneCount = 100001;
      },
    ];
    for (const mutate of mutations) {
      const { base, draft } = pair();
      mutate(base, draft);
      expect(() => buildDraftPreviewTargets(base, draft, [])).toThrow();
    }
    const { base, draft } = pair();
    for (const invalid of [
      null,
      {},
      { type: 'unknown', ids: [1] },
      { type: 'reset_drones', cueId: 'scene', ids: [] },
      { type: 'reset_drones', cueId: 'scene', ids: [0] },
      { type: 'reset_drones', cueId: 'scene', ids: [100001] },
      { type: 'reset_drones', cueId: 'scene', ids: [1.5] },
      { type: 'reset_drones', cueId: 'scene', ids: Array(1) },
      { type: 'move_keyframe', cueId: 'scene', droneId: 0, from: 0, to: 1 },
      { type: 'edit_drones', cueId: 'scene', ids: [1], patch: { brightness: 2 } },
    ])
      expect(() => buildDraftPreviewTargets(base, draft, [invalid as Operation])).toThrow();
    const bound: Operation[] = Array.from({ length: 128 }, () => ({
      type: 'rename',
      name: 'Name',
    }));
    expect(buildDraftPreviewTargets(base, draft, bound).otherOperations).toBe(128);
    expect(() => buildDraftPreviewTargets(base, draft, [...bound, bound[0]])).toThrow('128');
  });

  it('publishes no target document if the full transaction fails after a valid granular command', () => {
    const base = fixture();
    const change = proposal(base, [
      { type: 'edit_drones', cueId: 'scene', ids: [1, 5], patch: { brightness: 0.5 } },
      { type: 'remove_cue', id: 'not-present' },
    ]);
    const original = structuredClone({ base, change });
    expect(() => createDraftPreview(base, change, 0)).toThrow('Cue not found');
    expect({ base, change }).toEqual(original);
    expect(base.revision).toBe(7);
  });

  it('extracts the same owned union from independently applied valid operations', () => {
    const base = fixture(),
      operations: Operation[] = [
        {
          type: 'set_keyframe',
          cueId: 'later',
          ids: [3, 1, 900],
          keyframe: { time: 1, brightness: 0.25 },
        },
        { type: 'move_keyframe', cueId: 'scene', droneId: 5, from: 1, to: 3 },
        { type: 'rename', name: 'Final show name' },
      ];
    const draft = applyOperations(base, operations, 7);
    expect(buildDraftPreviewTargets(base, draft, operations)).toEqual(
      createDraftPreview(base, proposal(base, operations), 0).droneTargets
    );
  });

  it('groups all six granular families by the first explicit scene command, independently of scene order', () => {
    const base = fixture();
    const operations: Operation[] = [
      { type: 'reset_drones', cueId: 'later', ids: [5, 3, 3] },
      { type: 'edit_drones', cueId: 'scene', ids: [2], patch: { brightness: 0.5 } },
      {
        type: 'transform_drones',
        cueId: 'later',
        ids: [1, 3],
        translation: [0, 0, 0],
        scope: 'base_and_keys',
      },
      { type: 'set_keyframe', cueId: 'scene', ids: [3, 2], keyframe: { time: 1, brightness: 1 } },
      { type: 'remove_keyframe', cueId: 'later', ids: [5], time: 99 },
      { type: 'move_keyframe', cueId: 'scene', droneId: 1, from: 0, to: 0 },
      { type: 'set_fleet', count: 5 },
      { type: 'update_cue', id: 'scene', patch: { name: 'Renamed opening' } },
      { type: 'move_cue', id: 'later', direction: 'up' },
    ];
    const targets = createDraftPreview(base, proposal(base, operations), 0).droneTargets!;
    expect(targets.ids).toEqual([1, 2, 3, 5]);
    expect(targets.perDroneOperations).toBe(6);
    expect(targets.otherOperations).toBe(3);
    expect(targets.scenes).toEqual([
      {
        cueId: 'later',
        nameBefore: base.cues[1].name,
        nameAfter: base.cues[1].name,
        ids: [1, 3, 5],
        perDroneOperations: 3,
        base: { projectId: base.id, revision: 7, droneCount: 3, ids: [1, 3] },
        draft: { projectId: base.id, revision: 8, droneCount: 5, ids: [1, 3, 5] },
      },
      {
        cueId: 'scene',
        nameBefore: base.cues[0].name,
        nameAfter: 'Renamed opening',
        ids: [1, 2, 3],
        perDroneOperations: 3,
        base: { projectId: base.id, revision: 7, droneCount: 3, ids: [1, 2, 3] },
        draft: { projectId: base.id, revision: 8, droneCount: 5, ids: [1, 2, 3] },
      },
    ]);
    expect(targets.scenes[0].ids).not.toBe(targets.scenes[1].ids);
  });

  it('retains removed, added and transient scenes without inventing labels or filtering active IDs by scene presence', () => {
    const base = fixture();
    const added = { ...structuredClone(base.cues[1]), id: 'added', name: 'Added scene' };
    const transient = { ...structuredClone(added), id: 'transient', name: 'Temporary scene' };
    const operations: Operation[] = [
      { type: 'edit_drones', cueId: 'scene', ids: [1, 3], patch: { brightness: 0.25 } },
      { type: 'add_cue', cue: added },
      { type: 'edit_drones', cueId: 'added', ids: [2, 5], patch: { brightness: 0.25 } },
      { type: 'add_cue', cue: transient },
      { type: 'reset_drones', cueId: 'transient', ids: [3] },
      { type: 'remove_cue', id: 'transient' },
      { type: 'remove_cue', id: 'scene' },
      { type: 'set_fleet', count: 2 },
      { type: 'update_cue', id: 'added', patch: { name: 'Final added name' } },
    ];
    const comparison = createDraftPreview(base, proposal(base, operations), 0);
    expect(comparison.droneTargets!.scenes).toEqual([
      {
        cueId: 'scene',
        nameBefore: base.cues[0].name,
        nameAfter: null,
        ids: [1, 3],
        perDroneOperations: 1,
        base: { projectId: base.id, revision: 7, droneCount: 3, ids: [1, 3] },
        draft: { projectId: base.id, revision: 8, droneCount: 2, ids: [1] },
      },
      {
        cueId: 'added',
        nameBefore: null,
        nameAfter: 'Final added name',
        ids: [2, 5],
        perDroneOperations: 1,
        base: { projectId: base.id, revision: 7, droneCount: 3, ids: [2] },
        draft: { projectId: base.id, revision: 8, droneCount: 2, ids: [2] },
      },
      {
        cueId: 'transient',
        nameBefore: null,
        nameAfter: null,
        ids: [3],
        perDroneOperations: 1,
        base: { projectId: base.id, revision: 7, droneCount: 3, ids: [3] },
        draft: { projectId: base.id, revision: 8, droneCount: 2, ids: [] },
      },
    ]);
    expect(describeDraftTargetSceneFrame(comparison.draft, 0, 'scene').role).toBe('absent');
    expect(describeDraftTargetSceneFrame(comparison.base, 0, 'added').role).toBe('absent');
  });

  it('does not create scene scopes for broad operations or lose no-op scene scopes', () => {
    const base = fixture();
    const operations: Operation[] = [
      { type: 'update_cue', id: 'later', patch: { droneEdits: { 2: { brightness: 0.5 } } } },
      { type: 'move_keyframe', cueId: 'scene', droneId: 1, from: 0, to: 0 },
      { type: 'reset_drones', cueId: 'scene', ids: [2] },
    ];
    const targets = createDraftPreview(base, proposal(base, operations), 0).droneTargets!;
    expect(targets.scenes).toHaveLength(1);
    expect(targets.scenes[0]).toMatchObject({ cueId: 'scene', ids: [1, 2], perDroneOperations: 2 });
    expect(targets.otherOperations).toBe(1);
  });

  it('rejects malformed scene headers before publishing scene scope metadata', () => {
    for (const mutate of [
      (project: Project) => {
        project.cues = [];
      },
      (project: Project) => {
        project.cues[0].name = '';
      },
      (project: Project) => {
        project.cues[0].id = project.cues[1].id;
      },
      (project: Project) => {
        project.cues[0].name = 'x'.repeat(61);
      },
    ]) {
      const { base, draft } = pair();
      mutate(draft);
      expect(() => buildDraftPreviewTargets(base, draft, [])).toThrow(/scene/i);
    }
  });
});

function sceneTimingFixture(): Project {
  const project = fixture();
  project.cues = [
    { ...project.cues[0], id: 'opening', name: 'Opening', duration: 24, transition: 12 },
    { ...project.cues[1], id: 'middle', name: 'Middle', duration: 8, transition: 6.4 },
    { ...project.cues[1], id: 'closing', name: 'Closing', duration: 6.4, transition: 6.4 },
  ];
  return project;
}

describe('scene scope timing descriptions', () => {
  it('describes current/source/outside/absent roles without changing membership or the project', () => {
    const project = sceneTimingFixture(),
      original = structuredClone(project);
    const expectedNames = { currentSceneName: 'Middle', transitionSourceName: 'Opening' };
    expect(describeDraftTargetSceneFrame(project, 25, 'middle')).toEqual({
      role: 'current',
      ...expectedNames,
    });
    expect(describeDraftTargetSceneFrame(project, 25, 'opening')).toEqual({
      role: 'incoming-source',
      ...expectedNames,
    });
    expect(describeDraftTargetSceneFrame(project, 25, 'closing')).toEqual({
      role: 'outside-frame',
      ...expectedNames,
    });
    expect(describeDraftTargetSceneFrame(project, 25, 'missing')).toEqual({
      role: 'absent',
      ...expectedNames,
    });
    const description = describeDraftTargetSceneFrame(project, 25, 'opening');
    expect(Object.isFrozen(description)).toBe(true);
    expect(project).toEqual(original);
    project.cues[0].name = 'Changed later';
    project.cues[1].name = 'Changed current';
    expect(description).toEqual({ role: 'incoming-source', ...expectedNames });
  });

  it('uses exact fractional global transition endpoints and the next scene at scene boundaries', () => {
    const project = sceneTimingFixture();
    expect(describeDraftTargetSceneFrame(project, 24, 'opening').role).toBe('incoming-source');
    expect(describeDraftTargetSceneFrame(project, 24, 'middle').role).toBe('current');
    expect(describeDraftTargetSceneFrame(project, 30.399, 'opening').role).toBe('incoming-source');
    expect(describeDraftTargetSceneFrame(project, 30.4, 'opening')).toEqual({
      role: 'outside-frame',
      currentSceneName: 'Middle',
      transitionSourceName: null,
    });
    expect(describeDraftTargetSceneFrame(project, 32, 'middle')).toEqual({
      role: 'incoming-source',
      currentSceneName: 'Closing',
      transitionSourceName: 'Middle',
    });
    expect(describeDraftTargetSceneFrame(project, 38.399, 'middle').role).toBe('incoming-source');
    expect(describeDraftTargetSceneFrame(project, 38.4, 'middle')).toEqual({
      role: 'outside-frame',
      currentSceneName: 'Closing',
      transitionSourceName: null,
    });
    expect(describeDraftTargetSceneFrame(project, 38.4, 'closing').role).toBe('current');
  });

  it('never invents a first-scene source or a source for cuts and clamps finite held times', () => {
    const project = sceneTimingFixture();
    for (const time of [-100, 0, 2, 23.999]) {
      expect(describeDraftTargetSceneFrame(project, time, 'opening')).toEqual({
        role: 'current',
        currentSceneName: 'Opening',
        transitionSourceName: null,
      });
    }
    project.cues[1].transition = 0;
    expect(describeDraftTargetSceneFrame(project, 24, 'opening')).toEqual({
      role: 'outside-frame',
      currentSceneName: 'Middle',
      transitionSourceName: null,
    });
    expect(describeDraftTargetSceneFrame(project, 1e30, 'closing')).toEqual({
      role: 'current',
      currentSceneName: 'Closing',
      transitionSourceName: null,
    });
  });

  it('follows each version’s retimed and reordered timeline, using the actual preceding scene', () => {
    const base = sceneTimingFixture();
    const operations: Operation[] = [
      { type: 'retime_cue', id: 'middle', speed: 2 },
      { type: 'move_cue', id: 'closing', direction: 'up' },
    ];
    const draft = applyOperations(base, operations, base.revision);
    expect(draft.cues.map((cue) => cue.id)).toEqual(['opening', 'closing', 'middle']);
    // Closing moved from show time 32 to 24; Middle now begins at 30.4 and blends for 3.2 s.
    expect(describeDraftTargetSceneFrame(draft, 24, 'opening').role).toBe('incoming-source');
    expect(describeDraftTargetSceneFrame(draft, 30.4, 'closing')).toEqual({
      role: 'incoming-source',
      currentSceneName: 'Middle',
      transitionSourceName: 'Closing',
    });
    expect(describeDraftTargetSceneFrame(draft, 33.6, 'closing')).toEqual({
      role: 'outside-frame',
      currentSceneName: 'Middle',
      transitionSourceName: null,
    });
    expect(describeDraftTargetSceneFrame(base, 30.4, 'closing').role).toBe('outside-frame');
    expect(describeDraftTargetSceneFrame(base, 33.6, 'middle').role).toBe('incoming-source');
  });

  it('rejects nonfinite times, invalid IDs and malformed timeline bounds', () => {
    const project = sceneTimingFixture();
    for (const time of [NaN, Infinity, -Infinity])
      expect(() => describeDraftTargetSceneFrame(project, time, 'opening')).toThrow(/finite time/);
    for (const id of ['', 'x'.repeat(101)])
      expect(() => describeDraftTargetSceneFrame(project, 0, id)).toThrow(/scene ID/);
    for (const [duration, transition] of [
      [NaN, 0],
      [0, 0],
      [1, -1],
      [1, 2],
      [1, Infinity],
    ]) {
      const malformed = structuredClone(project);
      malformed.cues[0].duration = duration;
      malformed.cues[0].transition = transition;
      expect(() => describeDraftTargetSceneFrame(malformed, 0, 'opening')).toThrow(/durations/);
    }
  });
});
