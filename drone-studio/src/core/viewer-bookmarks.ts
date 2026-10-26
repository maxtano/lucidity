import { z } from 'zod';
import { normalizeViewerSnapshot, type ViewerBookmark, type ViewerSnapshot } from './viewer';
export type { ViewerBookmark } from './viewer';

export const MAX_VIEWER_BOOKMARKS = 12;
export const MAX_VIEWER_BOOKMARK_BYTES = 64_000;
const prefix = 'lucidity.viewer.bookmarks.v1:';
const encoder = new TextEncoder();

const finite = z.number().finite();
const snapshotSchema = z
  .object({
    pose: z
      .object({
        east: finite,
        north: finite,
        eyeHeight: finite,
        yaw: finite,
        pitch: finite,
        fov: finite,
      })
      .strict(),
    venue: z.object({ east: finite, north: finite, heading: finite }).strict(),
  })
  .strict();
const bookmarkSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(80)
      .refine((id) => id === id.trim(), 'Bookmark IDs cannot have surrounding whitespace.'),
    name: z.string().trim().min(1).max(48),
    snapshot: snapshotSchema,
  })
  .strict();
const bookmarksSchema = z
  .array(bookmarkSchema)
  .max(MAX_VIEWER_BOOKMARKS)
  .superRefine((bookmarks, context) => {
    if (new Set(bookmarks.map((bookmark) => bookmark.id)).size !== bookmarks.length)
      context.addIssue({ code: 'custom', message: 'Bookmark IDs must be unique.' });
  });
const envelopeSchema = z
  .object({
    format: z.literal('lucidity.viewer-bookmarks'),
    version: z.literal(1),
    projectId: z.string().min(1).max(100),
    bookmarks: bookmarksSchema,
  })
  .strict();

function bookmarkKey(projectId: string) {
  if (typeof projectId !== 'string' || !projectId.length || projectId.length > 100)
    throw new Error('Choose a valid project before accessing viewer bookmarks.');
  try {
    return prefix + encodeURIComponent(projectId);
  } catch {
    throw new Error('This project ID cannot be used for viewer bookmark storage.');
  }
}
function checkSize(text: string) {
  if (
    typeof text !== 'string' ||
    text.length > MAX_VIEWER_BOOKMARK_BYTES ||
    encoder.encode(text).byteLength > MAX_VIEWER_BOOKMARK_BYTES
  )
    throw new Error(
      'Saved viewer bookmarks exceed the 64 KB storage limit. Existing data was kept.'
    );
}
function sameSnapshot(a: ViewerSnapshot, b: ViewerSnapshot) {
  return (
    (Object.keys(a.pose) as (keyof ViewerSnapshot['pose'])[]).every(
      (key) => a.pose[key] === b.pose[key]
    ) &&
    (Object.keys(a.venue) as (keyof ViewerSnapshot['venue'])[]).every(
      (key) => a.venue[key] === b.venue[key]
    )
  );
}
function validationMessage(error: unknown): string {
  return error instanceof z.ZodError
    ? error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || 'bookmarks'}: ${issue.message}`)
        .join('; ')
    : 'Invalid bookmark content.';
}

/** Read only: malformed saved content is reported, never replaced with an empty saved list. */
export function loadViewerBookmarks(
  storage: Pick<Storage, 'getItem'>,
  projectId: string
): ViewerBookmark[] {
  const key = bookmarkKey(projectId);
  let text: string | null;
  try {
    text = storage.getItem(key);
  } catch {
    throw new Error('Viewer bookmark storage is unavailable in this browser.');
  }
  if (text === null) return [];
  checkSize(text);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Saved viewer bookmarks contain invalid JSON. Existing data was kept.');
  }
  let envelope: z.infer<typeof envelopeSchema>;
  try {
    envelope = envelopeSchema.parse(raw);
  } catch (error) {
    throw new Error(
      `Saved viewer bookmarks are invalid. ${validationMessage(error)} Existing data was kept.`
    );
  }
  if (envelope.projectId !== projectId)
    throw new Error(
      'Saved viewer bookmarks belong to a different project. Existing data was kept.'
    );
  return envelope.bookmarks.map((bookmark, index) => {
    const snapshot = normalizeViewerSnapshot(bookmark.snapshot);
    const rawName = (raw as { bookmarks: { name: string }[] }).bookmarks[index].name;
    if (rawName !== bookmark.name || !sameSnapshot(snapshot, bookmark.snapshot))
      throw new Error(
        'Saved viewer bookmarks contain noncanonical or out-of-range values. Existing data was kept.'
      );
    return { id: bookmark.id, name: bookmark.name, snapshot };
  });
}

/** Explicit atomic save. Validation occurs before setItem; callers retain their original objects. */
export function saveViewerBookmarks(
  storage: Pick<Storage, 'setItem'>,
  projectId: string,
  bookmarks: ViewerBookmark[]
): void {
  const key = bookmarkKey(projectId);
  if (!Array.isArray(bookmarks) || bookmarks.length > MAX_VIEWER_BOOKMARKS)
    throw new Error('Viewer bookmarks cannot be saved. Keep at most 12 bookmarks per project.');
  let parsed: ViewerBookmark[];
  try {
    parsed = bookmarksSchema.parse(bookmarks);
  } catch (error) {
    throw new Error(`Viewer bookmarks cannot be saved. ${validationMessage(error)}`);
  }
  const text = JSON.stringify({
    format: 'lucidity.viewer-bookmarks',
    version: 1,
    projectId,
    bookmarks: parsed.map((bookmark) => ({
      ...bookmark,
      snapshot: normalizeViewerSnapshot(bookmark.snapshot),
    })),
  });
  checkSize(text);
  try {
    storage.setItem(key, text);
  } catch {
    throw new Error(
      'Could not save viewer bookmarks. Browser storage may be full or unavailable; previous bookmarks were kept.'
    );
  }
}
