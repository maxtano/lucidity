import { useEffect, useRef, useState } from 'react';
import { Check, Play, RefreshCw, X } from 'lucide-react';
import type { AgentViewerContext } from '../agent/types';
import type {
  AudienceComparisonReport,
  AudienceComparisonRequest,
} from '../core/audience-comparison';
import { frameAt, totalDuration, type Project } from '../core/model';
import type { ViewerSnapshot } from '../core/viewer';
import './AudienceComparison.css';

type Props = {
  project: Project;
  time: number;
  capture: () => AgentViewerContext | undefined;
  onClose: () => void;
  onSeek?: (time: number) => void;
  onInspect?: (time: number, snapshot: ViewerSnapshot) => void;
};
type Response =
  | { id: number; type: 'progress'; completed: number; total: number }
  | { id: number; type: 'result'; report: AudienceComparisonReport }
  | { id: number; type: 'error'; message: string };

const seconds = (value: number) => Number(value.toPrecision(8)).toString();
const count = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
const sameSnapshot = (a: ViewerSnapshot, b: ViewerSnapshot) =>
  (['east', 'north', 'eyeHeight', 'yaw', 'pitch', 'fov'] as const).every(
    (key) => a.pose[key] === b.pose[key]
  ) && (['east', 'north', 'heading'] as const).every((key) => a.venue[key] === b.venue[key]);

