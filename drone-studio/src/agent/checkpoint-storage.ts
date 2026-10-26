/** Storage only. Checkpoint parsing, base fingerprint checks, and fresh review happen separately. */
export type CheckpointStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const localCheckpointByteLimit = 1_000_000;
const checkpointPrefix = 'lucidity.agent.checkpoint.v1:';
const encoder = new TextEncoder();

function checkpointKey(projectId: string) {
  if (typeof projectId !== 'string' || projectId.length === 0)
    throw new Error('Choose a project before accessing its saved draft.');
  try {
    return checkpointPrefix + encodeURIComponent(projectId);
  } catch {
    throw new Error('This project ID cannot be used for local draft storage.');
  }
}

function checkSize(text: string) {
  if (typeof text !== 'string') throw new Error('The saved draft must contain text.');
  if (encoder.encode(text).byteLength > localCheckpointByteLimit)
    throw new Error('This draft exceeds the 1 MB local recovery limit. Use a draft file instead.');
}

/** Reads exactly one project slot. Does not inspect or change the saved show or other drafts. */
export function readCheckpointText(storage: CheckpointStorage, projectId: string): string | null {
  const key = checkpointKey(projectId);
  let text: string | null;
  try {
    text = storage.getItem(key);
  } catch {
    throw new Error('Local draft storage is unavailable in this browser.');
  }
  if (text !== null) checkSize(text);
  return text;
}

/** An explicit save uses one atomic setItem; never remove the old slot before a replacement. */
export function writeCheckpointText(
  storage: CheckpointStorage,
  projectId: string,
  serialized: string
): void {
  const key = checkpointKey(projectId);
  checkSize(serialized);
  try {
    storage.setItem(key, serialized);
  } catch {
    throw new Error(
      'Could not save the draft locally. Browser storage may be full or unavailable; the previous saved draft was kept.'
    );
  }
}

/** Explicit removal only. Applying an edit does not automatically erase a recovery checkpoint. */
export function removeCheckpointText(storage: CheckpointStorage, projectId: string): void {
  const key = checkpointKey(projectId);
  try {
    storage.removeItem(key);
  } catch {
    throw new Error('Could not remove the saved draft. Local storage is unavailable.');
  }
}
