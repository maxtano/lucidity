import type { Project } from '../core/model';
import type { ViewerSnapshot } from '../core/viewer';

export type ReviewFrameIntent = {
  project: Project;
  version: 'base' | 'draft';
  sharedTime: number;
  sampledTime: number;
  initialSharedTime: number;
  initialSampledTime: number;
  viewer: ViewerSnapshot;
  aspect: number;
  framing: 'captured' | 'viewport';
  appearance: { glow: number; exposure: number };
};

type DisplayedFrame = {
  project: Project;
  version?: 'base' | 'draft';
  sharedTime?: number;
  sampledTime: number;
  playing: boolean;
  viewer?: ViewerSnapshot;
  aspect: number;
  framing: 'captured' | 'viewport';
  mode: 'audience' | 'design';
  available: boolean;
  appearance: { glow: number; exposure: number };
};

/** Only the pre-pause props may wait; never capture a different document, pose, or new seek. */
export function reviewFrameReadiness(
  intent: ReviewFrameIntent,
  current: DisplayedFrame
): 'ready' | 'waiting' | 'changed' {
  const viewer = current.viewer;
  if (
    current.project !== intent.project ||
    current.version !== intent.version ||
    current.mode !== 'audience' ||
    !current.available ||
    !viewer ||
    current.aspect !== intent.aspect ||
    current.framing !== intent.framing ||
    current.appearance.glow !== intent.appearance.glow ||
    current.appearance.exposure !== intent.appearance.exposure ||
    (['east', 'north', 'eyeHeight', 'yaw', 'pitch', 'fov'] as const).some(
      (key) => viewer.pose[key] !== intent.viewer.pose[key]
    ) ||
    (['east', 'north', 'heading'] as const).some(
      (key) => viewer.venue[key] !== intent.viewer.venue[key]
    )
  )
    return 'changed';
  const exact =
    current.sampledTime === intent.sampledTime && current.sharedTime === intent.sharedTime;
  const initial =
    current.sampledTime === intent.initialSampledTime &&
    current.sharedTime === intent.initialSharedTime;
  if (exact && !current.playing) return 'ready';
  return initial ? 'waiting' : 'changed';
}
