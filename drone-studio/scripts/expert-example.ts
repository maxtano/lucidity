/** An editable procedural study. Run `npm run --silent example > public/examples/prismatic-study.lucid.json`. */
import {
  defaultProject,
  type Cue,
  type DroneEdit,
  type Project,
  type Vector3Tuple,
} from '../src/core/model';
import { projectBundle } from '../src/core/export';

const count = 800;
const hue = (h: number) => {
  const sector = (((h % 1) + 1) % 1) * 6,
    x = 1 - Math.abs((sector % 2) - 1);
  const rgb =
    sector < 1
      ? [1, x, 0]
      : sector < 2
        ? [x, 1, 0]
        : sector < 3
          ? [0, 1, x]
          : sector < 4
            ? [0, x, 1]
            : sector < 5
              ? [x, 0, 1]
              : [1, 0, x];
  return (
    '#' +
    rgb
      .map((v) =>
        Math.round((0.12 + v * 0.88) * 255)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  );
};
const point = (u: number, phase: number, vortex: boolean): Vector3Tuple => {
  const a = u * Math.PI * 2,
    angle = 2 * a + phase;
  if (vortex) {
    const radius = 20 + 10 * Math.sin(a * 2 + phase);
    return [
      radius * Math.cos(a * 4 + phase),
      radius * Math.sin(a * 4 + phase),
      70 + (u - 0.5) * 75,
    ];
  }
  const r = 26 + 9 * Math.cos(3 * a + phase);
  return [r * Math.cos(angle), r * Math.sin(angle), 70 + 17 * Math.sin(3 * a + phase)];
};
const cue = (id: string, name: string, vortex: boolean): Cue => {
  const droneEdits: Record<string, DroneEdit> = {};
  for (let i = 0; i < count; i++) {
    const u = i / count;
    droneEdits[i + 1] = {
      position: point(u, 0, vortex),
      color: hue(0.48 + u * 0.4),
      brightness: 0.95,
      flash: { hz: i % 8 === 0 ? 2 : 0, duty: 0.7, phase: u },
      keyframes: [0, 8, 16, 24].map((time) => ({
        time,
        easing: 'smooth',
        position: point(u, (time / 24) * Math.PI * 0.8, vortex),
        color: hue(0.48 + u * 0.4 + time / 100),
      })),
    };
  }
  return {
    id,
    name,
    shape: 'custom',
    palette: 'aurora',
    duration: 24,
    transition: vortex ? 8 : 0,
    scale: 80,
    altitude: 70,
    droneEdits,
    metadata: { generator: 'scripts/expert-example.ts', editable: true },
  };
};
const project: Project = {
  ...structuredClone(defaultProject),
  id: 'prismatic-study',
  name: 'Prismatic study',
  droneCount: count,
  cues: [
    cue('woven-light', 'Woven light', false),
    cue('chromatic-vortex', 'Chromatic vortex', true),
  ],
};
process.stdout.write(JSON.stringify(projectBundle(project, null)));