export function AudienceComparison({ project, time, capture, onClose, onSeek, onInspect }: Props) {
  const duration = totalDuration(project);
  const [context, setContext] = useState(() => {
    try {
      return capture();
    } catch {
      return undefined;
    }
  });
  const [selection, setSelection] = useState<string[]>(() => {
    const distinct = context?.savedViews.find(
      (saved) => !sameSnapshot(saved.snapshot, context.current.snapshot)
    );
    return distinct ? ['', distinct.id] : [''];
  });
  const [start, setStart] = useState(() => String(frameAt(project, time).start));
  const [end, setEnd] = useState(() => {
    const frame = frameAt(project, time);
    return String(frame.start + frame.cue.duration);
  });
  const [samples, setSamples] = useState('5');
  const [report, setReport] = useState<AudienceComparisonReport | null>(null);
  const [selectedView, setSelectedView] = useState('');
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
    setNotice(
      'Comparison cancelled because the show changed. Any previous results remain available.'
    );
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
      report ? 'Comparison cancelled. Previous results are still shown.' : 'Comparison cancelled.'
    );
  };

  const run = () => {
    setError('');
    setNotice('');
    let created: Worker | null = null;
    try {
      const from = start.trim() ? Number(start) : NaN;
      const to = end.trim() ? Number(end) : NaN;
      const sampleCount = samples.trim() ? Number(samples) : NaN;
      if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to > duration || from >= to)
        throw new Error(
          `Choose a start before the end, both within 0–${seconds(duration)} seconds.`
        );
      if (!Number.isInteger(sampleCount) || sampleCount < 2 || sampleCount > 12)
        throw new Error('Samples must be a whole number from 2 to 12.');
      if (selection.length < 1 || selection.length > 4)
        throw new Error('Choose one to four viewpoints.');
      const fresh = capture();
      if (!fresh)
        throw new Error(
          'The 3D viewer is not available yet. Close this panel and try again once it is ready.'
        );
      setContext(fresh);
      if (selection.some((id) => id !== '' && !fresh.savedViews.some((saved) => saved.id === id))) {
        setSelection((previous) =>
          previous.filter((id) => id === '' || fresh.savedViews.some((saved) => saved.id === id))
        );
        throw new Error('A selected saved view is no longer available. Choose the views again.');
      }
      const views = selection.map((id) => {
        const saved = id === '' ? undefined : fresh.savedViews.find((view) => view.id === id);
        if (id !== '' && !saved)
          throw new Error('A selected saved view is no longer available. Choose the views again.');
        return {
          id,
          name: saved?.name ?? 'Current view',
          snapshot: saved?.snapshot ?? fresh.current.snapshot,
          aspect: fresh.current.aspect,
        };
      });
      const request: AudienceComparisonRequest = {
        start: from,
        end: to,
        samples: sampleCount,
        views,
      };
      const id = ++generation.current;
      worker.current?.terminate();
      worker.current = null;
      created = new Worker(new URL('../core/audience-comparison.worker.ts', import.meta.url), {
        type: 'module',
      });
      const active = created;
      worker.current = active;
      const isCurrent = () =>
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
        if (!isCurrent() || event.data.id !== id) return;
        const message = event.data;
        if (message.type === 'progress') {
          setProgress({ completed: message.completed, total: message.total });
        } else if (message.type === 'result') {
          finish();
          setReport(message.report);
          setSelectedView((previous) =>
            message.report.views.some((view) => view.id === previous)
              ? previous
              : message.report.views[0].id
          );
          setNotice(
            `Compared ${message.report.views.length} ${message.report.views.length === 1 ? 'view' : 'views'} at ${message.report.times.length} fixed times.`
          );
        } else if (message.type === 'error') {
          finish();
          setError(message.message);
        }
      };
      active.onerror = (event) => {
        if (!isCurrent()) return;
        event.preventDefault();
        finish();
        setError('The comparison worker stopped unexpectedly. Run the comparison again.');
      };
      active.onmessageerror = () => {
        if (!isCurrent()) return;
        finish();
        setError('The comparison result could not be read. Run the comparison again.');
      };
      setRunning(true);
      setProgress({ completed: 0, total: views.length * sampleCount });
      active.postMessage({ id, project, request });
    } catch (failure) {
      created?.terminate();
      if (worker.current === created) worker.current = null;
      setRunning(false);
      setError(failure instanceof Error ? failure.message : 'The comparison could not start.');
    }
  };

  const from = start.trim() ? Number(start) : NaN;
  const to = end.trim() ? Number(end) : NaN;
  const beatCount =
    Number.isFinite(from) && Number.isFinite(to) && to > from
      ? ((to - from) * project.bpm) / 60
      : null;
  const stale =
    !!report && (report.projectId !== project.id || report.revision !== project.revision);
  const view = report?.views.find((candidate) => candidate.id === selectedView) ?? report?.views[0];
  const options = context
    ? [
        { id: '', name: 'Current view', description: 'Live pose captured when you run' },
        ...context.savedViews.map((saved) => ({
          id: saved.id,
          name: saved.name,
          description: `E ${seconds(saved.snapshot.pose.east)} · N ${seconds(saved.snapshot.pose.north)} m`,
        })),
      ]
    : [];

  return (
    <div
      className="audience-comparison"
      onKeyDown={(event) => {
        // Modal owns Escape and focus trapping; other keys must not reach timeline shortcuts.
        if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
      }}
    >
      <p className="audience-comparison-intro">
        Compare where lights fall in the frame across captured viewpoints. Camera and stage
        placement stay unchanged.
      </p>
      <form
        className="audience-comparison-setup"
        onSubmit={(event) => {
          event.preventDefault();
          if (!running) run();
        }}
        noValidate
      >
        <fieldset className="audience-comparison-views" disabled={running}>
          <legend>
            Viewpoints <span>{selection.length} / 4 selected</span>
          </legend>
          <div className="audience-comparison-options">
            {options.map((option) => (
              <label key={option.id} className={selection.includes(option.id) ? 'selected' : ''}>
                <input
                  type="checkbox"
                  checked={selection.includes(option.id)}
                  disabled={selection.length >= 4 && !selection.includes(option.id)}
                  onChange={(event) =>
                    setSelection((previous) =>
                      event.target.checked
                        ? [...previous, option.id]
                        : previous.filter((id) => id !== option.id)
                    )
                  }
                />
                <span>
                  <strong>{option.name}</strong>
                  <small>{option.description}</small>
                </span>
                {selection.includes(option.id) && <Check size={13} aria-hidden="true" />}
              </label>
            ))}
            {!context && (
              <p className="audience-comparison-empty">
                No viewer is available yet. Run again when the 3D viewer is ready.
              </p>
            )}
          </div>
          {context && context.savedViews.length === 0 && (
            <p className="audience-comparison-hint">
              Save viewpoints in Venue & viewpoint to compare more seats.
            </p>
          )}
        </fieldset>
        <div className="audience-comparison-range">
          <fieldset disabled={running}>
            <legend>Show range</legend>
            <div className="audience-comparison-presets">
              <button
                type="button"
                onClick={() => {
                  const frame = frameAt(project, time);
                  setStart(String(frame.start));
                  setEnd(String(frame.start + frame.cue.duration));
                }}
              >
                Current scene
              </button>
              <button
                type="button"
                onClick={() => {
                  setStart('0');
                  setEnd(String(duration));
                }}
              >
                Whole show
              </button>
            </div>
            <div className="audience-comparison-inputs">
              <label>
                Start{' '}
                <span>
                  <input
                    aria-label="Comparison start seconds"
                    type="number"
                    min={0}
                    max={duration}
                    step="any"
                    value={start}
                    onChange={(event) => setStart(event.target.value)}
                  />
                  s
                </span>
              </label>
              <label>
                End{' '}
                <span>
                  <input
                    aria-label="Comparison end seconds"
                    type="number"
                    min={0}
                    max={duration}
                    step="any"
                    value={end}
                    onChange={(event) => setEnd(event.target.value)}
                  />
                  s
                </span>
              </label>
              <label>
                Samples{' '}
                <span>
                  <input
                    aria-label="Comparison sample count"
                    type="number"
                    min={2}
                    max={12}
                    step={1}
                    value={samples}
                    onChange={(event) => setSamples(event.target.value)}
                  />
                </span>
              </label>
            </div>
            <p className="audience-comparison-hint">
              {beatCount === null
                ? `Show clock · ${project.bpm} BPM`
                : `${count(beatCount)} beats at ${project.bpm} BPM`}{' '}
              · Evenly spaced samples include both endpoints.
            </p>
          </fieldset>
          <div className="audience-comparison-run-actions">
            <button type="submit" className="audience-comparison-run" disabled={running}>
              <RefreshCw size={13} />
              {report ? 'Run again' : 'Run comparison'}
            </button>
            {running && (
              <button type="button" className="audience-comparison-cancel" onClick={cancel}>
                <X size={13} />
                Cancel
              </button>
            )}
          </div>
        </div>
      </form>

      {running && (
        <div className="audience-comparison-progress" role="status">
          <span>Comparing viewpoints</span>
          <progress max={Math.max(1, progress.total)} value={progress.completed} />
          <span>
            {progress.completed} / {progress.total}
          </span>
        </div>
      )}
      {error && (
        <p className="audience-comparison-error" role="alert">
          {error}
          {report ? ' Previous results are still shown.' : ''}
        </p>
      )}
      {notice && (
        <p className="audience-comparison-status" role="status">
          {notice}
        </p>
      )}

      {report && view && (
        <section className="audience-comparison-results" aria-label="Audience comparison results">
          <div className="audience-comparison-results-title">
            <h3>Lights in frame</h3>
            <span className={stale ? 'is-stale' : ''}>
              {stale ? 'Show changed · run again' : `Captured revision ${report.revision}`}
            </span>
          </div>
          <p className="audience-comparison-scope">
            Sampled geometry • no occlusion or continuous coverage
          </p>
          <div className="audience-comparison-table-wrap">
            <table className="audience-comparison-summary">
              <thead>
                <tr>
                  <th scope="col">Captured view</th>
                  <th scope="col">Minimum</th>
                  <th scope="col">Maximum</th>
                  <th scope="col">Sampled mean</th>
                </tr>
              </thead>
              <tbody>
                {report.views.map((candidate) => (
                  <tr key={candidate.id} className={view.id === candidate.id ? 'selected' : ''}>
                    <th scope="row">
                      <button
                        type="button"
                        aria-pressed={view.id === candidate.id}
                        onClick={() => setSelectedView(candidate.id)}
                      >
                        {candidate.name}
                      </button>
                    </th>
                    <td>
                      <strong>{count(candidate.summary.minInFrameLights)}</strong>
                      <small>at {seconds(candidate.summary.minAt)} s</small>
                    </td>
                    <td>
                      <strong>{count(candidate.summary.maxInFrameLights)}</strong>
                      <small>at {seconds(candidate.summary.maxAt)} s</small>
                    </td>
                    <td>
                      <strong>{count(candidate.summary.meanInFrameLights)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="audience-comparison-captured">
            <strong>{view.name}</strong>
            <span>
              E {seconds(view.snapshot.pose.east)} · N {seconds(view.snapshot.pose.north)} · Eye{' '}
              {seconds(view.snapshot.pose.eyeHeight)} m
            </span>
            <span>
              Yaw {seconds(view.snapshot.pose.yaw)}° · Pitch {seconds(view.snapshot.pose.pitch)}° ·
              Vertical lens {seconds(view.snapshot.pose.fov)}° · Aspect {count(view.aspect)}
            </span>
            <span>
              Stage E {seconds(view.snapshot.venue.east)} · N {seconds(view.snapshot.venue.north)} m
              · Front {seconds(view.snapshot.venue.heading)}°
            </span>
          </div>
          <div className="audience-comparison-table-wrap">
            <table className="audience-comparison-samples">
              <caption>
                Fixed sample times · {count(view.samples[0]?.totals.droneCount ?? 0)} drones
              </caption>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Front</th>
                  <th scope="col">Right</th>
                  <th scope="col">Rear</th>
                  <th scope="col">Left</th>
                  <th scope="col">Overhead</th>
                  <th scope="col">In frame</th>
                  <th scope="col">Lit in frame</th>
                </tr>
              </thead>
              <tbody>
                {view.samples.map((sample, index) => (
                  <tr key={index}>
                    <th scope="row">
                      {onInspect || onSeek ? (
                        <button
                          type="button"
                          disabled={stale}
                          title={
                            stale
                              ? 'Run again before seeking in a changed show'
                              : onInspect
                                ? `Inspect ${sample.time} seconds from ${view.name}`
                                : `Seek to ${sample.time} seconds`
                          }
                          onClick={() =>
                            onInspect
                              ? onInspect(sample.time, structuredClone(view.snapshot))
                              : onSeek?.(sample.time)
                          }
                        >
                          <Play size={9} />
                          {onInspect ? 'Inspect ' : ''}
                          {seconds(sample.time)} s
                        </button>
                      ) : (
                        <span title={`${sample.time} seconds`}>{seconds(sample.time)} s</span>
                      )}
                    </th>
                    <td>{count(sample.totals.front)}</td>
                    <td>{count(sample.totals.right)}</td>
                    <td>{count(sample.totals.rear)}</td>
                    <td>{count(sample.totals.left)}</td>
                    <td>{count(sample.totals.overhead)}</td>
                    <td>{count(sample.totals.inFrustum)}</td>
                    <td>{count(sample.totals.inFrustumLightsOn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="audience-comparison-hint">
            Quadrants count all drones relative to the stage direction. Overhead means at least 70°
            elevation and overlaps those counts. “Lit” means any evaluated RGB channel is positive.
          </p>
          <details className="audience-comparison-limitations">
            <summary>What these samples can tell you</summary>
            <ul>
              {report.limitations.map((limitation, index) => (
                <li key={index}>{limitation}</li>
              ))}
            </ul>
          </details>
        </section>
      )}
      <div className="audience-comparison-footer">
        <span>Display analysis only · no show edits</span>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
