import type { Project } from '../core/model';
import { zorroStopPlanError } from '../core/zorro-test';
import './ZorroStopPreview.css';

/** Creative preview only. Hardware readiness belongs to Run storyboard. */
export function ZorroStopPreview({ project }: { project: Project }) {
  const error = zorroStopPlanError(project);
  return <section className="zorro-preview" aria-label="Props-off idle storyboard preview">
    <div className="zorro-preview-card">
      <span className="zorro-preview-kicker">ONE DRONE · PROPS OFF</span>
      <h2>Props-off idle</h2>
      <p>A 20-second, one-drone show at armed idle. No flight path or lights.</p>
      <div className="zorro-preview-diagram" aria-label="Four-motor illustration, not live telemetry">
        <span>Front left</span><span>Front right</span><span>Rear left</span><span>Rear right</span>
      </div>
      {error && <p className="zorro-preview-error" role="alert">{error}</p>}
      <small>Illustration · motion is checked on the physical drone</small>
    </div>
  </section>;
}
