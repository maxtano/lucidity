import { applyOperations } from '../core/commands';
import { totalDuration, type Project } from '../core/model';
import { normalizeViewerSnapshot, type ViewerSnapshot } from '../core/viewer';
import type { AgentProposal } from './types';
import type { AgentReviewMoment } from './review-moments';
import { buildDraftPreviewTargets, type DraftPreviewDroneTargets } from './draft-preview-targets';

/** Owned display documents. Neither switching sides nor scrubbing applies a proposal. */
export type DraftPreviewDocument = {
  base: Project;
  draft: Project;
  initialTime: number;
  viewer?: ViewerSnapshot;
  /** Owned sampled evidence from this exact completed proposal's full trace. */
  reviewMoments?: AgentReviewMoment[];
  /** Explicit command targets, captured once; never a claim of measured visual differences. */
  droneTargets?: DraftPreviewDroneTargets;
};

/** One show-global clock; the shorter document holds its exact final frame afterward. */
export function draftPreviewTiming(base: Project, draft: Project, time: number) {
  if (!Number.isFinite(time)) throw new Error('Draft preview time must be finite.');
  const baseDuration = totalDuration(base),
    draftDuration = totalDuration(draft);
  if (
    !Number.isFinite(baseDuration) ||
    !Number.isFinite(draftDuration) ||
    baseDuration <= 0 ||
    draftDuration <= 0
  )
    throw new Error('Draft preview documents must have finite positive durations.');
  const duration = Math.max(baseDuration, draftDuration);
  const sharedTime = Math.max(0, Math.min(duration, time));
  return {
    duration,
    time: sharedTime,
    baseTime: Math.min(sharedTime, baseDuration),
    draftTime: Math.min(sharedTime, draftDuration),
    // At an exact endpoint this is the actual last frame, not a later held frame.
    baseEnded: sharedTime > baseDuration,
    draftEnded: sharedTime > draftDuration,
  };
}

/** Capture an exact revision-bound proposal entirely in memory, without shared references. */
export function createDraftPreview(
  base: Project,
  proposal: AgentProposal,
  time: number,
  viewer?: ViewerSnapshot
): DraftPreviewDocument {
  if (!Number.isFinite(time)) throw new Error('Draft preview time must be finite.');
  if (proposal.projectId !== base.id)
    throw new Error('This proposal belongs to a different project.');
  if (proposal.revision !== base.revision)
    throw new Error('This proposal targets a stale project revision.');
  const ownedBase = structuredClone(base);
  const ownedOperations = structuredClone(proposal.operations);
  const draft = applyOperations(ownedBase, ownedOperations, proposal.revision);
  const droneTargets = buildDraftPreviewTargets(ownedBase, draft, ownedOperations);
  const timing = draftPreviewTiming(ownedBase, draft, time);
  return {
    base: ownedBase,
    draft,
    initialTime: timing.time,
    droneTargets,
    ...(viewer ? { viewer: normalizeViewerSnapshot(viewer) } : {}),
  };
}
