import { describe, expect, it } from 'vitest';
import { compileStoryboardBenchPlan } from './bench-storyboard';
import { createZorroStopStoryboard, isZorroStopStoryboard, zorroStopPlanError } from './zorro-test';

describe('props-off idle storyboard', () => {
  it('is a stationary saved project with no flight or sequential motor cues', () => {
    const project = createZorroStopStoryboard('zorro-test');
    expect(project).toMatchObject({ id: 'zorro-test', name: 'Props-off idle', droneCount: 1, cues: [{ duration: 20, altitude: 0 }] });
    expect(project.cues[0].benchCue).toBeUndefined();
    expect(isZorroStopStoryboard(project)).toBe(true);
    expect(zorroStopPlanError(project)).toBeNull();
    expect(() => compileStoryboardBenchPlan(project)).toThrow(/motor pulses/);
  });

  it('rejects edits that would mislabel a flight or bench-motor show as this idle show', () => {
    const project = createZorroStopStoryboard();
    project.cues[0].altitude = 1;
    expect(zorroStopPlanError(project)).toMatch(/fixed/);
    project.cues[0].altitude = 0;
    project.cues[0].benchCue = { motor: 1, offset: 3 };
    expect(zorroStopPlanError(project)).toMatch(/fixed/);
  });
});
