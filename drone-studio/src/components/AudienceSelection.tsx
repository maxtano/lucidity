import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Eye, Plus, RefreshCw, Search, X } from 'lucide-react';
import type { AudienceSelectionReport, AudienceSelectionRequest } from '../core/audience-selection';
import { totalDuration, type Project } from '../core/model';
import type { ViewerSnapshot } from '../core/viewer';
import './AudienceSelection.css';

type Props = {
  project: Project;
  time: number;
  selection: number[];
  capture: () => { snapshot: ViewerSnapshot; aspect: number } | undefined;
  onSelect: (ids: number[], additive: boolean) => void;
  onPreview?: (report: AudienceSelectionReport) => void;
  onClose: () => void;
};
type Response =
  | { id: number; type: 'progress'; completed: number; total: number }
  | { id: number; type: 'result'; report: AudienceSelectionReport }
  | { id: number; type: 'error'; message: string };
type Region = AudienceSelectionRequest['region'];
type LightState = AudienceSelectionRequest['lights'];
const regionLabels: Record<Region, string> = {
  in_frame: 'In camera frame',
  front: 'Front of audience',
  right: 'Right of audience',
  rear: 'Behind audience',
  left: 'Left of audience',
  overhead: 'Overhead',
};
const lightLabels: Record<LightState, string> = {
  any: 'Any light state',
  on: 'Lights on',
  off: 'Lights off',
};
const number = (value: number) => Number(value.toPrecision(9)).toString();
const count = (value: number) => value.toLocaleString();

