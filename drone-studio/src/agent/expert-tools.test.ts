import { describe, expect, it } from 'vitest';
import { defaultProject, type DroneEdit, type Vector3Tuple } from '../core/model';
import { defaultAgentLimits } from './harness';
import { agentTools, executeAgentTool, stageOperations } from './tools';
import type { AgentDraft } from './types';

function state(): AgentDraft {
  const base = structuredClone(defaultProject);
  base.droneCount = 2500;
  base.cues = [{ ...base.cues[0], duration: 10, transition: 0 }];
  return {
    base,
    project: structuredClone(base),
    selection: [2333, 9, 2000],
    operations: [],
    explanations: [],
    reviewedOperationCount: -1,
    reviewLimited: false,
  };
}
function inspect(draft: AgentDraft, fields: Record<string, unknown> = {}) {
  return executeAgentTool(
    'inspect_drones',
    {
      cueId: draft.project.cues[0].id,
      ids: [],
      offset: 0,
      limit: 32,
      keyframeOffset: 0,
      keyframeLimit: 32,
      localTime: 5,
      ...fields,
    },
    draft,
    defaultAgentLimits
  ) as {
    totalDrones: number;
    nextOffset: number | null;
    source: string;
    drones: {
      id: number;
      active: boolean;
      authored: unknown;
      target: { position: number[] | null; brightness: number };
      keyframes: unknown[];
      nextKeyframeOffset: number | null;
      channelContext: unknown;
    }[];
  };
}

