import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { AgentReviewMoment } from '../agent/review-moments';
import { timecode } from '../core/timeline';

const momentKind = {
  inspection: 'Inspection',
  minimum: 'Minimum sample',
  maximum: 'Maximum sample',
} as const;
const seconds = (value: number) => Number(value.toPrecision(9)).toString();

/** Evidence stays historical; opening a moment is the only action that moves the preview. */
export function AgentReviewMoments({
  moments,
  onOpen,
}: {
  moments: AgentReviewMoment[];
  onOpen: (moment: AgentReviewMoment) => void;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  if (!moments.length) return null;
  return (
    <section className="agent-draft-review-moments" aria-label="Measured review moments">
      <button
        type="button"
        className="agent-draft-review-toggle"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
      >
        Measured review moments <span>{moments.length}</span>
        <small>Captured in the agent run</small>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="agent-draft-review-body" id={contentId}>
          <p className="agent-draft-review-caveat">
            Open moment pauses and recalls its version, time, and audience view. Enable Captured
            frame in the viewer to match its captured projection; otherwise framing can differ.
            Sampled geometry excludes occlusion. The camera stays movable, so counts apply only at
            the recorded view and time.
          </p>
          <ol className="agent-draft-review-list">
            {moments.map((moment) => {
              const version = moment.version === 'base' ? 'Before' : 'Draft';
              const kind = momentKind[moment.kind];
              return (
                <li key={moment.id}>
                  <div className="agent-draft-review-identity">
                    <div>
                      <span
                        className={`agent-draft-review-version${moment.version === 'draft' ? ' is-draft' : ''}`}
                      >
                        {version}
                      </span>
                      <strong title={moment.viewName}>{moment.viewName}</strong>
                    </div>
                    <span>
                      {kind} ·{' '}
                      <time title={`${moment.time} seconds show time`}>
                        Show {timecode(moment.time)}
                      </time>
                    </span>
                    {moment.camera && (
                      <span
                        className="agent-draft-review-camera"
                        title={`Camera elapsed ${moment.camera.elapsed} seconds of ${moment.camera.duration}; show time ${moment.time} seconds. This recalls a single measured pose, not camera playback.`}
                      >
                        Camera {seconds(moment.camera.elapsed)} / {seconds(moment.camera.duration)}s
                        {' · '}sample {moment.camera.sampleIndex + 1} / {moment.camera.sampleCount}
                        {' · '}
                        {moment.camera.easing}
                      </span>
                    )}
                  </div>
                  <div className="agent-draft-review-measurement">
                    <span>
                      {moment.inFrameLights.toLocaleString()} / {moment.droneCount.toLocaleString()}{' '}
                      lit points in captured frustum
                    </span>
                    <small
                      title={`Source: ${moment.tool}, event ${moment.eventId}, call ${moment.callId}. Captured aspect: ${moment.aspect}:1.`}
                    >
                      {moment.tool} · event {moment.eventId} · aspect {moment.aspect.toFixed(3)}:1
                    </small>
                  </div>
                  <button
                    type="button"
                    aria-label={`Open moment: ${version}, ${moment.viewName}, ${kind.toLowerCase()}, ${moment.time} seconds show time${moment.camera ? `, ${moment.camera.elapsed} seconds camera elapsed` : ''}`}
                    onClick={() => onOpen(moment)}
                  >
                    Open moment
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}