/** Complete historical IDs from one captured frame; selection changes only on explicit commit. */
export function AudienceSelection({
  project,
  time,
  selection,
  capture,
  onSelect,
  onPreview,
  onClose,
}: Props) {
  const [scope, setScope] = useState<'fleet' | 'selection'>('fleet');
  const [region, setRegion] = useState<Region>('in_frame');
  const [lights, setLights] = useState<LightState>('any');
  const [report, setReport] = useState<AudienceSelectionReport | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const worker = useRef<Worker | null>(null);
  const generation = useRef(0);
  const liveProject = useRef({ id: project.id, revision: project.revision });
  liveProject.current = { id: project.id, revision: project.revision };
  const selectedIds = useMemo(() => [...new Set(selection)].sort((a, b) => a - b), [selection]);
  const activeSelected = useMemo(
    () => selectedIds.filter((id) => id >= 1 && id <= project.droneCount).length,
    [selectedIds, project.droneCount]
  );
  const stale = Boolean(
    report && (report.projectId !== project.id || report.revision !== project.revision)
  );
  const scopeChanged = useMemo(() => {
    const previous = report?.request.scopeIds;
    return (
      previous !== undefined &&
      (previous.length !== selectedIds.length ||
        previous.some((id, index) => id !== selectedIds[index]))
    );
  }, [report, selectedIds]);

  useEffect(() => {
    if (!worker.current) return;
    generation.current++;
    worker.current.terminate();
    worker.current = null;
    setRunning(false);
    setNotice('Search cancelled because the show changed. Previous results remain available.');
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
    setNotice(report ? 'Search cancelled. Previous results are still shown.' : 'Search cancelled.');
  };

  const run = () => {
    if (worker.current) return;
    setError('');
    setNotice('');
    let created: Worker | null = null;
    try {
      if (!Number.isFinite(time) || time < 0 || time > totalDuration(project))
        throw new Error('The playhead must be within this show before finding drones.');
      const fresh = capture();
      if (!fresh)
        throw new Error(
          'The audience camera is not available yet. Try again once the viewer is ready.'
        );
      const request: AudienceSelectionRequest = structuredClone({
        time,
        snapshot: fresh.snapshot,
        aspect: fresh.aspect,
        region,
        lights,
        ...(scope === 'selection' ? { scopeIds: selectedIds } : {}),
      });
      const id = ++generation.current;
      created = new Worker(new URL('../core/audience-selection.worker.ts', import.meta.url), {
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
            `Found ${count(message.report.matchedCount)} matching ${message.report.matchedCount === 1 ? 'drone' : 'drones'}. Your selection has not changed.`
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
        setError('The audience search worker stopped unexpectedly. Find drones again.');
      };
      active.onmessageerror = () => {
        if (!current()) return;
        finish();
        setError('The audience search result could not be read. Find drones again.');
      };
      setRunning(true);
      setProgress({
        completed: 0,
        total: scope === 'selection' ? activeSelected : project.droneCount,
      });
      active.postMessage({ id, project, request });
    } catch (cause) {
      created?.terminate();
      if (worker.current === created) worker.current = null;
      setRunning(false);
      setError(cause instanceof Error ? cause.message : 'Audience search could not start.');
    }
  };

  const commit = (additive: boolean) => {
    if (!report || worker.current) return;
    if (
      report.projectId !== liveProject.current.id ||
      report.revision !== liveProject.current.revision
    ) {
      setError(
        'This result belongs to an earlier show revision. Find drones again before selecting.'
      );
      return;
    }
    onSelect([...report.ids], additive);
  };

  const captured = report?.request;
  const pose = captured?.snapshot.pose;
  const venue = captured?.snapshot.venue;
  const preview = report?.ids.slice(0, 32) ?? [];

  return (
    <div
      className="audience-selection"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
      }}
    >
      <p className="audience-selection-intro">
        Find every matching drone in one captured audience frame, then use those IDs to edit the
        show. Finding drones leaves your camera and selection in place.
      </p>
      <form
        className="audience-selection-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!running) run();
        }}
      >
        <div className="audience-selection-fields">
          <label>
            Search scope
            <select
              aria-label="Audience selection scope"
              value={scope}
              disabled={running}
              onChange={(event) => setScope(event.currentTarget.value as 'fleet' | 'selection')}
            >
              <option value="fleet">All active drones</option>
              <option value="selection">Current selection</option>
            </select>
          </label>
          <label>
            Audience region
            <select
              aria-label="Audience selection region"
              value={region}
              disabled={running}
              onChange={(event) => setRegion(event.currentTarget.value as Region)}
            >
              {(Object.keys(regionLabels) as Region[]).map((value) => (
                <option key={value} value={value}>
                  {regionLabels[value]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Light state
            <select
              aria-label="Audience selection light state"
              value={lights}
              disabled={running}
              onChange={(event) => setLights(event.currentTarget.value as LightState)}
            >
              {(Object.keys(lightLabels) as LightState[]).map((value) => (
                <option key={value} value={value}>
                  {lightLabels[value]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="audience-selection-input-help">
          <strong>Show {number(time)}s</strong> ·{' '}
          {scope === 'fleet'
            ? `${count(project.droneCount)} active drones`
            : `${count(activeSelected)} active of ${count(selectedIds.length)} selected IDs`}
          . The exact camera, aspect, time and scope are captured when you find.
          <br />
          {region === 'in_frame'
            ? 'In frame follows the camera’s perspective frustum.'
            : region === 'overhead'
              ? 'Overhead means at least 70° elevation above the viewer.'
              : 'Front, right, rear and left follow the viewer-to-stage bearing, independent of look direction.'}{' '}
          Lights on means positive evaluated RGB at this instant.
        </p>
        <div className="audience-selection-run-row">
          <button type="submit" className="audience-selection-primary" disabled={running}>
            {report ? <RefreshCw size={12} /> : <Search size={12} />}
            {running ? 'Finding…' : 'Find drones'}
          </button>
          {running && (
            <>
              <button type="button" onClick={cancel}>
                <X size={12} /> Cancel
              </button>
              <span className="audience-selection-progress" role="status">
                <progress
                  value={progress.completed}
                  max={Math.max(1, progress.total)}
                  aria-label="Audience selection progress"
                />
                {count(progress.completed)} / {count(progress.total)}
              </span>
            </>
          )}
        </div>
      </form>
      {error && (
        <p className="audience-selection-error" role="alert">
          {error}
          {report ? ' Previous results are still shown.' : ''}
        </p>
      )}
      {notice && (
        <p className="audience-selection-notice" role="status">
          {notice}
        </p>
      )}
      {stale && (
        <p className="audience-selection-stale" role="status">
          This result belongs to an earlier show revision or another project. Find drones again
          before changing the selection.
        </p>
      )}
      {report && captured && pose && venue && (
        <section className="audience-selection-result" aria-label="Audience selection results">
          <div className="audience-selection-result-heading">
            <div>
              <h3>
                {regionLabels[captured.region]} · {lightLabels[captured.lights]}
              </h3>
              <p>
                Show {number(captured.time)}s ·{' '}
                {captured.scopeIds === undefined ? 'All active drones' : 'Captured selection'} ·
                revision {report.revision}
              </p>
            </div>
            <span>{stale ? 'Stale result' : 'Complete result'}</span>
          </div>
          <dl className="audience-selection-counts">
            <div>
              <dt>Matching drones</dt>
              <dd>{count(report.matchedCount)}</dd>
            </div>
            <div>
              <dt>Active IDs considered</dt>
              <dd>{count(report.consideredCount)}</dd>
            </div>
            <div>
              <dt>Active fleet</dt>
              <dd>{count(report.droneCount)}</dd>
            </div>
          </dl>
          <p className="audience-selection-ids">
            {preview.length ? (
              <>
                <strong>IDs</strong> {preview.join(', ')}
                {report.ids.length > preview.length && (
                  <> · +{count(report.ids.length - preview.length)} more</>
                )}
              </>
            ) : (
              'No drones match this captured frame and criteria.'
            )}
          </p>
          <p className="audience-selection-history">
            {report.ids.length > preview.length
              ? `All ${count(report.ids.length)} matching IDs will be used, including those beyond this preview.`
              : report.ids.length
                ? `All ${count(report.ids.length)} matching IDs are shown and will be used.`
                : 'This result contains no IDs.'}
            {captured.scopeIds !== undefined && (
              <>
                {' '}
                Scope is the {count(captured.scopeIds.length)} IDs captured when this search ran;
                inactive IDs were not considered.
              </>
            )}
            {scopeChanged && (
              <>
                {' '}
                Your current selection has changed since this search. These results still use the
                captured scope.
              </>
            )}
          </p>
          <details className="audience-selection-metadata">
            <summary>Captured frame and criteria</summary>
            <dl>
              <dt>Show time</dt>
              <dd>{captured.time} seconds</dd>
              <dt>Scene</dt>
              <dd>
                {report.cueId} · local {report.localTime}s · blend {report.blend}
              </dd>
              <dt>Audience position</dt>
              <dd>
                E {pose.east}m · N {pose.north}m · eye {pose.eyeHeight}m
              </dd>
              <dt>Camera</dt>
              <dd>
                Yaw {pose.yaw}° · pitch {pose.pitch}° · vertical FOV {pose.fov}°
              </dd>
              <dt>Captured aspect</dt>
              <dd>{captured.aspect}:1</dd>
              <dt>Stage reference</dt>
              <dd>
                E {venue.east}m · N {venue.north}m · front heading {venue.heading}°
              </dd>
              <dt>Criteria</dt>
              <dd>
                {regionLabels[captured.region]} · {lightLabels[captured.lights]}
              </dd>
              <dt>Scope</dt>
              <dd>
                {captured.scopeIds === undefined
                  ? 'All active drone IDs'
                  : `${count(captured.scopeIds.length)} captured IDs · ${captured.scopeIds.slice(0, 32).join(', ') || 'empty selection'}${captured.scopeIds.length > 32 ? ' …' : ''}`}
              </dd>
            </dl>
            <ul className="audience-selection-limitations">
              {report.limitations.map((limitation, index) => (
                <li key={index}>{limitation}</li>
              ))}
            </ul>
          </details>
          <div className="audience-selection-commit">
            {onPreview && (
              <button
                type="button"
                disabled={stale || running || report.ids.length === 0}
                onClick={() => {
                  if (
                    worker.current ||
                    !report ||
                    report.projectId !== liveProject.current.id ||
                    report.revision !== liveProject.current.revision
                  )
                    return;
                  try {
                    onPreview(report);
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : 'These matches could not be previewed.'
                    );
                  }
                }}
              >
                <Eye size={12} /> Preview matches
              </button>
            )}
            <button
              type="button"
              className="audience-selection-primary"
              disabled={stale || running}
              onClick={() => commit(false)}
            >
              <Check size={12} /> Replace selection
            </button>
            <button
              type="button"
              disabled={stale || running || report.ids.length === 0}
              onClick={() => commit(true)}
            >
              <Plus size={12} /> Add to selection
            </button>
            {report.ids.length === 0 && <span>Replace clears the current selection.</span>}
          </div>
        </section>
      )}
      <div className="audience-selection-footer">
        <p>
          One instant of sampled geometry and evaluated light state. No occlusion or rendered
          visibility is measured. Selection changes do not edit drone positions or lights.
        </p>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
