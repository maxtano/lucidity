import { describe, expect, it } from 'vitest';
import { ShowEvaluator } from '../core/animation';
import type { Operation } from '../core/commands';
import { defaultProject, frameAt, type Project } from '../core/model';
import { DEFAULT_VENUE_PLACEMENT, DEFAULT_VIEWER_POSE, type ViewerSnapshot } from '../core/viewer';
import { createDraftPreview, draftPreviewTiming } from './draft-preview';
import type { AgentProposal } from './types';

function fixture(): Project {
  const project = structuredClone(defaultProject);
  project.id = 'preview-fixture';
  project.revision = 12;
  project.droneCount = 2;
  project.cues = [
    {
      ...project.cues[0],
      id: 'opening',
      duration: 4,
      transition: 0,
      droneEdits: { 1: { position: [0, 10, 10], color: '#114477' } },
    },
    {
      ...project.cues[1],
      id: 'detail',
      duration: 6,
      transition: 2,
      transitionEasing: 'linear',
      droneEdits: {
        1: {
          position: [10, 20, 20],
          color: '#ffaa33',
          keyframes: [
            { time: 0, position: [10, 20, 20], brightness: 0.25, easing: 'linear' },
            { time: 6, position: [16, 26, 26], brightness: 0.75 },
            { time: 8, color: '#113355', easing: 'hold' },
          ],
        },
        5: {
          position: [40, 50, 60],
          keyframes: [{ time: 9, position: [43, 53, 63], color: '#abcdef', easing: 'hold' }],
        },
      },
    },
  ];
  return project;
}
function proposal(base: Project, operations: Operation[]): AgentProposal {
  return {
    projectId: base.id,
    revision: base.revision,
    title: 'Draft',
    description: 'Preview only',
    changes: ['Review the draft.'],
    operations,
  };
}
const retime = (speed: number): Operation => ({ type: 'retime_cue', id: 'detail', speed });
const viewer = (): ViewerSnapshot => ({
  pose: { ...DEFAULT_VIEWER_POSE },
  venue: { ...DEFAULT_VENUE_PLACEMENT },
});

describe('owned draft comparison documents', () => {
  it('captures the original and privately applied draft at the exact proposal revision', () => {
    const base = fixture(),
      change = proposal(base, [retime(2)]);
    const snapshot = structuredClone({ base, change });
    const result = createDraftPreview(base, change, 9);
    expect(result.initialTime).toBe(9);
    expect(result.base).toEqual(base);
    expect(result.base.revision).toBe(12);
    expect(result.draft.revision).toBe(13);
    expect(result.draft.cues[1]).toMatchObject({ duration: 3, transition: 1 });
    expect(result.draft.cues[1].droneEdits![1].keyframes!.map((key) => key.time)).toEqual([
      0, 3, 4,
    ]);
    expect(result.draft.cues[1].droneEdits![5].keyframes).toEqual([
      { time: 4.5, position: [43, 53, 63], color: '#abcdef', easing: 'hold' },
    ]);
    expect({ base, change }).toEqual(snapshot);
    expect(result).not.toHaveProperty('viewer');
  });

  it.each([
    { projectId: 'another-project' },
    { projectId: undefined },
    { revision: 11 },
    { revision: 13 },
    { revision: undefined },
  ])('rejects missing or mismatched proposal identity %j', (patch) => {
    const base = fixture();
    const invalid = { ...proposal(base, [retime(2)]), ...patch } as unknown as AgentProposal;
    expect(() => createDraftPreview(base, invalid, 2)).toThrow(/project|revision/);
  });

  it('publishes no partial document when a later operation fails', () => {
    const base = fixture();
    const change = proposal(base, [
      { type: 'edit_drones', cueId: 'detail', ids: [1], patch: { color: '#ffffff' } },
      { type: 'remove_cue', id: 'missing-scene' },
    ]);
    const original = structuredClone({ base, change });
    expect(() => createDraftPreview(base, change, 2)).toThrow('Cue not found');
    expect({ base, change }).toEqual(original);
  });

  it('owns nested projects, commands, and camera values independently in both directions', () => {
    const base = fixture(),
      camera = viewer();
    const change = proposal(base, [
      {
        type: 'set_keyframe',
        cueId: 'detail',
        ids: [1],
        keyframe: { time: 2, position: [100, 200, 300] },
      },
    ]);
    const result = createDraftPreview(base, change, 5, camera);
    const expected = structuredClone(result);
    base.cues[1].droneEdits![1].keyframes![0].position![0] = 999;
    if (change.operations[0].type === 'set_keyframe')
      change.operations[0].keyframe.position![0] = 888;
    camera.pose.yaw = 271;
    camera.venue.east = 100;
    expect(result).toEqual(expected);
    result.base.cues[1].droneEdits![1].keyframes![0].position![1] = -999;
    expect(result.draft).toEqual(expected.draft);
    result.draft.cues[1].droneEdits![1].keyframes![0].position![2] = -888;
    expect(result.base.cues[1].droneEdits![1].keyframes![0].position![2]).toBe(20);
    result.viewer!.pose.yaw = 20;
    expect(camera.pose.yaw).toBe(271);
    expect(base.cues[1].droneEdits![1].keyframes![0].position).toEqual([999, 20, 20]);
  });

  it('normalizes a captured viewer without mutating it, and rejects nonfinite camera values', () => {
    const base = fixture(),
      change = proposal(base, [retime(2)]),
      camera = viewer();
    camera.pose = { east: 1000, north: -1000, eyeHeight: 10, yaw: -90, pitch: 120, fov: 10 };
    camera.venue = { east: -1000, north: 1000, heading: 540 };
    const original = structuredClone(camera);
    expect(createDraftPreview(base, change, 0, camera).viewer).toEqual({
      pose: { east: 500, north: -500, eyeHeight: 5, yaw: 270, pitch: 89, fov: 45 },
      venue: { east: -500, north: 500, heading: 180 },
    });
    expect(camera).toEqual(original);
    camera.pose.yaw = NaN;
    expect(() => createDraftPreview(base, change, 0, camera)).toThrow(/finite/);
  });
});

