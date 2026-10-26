import { z } from 'zod';
import { keyframeAt } from './keyframes';
import { transformDrones } from './transforms';
import {
  projectSchema,
  cueSchema,
  benchCueSchema,
  droneEditSchema,
  droneEditsSchema,
  keyframeSchema,
  vectorSchema,
  shapes,
  palettes,
  transitionEasings,
  shapeNames,
  type Project,
  type Cue,
  type Shape,
  type Palette,
} from './model';

export const operationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set_fleet'), count: z.number().int().min(1).max(100_000) }),
  z.object({ type: z.literal('set_tempo'), bpm: z.number().min(40).max(220) }),
  z.object({ type: z.literal('rename'), name: z.string().trim().min(1).max(80) }),
  z.object({ type: z.literal('replace_cues'), cues: z.array(cueSchema).min(1).max(512) }),
  z.object({ type: z.literal('add_cue'), cue: cueSchema }),
  z.object({
    type: z.literal('update_cue'),
    id: z.string(),
    patch: z
      .object({
        name: z.string().optional(),
        shape: z.enum(shapes).optional(),
        palette: z.enum(palettes).optional(),
        duration: z.number().optional(),
        transition: z.number().optional(),
        transitionEasing: z.enum(transitionEasings).optional(),
        scale: z.number().optional(),
        altitude: z.number().optional(),
        droneEdits: droneEditsSchema.optional(),
        benchCue: benchCueSchema.nullable().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  }),
  z.object({ type: z.literal('remove_cue'), id: z.string() }),
  z.object({ type: z.literal('move_cue'), id: z.string(), direction: z.enum(['up', 'down']) }),
  z.object({
    type: z.literal('retime_cue'),
    id: z.string(),
    speed: z.number().finite().positive(),
    scaleKeyframes: z.boolean().optional(),
    scaleTransition: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('transition_to_beats'),
    id: z.string(),
    beats: z.number().finite().min(0),
  }),
  z.object({
    type: z.literal('edit_drones'),
    cueId: z.string(),
    ids: z.array(z.number().int().min(1).max(100000)).min(1),
    patch: droneEditSchema,
  }),
  z.object({
    type: z.literal('set_keyframe'),
    cueId: z.string(),
    ids: z.array(z.number().int().min(1).max(100000)).min(1),
    keyframe: keyframeSchema,
  }),
  z.object({
    type: z.literal('remove_keyframe'),
    cueId: z.string(),
    ids: z.array(z.number().int().min(1).max(100000)).min(1),
    time: z.number().finite(),
  }),
  z.object({
    type: z.literal('move_keyframe'),
    cueId: z.string(),
    droneId: z.number().int().min(1).max(100000),
    from: z.number().finite(),
    to: z.number().finite().min(0).max(1800),
  }),
  z.object({
    type: z.literal('reset_drones'),
    cueId: z.string(),
    ids: z.array(z.number().int().min(1).max(100000)).min(1),
  }),
  z.object({
    type: z.literal('transform_drones'),
    cueId: z.string(),
    ids: z.array(z.number().int().min(1).max(100000)).min(1),
    translation: vectorSchema,
    pivot: vectorSchema.optional(),
    scale: vectorSchema.optional(),
    rotation: z
      .object({
        axis: vectorSchema.refine(
          (axis) => axis.some((value) => value !== 0),
          'Rotation axis must be nonzero.'
        ),
        angleDegrees: z.number().finite(),
      })
      .strict()
      .optional(),
    scope: z.enum(['base_and_keys', 'key_at_time']),
    time: z.number().finite().min(0).max(1800).optional(),
  }),
]);
export type Operation = z.infer<typeof operationSchema>;

/** Correct only floating-point roundoff at a known bound, never a substantive timing overshoot. */
function timingRoundoff(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return value;
  const close = (bound: number) =>
    Math.abs(value - bound) <= Number.EPSILON * 8 * Math.max(1, Math.abs(value), Math.abs(bound));
  if (value < minimum && close(minimum)) return minimum;
  if (value > maximum && close(maximum)) return maximum;
  return value;
}

