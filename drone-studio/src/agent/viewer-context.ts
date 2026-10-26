import { z } from 'zod';
import type { AgentViewerContext } from './types';

const coordinate = z.number().finite().min(-500).max(500);
const heading = z.number().finite().min(0).lt(360);
const snapshotSchema = z
  .object({
    pose: z
      .object({
        east: coordinate,
        north: coordinate,
        eyeHeight: z.number().finite().min(0.5).max(5),
        yaw: heading,
        pitch: z.number().finite().min(-20).max(89),
        fov: z.number().finite().min(45).max(100),
      })
      .strict(),
    venue: z.object({ east: coordinate, north: coordinate, heading }).strict(),
  })
  .strict();
const canonicalText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim(), 'Use trimmed text.');

/** Reject malformed or noncanonical captured context. Do not silently change the camera. */
export const agentViewerContextSchema = z
  .object({
    current: z
      .object({ snapshot: snapshotSchema, aspect: z.number().finite().gt(0).max(100) })
      .strict(),
    savedViews: z
      .array(
        z
          .object({ id: canonicalText(80), name: canonicalText(48), snapshot: snapshotSchema })
          .strict()
      )
      .max(12)
      .superRefine((views, context) => {
        if (new Set(views.map((view) => view.id)).size !== views.length)
          context.addIssue({ code: 'custom', message: 'Saved view IDs must be unique.' });
      }),
  })
  .strict();

/** Zod builds owned nested objects, preserving exact canonical fractional angles. */
export function parseAgentViewerContext(input: unknown): AgentViewerContext {
  return agentViewerContextSchema.parse(input);
}

export function summarizeViewerContext(viewer: AgentViewerContext | undefined) {
  if (!viewer)
    return {
      available: false,
      reason:
        'No audience viewpoint was captured for this run. inspect_viewpoint needs viewer context.',
    };
  return {
    available: true,
    current: { viewId: '', name: 'Captured current viewpoint', ...structuredClone(viewer.current) },
    savedViews: viewer.savedViews.map(({ id, name, snapshot }) => ({
      viewId: id,
      name,
      snapshot: structuredClone(snapshot),
    })),
    note: 'All inspections use the captured current viewport aspect. Saved viewpoints keep their own pose and venue. Context is fixed for this run; show frames reflect the current private draft.',
  };
}
