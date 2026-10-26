import { describe, expect, it } from 'vitest';
import { applyOperations } from '../core/commands';
import { defaultProject, type Project } from '../core/model';
import { draftAuditionPresets } from './draft-preview-audition';
import { draftPreviewTiming } from './draft-preview';
import { advanceDraftPlayback } from './draft-preview-playback';

function fixture(): Project {
  const project = structuredClone(defaultProject);
  project.droneCount = 2;
  project.cues = [
    { ...project.cues[0], id: 'opening', duration: 24, transition: 8 },
    { ...project.cues[1], id: 'detail', duration: 24, transition: 8 },
  ];
  return project;
}

describe('private audition presets', () => {
  it('encloses both real command-retimed intervals without changing the shared clock', () => {
    const base = fixture();
    const original = structuredClone(base);
    const draft = applyOperations(
      base,
      [{ type: 'retime_cue', id: 'detail', speed: 1.25 }],
      base.revision
    );
    expect(draftAuditionPresets(base, draft, 'detail')).toEqual({
      scene: { start: 24, end: 48 },
      transition: { start: 24, end: 32 },
    });
    expect(base).toEqual(original);
    expect(draft.cues[1].transition).toBe(6.4);
  });

  it('includes shifted timings after an earlier retime, even for an unedited scene', () => {
    const base = fixture();
    const draft = applyOperations(
      base,
      [{ type: 'retime_cue', id: 'opening', speed: 2 }],
      base.revision
    );
    expect(draftAuditionPresets(base, draft, 'detail')).toEqual({
      scene: { start: 12, end: 48 },
      transition: { start: 12, end: 32 },
    });
  });

  it('keeps a first scene available while excluding its inactive incoming blend', () => {
    const base = fixture();
    expect(draftAuditionPresets(base, base, 'opening')).toEqual({
      scene: { start: 0, end: 24 },
      transition: null,
    });
  });

  it('retains the existing blend when the other version cuts, then has no blend when both cut', () => {
    const base = fixture();
    const draft = structuredClone(base);
    draft.cues[1].transition = 0;
    expect(draftAuditionPresets(base, draft, 'detail').transition).toEqual({ start: 24, end: 32 });
    base.cues[1].transition = 0;
    expect(draftAuditionPresets(base, draft, 'detail').transition).toBeNull();
  });

  it('handles a removed or added scene using the side where it exists', () => {
    const base = fixture();
    const draft = structuredClone(base);
    draft.cues.pop();
    const expected = { scene: { start: 24, end: 48 }, transition: { start: 24, end: 32 } };
    expect(draftAuditionPresets(base, draft, 'detail')).toEqual(expected);
    expect(draftAuditionPresets(draft, base, 'detail')).toEqual(expected);
    expect(draftAuditionPresets(base, draft, 'unknown')).toEqual({ scene: null, transition: null });
  });

  it('encloses reordered scene positions and only the active incoming blend', () => {
    const base = fixture();
    const draft = structuredClone(base);
    draft.cues.reverse();
    expect(draftAuditionPresets(base, draft, 'detail')).toEqual({
      scene: { start: 0, end: 48 },
      transition: { start: 24, end: 32 },
    });
  });

  it('returns independent preset objects with no shared authored state', () => {
    const base = fixture();
    base.cues[1].transition = 24;
    const result = draftAuditionPresets(base, base, 'detail');
    result.scene!.start = 25;
    expect(result.transition).toEqual({ start: 24, end: 48 });
    expect(draftAuditionPresets(base, base, 'detail').scene).toEqual({ start: 24, end: 48 });
  });

  it('holds a shorter draft within the loop then resumes both versions on wrap', () => {
    const base = fixture();
    const draft = applyOperations(
      base,
      [{ type: 'retime_cue', id: 'detail', speed: 2 }],
      base.revision
    );
    const range = draftAuditionPresets(base, draft, 'detail').scene!;
    const late = advanceDraftPlayback({
      startTime: 24,
      elapsedSeconds: 20,
      speed: 1,
      duration: 48,
      range,
    });
    expect(late).toEqual({ time: 44, ended: false });
    expect(draftPreviewTiming(base, draft, late.time)).toMatchObject({
      baseTime: 44,
      draftTime: 36,
      draftEnded: true,
    });
    const wrapped = advanceDraftPlayback({
      startTime: 24,
      elapsedSeconds: 26,
      speed: 1,
      duration: 48,
      range,
    });
    expect(wrapped).toEqual({ time: 26, ended: false });
    expect(draftPreviewTiming(base, draft, wrapped.time)).toMatchObject({
      baseTime: 26,
      draftTime: 26,
      draftEnded: false,
    });
  });
});