describe('shared show-global draft preview timing', () => {
  it('holds a shortened draft only after its endpoint, while the original clock continues', () => {
    const base = fixture(),
      result = createDraftPreview(base, proposal(base, [retime(2)]), 9);
    expect(draftPreviewTiming(result.base, result.draft, 9)).toEqual({
      duration: 10,
      time: 9,
      baseTime: 9,
      draftTime: 7,
      baseEnded: false,
      draftEnded: true,
    });
    expect(draftPreviewTiming(result.base, result.draft, 7)).toMatchObject({
      time: 7,
      baseTime: 7,
      draftTime: 7,
      baseEnded: false,
      draftEnded: false,
    });
    expect(draftPreviewTiming(result.base, result.draft, 7 + 1e-9).draftEnded).toBe(true);
  });

  it('holds an original show after its endpoint when the proposed scene is longer', () => {
    const base = fixture(),
      result = createDraftPreview(base, proposal(base, [retime(0.5)]), 14);
    expect(result.initialTime).toBe(14);
    expect(draftPreviewTiming(result.base, result.draft, 14)).toEqual({
      duration: 16,
      time: 14,
      baseTime: 10,
      draftTime: 14,
      baseEnded: true,
      draftEnded: false,
    });
    expect(draftPreviewTiming(result.base, result.draft, 10).baseEnded).toBe(false);
    expect(result.draft.cues[1].droneEdits![5].keyframes![0].time).toBe(18);
  });

  it('keeps identical global times across different transition speeds and exact scene boundaries', () => {
    const base = fixture(),
      result = createDraftPreview(base, proposal(base, [retime(2)]), 5);
    const boundary = draftPreviewTiming(result.base, result.draft, 4);
    expect(frameAt(result.base, boundary.baseTime)).toMatchObject({
      start: 4,
      index: 1,
      progress: 0,
    });
    expect(frameAt(result.draft, boundary.draftTime)).toMatchObject({
      start: 4,
      index: 1,
      progress: 0,
    });
    const timing = draftPreviewTiming(result.base, result.draft, 5);
    expect(frameAt(result.base, timing.baseTime).progress).toBe(0.5);
    expect(frameAt(result.draft, timing.draftTime).progress).toBe(1);
    expect(
      Array.from(new ShowEvaluator(result.base).samplePositions(timing.baseTime, [1]))
    ).toEqual([5.5, 15.5, 15.5]);
    expect(
      Array.from(new ShowEvaluator(result.draft).samplePositions(timing.draftTime, [1]))
    ).toEqual([12, 22, 22]);
  });

  it('compares reordered scenes at the same global clock rather than aligning scene-local times', () => {
    const base = fixture();
    const result = createDraftPreview(
      base,
      proposal(base, [{ type: 'move_cue', id: 'detail', direction: 'up' }]),
      6
    );
    const timing = draftPreviewTiming(result.base, result.draft, 6);
    expect(timing).toEqual({
      duration: 10,
      time: 6,
      baseTime: 6,
      draftTime: 6,
      baseEnded: false,
      draftEnded: false,
    });
    expect(frameAt(result.base, timing.baseTime)).toMatchObject({
      start: 4,
      cue: { id: 'detail' },
    });
    expect(frameAt(result.draft, timing.draftTime)).toMatchObject({
      start: 6,
      cue: { id: 'opening' },
    });
    expect(
      Array.from(new ShowEvaluator(result.base).samplePositions(timing.baseTime, [1]))
    ).toEqual([12, 22, 22]);
    expect(
      Array.from(new ShowEvaluator(result.draft).samplePositions(timing.draftTime, [1]))
    ).toEqual([0, 10, 10]);
    expect(result.draft.cues[0].droneEdits![5]).toEqual(base.cues[1].droneEdits![5]);
  });

  it('clamps negative and oversized clocks to the shared interval without marking equal ends held', () => {
    const base = fixture(),
      change = proposal(base, [retime(0.5)]);
    expect(createDraftPreview(base, change, -12).initialTime).toBe(0);
    const result = createDraftPreview(base, change, Number.MAX_VALUE);
    expect(result.initialTime).toBe(16);
    expect(draftPreviewTiming(result.base, result.draft, -12)).toMatchObject({
      time: 0,
      baseTime: 0,
      draftTime: 0,
      baseEnded: false,
      draftEnded: false,
    });
    expect(draftPreviewTiming(result.base, result.draft, Number.MAX_VALUE)).toMatchObject({
      time: 16,
      baseTime: 10,
      draftTime: 16,
      baseEnded: true,
      draftEnded: false,
    });
    expect(draftPreviewTiming(base, base, 100)).toMatchObject({
      time: 10,
      baseEnded: false,
      draftEnded: false,
    });
  });

  it.each([NaN, Infinity, -Infinity])('rejects nonfinite shared time %s', (time) => {
    const base = fixture();
    expect(() => createDraftPreview(base, proposal(base, [retime(2)]), time)).toThrow(/finite/);
    expect(() => draftPreviewTiming(base, base, time)).toThrow(/finite/);
  });
});
