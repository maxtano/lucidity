import { totalDuration, type Project } from '../core/model';
import { validateDraftAuditionRange, type DraftAuditionRange } from './draft-preview-playback';

function intervals(project: Project, sceneId: string) {
  let start = 0;
  for (let index = 0; index < project.cues.length; index++) {
    const cue = project.cues[index];
    if (cue.id === sceneId) {
      return {
        scene: { start, end: start + cue.duration },
        transition: index > 0 && cue.transition > 0 ? { start, end: start + cue.transition } : null,
      };
    }
    start += cue.duration;
  }
  return { scene: null, transition: null };
}

/** Enclose the selected scene's actual intervals on the shared, unscaled show clock. */
export function draftAuditionPresets(base: Project, draft: Project, sceneId: string) {
  const before = intervals(base, sceneId);
  const after = intervals(draft, sceneId);
  const duration = Math.max(totalDuration(base), totalDuration(draft));
  const enclose = (a: DraftAuditionRange | null, b: DraftAuditionRange | null) => {
    if (!a && !b) return null;
    return validateDraftAuditionRange(
      {
        start: Math.min(a?.start ?? Infinity, b?.start ?? Infinity),
        end: Math.max(a?.end ?? -Infinity, b?.end ?? -Infinity),
      },
      duration
    );
  };
  return {
    scene: enclose(before.scene, after.scene),
    // A first scene or a cut has no incoming blend interval to audition.
    transition: enclose(before.transition, after.transition),
  };
}
