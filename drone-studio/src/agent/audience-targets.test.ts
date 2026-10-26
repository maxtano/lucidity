import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudienceSelectionReport } from '../core/audience-selection';
import { defaultProject } from '../core/model';
import {
  registerAudienceTarget,
  requireAudienceTarget,
  summarizeAudienceTarget,
  MAX_AUDIENCE_TARGETS,
  MAX_AUDIENCE_TARGET_IDS,
} from './audience-targets';
import { defaultAgentLimits } from './harness';
import { executeAgentTool, stageOperations, type AudienceSelectionPage } from './tools';
import type { AgentDraft } from './types';

function state(count = 400): AgentDraft {
  const project = structuredClone(defaultProject);
  project.id = 'query-targets';
  project.revision = 7;
  project.droneCount = count;
  project.cues = [
    { ...project.cues[0], id: 'scene', duration: 4, transition: 0, scale: 1, altitude: 100 },
  ];
  return {
    base: project,
    project,
    selection: Object.freeze([2, 3, 8]),
    operations: [],
    explanations: [],
    reviewedOperationCount: 0,
    reviewLimited: true,
    viewer: {
      current: {
        snapshot: {
          pose: { east: 0, north: 0, eyeHeight: 1, yaw: 0, pitch: 89, fov: 90 },
          venue: { east: 0, north: 70, heading: 180 },
        },
        aspect: 1,
      },
      savedViews: [],
    },
  };
}
const criteria = {
  time: 0,
  viewId: '',
  region: 'overhead',
  lights: 'any',
  scope: 'fleet',
  offset: 0,
  limit: 3,
};
function query(value: AgentDraft, patch: object = {}, signal?: AbortSignal) {
  return executeAgentTool(
    'inspect_audience_selection',
    { ...criteria, ...patch },
    value,
    defaultAgentLimits,
    signal
  ) as Promise<AudienceSelectionPage>;
}
function edit(
  value: AgentDraft,
  targetId: string,
  operation: unknown = { type: 'edit_drones', cueId: 'scene', patch: { brightness: 0.25 } }
) {
  return executeAgentTool(
    'stage_audience_operation',
    {
      targetId,
      operationJson: JSON.stringify(operation),
      explanation: 'Edit every measured match.',
    },
    value,
    defaultAgentLimits
  ) as {
    targetId: string;
    matchedCount: number;
    stagedOperations: number;
    target: { stagedOperations: number; projectId: string; request: { scope: string } };
  };
}
function report(value: AgentDraft, ids: number[]): AudienceSelectionReport {
  return {
    projectId: value.project.id,
    revision: value.project.revision,
    request: {
      time: 0,
      ...structuredClone(value.viewer!.current),
      region: 'overhead',
      lights: 'any',
    },
    cueId: 'scene',
    localTime: 0,
    blend: 1,
    ids,
    matchedCount: ids.length,
    consideredCount: value.project.droneCount,
    droneCount: value.project.droneCount,
    limitations: [],
  };
}
function register(value: AgentDraft, ids: number[]) {
  return registerAudienceTarget(
    value,
    { project: value.project, stagedOperations: value.operations.length },
    report(value, ids),
    { id: '', name: 'Captured current viewpoint' },
    'fleet'
  )!;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('bounded run-local audience target records', () => {
  it('owns and freezes complete IDs and criteria with copy-on-write snapshots', () => {
    const value = state(),
      source = report(value, [1, 9, 128, 257, 400]);
    const id = registerAudienceTarget(
      value,
      { project: value.project, stagedOperations: 0 },
      source,
      { id: '', name: 'Captured current viewpoint' },
      'fleet'
    )!;
    const firstStore = value.audienceTargets!,
      target = requireAudienceTarget(value, id);
    source.ids[0] = 3;
    source.request.snapshot.pose.yaw = 180;
    expect(target.ids).toEqual([1, 9, 128, 257, 400]);
    expect(target.request.snapshot.pose.yaw).toBe(0);
    expect(
      [
        firstStore,
        target,
        target.ids,
        target.request,
        target.request.snapshot,
        target.request.snapshot.pose,
      ].every(Object.isFrozen)
    ).toBe(true);
    const summary = summarizeAudienceTarget(target);
    summary.request.snapshot.pose.yaw = 90;
    expect(target.request.snapshot.pose.yaw).toBe(0);
    expect(summary).not.toHaveProperty('ids');
    expect(summary).not.toHaveProperty('project');
    register(value, [2]);
    expect(value.audienceTargets).not.toBe(firstStore);
    expect(firstStore).toHaveLength(1);
    expect(value.audienceTargets).toHaveLength(2);
  });

  it('evicts the oldest records above eight targets without mutating earlier stores', () => {
    const value = state(),
      ids: string[] = [];
    for (let index = 0; index < MAX_AUDIENCE_TARGETS; index++)
      ids.push(register(value, [index + 1]));
    const previous = value.audienceTargets!;
    ids.push(register(value, [9]));
    expect(previous.map((target) => target.targetId)).toEqual(ids.slice(0, 8));
    expect(value.audienceTargets!.map((target) => target.targetId)).toEqual(ids.slice(1));
    expect(() => requireAudienceTarget(value, ids[0])).toThrow('expired');
    expect(requireAudienceTarget(value, ids[1]).ids).toEqual([2]);
  });

  it('bounds all retained matched IDs to200000 even below the record limit', () => {
    const value = state(100000),
      ids = Array.from({ length: 100000 }, (_, index) => index + 1);
    const oldest = register(value, ids),
      middle = register(value, ids);
    const previous = value.audienceTargets!;
    const newest = register(value, ids);
    expect(value.audienceTargets!.map((target) => target.targetId)).toEqual([middle, newest]);
    expect(value.audienceTargets!.reduce((sum, target) => sum + target.ids.length, 0)).toBe(
      MAX_AUDIENCE_TARGET_IDS
    );
    expect(previous).toHaveLength(2);
    expect(previous[0].targetId).toBe(oldest);
    expect(() => requireAudienceTarget(value, oldest)).toThrow('expired');
  });

  it('creates no record for zero matches and refuses malformed full sets', () => {
    const value = state();
    expect(register(value, [])).toBeNull();
    expect(value.audienceTargets).toBeUndefined();
    for (const ids of [[1, 1], [9, 1], [0], [401], [1.5]])
      expect(() => register(value, ids)).toThrow('matching set');
    expect(value.audienceTargets).toBeUndefined();
  });

  it('rejects stale identity and staged-operation counts even when revisions are unchanged', () => {
    const value = state(),
      targetId = register(value, [1]),
      project = value.project;
    value.project = structuredClone(project);
    expect(() => requireAudienceTarget(value, targetId)).toThrow('expired');
    expect(() =>
      registerAudienceTarget(
        value,
        { project, stagedOperations: 0 },
        report(value, [1]),
        { id: '', name: 'View' },
        'fleet'
      )
    ).toThrow('stale');
    value.project = project;
    value.operations = [{ type: 'set_tempo', bpm: 120 }];
    expect(() => requireAudienceTarget(value, targetId)).toThrow('expired');
    expect(() =>
      registerAudienceTarget(
        value,
        { project, stagedOperations: 0 },
        report(value, [1]),
        { id: '', name: 'View' },
        'fleet'
      )
    ).toThrow('stale');
  });
});

describe('complete audience target staging', () => {
  it('edits the whole exact400-ID set from a three-ID page with one operation and preserves artist selection', async () => {
    const value = state(),
      base = structuredClone(value.base),
      selection = value.selection;
    const page = await query(value),
      token = page.targetId!;
    expect(page.ids).toEqual([1, 2, 3]);
    expect(page.matchedCount).toBe(400);
    expect(token).toMatch(/^[0-9a-f-]{36}$/i);
    page.ids[0] = 99999;
    page.request.snapshot.pose.yaw = 180;
    const result = edit(value, token);
    expect(result).toMatchObject({
      targetId: token,
      matchedCount: 400,
      stagedOperations: 1,
      target: { stagedOperations: 0, projectId: base.id, request: { scope: 'fleet' } },
    });
    expect(value.operations).toEqual([
      {
        type: 'edit_drones',
        cueId: 'scene',
        ids: Array.from({ length: 400 }, (_, index) => index + 1),
        patch: { brightness: 0.25 },
      },
    ]);
    expect(Object.keys(value.project.cues[0].droneEdits!)).toHaveLength(400);
    expect(value.project.cues[0].droneEdits![400].brightness).toBe(0.25);
    expect(value.base).toEqual(base);
    expect(value.selection).toBe(selection);
    expect(value.audienceTargets).toEqual([]);
    expect(value.reviewedOperationCount).toBe(-1);
    expect(JSON.stringify(value.operations)).not.toContain(token);
    expect(() => edit(value, token)).toThrow('expired');
  });

  it('returns a full-set handle for an empty page, but null for an empty complete match', async () => {
    const value = state();
    const outOfRange = await query(value, { offset: 1000 });
    expect(outOfRange).toMatchObject({ ids: [], matchedCount: 400 });
    expect(outOfRange.targetId).toEqual(expect.any(String));
    const before = value.audienceTargets;
    const empty = await query(value, { lights: 'off' });
    expect(empty).toMatchObject({ ids: [], matchedCount: 0, targetId: null });
    expect(value.audienceTargets).toBe(before);
  });

  it.each([
    { type: 'edit_drones', cueId: 'scene', patch: { brightness: 0.5 } },
    { type: 'set_keyframe', cueId: 'scene', keyframe: { time: 1, brightness: 0.5 } },
    { type: 'remove_keyframe', cueId: 'scene', time: 1 },
    { type: 'reset_drones', cueId: 'scene' },
    { type: 'transform_drones', cueId: 'scene', translation: [1, 2, 3], scope: 'base_and_keys' },
  ])(
    'supports the same per-drone operation type $type as original-selection staging',
    async (operation) => {
      const value = state(9),
        page = await query(value);
      edit(value, page.targetId!, operation);
      expect(value.operations).toEqual([{ ...operation, ids: [1, 2, 3, 4, 5, 6, 7, 8, 9] }]);
    }
  );

  it('keeps targets and reviewed draft valid after forbidden IDs, unsupported commands, malformed fields, or failed apply', async () => {
    const value = state(),
      page = await query(value),
      store = value.audienceTargets;
    const before = { ...value, explanations: [...value.explanations] };
    const invalid = [
      [],
      null,
      { type: 'rename', name: 'No' },
      { type: 'edit_drones', cueId: 'scene', ids: [1], patch: { brightness: 1 } },
      { type: 'edit_drones', cueId: 'scene', patch: { brightness: 2 } },
      { type: 'edit_drones', cueId: 'scene', patch: { brightness: 1 }, unknown: true },
      { type: 'edit_drones', cueId: 'missing', patch: { brightness: 1 } },
      { type: 'edit_drones', patch: { brightness: 1 } },
    ];
    for (const operation of invalid) {
      expect(() => edit(value, page.targetId!, operation)).toThrow();
      expect(value).toEqual(before);
      expect(value.audienceTargets).toBe(store);
    }
    expect(() =>
      executeAgentTool(
        'stage_audience_operation',
        { targetId: page.targetId, operationJson: '{', explanation: 'Repair me.' },
        value,
        defaultAgentLimits
      )
    ).toThrow();
    expect(() =>
      executeAgentTool(
        'stage_audience_operation',
        {
          targetId: page.targetId,
          operationJson: JSON.stringify({ type: 'reset_drones', cueId: 'scene' }),
          explanation: 'Budget.',
        },
        value,
        { ...defaultAgentLimits, maxOperations: 0 }
      )
    ).toThrow('at most');
    expect(value).toEqual(before);
    edit(value, page.targetId!);
    expect(value.operations).toHaveLength(1);
  });

  it('retains targets after conservative expansion rejection without any partial authored edits', () => {
    const value = state(100000),
      targetId = register(
        value,
        Array.from({ length: 100000 }, (_, index) => index + 1)
      );
    const before = value.project,
      store = value.audienceTargets;
    const keyframes = Array.from({ length: 2048 }, (_, index) => ({
      time: index / 2,
      brightness: 0.5,
    }));
    expect(() =>
      edit(value, targetId, { type: 'edit_drones', cueId: 'scene', patch: { keyframes } })
    ).toThrow('expansion budget');
    expect(value.project).toBe(before);
    expect(value.operations).toEqual([]);
    expect(value.audienceTargets).toBe(store);
    expect(requireAudienceTarget(value, targetId).ids).toHaveLength(100000);
  });

  it('expires all targets after any successful batch, even a no-op command, but not after a failed batch', async () => {
    const value = state();
    const first = (await query(value)).targetId!,
      second = (await query(value)).targetId!;
    const store = value.audienceTargets;
    expect(() =>
      stageOperations([{ type: 'rename', name: '' }], 'Invalid', value, defaultAgentLimits)
    ).toThrow();
    expect(value.audienceTargets).toBe(store);
    stageOperations(
      [{ type: 'set_tempo', bpm: value.project.bpm }],
      'Valid no-op',
      value,
      defaultAgentLimits
    );
    expect(value.audienceTargets).toEqual([]);
    expect(() => edit(value, first)).toThrow('expired');
    expect(() => edit(value, second)).toThrow('expired');
    expect(store).toHaveLength(2);
  });

  it('leaves original selection staging unchanged after querying a different audience set', async () => {
    const value = state();
    const page = await query(value);
    executeAgentTool(
      'stage_selection_operation',
      {
        operationJson: JSON.stringify({
          type: 'edit_drones',
          cueId: 'scene',
          patch: { brightness: 0.5 },
        }),
        explanation: 'Original artist selection only.',
      },
      value,
      defaultAgentLimits
    );
    expect(value.operations[0]).toMatchObject({ ids: [2, 3, 8] });
    expect(() => edit(value, page.targetId!)).toThrow('expired');
    const selected = await query(value, { scope: 'selection' });
    expect(selected.matchedCount).toBe(3);
    expect(requireAudienceTarget(value, selected.targetId!).ids).toEqual([2, 3, 8]);
  });

  it('excludes dormant captured selection IDs after fleet reduction and never expands the artist selection', async () => {
    const value = state();
    value.selection = Object.freeze([399, 2, 8, 3, 257]);
    stageOperations([{ type: 'set_fleet', count: 300 }], 'Reduce fleet', value, defaultAgentLimits);
    const page = await query(value, { scope: 'selection', limit: 1 });
    expect(page).toMatchObject({ matchedCount: 4, consideredCount: 4, ids: [2] });
    edit(value, page.targetId!);
    expect(value.operations[1]).toMatchObject({ ids: [2, 3, 8, 257] });
    expect(value.selection).toEqual([399, 2, 8, 3, 257]);
  });

  it('never registers a canceled or concurrently stale async query', async () => {
    const value = state(),
      initial = register(value, [1]),
      store = value.audienceTargets;
    const controller = new AbortController(),
      canceled = query(value, {}, controller.signal);
    controller.abort();
    await expect(canceled).rejects.toMatchObject({ name: 'AbortError' });
    expect(value.audienceTargets).toBe(store);
    expect(requireAudienceTarget(value, initial).ids).toEqual([1]);
    const stale = query(value);
    stageOperations(
      [{ type: 'rename', name: 'Edited while filtering' }],
      'Edit',
      value,
      defaultAgentLimits
    );
    await expect(stale).rejects.toThrow('stale');
    expect(value.audienceTargets).toEqual([]);
  });
});