describe('expert selection tools', () => {
  it('directly retrieves sparse IDs, exact authored keys and independently evaluated local channels', () => {
    const draft = state();
    draft.project.cues[0].droneEdits = {
      9: { color: '#aabbcc' },
      2333: {
        position: [90, 90, 90],
        brightness: 0.1,
        keyframes: [
          { time: 10, position: [10, 20, 30], brightness: 1 },
          { time: 0, position: [0, 0, 10], brightness: 0 },
          { time: 5, color: '#ff0000' },
        ],
      },
    };
    const result = inspect(draft, { ids: [2333, 2333], keyframeOffset: 1, keyframeLimit: 1 });
    expect(result.source).toBe('ids');
    expect(result.totalDrones).toBe(1);
    expect(result.drones[0]).toMatchObject({
      id: 2333,
      active: true,
      authored: { position: [90, 90, 90], brightness: 0.1 },
      target: { position: [5, 10, 20], brightness: 0.5 },
      keyframes: [{ time: 5, color: '#ff0000' }],
      nextKeyframeOffset: 2,
      channelContext: {
        position: {
          atOrBefore: { time: 0, value: [0, 0, 10] },
          after: { time: 10, value: [10, 20, 30] },
        },
        color: { atOrBefore: { time: 5, value: '#ff0000' }, after: null },
      },
    });
  });

  it('pages the captured selection rather than scanning every authored scene edit', () => {
    const draft = state();
    const result = inspect(draft, { offset: 1, limit: 1 });
    expect(result.source).toBe('captured_selection');
    expect(result.totalDrones).toBe(3);
    expect(result.nextOffset).toBe(2);
    expect(result.drones.map((drone) => drone.id)).toEqual([9]);
    expect(result.drones[0].target.position).toHaveLength(3);
    expect(result.drones[0].authored).toEqual({});
  });

  it('inspects dormant authored channels but never invents an inactive generated position', () => {
    const draft = state();
    draft.project.droneCount = 5;
    draft.project.cues[0].droneEdits = {
      2333: { keyframes: [{ time: 1, position: [1, 2, 3] }] },
      9: { brightness: 0.2 },
    };
    const result = inspect(draft);
    expect(result.drones[0]).toMatchObject({ active: false, target: { position: [1, 2, 3] } });
    expect(result.drones[1]).toMatchObject({
      active: false,
      target: { position: null, brightness: 0.2 },
    });
    expect(result.drones[2].target.position).toBeNull();
  });

  it('stages one relative transform over an arbitrary selection larger than the context preview', () => {
    const draft = state();
    draft.selection = Array.from({ length: 800 }, (_, index) => index * 3 + 1);
    executeAgentTool(
      'stage_selection_operation',
      {
        operationJson: JSON.stringify({
          type: 'transform_drones',
          cueId: draft.project.cues[0].id,
          translation: [0, 0, 8],
          scope: 'base_and_keys',
        }),
        explanation: 'Lift the selected formation.',
      },
      draft,
      defaultAgentLimits
    );
    expect(draft.operations).toHaveLength(1);
    expect(draft.operations[0]).toMatchObject({ type: 'transform_drones', ids: draft.selection });
    expect(Object.keys(draft.project.cues[0].droneEdits!)).toHaveLength(800);
    expect(draft.project.cues[0].droneEdits![1].position).not.toEqual(
      draft.project.cues[0].droneEdits![4].position
    );
    expect(draft.base.cues[0].droneEdits).toBeUndefined();
    expect(draft.reviewedOperationCount).toBe(-1);
    const schema = executeAgentTool(
      'command_schema',
      { operationType: 'transform_drones' },
      draft,
      defaultAgentLimits
    );
    expect(JSON.stringify(schema)).toContain('key_at_time');
    expect(agentTools.find((tool) => tool.name === 'inspect_drones')?.strict).toBe(true);
  });

  it('rejects transform expansion before allocating a six-figure authored draft', () => {
    const draft = state();
    draft.base.droneCount = draft.project.droneCount = 100000;
    const operation = {
      type: 'transform_drones',
      cueId: draft.project.cues[0].id,
      ids: Array.from({ length: 100000 }, (_, index) => index + 1),
      translation: [1, 0, 0],
      scope: 'base_and_keys',
    };
    const before = structuredClone(draft);
    expect(() =>
      stageOperations(
        [operation, operation, operation],
        'Too much expansion.',
        draft,
        defaultAgentLimits
      )
    ).toThrow('draft expansion budget');
    expect(draft).toEqual(before);
  });

  it('counts earlier expanded key authoring before translating those paths', () => {
    const draft = state();
    draft.base.droneCount = draft.project.droneCount = 10000;
    const ids = Array.from({ length: 10000 }, (_, index) => index + 1);
    const keys = Array.from({ length: 32 }, (_, time) => ({ time, position: [0, 0, 1] }));
    expect(() =>
      stageOperations(
        [
          { type: 'edit_drones', cueId: draft.project.cues[0].id, ids, patch: { keyframes: keys } },
          {
            type: 'transform_drones',
            cueId: draft.project.cues[0].id,
            ids,
            translation: [1, 0, 0],
            scope: 'base_and_keys',
          },
        ],
        'Expanded keyframes.',
        draft,
        defaultAgentLimits
      )
    ).toThrow('draft expansion budget');
    expect(draft.operations).toEqual([]);
  });

  it('rotates and scales every immutable irregular selected path, including authored dormant IDs', () => {
    const draft = state();
    const selected = Object.freeze([
      2333,
      ...Array.from({ length: 160 }, (_, index) => index * 11 + 5).reverse(),
    ]);
    draft.selection = selected;
    draft.base.cues[0].droneEdits = Object.fromEntries(
      selected.map((id): [string, DroneEdit] => [
        String(id),
        {
          ...(id === 2333 ? {} : { position: [id, id % 7, 50] as Vector3Tuple }),
          color: '#123456',
          brightness: 0.7,
          flash: { hz: 3, duty: 0.2, phase: 0.4 },
          keyframes: [
            { time: 0.123456, easing: 'smooth', position: [id + 1, id % 5, 60], color: '#aabbcc' },
            { time: 5, brightness: 0.4, flash: { hz: 1, duty: 0.5, phase: 0.1 } },
            { time: 12, easing: 'hold', position: [id + 2, id % 3, 70], color: '#ddeeff' },
          ],
        },
      ])
    );
    draft.base.cues[0].droneEdits[2] = { position: [8, 9, 55], color: '#ff0000' };
    draft.project = structuredClone(draft.base);
    const original = structuredClone(draft.base);
    stageOperations(
      [{ type: 'set_fleet', count: 100 }],
      'Preview a smaller active fleet.',
      draft,
      defaultAgentLimits
    );
    executeAgentTool('review_draft', {}, draft, defaultAgentLimits);
    expect(draft.reviewedOperationCount).toBe(1);
    expect(draft.review).toBeDefined();
    const operation = {
      type: 'transform_drones',
      cueId: draft.project.cues[0].id,
      translation: [3, 4, 5],
      pivot: [10, -4, 20],
      scale: [2, -1, 0],
      rotation: { axis: [0, 0, 5], angleDegrees: 90 },
      scope: 'base_and_keys',
    };
    executeAgentTool(
      'stage_selection_operation',
      {
        operationJson: JSON.stringify(operation),
        explanation: 'Reflect and flatten the group, turn it toward North, then offset it.',
      },
      draft,
      defaultAgentLimits
    );
    expect(draft.selection).toBe(selected);
    expect(Object.isFrozen(draft.selection)).toBe(true);
    expect(draft.operations[1]).toEqual({ ...operation, ids: [...selected] });
    expect(draft.base).toEqual(original);
    expect(draft.project.cues[0].droneEdits![2]).toEqual(original.cues[0].droneEdits![2]);
    // For this pivot/scale/90° Up rotation, the explicit ENU result is [y + 17, 2x - 20, 25].
    const expectPoint = (actual: Vector3Tuple | undefined, source: Vector3Tuple) => {
      const expected = [source[1] + 17, 2 * source[0] - 20, 25];
      expected.forEach((coordinate, axis) => expect(actual?.[axis]).toBeCloseTo(coordinate, 9));
    };
    for (const id of selected) {
      const before = original.cues[0].droneEdits![id],
        after = draft.project.cues[0].droneEdits![id];
      const { position: beforePosition, keyframes: beforeKeys, ...beforeChannels } = before;
      const { position: afterPosition, keyframes: afterKeys, ...afterChannels } = after;
      expect(afterChannels).toEqual(beforeChannels);
      if (beforePosition) expectPoint(afterPosition, beforePosition);
      else expect(afterPosition).toBeUndefined();
      expect(afterKeys).toHaveLength(beforeKeys!.length);
      beforeKeys!.forEach((key, index) => {
        const { position, ...channels } = key;
        const { position: moved, ...nextChannels } = afterKeys![index];
        expect(nextChannels).toEqual(channels);
        if (position) expectPoint(moved, position);
        else expect(moved).toBeUndefined();
      });
    }
    expect(draft.review).toBeUndefined();
    expect(draft.reviewedOperationCount).toBe(-1);
    const finish = {
      title: 'Transformed formation',
      description: 'Review the complete private edit.',
      changes: ['Moved selected paths.'],
    };
    expect(() => executeAgentTool('finish_proposal', finish, draft, defaultAgentLimits)).toThrow(
      /Review the latest draft/
    );
    executeAgentTool('review_draft', {}, draft, defaultAgentLimits);
    executeAgentTool('finish_proposal', finish, draft, defaultAgentLimits);
    expect(draft.proposal?.operations).toHaveLength(2);
    expect(draft.proposal?.revision).toBe(original.revision);
  });

  it('merges a rotated and scaled keyed target while preserving same-time light channels and dormant geometry', () => {
    const draft = state();
    draft.selection = Object.freeze([2333, 1]);
    draft.base.cues[0].droneEdits = {
      1: {
        color: '#123456',
        keyframes: [
          { time: 0, position: [1, 0, 1] },
          { time: 5, color: '#ff0000', brightness: 0.25, easing: 'hold' },
          { time: 10, position: [3, 0, 3] },
        ],
      },
      2: { position: [90, 80, 70], brightness: 0.9 },
      2333: {
        flash: { hz: 2, duty: 0.3, phase: 0.2 },
        keyframes: [
          { time: 0, position: [10, 0, 1] },
          { time: 10, position: [20, 0, 1] },
        ],
      },
    };
    draft.project = structuredClone(draft.base);
    stageOperations(
      [{ type: 'set_fleet', count: 2 }],
      'Reduce only the active fleet.',
      draft,
      defaultAgentLimits
    );
    const before = structuredClone(draft.project);
    executeAgentTool(
      'stage_selection_operation',
      {
        operationJson: JSON.stringify({
          type: 'transform_drones',
          cueId: draft.project.cues[0].id,
          translation: [1, -1, 2],
          pivot: [0, 0, 0],
          scale: [-2, 3, 1],
          rotation: { axis: [0, 0, 1], angleDegrees: 90 },
          scope: 'key_at_time',
          time: 5,
        }),
        explanation: 'Transform the evaluated target at five seconds.',
      },
      draft,
      defaultAgentLimits
    );
    const edits = draft.project.cues[0].droneEdits!;
    const key = edits[1].keyframes![1];
    expect(key).toMatchObject({ time: 5, color: '#ff0000', brightness: 0.25, easing: 'hold' });
    [1, -5, 4].forEach((coordinate, axis) =>
      expect(key.position?.[axis]).toBeCloseTo(coordinate, 12)
    );
    const dormantKey = edits[2333].keyframes!.find((entry) => entry.time === 5)!;
    [1, -31, 3].forEach((coordinate, axis) =>
      expect(dormantKey.position?.[axis]).toBeCloseTo(coordinate, 12)
    );
    expect(edits[2333].position).toBeUndefined();
    expect(edits[2333].flash).toEqual(before.cues[0].droneEdits![2333].flash);
    expect(edits[2]).toEqual(before.cues[0].droneEdits![2]);
    expect(edits[1].keyframes![0]).toEqual(before.cues[0].droneEdits![1].keyframes![0]);
    expect(edits[1].keyframes![2]).toEqual(before.cues[0].droneEdits![1].keyframes![2]);
  });

  it('rejects a zero rotation axis or an implicit scale/rotation pivot without changing a reviewed draft', () => {
    for (const fields of [
      { pivot: [0, 0, 0], rotation: { axis: [0, 0, 0], angleDegrees: 90 } },
      { rotation: { axis: [0, 0, 1], angleDegrees: 90 } },
      { scale: [2, 2, 2] },
    ]) {
      const draft = state();
      stageOperations(
        [{ type: 'rename', name: 'Retain this reviewed draft' }],
        'Prior edit.',
        draft,
        defaultAgentLimits
      );
      executeAgentTool('review_draft', {}, draft, defaultAgentLimits);
      const before = structuredClone(draft);
      expect(() =>
        executeAgentTool(
          'stage_selection_operation',
          {
            operationJson: JSON.stringify({
              type: 'transform_drones',
              cueId: draft.project.cues[0].id,
              translation: [0, 0, 0],
              scope: 'base_and_keys',
              ...fields,
            }),
            explanation: 'Invalid transform.',
          },
          draft,
          defaultAgentLimits
        )
      ).toThrow();
      expect(draft).toEqual(before);
    }
  });

  it('exposes the required translation, optional affine fields, and actual transform order to the agent', () => {
    const result = executeAgentTool(
      'command_schema',
      { operationType: 'transform_drones' },
      state(),
      defaultAgentLimits
    ) as {
      schema: {
        properties: Record<string, { properties?: Record<string, unknown>; required?: string[] }>;
        required: string[];
      };
      notes: string[];
    };
    expect(result.schema.required).toContain('translation');
    for (const name of ['pivot', 'scale', 'rotation']) {
      expect(result.schema.properties).toHaveProperty(name);
      expect(result.schema.required).not.toContain(name);
    }
    expect(result.schema.properties.rotation.required).toEqual(
      expect.arrayContaining(['axis', 'angleDegrees'])
    );
    const notes = result.notes.join(' ');
    expect(notes).toContain('pivot + rotation(scale * (position - pivot)) + translation');
    expect(notes).toMatch(/explicit pivot/);
    expect(notes).toMatch(/right-hand/);
    expect(notes).toMatch(/zero collapses/);
    expect(notes).toMatch(/negative values reflect/);
    expect(notes).toMatch(/does not add orbital arc keys/);
  });

  it('keeps the existing expansion budget for rotation and scaling across a six-figure selection', () => {
    const draft = state();
    draft.base.droneCount = draft.project.droneCount = 100000;
    const operation = {
      type: 'transform_drones',
      cueId: draft.project.cues[0].id,
      ids: Array.from({ length: 100000 }, (_, index) => index + 1),
      translation: [0, 0, 0],
      pivot: [0, 0, 60],
      scale: [-1, 0.5, 2],
      rotation: { axis: [0, 1, 0], angleDegrees: 45 },
      scope: 'base_and_keys',
    };
    const before = structuredClone(draft);
    expect(() =>
      stageOperations(
        [operation, operation, operation],
        'Excessive transform expansion.',
        draft,
        defaultAgentLimits
      )
    ).toThrow('draft expansion budget');
    expect(draft).toEqual(before);
  });
});
