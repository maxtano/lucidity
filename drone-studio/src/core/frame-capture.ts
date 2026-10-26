import { z } from 'zod';
import { agentViewerContextSchema } from '../agent/viewer-context';
import { frameAt, type Project } from './model';
import type { ViewerSnapshot } from './viewer';
import { isAudienceFrameAspect } from './viewer-frame';

export const MAX_CAPTURE_PIXELS = 16_000_000;
export const MAX_CAPTURE_PNG_BYTES = 32 * 1024 * 1024;
export const DEFAULT_FRAME_CAPTURE_TIMEOUT_MS = 10_000;

export type CaptureMetadata = {
  format: 'lucidity.audience-frame';
  schemaVersion: 1;
  project: { id: string; name: string; revision: number };
  version: 'base' | 'draft';
  sharedTime: number;
  sampledTime: number;
  held: boolean;
  scene: { id: string; name: string; index: number; localTime: number };
  droneCount: number;
  viewer: ViewerSnapshot;
  aspect: number;
  framing: 'captured' | 'viewport';
  raster: { width: number; height: number };
  appearance: { glow: number; exposure: number };
  createdAt: string;
};
export type FrameCaptureMetadata = CaptureMetadata;
export type CapturedAudienceFrame = { blob: Blob; metadata: CaptureMetadata };
export type CaptureMetadataInput = {
  project: Project;
  version: 'base' | 'draft';
  sharedTime: number;
  sampledTime: number;
  viewer: ViewerSnapshot;
  aspect: number;
  framing: 'captured' | 'viewport';
  raster: { width: number; height: number };
  appearance: { glow: number; exposure: number };
  createdAt?: string;
};

const name = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => value === value.trim());
const identity = z.string().min(1).max(100);
const sceneSchema = z.object({ id: identity, name, duration: z.number().finite().positive() });
const projectCaptureSchema = z.object({
  id: identity,
  name,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  droneCount: z.number().int().min(1).max(100_000),
  cues: z.array(sceneSchema).min(1).max(512),
});
const inputSchema = z.object({
  version: z.enum(['base', 'draft']),
  sharedTime: z.number().finite().min(0).max(1800),
  sampledTime: z.number().finite().min(0).max(1800),
  viewer: agentViewerContextSchema.shape.current.shape.snapshot,
  aspect: z
    .number()
    .refine(isAudienceFrameAspect, 'Capture aspect must be supported by the audience renderer.'),
  framing: z.enum(['captured', 'viewport']),
  raster: z
    .object({
      width: z.number().int().min(1).max(MAX_CAPTURE_PIXELS),
      height: z.number().int().min(1).max(MAX_CAPTURE_PIXELS),
    })
    .strict()
    .refine(
      (value) => value.width * value.height <= MAX_CAPTURE_PIXELS,
      'Capture exceeds the 16-megapixel limit.'
    ),
  appearance: z
    .object({
      glow: z.number().finite().min(0).max(1.8),
      exposure: z.number().finite().min(0.5).max(2),
    })
    .strict(),
  createdAt: z
    .string()
    .max(40)
    .refine((value) => {
      const timestamp = new Date(value);
      return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
    }, 'Capture timestamp must be canonical ISO UTC text.'),
});

const metadataSchema = z
  .object({
    format: z.literal('lucidity.audience-frame'),
    schemaVersion: z.literal(1),
    project: projectCaptureSchema.pick({ id: true, name: true, revision: true }).strict(),
    version: inputSchema.shape.version,
    sharedTime: inputSchema.shape.sharedTime,
    sampledTime: inputSchema.shape.sampledTime,
    held: z.boolean(),
    scene: z
      .object({
        id: identity,
        name,
        index: z.number().int().min(0).max(511),
        localTime: z.number().finite().min(0).max(1800),
      })
      .strict(),
    droneCount: projectCaptureSchema.shape.droneCount,
    viewer: inputSchema.shape.viewer,
    aspect: inputSchema.shape.aspect,
    framing: inputSchema.shape.framing,
    raster: inputSchema.shape.raster,
    appearance: inputSchema.shape.appearance,
    createdAt: inputSchema.shape.createdAt,
  })
  .strict()
  .superRefine((metadata, context) => {
    if (
      metadata.sampledTime > metadata.sharedTime ||
      metadata.held !== metadata.sharedTime > metadata.sampledTime
    )
      context.addIssue({
        code: 'custom',
        message: 'Capture held status must match shared and sampled time.',
      });
    if (
      metadata.scene.localTime > metadata.sampledTime ||
      (metadata.scene.index === 0 && metadata.scene.localTime !== metadata.sampledTime) ||
      (metadata.scene.index > 0 && metadata.scene.localTime >= metadata.sampledTime)
    )
      context.addIssue({
        code: 'custom',
        message: 'Capture scene-local time is inconsistent with sampled time.',
      });
  });

