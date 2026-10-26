import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StoryboardBenchPlan } from '../core/bench-storyboard';
import { StoryboardMotorPreview, storyboardMotorFrame } from './StoryboardMotorPreview';

const plan: StoryboardBenchPlan = {
  source: { id: 'my-show', name: 'My show', revision: 7, planKey: 'edited-show-key' },
  durationMs: 32000,
  cues: [
    { sceneId: 'first', sceneName: 'First pulse', motor: 4, atMs: 4000 },
    { sceneId: 'second', sceneName: 'Second pulse', motor: 2, atMs: 14000 },
    { sceneId: 'third', sceneName: 'Final pulse', motor: 1, atMs: 24000 },
  ],
};

describe('storyboard motor-channel preview', () => {
  it('uses editor seconds and the authored motor, scene, start time, and duration', () => {
    expect(storyboardMotorFrame(plan, 3.999).cue).toBeUndefined();
    expect(storyboardMotorFrame(plan, 4).cue).toEqual(plan.cues[0]);
    expect(storyboardMotorFrame(plan, 4.999).cue).toEqual(plan.cues[0]);
    expect(storyboardMotorFrame(plan, 5).cue).toBeUndefined();
    expect(storyboardMotorFrame(plan, 24.5).cue).toEqual(plan.cues[2]);
    expect(storyboardMotorFrame(plan, 100)).toMatchObject({ elapsedMs: 32000, progress: 1 });
    expect(storyboardMotorFrame(plan, -2)).toMatchObject({ elapsedMs: 0, progress: 0 });
    expect(storyboardMotorFrame(plan, NaN)).toMatchObject({ elapsedMs: 0, progress: 0 });
  });

  it('renders an honest preview with authored cue labels and optional seek controls', () => {
    const html = renderToStaticMarkup(<StoryboardMotorPreview plan={plan} time={14.5} onSeek={() => { throw new Error('Render cannot seek'); }} />);
    expect(html).toContain('STORYBOARD PREVIEW · SIMULATED');
    expect(html).toContain('Schematic positions, not measured movement');
    expect(html).toContain('Second pulse: motor B, 5% for 1 second');
    expect(html).toContain('14.5 / 32 s');
    expect(html).toContain('aria-label="Preview Final pulse, motor A at 24 seconds"');
    expect(html).toContain('aria-label="Preview First pulse, motor D at 4 seconds"');
    expect(html.match(/type="button"/g)).toHaveLength(3);
    expect(html).not.toContain('Start');
  });

  it('does not imply a continuing physical pulse when a cancelled schedule freezes inside a cue', () => {
    const html = renderToStaticMarkup(<StoryboardMotorPreview plan={plan} time={14.5} highlightPulse={false} />);
    expect(html).toContain('Schedule ended; no pulse highlighting');
    expect(html).not.toContain('class="is-active"');
    expect(html).not.toContain('type="button"');
    expect(html).toContain('14.5 / 32 s');
  });
});