export function applyOperations(
  input: Project,
  operations: unknown[],
  expectedRevision = input.revision
): Project {
  let project = structuredClone(projectSchema.parse(input));
  if (project.revision !== expectedRevision)
    throw new Error('This proposal is out of date. Generate it again against the current project.');
  const parsed = operations.map((op) => operationSchema.parse(op));
  for (const op of parsed) {
    switch (op.type) {
      case 'set_fleet':
        project.droneCount = op.count;
        break;
      case 'set_tempo':
        project.bpm = op.bpm;
        break;
      case 'rename':
        project.name = op.name;
        break;
      case 'replace_cues':
        project.cues = op.cues;
        break;
      case 'add_cue':
        project.cues.push(op.cue);
        break;
      case 'update_cue': {
        const cue = project.cues.find((c) => c.id === op.id);
        if (!cue) throw new Error('Cue not found.');
        Object.assign(cue, op.patch);
        break;
      }
      case 'retime_cue': {
        const cue = project.cues.find((c) => c.id === op.id);
        if (!cue) throw new Error('Cue not found.');
        cue.duration = timingRoundoff(cue.duration / op.speed, 1 / 30, 1800);
        if (cue.benchCue)
          cue.benchCue.offset = timingRoundoff(cue.benchCue.offset / op.speed, 0, 1800);
        if (op.scaleTransition !== false)
          cue.transition = timingRoundoff(cue.transition / op.speed, 0, cue.duration);
        if (op.scaleKeyframes !== false)
          for (const edit of Object.values(cue.droneEdits || {}))
            for (const keyframe of edit.keyframes || [])
              keyframe.time = timingRoundoff(keyframe.time / op.speed, 0, 1800);
        break;
      }
      case 'transition_to_beats': {
        const cue = project.cues.find((c) => c.id === op.id);
        if (!cue) throw new Error('Cue not found.');
        cue.transition = timingRoundoff((op.beats * 60) / project.bpm, 0, cue.duration);
        break;
      }
      case 'remove_cue': {
        if (!project.cues.some((c) => c.id === op.id)) throw new Error('Cue not found.');
        project.cues = project.cues.filter((c) => c.id !== op.id);
        break;
      }
      case 'move_cue': {
        const i = project.cues.findIndex((c) => c.id === op.id);
        if (i < 0) throw new Error('Cue not found.');
        const next = Math.max(
          0,
          Math.min(project.cues.length - 1, i + (op.direction === 'up' ? -1 : 1))
        );
        [project.cues[i], project.cues[next]] = [project.cues[next], project.cues[i]];
        break;
      }
      case 'move_keyframe': {
        const cue = project.cues.find((c) => c.id === op.cueId);
        const frames = cue?.droneEdits?.[op.droneId]?.keyframes;
        const key = frames && keyframeAt(frames, op.from);
        if (!frames || !key) throw new Error('Keyframe not found.');
        if (key.time === op.to) break;
        if (frames.some((k) => k !== key && Math.abs(k.time - op.to) < 1e-6))
          throw new Error('A keyframe already exists at that time.');
        key.time = op.to;
        frames.sort((a, b) => a.time - b.time);
        break;
      }
      case 'transform_drones': {
        const cue = project.cues.find((c) => c.id === op.cueId);
        if (!cue) throw new Error('Cue not found.');
        transformDrones(project, cue, op);
        break;
      }
      case 'edit_drones':
      case 'set_keyframe':
      case 'remove_keyframe':
      case 'reset_drones': {
        const cue = project.cues.find((c) => c.id === op.cueId);
        if (!cue) throw new Error('Cue not found.');
        cue.droneEdits ||= {};
        for (const id of new Set(op.ids)) {
          const current = cue.droneEdits[id] || {};
          if (op.type === 'reset_drones') {
            delete cue.droneEdits[id];
            continue;
          }
          if (op.type === 'edit_drones') cue.droneEdits[id] = { ...current, ...op.patch };
          if (op.type === 'set_keyframe') {
            const frames = current.keyframes || [];
            const existing = keyframeAt(frames, op.keyframe.time);
            const keyframe = { ...existing, ...op.keyframe };
            cue.droneEdits[id] = {
              ...current,
              keyframes: [...frames.filter((k) => k !== existing), keyframe].sort(
                (a, b) => a.time - b.time
              ),
            };
          }
          if (op.type === 'remove_keyframe') {
            const frames = current.keyframes || [];
            const existing = keyframeAt(frames, op.time);
            cue.droneEdits[id] = {
              ...current,
              keyframes: frames.filter((key) => key !== existing),
            };
          }
        }
        break;
      }
    }
  }
  project.revision++;
  project = projectSchema.parse(project);
  return project;
}
export type Proposal = {
  title: string;
  description: string;
  changes: string[];
  operations: Operation[];
  revision: number;
};

