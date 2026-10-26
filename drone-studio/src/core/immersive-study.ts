import { hexRgb, rgbHex } from './animation';
import { smooth, type Cue, type DroneEdit, type Project, type Vector3Tuple } from './model';

const TAU = Math.PI * 2;
const RIBBON_COUNT = 960;
const DRONE_COUNT = 1200;
const KEY_TIMES = [0, 4, 8, 12, 16];
const CYAN = '#78d9d4';
const VIOLET = '#ad9ce0';
const GOLD = '#ebc68d';

const mixColor = (from: string, to: string, amount: number) => {
  const a = hexRgb(from);
  const b = hexRgb(to);
  return rgbHex(a.map((channel, index) => channel + (b[index] - channel) * amount));
};

/** A narrow warm accent travels through a predominantly cool, continuous colour field. */
function ribbonColor(phase: number) {
  const wrapped = ((phase % 1) + 1) % 1;
  const stops: [number, string][] = [
    [0, CYAN],
    [0.4, VIOLET],
    [0.64, VIOLET],
    [0.78, GOLD],
    [0.9, CYAN],
    [1, CYAN],
  ];
  const right = stops.findIndex(([time]) => time > wrapped);
  const [start, from] = stops[right - 1];
  const [end, to] = stops[right];
  return mixColor(from, to, smooth((wrapped - start) / (end - start)));
}

/** Authored ENU coordinates: compass north is +Y, with the audience at the origin. */
function channels(index: number, time: number) {
  const crown = index >= RIBBON_COUNT;
  const pointCount = crown ? 60 : 120;
  const localIndex = crown ? index - RIBBON_COUNT : index;
  const row = Math.floor(localIndex / pointCount);
  const column = localIndex % pointCount;
  const angle = ((column + (row % 2) * 0.5) / pointCount) * TAU;
  const phase = (time / 48) * TAU;
  const closingWarmth = smooth((time - 28) / 20);
  const heading = angle + (time / 48) * (crown ? -0.26 : 0.36);
  const radius = crown
    ? 26 + row * 10 + 4 * Math.cos(5 * angle - phase) + closingWarmth * 4
    : 96 + row * 2.2 + 6 * Math.sin(3 * angle + phase + row * 0.08);
  const altitude = crown
    ? 108 + row * 2.5 + 3 * Math.sin(3 * angle + phase)
    : 53 +
      row * 3 +
      5 * Math.sin(2 * angle - phase + row * 0.22) +
      3 * Math.sin(5 * angle + phase / 2);
  const position = [radius * Math.sin(heading), radius * Math.cos(heading), altitude].map(
    (value) => {
      const rounded = Number(value.toFixed(6));
      return rounded === 0 ? 0 : rounded;
    }
  ) as Vector3Tuple;
  const baseColor = ribbonColor(angle / TAU - time / 80 + row * 0.025);
  const color = mixColor(
    baseColor,
    GOLD,
    crown ? 0.25 + closingWarmth * 0.5 : closingWarmth * 0.32
  );
  const brightness = Number(
    (crown
      ? 0.58 + 0.12 * (0.5 + 0.5 * Math.sin(2 * angle - phase)) + closingWarmth * 0.12
      : 0.7 + 0.18 * (0.5 + 0.5 * Math.sin(3 * angle - (time * Math.PI) / 8 + row * 0.3))
    ).toFixed(6)
  );
  return { position, color, brightness };
}

/**
 * A deterministic creative study, rendered through the ordinary editable project engine.
 * Every active ID is explicitly authored; the custom formation is only a schema container.
 * This function has no storage, clock, renderer, hardware, or saved-project side effects.
 */
export function createImmersiveStudy(): Project {
  const scenes = [
    { id: 'light-all-around', name: 'Light, all around' },
    { id: 'the-turning-sky', name: 'The turning sky' },
    { id: 'a-crown-of-embers', name: 'A crown of embers' },
  ];
  const cues: Cue[] = scenes.map((scene, sceneIndex) => {
    const start = sceneIndex * 16;
    const droneEdits: Record<string, DroneEdit> = {};
    for (let index = 0; index < DRONE_COUNT; index++) {
      droneEdits[String(index + 1)] = {
        ...channels(index, start),
        keyframes: KEY_TIMES.map((time) => ({
          time,
          easing: 'smooth',
          ...channels(index, start + time),
        })),
      };
    }
    return {
      ...scene,
      shape: 'custom',
      palette: 'aurora',
      duration: 16,
      transition: sceneIndex === 0 ? 0 : 4,
      transitionEasing: 'smooth',
      scale: 118,
      altitude: 68,
      droneEdits,
      metadata: {
        generator: 'src/core/immersive-study.ts',
        designStudy: 'immersive-360',
        editable: true,
        flightReady: false,
        motifs: ['surrounding-sky-ribbons', 'overhead-crown'],
        audienceOrigin: [0, 0, 1.7],
        suggestedView: { yaw: 0, pitch: 35, fov: 90 },
        note: 'Creative simulation study. Venue placement is a viewing reference, not a planned flight site.',
      },
    };
  });
  return {
    version: 1,
    id: 'immersive-study',
    revision: 0,
    name: 'All around you',
    droneCount: DRONE_COUNT,
    bpm: 120,
    limits: {
      minimumSeparation: 2,
      maxSpeed: 8,
      maxAcceleration: 4,
      maxAltitude: 160,
      radius: 150,
    },
    cues,
  };
}
