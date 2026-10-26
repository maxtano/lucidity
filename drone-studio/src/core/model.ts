import { z } from 'zod';

export const shapes = [
  'orbit',
  'sphere',
  'helix',
  'heart',
  'wave',
  'bloom',
  'grid',
  'custom',
] as const;
export const palettes = ['aurora', 'moonlight', 'ember', 'rose', 'ocean'] as const;
export const transitionEasings = ['smooth', 'linear', 'ease-in', 'ease-out'] as const;
export type TransitionEasing = (typeof transitionEasings)[number];
export const transitionEasingNames: Record<TransitionEasing, string> = {
  smooth: 'Smooth · minimum jerk',
  linear: 'Linear · constant blend',
  'ease-in': 'Ease in · accelerate',
  'ease-out': 'Ease out · decelerate',
};
export const shapeNames: Record<Shape, string> = {
  orbit: 'Orbital rings',
  sphere: 'Celestial sphere',
  helix: 'Double helix',
  heart: 'Heart',
  wave: 'Ocean wave',
  bloom: 'Superbloom',
  grid: 'Light field',
  custom: 'Freeform points',
};
export const paletteColors: Record<Palette, string[]> = {
  aurora: ['#aaa3ff', '#e0ccff', '#63d7e6'],
  moonlight: ['#99bdfc', '#eef3ff', '#b5baff'],
  ember: ['#ffaf63', '#ffe6a1', '#ff7e65'],
  rose: ['#fa91ba', '#eed2f7', '#bd9bf4'],
  ocean: ['#5dcbcf', '#c2ffea', '#75a0ff'],
};
export type Shape = (typeof shapes)[number];
export type Palette = (typeof palettes)[number];
export const vectorSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
export const flashSchema = z.object({
  hz: z.number().finite().min(0).max(100),
  duty: z.number().finite().min(0).max(1),
  phase: z.number().finite(),
});
const droneProperties = {
  position: vectorSchema.optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  brightness: z.number().finite().min(0).max(1).optional(),
  flash: flashSchema.optional(),
};
export const keyframeSchema = z.object({
  time: z.number().finite().min(0).max(1800),
  easing: z.enum(['linear', 'smooth', 'hold']).optional(),
  ...droneProperties,
});
export const droneEditSchema = z
  .object({
    ...droneProperties,
    keyframes: z.array(keyframeSchema).max(2048).optional(),
  })
  .superRefine((edit, ctx) => {
    const times = edit.keyframes?.map((k) => k.time) || [];
    if (new Set(times).size !== times.length)
      ctx.addIssue({ code: 'custom', message: 'Keyframe times must be unique for a drone.' });
  });
export const droneEditsSchema = z.record(
  z
    .string()
    .regex(/^[1-9]\d{0,5}$/)
    .refine((id) => Number(id) <= 100000),
  droneEditSchema
);
export type Vector3Tuple = z.infer<typeof vectorSchema>;
export type DroneKeyframe = z.infer<typeof keyframeSchema>;
export type DroneEdit = z.infer<typeof droneEditSchema>;
export const benchCueSchema = z.object({
  motor: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  offset: z.number().finite().min(0).max(1800),
}).strict();
export type BenchCue = z.infer<typeof benchCueSchema>;
export const cueSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(60),
    shape: z.enum(shapes),
    palette: z.enum(palettes),
    duration: z
      .number()
      .finite()
      .min(1 / 30)
      .max(1800),
    transition: z.number().finite().min(0).max(1800),
    transitionEasing: z.enum(transitionEasings).optional(),
    scale: z.number().finite().positive(),
    altitude: z.number().finite(),
    droneEdits: droneEditsSchema.optional(),
    benchCue: benchCueSchema.nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((c) => c.transition <= c.duration, { message: 'Transition must fit inside the cue.' });
