import { operationSchema, type Operation } from '../core/commands';
import { frameAt, type Project } from '../core/model';

/** Minimal renderer target; contains only IDs active in this exact document version. */
export type DraftPreviewDroneTarget = {
  readonly projectId: string;
  readonly revision: number;
  readonly droneCount: number;
  readonly ids: readonly number[];
};
export type DraftPreviewSceneTargets = {
  readonly cueId: string;
  readonly nameBefore: string | null;
  readonly nameAfter: string | null;
  /** Explicit command membership, including IDs dormant in both versions. */
  readonly ids: readonly number[];
  readonly perDroneOperations: number;
  readonly base: DraftPreviewDroneTarget;
  readonly draft: DraftPreviewDroneTarget;
};
export type DraftPreviewDroneTargets = {
  /** Complete explicit union, including IDs dormant in either or both versions. */
  readonly ids: readonly number[];
  /** Counts command records, including no-ops; these are not measured visual differences. */
  readonly perDroneOperations: number;
  readonly otherOperations: number;
  readonly base: DraftPreviewDroneTarget;
  readonly draft: DraftPreviewDroneTarget;
  /** First explicit command order; scene/global commands do not create scopes. */
  readonly scenes: readonly DraftPreviewSceneTargets[];
};

export type DraftTargetSceneFrame = {
  readonly role: 'current' | 'incoming-source' | 'outside-frame' | 'absent';
  readonly currentSceneName: string;
  readonly transitionSourceName: string | null;
};

function assertDocument(project: Project) {
  if (
    typeof project.id !== 'string' ||
    !project.id.length ||
    project.id.length > 100 ||
    !Number.isSafeInteger(project.revision) ||
    project.revision < 0 ||
    !Number.isInteger(project.droneCount) ||
    project.droneCount < 1 ||
    project.droneCount > 100_000
  )
    throw new Error('Draft target overlays require a valid project identity, revision, and fleet.');
}

/** Read only scene headers; authored drone records are never scanned for target IDs. */
function sceneNames(project: Project): Map<string, string> {
  if (!Array.isArray(project.cues) || !project.cues.length || project.cues.length > 512)
    throw new Error('Draft target overlays require between 1 and 512 scenes.');
  const names = new Map<string, string>();
  for (const cue of project.cues) {
    if (
      !cue ||
      typeof cue.id !== 'string' ||
      !cue.id.length ||
      cue.id.length > 100 ||
      names.has(cue.id) ||
      typeof cue.name !== 'string' ||
      !cue.name.trim().length ||
      cue.name.length > 60
    )
      throw new Error('Draft target overlays require unique scene IDs and valid scene names.');
    names.set(cue.id, cue.name);
  }
  return names;
}

function activeTarget(project: Project, ids: readonly number[]): DraftPreviewDroneTarget {
  return Object.freeze({
    projectId: project.id,
    revision: project.revision,
    droneCount: project.droneCount,
    ids: Object.freeze(ids.filter((id) => id <= project.droneCount)),
  });
}

/**
 * Capture explicit command targets once after the proposal has applied successfully.
 * Six granular command families identify drones directly. Scene/global commands are
 * counted but never expanded into inferred targets, even if they contain drone records.
 * No-op commands and later scene removal do not erase an explicitly named target.
 */
export function buildDraftPreviewTargets(
  base: Project,
  draft: Project,
  operations: readonly Operation[]
): DraftPreviewDroneTargets {
  assertDocument(base);
  assertDocument(draft);
  if (draft.id !== base.id || draft.revision !== base.revision + 1)
    throw new Error(
      'Draft target overlays require matching project IDs and the next draft revision.'
    );
  if (!Array.isArray(operations) || operations.length > 128)
    throw new Error('Draft target overlays accept at most 128 proposal commands.');
  const namesBefore = sceneNames(base),
    namesAfter = sceneNames(draft);
  const targets = new Set<number>();
  const scenes = new Map<string, { ids: Set<number>; perDroneOperations: number }>();
  let perDroneOperations = 0,
    otherOperations = 0;
  const include = (cueId: string, ids: readonly number[]) => {
    let scene = scenes.get(cueId);
    if (!scene) {
      scene = { ids: new Set(), perDroneOperations: 0 };
      scenes.set(cueId, scene);
    }
    perDroneOperations++;
    scene.perDroneOperations++;
    for (const id of ids) {
      targets.add(id);
      scene.ids.add(id);
    }
  };
  for (const input of operations) {
    // Derive from the authoritative schema rather than treating arbitrary `ids` fields
    // as targeting information. No caller-owned command or array is retained.
    const operation = operationSchema.parse(input);
    switch (operation.type) {
      case 'edit_drones':
      case 'transform_drones':
      case 'set_keyframe':
      case 'remove_keyframe':
      case 'reset_drones':
        include(operation.cueId, operation.ids);
        break;
      case 'move_keyframe':
        include(operation.cueId, [operation.droneId]);
        break;
      default:
        otherOperations++;
    }
  }
  const ids = Object.freeze([...targets].sort((a, b) => a - b));
  return Object.freeze({
    ids,
    perDroneOperations,
    otherOperations,
    base: activeTarget(base, ids),
    draft: activeTarget(draft, ids),
    scenes: Object.freeze(
      [...scenes].map(([cueId, scene]) => {
        const sceneIds = Object.freeze([...scene.ids].sort((a, b) => a - b));
        return Object.freeze({
          cueId,
          nameBefore: namesBefore.get(cueId) ?? null,
          nameAfter: namesAfter.get(cueId) ?? null,
          ids: sceneIds,
          perDroneOperations: scene.perDroneOperations,
          base: activeTarget(base, sceneIds),
          draft: activeTarget(draft, sceneIds),
        });
      })
    ),
  });
}

/**
 * Describe scene timing independently of explicit target membership. An active ID
 * still has a current position even when its command's scene is absent or elsewhere.
 * This relation makes no claim that an operation changes the rendered image.
 */
export function describeDraftTargetSceneFrame(
  project: Project,
  time: number,
  cueId: string
): DraftTargetSceneFrame {
  if (!Number.isFinite(time) || typeof cueId !== 'string' || !cueId.length || cueId.length > 100)
    throw new Error('Scene frame descriptions require a finite time and a valid scene ID.');
  const names = sceneNames(project);
  let duration = 0;
  for (const cue of project.cues) {
    if (
      !Number.isFinite(cue.duration) ||
      cue.duration < 1 / 30 ||
      cue.duration > 1800 ||
      !Number.isFinite(cue.transition) ||
      cue.transition < 0 ||
      cue.transition > cue.duration
    )
      throw new Error('Scene frame descriptions require valid scene durations and transitions.');
    duration += cue.duration;
  }
  if (duration > 1800)
    throw new Error('Scene frame descriptions require a show no longer than 30 minutes.');
  const frame = frameAt(project, time);
  const source = frame.index > 0 && frame.progress < 1 ? frame.previous : null;
  return Object.freeze({
    role: !names.has(cueId)
      ? 'absent'
      : frame.cue.id === cueId
        ? 'current'
        : source?.id === cueId
          ? 'incoming-source'
          : 'outside-frame',
    currentSceneName: frame.cue.name,
    transitionSourceName: source?.name ?? null,
  });
}
