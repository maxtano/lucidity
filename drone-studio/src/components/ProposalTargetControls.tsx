import { Eye, EyeOff } from 'lucide-react';
import type { AudienceHighlightTarget } from '../core/audience-highlight';
import type {
  DraftPreviewSceneTargets,
  DraftTargetSceneFrame,
} from '../agent/draft-preview-targets';
import './ProposalTargetControls.css';

export type ProposalTargetControlsProps = {
  target: AudienceHighlightTarget;
  totalCount: number;
  /** The full proposal union remains visible when the selected scene has no IDs. */
  overallCount?: number;
  perDroneOperations: number;
  otherOperations: number;
  versionLabel: 'Before' | 'Draft';
  enabled: boolean;
  onToggle: () => void;
  sceneScope?: {
    cueId: string | null;
    scenes: readonly DraftPreviewSceneTargets[];
    frame: DraftTargetSceneFrame | null;
    onChange: (cueId: string | null) => void;
  };
};

function sceneLabel(scene: DraftPreviewSceneTargets) {
  if (scene.nameBefore === null && scene.nameAfter === null)
    return `Absent in both versions · ${scene.cueId}`;
  if (scene.nameBefore === null) return `Added · ${scene.nameAfter}`;
  if (scene.nameAfter === null) return `Removed · ${scene.nameBefore}`;
  return scene.nameBefore === scene.nameAfter
    ? scene.nameAfter
    : `${scene.nameBefore} → ${scene.nameAfter}`;
}

/** Optional display of explicit command targets, never a claim of visible differences. */
export function ProposalTargetControls({
  target,
  totalCount,
  overallCount = totalCount,
  perDroneOperations,
  otherOperations,
  versionLabel,
  enabled,
  onToggle,
  sceneScope,
}: ProposalTargetControlsProps) {
  const activeCount = target.ids.length;
  const inactiveCount = Math.max(0, totalCount - activeCount);
  const scoped = sceneScope?.cueId !== null && sceneScope?.cueId !== undefined;
  const selectedScene = sceneScope?.scenes.find((scene) => scene.cueId === sceneScope.cueId);
  const relation = sceneScope?.frame;
  return (
    <section
      className="proposal-target-controls"
      aria-label="Proposal drone targets"
      onKeyDown={(event) => {
        if (event.key !== 'Tab' && event.key !== 'Escape') event.stopPropagation();
      }}
    >
      <div className="proposal-target-heading">
        <strong>
          <i aria-hidden="true" />
          {totalCount.toLocaleString()} targeted drones
        </strong>
        <button
          type="button"
          onClick={onToggle}
          aria-label="Show proposal target markers"
          aria-pressed={enabled}
          disabled={activeCount === 0 && !enabled}
          title={activeCount === 0 ? 'No targeted IDs are active in this version.' : undefined}
        >
          {enabled ? <Eye size={12} /> : <EyeOff size={12} />}
          {enabled ? 'Hide marks' : 'Show marks'}
        </button>
      </div>
      {sceneScope && (
        <label className="proposal-target-scene">
          Command scene
          <select
            aria-label="Proposal target scene"
            value={sceneScope.cueId ?? ''}
            title={selectedScene ? sceneLabel(selectedScene) : 'All scenes'}
            onChange={(event) => sceneScope.onChange(event.target.value || null)}
          >
            <option value="">All scenes</option>
            {sceneScope.scenes.map((scene) => (
              <option key={scene.cueId} value={scene.cueId}>
                {sceneLabel(scene)}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="proposal-target-scope">
        {scoped
          ? `${totalCount.toLocaleString()} of ${overallCount.toLocaleString()} proposal targets · fixed scene scope`
          : 'Per-drone operation targets · all scenes'}
      </p>
      <p className="proposal-target-membership">
        <b>{versionLabel}</b> · {activeCount.toLocaleString()} / {totalCount.toLocaleString()}{' '}
        active · {inactiveCount.toLocaleString()} inactive
      </p>
      {scoped && relation && (
        <p className="proposal-target-frame">
          <strong>
            {relation.role === 'current'
              ? 'Current scene'
              : relation.role === 'incoming-source'
                ? 'Incoming transition source'
                : relation.role === 'absent'
                  ? `Scene absent in ${versionLabel}`
                  : 'Other scene at playhead'}
          </strong>
          {relation.role === 'current'
            ? ` · ${relation.currentSceneName}`
            : relation.role === 'incoming-source'
              ? ` · ${relation.transitionSourceName} → ${relation.currentSceneName}`
              : relation.role === 'outside-frame'
                ? ` · Showing ${relation.currentSceneName}`
                : '. Active IDs still follow their current positions.'}
        </p>
      )}
      <p className="proposal-target-operation-count">
        {perDroneOperations.toLocaleString()} per-drone{' '}
        {perDroneOperations === 1 ? 'operation' : 'operations'} in{' '}
        {scoped ? 'this scope' : 'all scenes'}
        {' · '}
        {otherOperations.toLocaleString()} other{' '}
        {otherOperations === 1 ? 'operation' : 'operations'} in the whole proposal{' '}
        {otherOperations === 1 ? 'is' : 'are'} not marked
      </p>
      <details>
        <summary>What these marks mean</summary>
        <p>
          {scoped
            ? 'The complete union of IDs named by per-drone commands in the chosen scene. '
            : 'The complete union of IDs named by per-drone commands, across all scenes. '}
          A targeted drone may have no visible change at this playhead. Scene and show operations
          can change other drones without marking them here.
        </p>
        <p>
          Marks follow active IDs at their current positions, including lights that are off.
          Inactive IDs are outside this version’s fleet. Membership stays fixed as you play or look
          around. Choosing a command scene does not seek or recall its formation.
        </p>
        <p>
          Marks ignore venue occlusion and stay out of captured review frames. They do not change
          selection, authored lights, or show timing.
        </p>
      </details>
    </section>
  );
}
