import { describe, expect, it } from 'vitest';
import { projectSchema } from './model';
import { createFirstLiveHoverStoryboard, isFirstLiveHoverStoryboard } from './first-live-show';
import { compileHoverMission } from '../aircraft/mission-plan';

describe('first live hover candidate', () => {
  it('creates an editable one-drone vertical design that is not a props-off motor show', () => {
    const project = createFirstLiveHoverStoryboard('flight-candidate');
    expect(projectSchema.parse(project)).toEqual(project);
    expect(project.id).toBe('flight-candidate');
    expect(project.droneCount).toBe(1);
    expect(project.cues[0].benchCue).toBeUndefined();
    expect(project.cues[0].droneEdits?.['1']?.keyframes?.map((key) => key.position)).toEqual([
      [0, 0, 0], [0, 0, 2], [0, 0, 2], [0, 0, 0],
    ]);
    expect(isFirstLiveHoverStoryboard(project)).toBe(true);
    expect(compileHoverMission(project)).toMatchObject({
      heightM: 2,
      holdSeconds: 5,
      items: [
        { command: 22 },
        { command: 19 },
        { command: 21 },
      ],
    });
  });
});