/** Validate an imported record without trusting or normalizing any of its fields. */
export function parseCaptureMetadata(input: unknown): CaptureMetadata {
  return metadataSchema.parse(input);
}

/** Build owned capture metadata without copying/scanning authored drone/keyframe payloads. */
export function buildCaptureMetadata(input: CaptureMetadataInput): CaptureMetadata {
  const project = projectCaptureSchema.parse(input.project);
  if (new Set(project.cues.map((cue) => cue.id)).size !== project.cues.length)
    throw new Error('Capture project scene IDs must be unique.');
  const duration = project.cues.reduce((sum, cue) => sum + cue.duration, 0);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 1800)
    throw new Error('Capture project duration must be positive and at most 1800 seconds.');
  const data = inputSchema.parse({
    ...input,
    createdAt: input.createdAt === undefined ? new Date().toISOString() : input.createdAt,
  });
  if (data.sampledTime !== Math.min(data.sharedTime, duration))
    throw new Error(
      'Capture sampled time must equal the shared time, held at this document’s endpoint.'
    );
  const frame = frameAt(input.project, data.sampledTime);
  const scene = project.cues[frame.index];
  return parseCaptureMetadata({
    format: 'lucidity.audience-frame',
    schemaVersion: 1,
    project: { id: project.id, name: project.name, revision: project.revision },
    version: data.version,
    sharedTime: data.sharedTime,
    sampledTime: data.sampledTime,
    held: data.sharedTime > duration,
    scene: {
      id: scene.id,
      name: scene.name,
      index: frame.index,
      localTime: data.sampledTime === duration ? scene.duration : data.sampledTime - frame.start,
    },
    droneCount: project.droneCount,
    viewer: data.viewer,
    aspect: data.aspect,
    framing: data.framing,
    raster: data.raster,
    appearance: data.appearance,
    createdAt: data.createdAt,
  });
}

export type PngBlobSource = {
  toBlob(callback: (blob: Blob | null) => void, type?: string): void;
};

/**
 * Invoke the injected encoder synchronously; callers must render their fresh frame first.
 * Accept only a nonempty bounded PNG Blob with its PNG signature. No object URLs,
 * renderer imports, or pixel reads beyond the eight-byte signature are involved.
 */
export function encodeAudiencePng(
  source: PngBlobSource,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const { signal, timeoutMs = DEFAULT_FRAME_CAPTURE_TIMEOUT_MS } = options;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
      reject(new Error('PNG encoding timeout must be an integer from 1 to 60000 milliseconds.'));
      return;
    }
    let settled = false,
      received = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: unknown, blob?: Blob) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error !== undefined) reject(error);
      else resolve(blob!);
    };
    const abort = () => finish(new DOMException('Audience frame capture cancelled.', 'AbortError'));
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(
      () => finish(new DOMException('PNG encoding timed out.', 'TimeoutError')),
      timeoutMs
    );
    try {
      source.toBlob((blob) => {
        if (settled || received) return;
        received = true;
        try {
          if (!(blob instanceof Blob) || !blob.size)
            throw new Error('PNG encoder returned no image data.');
          if (blob.type !== 'image/png') throw new Error('PNG encoder returned a non-PNG image.');
          if (blob.size > MAX_CAPTURE_PNG_BYTES)
            throw new Error('PNG capture exceeds the 32 MiB limit.');
          void blob
            .slice(0, 8)
            .arrayBuffer()
            .then(
              (header) => {
                if (settled) return;
                const bytes = new Uint8Array(header);
                const signature = [137, 80, 78, 71, 13, 10, 26, 10];
                if (
                  bytes.length !== signature.length ||
                  signature.some((byte, index) => bytes[index] !== byte)
                )
                  finish(new Error('PNG encoder returned an invalid PNG signature.'));
                else finish(undefined, blob);
              },
              (error: unknown) => finish(error)
            );
        } catch (error) {
          finish(error);
        }
      }, 'image/png');
    } catch (error) {
      if (!received) finish(error);
    }
  });
}
