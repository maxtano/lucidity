import { describe, expect, it } from 'vitest';
import { applyOperations } from '../core/commands';
import { defaultProject, frameAt, transitionEasings, type Project } from '../core/model';
import { draftPreviewTiming } from './draft-preview';
import { buildDraftPreviewNavigation } from './draft-preview-navigation';

function fixture(): Project {
  const project = structuredClone(defaultProject);
  project.droneCount = 2;
  project.cues = [
    { ...project.cues[0], id: 'opening', name: 'Opening', duration: 4, transition: 0 },
    {
      ...project.cues[1],
      id: 'detail',
      name: 'Detail',
      duration: 8,
      transition: 4,
      droneEdits: {
        1: {
          keyframes: [
            { time: 0, position: [0, 0, 10] },
            { time: 3, position: [3, 0, 10] },
            { time: 8, position: [8, 0, 10] },
          ],
        },
      },
    },
    { ...project.cues[0], id: 'closing', name: 'Closing', duration: 6, transition: 2 },
  ];
  return project;
}

describe('command-applied draft navigation', () => {
  it.each(transitionEasings)(
    'completes a fractional retimed %s transition at its exact landmark',
    (easing) => {
      const base = fixture();
      base.cues[0].duration = 24;
      base.cues[1].duration = 24;
      base.cues[1].transition = 8;
      base.cues[1].transitionEasing = easing;
      const draft = applyOperations(
        base,
        [{ type: 'retime_cue', id: 'detail', speed: 1.25 }],
        base.revision
      );
      const side = buildDraftPreviewNavigation(base, draft).changes[0].draft!;
      const endpoint = side.points.find((point) => point.localTime === 6.4)!;
      expect(endpoint.time).toBe(30.4);
      expect(frameAt(draft, endpoint.time).progress).toBe(1);
      expect(frameAt(draft, endpoint.time - 0.001).progress).toBeLessThan(1);
    }
  );

  it('finds each retimed transition at its own show time without marking the shifted closing edited', () => {
    const base = fixture();
    const original = structuredClone(base);
    const draft = applyOperations(
      base,
      [{ type: 'retime_cue', id: 'detail', speed: 2 }],
      base.revision
    );
    const navigation = buildDraftPreviewNavigation(base, draft);
    expect(navigation.changes.map((change) => change.id)).toEqual(['detail']);
    const change = navigation.changes[0];
    for (const [project, side, expectedTime, expectedLocal] of [
      [base, change.before, 8, 4],
      [draft, change.draft, 6, 2],
    ] as const) {
      const point = side!.points.find((point) => point.label === 'Transition end')!;
      expect(point).toMatchObject({ time: expectedTime, localTime: expectedLocal });
      const frame = frameAt(project, point.time);
      expect(frame.cue.id).toBe('detail');
      expect(frame.progress).toBe(1);
      expect(point.time - frame.start).toBe(expectedLocal);
    }
    expect(base).toEqual(original);
  });

  it('keeps the same global time while retiming puts Before and Draft in different scenes', () => {
    const base = fixture();
    const draft = applyOperations(
      base,
      [{ type: 'retime_cue', id: 'detail', speed: 2 }],
      base.revision
    );
    const timing = draftPreviewTiming(base, draft, 10);
    const beforeFrame = frameAt(base, timing.baseTime);
    const draftFrame = frameAt(draft, timing.draftTime);
    expect([beforeFrame.cue.name, timing.baseTime - beforeFrame.start]).toEqual(['Detail', 6]);
    expect([draftFrame.cue.name, timing.draftTime - draftFrame.start]).toEqual(['Closing', 2]);
    expect(timing.time).toBe(10);
    expect(timing.baseEnded || timing.draftEnded).toBe(false);
  });

  it('retains a final edited-key landmark at an exact endpoint before later shared time holds it', () => {
    const base = fixture();
    base.cues.pop();
    const draft = applyOperations(
      base,
      [{ type: 'retime_cue', id: 'detail', speed: 2 }],
      base.revision
    );
    const change = buildDraftPreviewNavigation(base, draft).changes[0];
    const endpoint = change.draft!.points.find((point) => point.localTime === 4)!;
    expect(endpoint.time).toBe(8);
    const exact = draftPreviewTiming(base, draft, endpoint.time);
    expect(exact.draftEnded).toBe(false);
    expect(frameAt(draft, exact.draftTime).cue.id).toBe('detail');
    const later = draftPreviewTiming(base, draft, 12);
    expect(later.draftTime).toBe(endpoint.time);
    expect(later.draftEnded).toBe(true);
  });
});
