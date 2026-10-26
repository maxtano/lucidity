import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ShowEvaluator } from './animation';
import { parseProjectFile, projectBundle, trajectoryCsv } from './export';
import { createImmersiveStudy } from './immersive-study';
import { projectSchema, totalDuration } from './model';

const project = createImmersiveStudy();

describe('immersive creative study', () => {
  it('creates independent deterministic projects with every point and channel authored', () => {
    const another = createImmersiveStudy();
    expect(another).toEqual(project);
    expect(projectSchema.parse(project)).toEqual(project);
    expect(project).toMatchObject({
      id: 'immersive-study',
      name: 'All around you',
      droneCount: 1200,
      bpm: 120,
    });
    expect(totalDuration(project)).toBe(48);
    expect(project.cues.map((cue) => [cue.duration, cue.transition])).toEqual([
      [16, 0],
      [16, 4],
      [16, 4],
    ]);
    for (const cue of project.cues) {
      expect(cue.shape).toBe('custom');
      expect(cue.metadata).toMatchObject({
        editable: true,
        flightReady: false,
        designStudy: 'immersive-360',
      });
      expect(Object.keys(cue.droneEdits!)).toHaveLength(1200);
      expect(
        Object.entries(cue.droneEdits!).every(
          ([id, edit]) =>
            Number(id) >= 1 &&
            Number(id) <= 1200 &&
            edit.position &&
            edit.color &&
            edit.brightness !== undefined &&
            edit.keyframes?.length === 5 &&
            edit.keyframes.every(
              (key, index) =>
                key.time === index * 4 &&
                key.position?.length === 3 &&
                key.color &&
                key.brightness !== undefined &&
                key.easing === 'smooth'
            )
        )
      ).toBe(true);
    }
    another.cues[0].droneEdits!['1'].position![0] = 500;
    expect(project.cues[0].droneEdits!['1'].position).toEqual([0, 96, 53]);
  });

  it('places visible ribbons in all four compass directions and a distinct overhead crown', () => {
    const evaluator = new ShowEvaluator(project);
    // Fixture anchors verify the intended ENU orientation, not a front-only backdrop.
    const start = evaluator.sample(0);
    expect(Array.from(start.positions.slice(0, 3))).toEqual([0, 96, 53]);
    expect(Array.from(start.positions.slice(30 * 3, 30 * 3 + 3))).toEqual([90, 0, 56]);
    expect(Array.from(start.positions.slice(60 * 3, 60 * 3 + 3))).toEqual([0, -96, 53]);
    expect(Array.from(start.positions.slice(90 * 3, 90 * 3 + 3))).toEqual([-102, 0, 50]);
    expect(Array.from(start.positions.slice(960 * 3, 960 * 3 + 3))).toEqual([0, 30, 108]);

    // These are sampled composition checks, not collision or continuous flight bounds.
    for (const time of [0, 8, 18, 24, 34, 40, 48]) {
      const sample = evaluator.sample(time);
      const quadrants = [0, 0, 0, 0];
      const eyeLevelCounts = [0, 0, 0, 0];
      let overhead = 0;
      for (let index = 0; index < project.droneCount; index++) {
        const [east, north, up] = sample.positions.slice(index * 3, index * 3 + 3);
        const radius = Math.hypot(east, north);
        const elevation = (Math.atan2(up - 1.7, radius) * 180) / Math.PI;
        const bearing = (Math.atan2(east, north) * 180) / Math.PI;
        if (index < 960) {
          quadrants[(east >= 0 ? 0 : 2) + (north >= 0 ? 0 : 1)]++;
          expect(radius).toBeGreaterThan(88);
          expect(radius).toBeLessThan(120);
          expect(up).toBeGreaterThanOrEqual(44);
          expect(up).toBeLessThanOrEqual(83);
        } else if (elevation > 59) overhead++;
        for (let direction = 0; direction < 4; direction++) {
          const relative = ((bearing - direction * 90 + 540) % 360) - 180;
          if (Math.abs(relative) <= 45 && elevation >= -10 && elevation <= 80)
            eyeLevelCounts[direction]++;
        }
      }
      expect(quadrants.every((count) => count >= 225)).toBe(true);
      expect(eyeLevelCounts.every((count) => count > 240)).toBe(true);
      expect(overhead).toBeGreaterThan(220);
    }
  });

  it('keeps every position, color and brightness continuous through both scene boundaries', () => {
    const evaluator = new ShowEvaluator(project);
    for (const boundary of [16, 32]) {
      const sceneIndex = boundary / 16;
      const previous = project.cues[sceneIndex - 1];
      const incoming = project.cues[sceneIndex];
      for (let id = 1; id <= project.droneCount; id++) {
        const last = previous.droneEdits![id].keyframes!.at(-1)!;
        const first = incoming.droneEdits![id].keyframes![0];
        expect([last.position, last.color, last.brightness]).toEqual([
          first.position,
          first.color,
          first.brightness,
        ]);
      }
      const before = evaluator.sample(boundary - 0.001);
      const at = evaluator.sample(boundary);
      const after = evaluator.sample(boundary + 0.001);
      for (const sample of [before, after]) {
        let positionDelta = 0;
        let lightDelta = 0;
        for (let index = 0; index < at.positions.length; index++) {
          positionDelta = Math.max(
            positionDelta,
            Math.abs(at.positions[index] - sample.positions[index])
          );
          lightDelta = Math.max(lightDelta, Math.abs(at.shades[index] - sample.shades[index]));
        }
        expect(positionDelta).toBeLessThan(0.001);
        expect(lightDelta).toBeLessThan(0.0001);
      }
    }
    const early = evaluator.sample(4);
    const late = evaluator.sample(40);
    expect(
      Math.max(...late.positions.map((value, index) => Math.abs(value - early.positions[index])))
    ).toBeGreaterThan(15);
    expect(
      Math.max(...late.shades.map((value, index) => Math.abs(value - early.shades[index])))
    ).toBeGreaterThan(0.15);
  });

  it('ships the same editable, non-flight bundle and exports shared animation samples', () => {
    const bundled = projectBundle(project, null);
    expect(bundled).toMatchObject({
      format: 'lucidity.design',
      flightReady: false,
      validation: null,
      media: { audioEmbedded: false },
    });
    const artifactText = readFileSync(
      new URL('../../public/examples/immersive-study.lucid.json', import.meta.url),
      'utf8'
    );
    const artifact = JSON.parse(artifactText);
    expect(artifact).toMatchObject({
      flightReady: false,
      formatVersion: 3,
      coordinateSystem: { frame: 'local-ENU' },
    });
    const imported = parseProjectFile(artifactText);
    expect(imported).toEqual(project);
    expect(parseProjectFile(JSON.stringify(bundled))).toEqual(project);
    const originalEvaluator = new ShowEvaluator(project);
    const importedEvaluator = new ShowEvaluator(imported);
    for (const time of [0, 16, 18, 24.5, 32, 48])
      expect(importedEvaluator.sample(time)).toEqual(originalEvaluator.sample(time));

    const rows = trajectoryCsv(imported).split('\n');
    for (const [time, id] of [
      [0, 61],
      [18, 963],
      [32, 1200],
      [48, 1],
    ]) {
      const row = rows[2 + time * 2 * project.droneCount + id - 1].split(',').map(Number);
      const sample = originalEvaluator.sample(time);
      const offset = (id - 1) * 3;
      expect(row).toEqual([
        time,
        id,
        ...Array.from(sample.positions.slice(offset, offset + 3), (value) =>
          Number(value.toFixed(4))
        ),
        ...Array.from(sample.shades.slice(offset, offset + 3), (value) => Math.round(value * 255)),
      ]);
    }
  });
});