/** Offline, deterministic brief interpreter. It never represents itself as a language model. */
export function propose(brief: string, project: Project): Proposal {
  const text = brief.trim().toLowerCase();
  if (!text) throw new Error('Describe the show you have in mind.');
  const operations: Operation[] = [],
    changes: string[] = [];
  const count = text.match(/\b([\d,]+)\s*drones?\b/);
  if (count) {
    const n = Number(count[1].replaceAll(',', ''));
    operations.push(operationSchema.parse({ type: 'set_fleet', count: n }));
    changes.push(`Set the fleet to ${n.toLocaleString()} drones`);
  }
  const bpm = text.match(/\b(\d+)\s*bpm\b/);
  if (bpm) {
    operations.push(operationSchema.parse({ type: 'set_tempo', bpm: Number(bpm[1]) }));
    changes.push(`Set the beat grid to ${bpm[1]} BPM`);
  }
  let palette: Palette | undefined;
  if (/warm|sunset|gold|amber|ember/.test(text)) palette = 'ember';
  else if (/pink|romantic|rose/.test(text)) palette = 'rose';
  else if (/ocean|blue|teal/.test(text)) palette = 'ocean';
  else if (/moon|white|ice/.test(text)) palette = 'moonlight';
  else if (/aurora|purple|cosmic/.test(text)) palette = 'aurora';
  const requested: Shape[] = [];
  const aliases: [RegExp, Shape][] = [
    [/orbit|rings?/, 'orbit'],
    [/sphere|globe/, 'sphere'],
    [/helix|spiral/, 'helix'],
    [/heart/, 'heart'],
    [/wave|ocean/, 'wave'],
    [/bloom|flower/, 'bloom'],
    [/grid|field/, 'grid'],
  ];
  const matches = aliases
    .map(([regex, shape]) => ({ shape, position: text.search(regex) }))
    .filter((m) => m.position >= 0)
    .sort((a, b) => a.position - b.position);
  for (const match of matches) requested.push(match.shape);
  const create = /create|build|design|make.*show|generate/.test(text) || requested.length > 1;
  if (create) {
    const sequence: Shape[] =
      requested.length > 1
        ? requested
        : ['grid', requested[0] || 'orbit', 'bloom', 'wave', 'heart', 'sphere'];
    const durationMatch = text.match(/\b(\d+)\s*(?:second|sec|s\b)/);
    const duration = durationMatch
      ? Math.max(4, Math.min(120, Number(durationMatch[1]) / sequence.length))
      : 16;
    const cues: Cue[] = sequence.map((shape, i) => ({
      id: `draft-${project.revision}-${i}`,
      name: shapeNames[shape],
      shape,
      palette: palette || (i % 2 ? 'aurora' : 'moonlight'),
      duration,
      transition: Math.min(duration, duration * 0.75),
      scale: 72,
      altitude: 66,
    }));
    operations.push({ type: 'replace_cues', cues });
    changes.push(
      `Compose ${cues.length} scenes · ${Math.round(cues.length * duration)} seconds`,
      `Sequence: ${sequence.map((s) => shapeNames[s]).join(' → ')}`
    );
  } else if (requested.length === 1 && /add|append/.test(text)) {
    const shape = requested[0];
    operations.push({
      type: 'add_cue',
      cue: {
        id: `cue-${project.revision}-${project.cues.length}`,
        name: shapeNames[shape],
        shape,
        palette: palette || 'aurora',
        duration: 16,
        transition: 12,
        scale: 72,
        altitude: 66,
      },
    });
    changes.push(`Add ${shapeNames[shape]} to the end`);
  } else {
    if (palette) {
      for (const cue of project.cues)
        operations.push({ type: 'update_cue', id: cue.id, patch: { palette } });
      changes.push(`Use the ${palette} palette throughout`);
    }
    if (/slower|slow down|more time|longer/.test(text)) {
      for (const cue of project.cues)
        operations.push({
          type: 'retime_cue',
          id: cue.id,
          speed: 1 / 1.5,
        });
      changes.push('Give every scene, transition, and animation key 50% more time');
    }
  }
  if (!operations.length)
    throw new Error(
      'Try “Create a 96 second cosmic show”, “Add a heart”, “Make it warmer”, “Slow down”, or “Use 1,200 drones”. The brief parser supports these patterns.'
    );
  applyOperations(project, operations);
  return {
    title: create ? 'A new story for the sky' : 'A little closer to your vision',
    description: create
      ? 'A complete sequence, ready for your creative direction.'
      : 'Here’s the edit I’ve prepared for your show.',
    changes,
    operations,
    revision: project.revision,
  };
}
