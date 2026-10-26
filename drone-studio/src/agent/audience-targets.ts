import type { AudienceSelectionReport } from '../core/audience-selection';
import type { Project } from '../core/model';
import type { AgentDraft } from './types';

export const MAX_AUDIENCE_TARGETS = 8;
export const MAX_AUDIENCE_TARGET_IDS = 200_000;
export type AudienceTargetCriteria = Omit<AudienceSelectionReport['request'], 'scopeIds'> & {
  scope: 'fleet' | 'selection';
};
export type AudienceTargetSummary = {
  projectId: string;
  revision: number;
  stagedOperations: number;
  viewId: string;
  viewName: string;
  request: AudienceTargetCriteria;
  consideredCount: number;
  droneCount: number;
};
export type AudienceTarget = Readonly<
  AudienceTargetSummary & {
    targetId: string;
    ids: readonly number[];
    /** Exact private document identity; never serialized or exposed to the provider. */
    project: Project;
  }
>;

/** Register only a finished query against the same private document that it evaluated. */
export function registerAudienceTarget(
  state: AgentDraft,
  baseline: { project: Project; stagedOperations: number },
  report: AudienceSelectionReport,
  view: { id: string; name: string },
  scope: 'fleet' | 'selection'
): string | null {
  if (
    state.project !== baseline.project ||
    state.operations.length !== baseline.stagedOperations ||
    report.projectId !== state.project.id ||
    report.revision !== state.project.revision
  )
    throw new Error('Audience query became stale while running. Query the current draft again.');
  if (
    report.ids.length !== report.matchedCount ||
    report.ids.length > 100_000 ||
    report.ids.some(
      (id, index) =>
        !Number.isInteger(id) ||
        id < 1 ||
        id > state.project.droneCount ||
        (index > 0 && id <= report.ids[index - 1])
    )
  )
    throw new Error('Audience query returned an invalid complete matching set.');
  if (!report.ids.length) return null;
  const snapshot = structuredClone(report.request.snapshot);
  Object.freeze(snapshot.pose);
  Object.freeze(snapshot.venue);
  Object.freeze(snapshot);
  const request: AudienceTargetCriteria = Object.freeze({
    time: report.request.time,
    snapshot,
    aspect: report.request.aspect,
    region: report.request.region,
    lights: report.request.lights,
    scope,
  });
  const target: AudienceTarget = Object.freeze({
    targetId: crypto.randomUUID(),
    ids: Object.freeze([...report.ids]),
    project: baseline.project,
    projectId: report.projectId,
    revision: report.revision,
    stagedOperations: baseline.stagedOperations,
    viewId: view.id,
    viewName: view.name,
    request,
    consideredCount: report.consideredCount,
    droneCount: report.droneCount,
  });
  const next = [...(state.audienceTargets ?? []), target];
  let totalIds = next.reduce((sum, item) => sum + item.ids.length, 0);
  while (next.length > MAX_AUDIENCE_TARGETS || totalIds > MAX_AUDIENCE_TARGET_IDS)
    totalIds -= next.shift()!.ids.length;
  // Copy-on-write is essential: the harness transaction checkpoint is shallow.
  state.audienceTargets = Object.freeze(next);
  return target.targetId;
}

export function requireAudienceTarget(state: AgentDraft, targetId: string): AudienceTarget {
  const target = state.audienceTargets?.find((item) => item.targetId === targetId);
  if (
    !target ||
    target.project !== state.project ||
    target.projectId !== state.project.id ||
    target.revision !== state.project.revision ||
    target.stagedOperations !== state.operations.length
  )
    throw new Error(
      'Audience target is unknown or expired. Run inspect_audience_selection again after draft edits or target eviction.'
    );
  return target;
}

/** Detached compact evidence: never leak the retained complete IDs or project reference. */
export function summarizeAudienceTarget(target: AudienceTarget): AudienceTargetSummary {
  return {
    projectId: target.projectId,
    revision: target.revision,
    stagedOperations: target.stagedOperations,
    viewId: target.viewId,
    viewName: target.viewName,
    request: structuredClone(target.request),
    consideredCount: target.consideredCount,
    droneCount: target.droneCount,
  };
}
