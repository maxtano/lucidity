import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShowEvaluator } from '../core/animation';
import { projectSchema, totalDuration } from '../core/model';
import { FirstFlightRehearsal } from './FirstFlightRehearsal';
import { createFirstFlightPreview, createOneFootHoverStoryboard, firstFlightPreviewAt, isOneFootHoverStoryboard } from './first-flight-preview';

describe('private one-drone flight preview', () => {
  it('uses the shared show evaluator with a single drone and exact up/hold/down keyframes', () => {
    const project = createFirstFlightPreview();
    expect(projectSchema.safeParse(project).success).toBe(true);
    expect(project.droneCount).toBe(1);
    expect(totalDuration(project)).toBe(9);
    const evaluator = new ShowEvaluator(project);
    for (const [time, altitude] of [
      [0, 0],
      [2, 0.3048],
      [4, 0.3048],
      [6, 0.3048],
      [9, 0],
    ]) {
      const positions = evaluator.samplePositions(time, [1]);
      expect(Array.from(positions.subarray(0, 2))).toEqual([0, 0]);
      expect(positions[2]).toBeCloseTo(altitude, 6);
      expect(firstFlightPreviewAt(time).altitudeM).toBeCloseTo(altitude, 6);
    }
    expect(firstFlightPreviewAt(1).altitudeM).toBeCloseTo(0.1524, 6);
    expect(firstFlightPreviewAt(7.5).altitudeM).toBeCloseTo(0.1524, 6);
    const savedStudy = createOneFootHoverStoryboard('my-flight-study');
    expect(savedStudy.id).toBe('my-flight-study');
    expect(isOneFootHoverStoryboard(savedStudy)).toBe(true);
    expect(savedStudy.cues[0].benchCue).toBeUndefined();
    const existing = structuredClone(savedStudy);
    existing.name = 'One drone · 1 ft hover';
    existing.cues[0].metadata = undefined;
    expect(isOneFootHoverStoryboard(existing)).toBe(true);
    const other = createFirstFlightPreview();
    project.cues[0].droneEdits!['1'].keyframes![0].position![2] = 8;
    expect(other.cues[0].droneEdits!['1'].keyframes![0].position![2]).toBe(0);
  });

  it('keeps the optional animation collapsed and explicitly separate from hardware commands', () => {
    const html = renderToStaticMarkup(<FirstFlightRehearsal />);
    expect(html).toContain('<details class="aircraft-first-preview">');
    expect(html).toContain('Simulation only');
    expect(html).toContain('Preview simulation');
    expect(html).toContain('This animation sends no hardware commands.');
    expect(html).toContain('It does not measure or control the aircraft’s height.');
    expect(html).toContain('Not aircraft telemetry.');
  });
});
