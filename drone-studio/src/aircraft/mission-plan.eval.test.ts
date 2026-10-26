import { describe, expect, it } from 'vitest';
import { createOneFootHoverStoryboard } from '../components/first-flight-preview';
import type { Project } from '../core/model';
import { compileHoverMission, MissionPlanError } from './mission-plan';

/** Deterministic compiler fixtures. These do not run ArduPilot or prove flight behavior. */
function verticalShow(): Project {
  const project = createOneFootHoverStoryboard('hover-evaluation');
  project.name = 'First live hover candidate';
  project.revision = 7;
  project.limits.maxAltitude = 3;
  const scene = project.cues[0];
  scene.duration = 11;
  scene.droneEdits!['1'].keyframes = [
    { time: 0, position: [0, 0, 0], easing: 'smooth' },
    { time: 3, position: [0, 0, 2.5], easing: 'hold' },
    { time: 8, position: [0, 0, 2.5], easing: 'smooth' },
    { time: 11, position: [0, 0, 0] },
  ];
  return project;
}

describe('one-drone mission compiler evaluation', () => {
  it('compiles a reviewed vertical scene to exactly takeoff, timed hold, and land', () => {
    const project = verticalShow();
    const original = structuredClone(project);
    const draft = compileHoverMission(project);
    expect(draft).toMatchObject({
      storyboardId: project.id,
      revision: 7,
      heightM: 2.5,
      holdSeconds: 5,
      items: [
        { seq: 1, command: 22, altitudeM: 2.5 },
        { seq: 2, command: 19, altitudeM: 2.5, holdSeconds: 5 },
        { seq: 3, command: 21, altitudeM: 0 },
      ],
    });
    expect(draft.items).toHaveLength(3);
    expect(draft.warning).toMatch(/fresh field readiness check and a pilot ready/i);
    expect(project).toEqual(original);
    expect(compileHoverMission(structuredClone(project))).toEqual(draft);
  });

  it('keeps the saved one-foot study out of the physical mission path', () => {
    expect(() => compileHoverMission(createOneFootHoverStoryboard())).toThrow(MissionPlanError);
    expect(() => compileHoverMission(createOneFootHoverStoryboard())).toThrow(/1 ft|2 to 10 m/i);
  });

  it.each([
    ['lateral motion', (show: Project) => { show.cues[0].droneEdits!['1'].keyframes![2].position = [1.5, 0, 2.5]; }],
    ['extra scene', (show: Project) => { show.cues.push(structuredClone(show.cues[0])); show.cues[1].id = 'extra'; }],
    ['extra drone', (show: Project) => { show.droneCount = 2; }],
    ['unrepresented brightness cue', (show: Project) => { show.cues[0].droneEdits!['1'].keyframes![1].brightness = 1; }],
    ['unrepresented bench cue', (show: Project) => { show.cues[0].benchCue = { motor: 1, offset: 3 }; }],
  ] as const)('rejects %s rather than silently dropping creative intent', (_name, change) => {
    const project = verticalShow();
    change(project);
    expect(() => compileHoverMission(project)).toThrow(MissionPlanError);
  });

  it.each([
    ['below minimum', 1.99, 11, 3, 8],
    ['above maximum', 10.01, 11, 3, 8],
    ['short ascent', 2.5, 11, 2.99, 8],
    ['short hold', 2.5, 11, 3, 5.99],
    ['long hold', 2.5, 20, 3, 18.01],
    ['short descent', 2.5, 10.99, 3, 8],
  ] as const)('rejects %s boundary', (_name, height, duration, hoverStart, hoverEnd) => {
    const project = verticalShow();
    project.limits.maxAltitude = 11;
    const scene = project.cues[0];
    scene.duration = duration;
    const frames = scene.droneEdits!['1'].keyframes!;
    frames[1].time = hoverStart;
    frames[2].time = hoverEnd;
    frames[3].time = duration;
    frames[1].position![2] = height;
    frames[2].position![2] = height;
    expect(() => compileHoverMission(project)).toThrow(MissionPlanError);
  });
});
