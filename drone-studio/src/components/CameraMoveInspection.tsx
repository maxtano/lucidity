import { useEffect, useRef, useState } from 'react';
import { Play, RefreshCw, X } from 'lucide-react';
import type { CameraAuditionPlan } from '../core/camera-audition';
import type { CameraMoveReport, CameraMoveRequest } from '../core/camera-move-inspection';
import { totalDuration, type Project } from '../core/model';
import type { ViewerSnapshot } from '../core/viewer';
import './CameraMoveInspection.css';

type CapturedMove = {
  plan: CameraAuditionPlan;
  aspect: number;
  fromName: string;
  toName: string;
};
type Props = {
  project: Project;
  time: number;
  capture: () => CapturedMove | undefined;
  onClose: () => void;
  onInspect?: (time: number, snapshot: ViewerSnapshot) => void;
};
type Response =
  | { id: number; type: 'progress'; completed: number; total: number }
  | { id: number; type: 'result'; report: CameraMoveReport }
  | { id: number; type: 'error'; message: string };

const seconds = (value: number) => Number(value.toPrecision(9)).toString();
const count = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
const angle = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 });

/** Numerical snapshots of two independent clocks; only an explicit Inspect moves the preview. */
export function CameraMoveInspection({ project, time, capture, onClose, onInspect }: Props) {
  const duration = totalDuration(project);
  const playhead = Number.isFinite(time) ? Math.max(0, Math.min(duration, time)) : 0;
  const [context, setContext] = useState<CapturedMove | undefined>(() => {
    try {
      return structuredClone(capture());
    } catch {
      return undefined;
    }
  });
  const [start, setStart] = useState(() => String(playhead));
  const [end, setEnd] = useState(() =>
    String(Math.min(duration, playhead + (context?.plan.duration ?? 0)))
  );
  const [samples, setSamples] = useState('5');
  const [report, setReport] = useState<CameraMoveReport | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const worker = useRef<Worker | null>(null);
  const liveProject = useRef({ id: project.id, revision: project.revision });
  liveProject.current = { id: project.id, revision: project.revision };

  useEffect(() => {
    if (!worker.current) return;
    generation.current++;
    worker.current.terminate();
    worker.current = null;
    setRunning(false);
    setNotice('Analysis cancelled because the show changed. Previous results remain available.');
  }, [project.id, project.revision]);

  useEffect(
    () => () => {
      generation.current++;
      worker.current?.terminate();
      worker.current = null;
    },
    []
  );

  const cancel = () => {
    generation.current++;
    worker.current?.terminate();
    worker.current = null;
    setRunning(false);
    setNotice(
      report ? 'Analysis cancelled. Previous results are still shown.' : 'Analysis cancelled.'
    );
  };

  const run = () => {
    if (worker.current) return;
    setError('');
    setNotice('');
    let created: Worker | null = null;
    try {
      const from = start.trim() ? Number(start) : NaN;
      const to = end.trim() ? Number(end) : NaN;
      const sampleCount = samples.trim() ? Number(samples) : NaN;
      if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || from > to || to > duration)
        throw new Error(
          `Choose 0 ≤ show start ≤ show end ≤ ${seconds(duration)} seconds. Equal times hold one show frame.`
        );
      if (!Number.isInteger(sampleCount) || sampleCount < 2 || sampleCount > 12)
        throw new Error('Samples must be a whole number from 2 to 12.');
      const fresh = capture();
      if (!fresh) throw new Error('Prepare a camera move before running this analysis.');
      const owned = structuredClone(fresh);
      const request: CameraMoveRequest = { ...owned, start: from, end: to, samples: sampleCount };
      setContext(owned);
      const id = ++generation.current;
      created = new Worker(new URL('../core/camera-move-inspection.worker.ts', import.meta.url), {
        type: 'module',
      });
      const active = created;
      worker.current = active;
      const current = () =>
        generation.current === id &&
        worker.current === active &&
        liveProject.current.id === project.id &&
        liveProject.current.revision === project.revision;
      const finish = () => {
        active.terminate();
        worker.current = null;
        setRunning(false);
      };
      active.onmessage = (event: MessageEvent<Response>) => {
        if (!current() || event.data.id !== id) return;
        const message = event.data;
        if (message.type === 'progress')
          setProgress({ completed: message.completed, total: message.total });
        else if (message.type === 'result') {
          finish();
          setReport(message.report);
          setNotice(
            `Analyzed ${message.report.samples.length} fixed camera and show sample pairs.`
          );
        } else if (message.type === 'error') {
          finish();
          setError(message.message);
        }
      };
      active.onerror = (event) => {
        if (!current()) return;
        event.preventDefault();
        finish();
        setError('The camera analysis worker stopped unexpectedly. Run the report again.');
      };
      active.onmessageerror = () => {
        if (!current()) return;
        finish();
        setError('The camera analysis result could not be read. Run the report again.');
      };
      setRunning(true);
      setProgress({ completed: 0, total: sampleCount });
      active.postMessage({ id, project, request });
    } catch (cause) {
      created?.terminate();
      if (worker.current === created) worker.current = null;
      setRunning(false);
      setError(cause instanceof Error ? cause.message : 'Camera analysis could not start.');
    }
  };

  const stale = Boolean(
    report && (report.projectId !== project.id || report.revision !== project.revision)
  );
  const fleet = report?.samples[0]?.totals.droneCount ?? 0;
  const held = start.trim() !== '' && end.trim() !== '' && Number(start) === Number(end);

  return (
    <div
      className="camera-move-inspection"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
      }}
    >
      <p className="camera-move-intro">
        Sample the prepared camera path against a chosen show interval. Camera elapsed time and show
        time are separate; running the report leaves the preview in place.
      </p>
      <div className="camera-move-source">
        <strong>
          {context
            ? `${context.fromName} → ${context.toName}`
            : 'No prepared camera move available'}
        </strong>
        {context && (
          <span>
            Camera 0–{seconds(context.plan.duration)}s · {context.plan.easing} · aspect{' '}
            {angle(context.aspect)}:1
          </span>
        )}
      </div>
      <form
        className="camera-move-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!running) run();
        }}
      >
        <div className="camera-move-fields">
          <label>
            Show start · seconds
            <input
              type="number"
              aria-label="Camera analysis show start in seconds"
              min={0}
              max={duration}
              step="any"
              value={start}
              disabled={running}
              onChange={(event) => setStart(event.currentTarget.value)}
            />
          </label>
          <label>
            Show end · seconds
            <input
              type="number"
              aria-label="Camera analysis show end in seconds"
              min={0}
              max={duration}
              step="any"
              value={end}
              disabled={running}
              onChange={(event) => setEnd(event.currentTarget.value)}
            />
          </label>
          <label>
            Fixed samples
            <input
              type="number"
              aria-label="Camera analysis sample count"
              min={2}
              max={12}
              step={1}
              value={samples}
              disabled={running}
              onChange={(event) => setSamples(event.currentTarget.value)}
            />
          </label>
        </div>
        <p className="camera-move-input-help">
          {held
            ? 'The show holds one frame while the complete camera path is sampled.'
            : 'Camera samples span the full move and map evenly across these show times. Equal start and end hold one show frame.'}{' '}
          The prepared move and current aspect are captured when you run.
        </p>
        <div className="camera-move-run-row">
          <button type="submit" className="camera-move-run" disabled={running}>
            {report ? <RefreshCw size={12} /> : <Play size={12} />}
            {running ? 'Analyzing…' : 'Run report'}
          </button>
          {running ? (
            <button type="button" onClick={cancel}>
              <X size={12} /> Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setStart(String(playhead));
                setEnd(String(playhead));
              }}
            >
              Hold current show frame
            </button>
          )}
          {running && (
            <span className="camera-move-progress" role="status">
              <progress
                value={progress.completed}
                max={Math.max(1, progress.total)}
                aria-label="Camera analysis progress"
              />
              {progress.completed} / {progress.total} samples
            </span>
          )}
        </div>
      </form>
      {error && (
        <p className="camera-move-error" role="alert">
          {error}
          {report ? ' Previous results are still shown.' : ''}
        </p>
      )}
      {notice && (
        <p className="camera-move-notice" role="status">
          {notice}
        </p>
      )}
      {stale && (
        <p className="camera-move-stale" role="status">
          This report belongs to an earlier show revision or another project. Run it again before
          inspecting a moment.
        </p>
      )}
      {report && (
        <section aria-label="Camera move analysis results">
          <div className="camera-move-result-heading">
            <div>
              <h3>
                {report.request.fromName} → {report.request.toName}
              </h3>
              <p>
                Camera 0–{seconds(report.request.plan.duration)}s · {report.request.plan.easing} ·
                captured aspect {angle(report.request.aspect)}:1
                <br />
                Show {seconds(report.request.start)}–{seconds(report.request.end)}s
                {report.request.start === report.request.end ? ' · held frame' : ''} ·{' '}
                {report.samples.length} fixed samples
              </p>
            </div>
            <span>{stale ? 'Stale report' : `Revision ${report.revision}`}</span>
          </div>
          <dl className="camera-move-summary">
            <div>
              <dt>Minimum lit in frame</dt>
              <dd>{count(report.summary.minInFrameLights)}</dd>
              <small>of {count(fleet)} drones</small>
            </div>
            <div>
              <dt>Maximum lit in frame</dt>
              <dd>{count(report.summary.maxInFrameLights)}</dd>
              <small>of {count(fleet)} drones</small>
            </div>
            <div>
              <dt>Sampled mean lit in frame</dt>
              <dd>{count(report.summary.meanInFrameLights)}</dd>
              <small>mean across fixed samples</small>
            </div>
          </dl>
          <div className="camera-move-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Camera elapsed</th>
                  <th scope="col">Show time</th>
                  <th scope="col">Yaw / pitch</th>
                  <th scope="col">In frame</th>
                  <th scope="col">Lit in frame</th>
                  <th
                    scope="col"
                    title="All overhead drones in the fleet, independent of the captured frustum"
                  >
                    Overhead
                  </th>
                  {onInspect && <th scope="col">Preview</th>}
                </tr>
              </thead>
              <tbody>
                {report.samples.map((sample, index) => (
                  <tr key={index}>
                    <td title={`${sample.cameraTime} seconds camera elapsed`}>
                      {seconds(sample.cameraTime)}s
                    </td>
                    <td title={`${sample.showTime} seconds show time`}>
                      {seconds(sample.showTime)}s
                    </td>
                    <td>
                      {angle(sample.snapshot.pose.yaw)}° / {angle(sample.snapshot.pose.pitch)}°
                    </td>
                    <td>{count(sample.totals.inFrustum)}</td>
                    <td className="camera-move-lit">{count(sample.totals.inFrustumLightsOn)}</td>
                    <td>{count(sample.totals.overhead)}</td>
                    {onInspect && (
                      <td>
                        <button
                          type="button"
                          disabled={stale}
                          aria-label={`Inspect camera at ${sample.cameraTime} seconds and show at ${sample.showTime} seconds`}
                          onClick={() => onInspect(sample.showTime, sample.snapshot)}
                        >
                          Inspect
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="camera-move-metadata">
            <summary>Exact camera and stage metadata</summary>
            <p>
              Project {report.projectId} · revision {report.revision} · aspect{' '}
              {String(report.request.aspect)}:1
              <br />
              Stage east {String(report.request.plan.from.venue.east)}m · north{' '}
              {String(report.request.plan.from.venue.north)}m · front heading{' '}
              {String(report.request.plan.from.venue.heading)}°. Stage placement is fixed throughout
              this camera move.
            </p>
            <div className="camera-move-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Camera seconds</th>
                    <th scope="col">Show seconds</th>
                    <th scope="col">East · m</th>
                    <th scope="col">North · m</th>
                    <th scope="col">Eye height · m</th>
                    <th scope="col">Yaw · °</th>
                    <th scope="col">Pitch · °</th>
                    <th scope="col">Vertical FOV · °</th>
                  </tr>
                </thead>
                <tbody>
                  {report.samples.map((sample, index) => (
                    <tr key={index}>
                      <td>{String(sample.cameraTime)}</td>
                      <td>{String(sample.showTime)}</td>
                      {(['east', 'north', 'eyeHeight', 'yaw', 'pitch', 'fov'] as const).map(
                        (key) => (
                          <td key={key}>{String(sample.snapshot.pose[key])}</td>
                        )
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <ul className="camera-move-limitations">
            {report.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </section>
      )}
      <div className="camera-move-footer">
        <p>
          Sampled geometry · no occlusion or continuous coverage. Inspect explicitly recalls the
          sampled camera and show time; the current viewport can have different framing.
        </p>
        <button type="button" className="camera-move-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