export const projectSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1).max(100),
    revision: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(80),
    droneCount: z.number().int().min(1).max(100_000),
    bpm: z.number().finite().min(40).max(220),
    cues: z.array(cueSchema).min(1).max(512),
    limits: z.object({
      minimumSeparation: z.number().finite().min(0.5).max(20),
      maxSpeed: z.number().finite().positive().max(30),
      maxAcceleration: z.number().finite().positive().max(30),
      maxAltitude: z.number().finite().positive().max(500),
      radius: z.number().finite().positive().max(1000),
    }),
  })
  .superRefine((p, ctx) => {
    if (new Set(p.cues.map((c) => c.id)).size !== p.cues.length)
      ctx.addIssue({ code: 'custom', message: 'Cue IDs must be unique.' });
    if (p.cues.reduce((sum, c) => sum + c.duration, 0) > 1800)
      ctx.addIssue({ code: 'custom', message: 'Shows are limited to 30 minutes.' });
  });
export type Cue = z.infer<typeof cueSchema>;
export type Project = z.infer<typeof projectSchema>;
export const defaultProject: Project = {
  version: 1,
  id: 'midnight-bloom',
  revision: 0,
  name: 'Midnight bloom',
  droneCount: 800,
  bpm: 120,
  limits: { minimumSeparation: 2, maxSpeed: 8, maxAcceleration: 4, maxAltitude: 120, radius: 160 },
  cues: [
    {
      id: 'first-light',
      name: 'First light',
      shape: 'grid',
      palette: 'moonlight',
      duration: 16,
      transition: 12,
      scale: 74,
      altitude: 60,
    },
    {
      id: 'in-orbit',
      name: 'In orbit',
      shape: 'orbit',
      palette: 'aurora',
      duration: 24,
      transition: 16,
      scale: 76,
      altitude: 64,
    },
    {
      id: 'superbloom',
      name: 'Superbloom',
      shape: 'bloom',
      palette: 'rose',
      duration: 24,
      transition: 16,
      scale: 66,
      altitude: 68,
    },
    {
      id: 'the-current',
      name: 'The current',
      shape: 'wave',
      palette: 'ocean',
      duration: 24,
      transition: 16,
      scale: 80,
      altitude: 64,
    },
    {
      id: 'together',
      name: 'Together',
      shape: 'heart',
      palette: 'rose',
      duration: 24,
      transition: 16,
      scale: 65,
      altitude: 66,
    },
    {
      id: 'afterglow',
      name: 'Afterglow',
      shape: 'sphere',
      palette: 'ember',
      duration: 16,
      transition: 14,
      scale: 60,
      altitude: 64,
    },
  ],
};
export function totalDuration(project: Project) {
  return project.cues.reduce((n, cue) => n + cue.duration, 0);
}
export function cueStart(project: Project, id: string) {
  let t = 0;
  for (const cue of project.cues) {
    if (cue.id === id) return t;
    t += cue.duration;
  }
  return 0;
}
export function formatTime(seconds: number, decimals = false) {
  const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(s % 60)
    .toString()
    .padStart(2, '0')}${decimals ? '.' + Math.floor((s % 1) * 10) : ''}`;
}
export const smooth = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
};
/** Incoming scene blend; omitted profiles retain the original minimum-jerk curve. */
export function transitionEase(t: number, profile: TransitionEasing = 'smooth') {
  const x = Math.max(0, Math.min(1, t));
  if (profile === 'linear') return x;
  if (profile === 'ease-in') return x ** 3;
  if (profile === 'ease-out') return 1 - (1 - x) ** 3;
  return smooth(x);
}
export const transitionPeakSlope: Record<TransitionEasing, number> = {
  smooth: 1.875,
  linear: 1,
  'ease-in': 3,
  'ease-out': 3,
};
export function frameAt(project: Project, time: number) {
  let start = 0;
  const t = Math.max(0, Math.min(totalDuration(project), time));
  for (let i = 0; i < project.cues.length; i++) {
    const cue = project.cues[i];
    if (t < start + cue.duration || i === project.cues.length - 1)
      return {
        cue,
        previous: project.cues[Math.max(0, i - 1)],
        index: i,
        start,
        progress:
          // Compare in show time before subtraction: e.g. 30.4 - 24 is slightly below 6.4.
          i === 0 || cue.transition === 0 || t >= start + cue.transition
            ? 1
            : transitionEase((t - start) / cue.transition, cue.transitionEasing),
      };
    start += cue.duration;
  }
  throw new Error('Project must contain a cue.');
}
