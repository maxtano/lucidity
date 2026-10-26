import type { ProposalImpact } from '../agent/impact';

const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 });

/** Measured document differences, independent of the agent's prose. */
export function DraftImpact({ impact }: { impact: ProposalImpact }) {
  return (
    <section className="agent-impact" aria-label="Draft change summary">
      <span className="agent-eyebrow">WHAT CHANGES</span>
      <dl>
        <div>
          <dt>Show duration</dt>
          <dd>
            {number(impact.durationBefore)} → {number(impact.durationAfter)} s
          </dd>
        </div>
        <div>
          <dt>Fleet size</dt>
          <dd>
            {impact.fleetBefore === impact.fleetAfter
              ? number(impact.fleetAfter)
              : `${number(impact.fleetBefore)} → ${number(impact.fleetAfter)}`}
          </dd>
        </div>
        <div>
          <dt>Scenes edited</dt>
          <dd>{number(impact.changedSceneCount)}</dd>
        </div>
        <div>
          <dt>Drone records edited</dt>
          <dd>{number(impact.authoredDroneRecordsChanged)}</dd>
        </div>
      </dl>
      <div className="agent-impact-channels">
        {impact.positionChanged && <span>Position</span>}
        {impact.lightChanged && <span>Light</span>}
        {impact.timingChanged && <span>Timing</span>}
      </div>
      <details>
        <summary>Scene & key details</summary>
        <p>
          {number(impact.totalKeyCountBefore)} → {number(impact.totalKeyCountAfter)} authored keys ·{' '}
          {number(impact.keyframesAdded)} added · {number(impact.keyframesRemoved)} removed ·{' '}
          {number(impact.keyframesChanged)} changed
        </p>
        <p>
          {number(impact.affectedDroneCount)} drone IDs in the affected authoring scope. Records
          count each scene/drone pair; scope includes scene-wide edits.
        </p>
        <div className="agent-impact-scenes">
          {impact.scenes.map((scene) => (
            <div key={scene.id}>
              <strong>
                {scene.name} <span>{scene.status}</span>
              </strong>
              <p>
                {scene.durationBefore === null ? 'New' : `${number(scene.durationBefore)} s`} →{' '}
                {scene.durationAfter === null ? 'Removed' : `${number(scene.durationAfter)} s`}
              </p>
              <p>
                {scene.changedProperties
                  .map(
                    (property) =>
                      ({
                        droneEdits: 'Drone animation',
                        transitionEasing: 'Transition curve',
                        scene_added: 'Scene added',
                        scene_removed: 'Scene removed',
                      })[property] || property
                  )
                  .join(' · ')}
              </p>
            </div>
          ))}
        </div>
        {impact.remainingSceneCount > 0 && (
          <p>And {number(impact.remainingSceneCount)} more edited scenes.</p>
        )}
        {impact.notes.map((note) => (
          <p className="agent-impact-note" key={note}>
            {note}
          </p>
        ))}
      </details>
    </section>
  );
}
