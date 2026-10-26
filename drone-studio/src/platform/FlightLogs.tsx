import { useEffect, useState } from 'react';
import { Activity, Download, FileSearch, LoaderCircle, OctagonX, RefreshCw } from 'lucide-react';
import type { AircraftContext } from './useAircraft';
import { api, errorText } from './client';
import { Connection } from './Connection';
import { analyzeDataFlash, type FlightLogAnalysis, type NumericSummary } from '../aircraft/dataflash-analysis';
import './FlightLogs.css';

const MAX_WIRE_LOG_BYTES = 16 * 1024 * 1024;
const MAX_LOCAL_LOG_BYTES = 64 * 1024 * 1024;

interface OnboardLog {
  id: number;
  size: number;
  timeUtc?: number;
}

interface FlightLogStatus {
  state: 'idle' | 'listing' | 'downloading' | 'complete' | 'error';
  entries: OnboardLog[];
  progress: { received: number; total: number } | null;
  error: string | null;
  artifact: {
    name: string;
    downloadUrl: string;
    analysis: FlightLogAnalysis | null;
    analysisError?: string;
  } | null;
}

type ReportRecord = Record<string, unknown>;
const record = (value: unknown): value is ReportRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const numberText = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);
const flightTime = (seconds: number | null | undefined) => {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  return seconds < 60 ? `${seconds.toFixed(1)} s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
};

function bytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return 'Size unknown';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function logTime(timeUtc?: number) {
  if (!timeUtc || !Number.isFinite(timeUtc)) return 'Time not reported';
  const date = new Date(timeUtc * 1000);
  return Number.isNaN(date.getTime()) ? 'Time not reported' : date.toLocaleString();
}

type TracePoint = { timeSeconds: number };

function TraceChart({ title, points, channels, unit }: {
  title: string;
  points: TracePoint[];
  channels: { key: string; name: string; color: string }[];
  unit: string;
}) {
  const values = points.flatMap((point) => channels.map((channel) => (point as Record<string, number>)[channel.key])).filter(Number.isFinite);
  if (points.length < 2 || values.length < 2) return null;
  const first = Math.min(...points.map((point) => point.timeSeconds));
  const last = Math.max(...points.map((point) => point.timeSeconds));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(0.001, max - min);
  const x = (time: number) => 18 + (time - first) / Math.max(0.001, last - first) * 564;
  const y = (value: number) => 120 - (value - min) / span * 102;
  return <div className="flight-log-chart">
    <div className="flight-log-chart-top"><h4>{title}</h4><span>{numberText(min)}–{numberText(max)} {unit}</span></div>
    <svg viewBox="0 0 600 140" role="img" aria-label={`${title} from ${flightTime(first)} to ${flightTime(last)}`} preserveAspectRatio="none">
      <path d="M18 18 H582 M18 69 H582 M18 120 H582" className="flight-log-chart-grid" />
      {channels.map((channel) => <polyline key={channel.key} points={points.filter((point) => Number.isFinite((point as Record<string, number>)[channel.key])).map((point) => `${x(point.timeSeconds).toFixed(1)},${y((point as Record<string, number>)[channel.key]).toFixed(1)}`).join(' ')} fill="none" stroke={channel.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
    </svg>
    <div className="flight-log-chart-bottom"><span>{flightTime(first)}</span><span>{channels.map((channel) => <span key={channel.key} className="flight-log-legend"><i style={{ background: channel.color }} />{channel.name}</span>)}</span><span>{flightTime(last)}</span></div>
  </div>;
}

function Metric({ name, value, unit }: { name: string; value: NumericSummary | null | undefined; unit: string }) {
  return <div className="flight-log-metric">
    <strong>{name}</strong>
    {value ? <><span>95th percentile <b>{numberText(value.p95)} {unit}</b></span><span>Peak <b>{numberText(value.peak)} {unit}</b>{value.peakTimeSeconds !== null ? ` at ${flightTime(value.peakTimeSeconds)}` : ''}</span><small>{value.samples.toLocaleString()} samples</small></> : <span>No samples in this log</span>}
  </div>;
}

function FlightReport({ analysis }: { analysis: unknown }) {
  if (!record(analysis) || analysis.format !== 'ArduPilot DataFlash')
    return <p>Log saved. Lucidity could not create a structured ArduPilot DataFlash report from this file.</p>;
  const report = analysis as FlightLogAnalysis;
  const sensors = report.vibration?.sensors ?? [];
  const sensor = sensors.find((item) => item.imu === 0) ?? sensors[0] ?? null;
  const vibrationTrace = report.traces.vibration.filter((point) => point.imu === (sensor?.imu ?? 0));
  return <div className="flight-log-report">
    <div className="flight-log-report-overview">
      <span><strong>{flightTime(report.durationSeconds)}</strong> recorded span</span>
      <span><strong>{report.parsedRecords.toLocaleString()}</strong> parsed records</span>
      <span><strong>{bytes(report.bytes)}</strong> file size</span>
    </div>

    <section aria-label="Vibration and throttle review">
      <h3>Vibration & throttle</h3>
      <p className="flight-log-hint"><a href="https://docs.ardupilot.org/planner/docs/common-measuring-vibration.html" target="_blank" rel="noreferrer">ArduPilot’s vibration guidance</a> says VibeX, VibeY, and VibeZ should be mostly below 30 m/s² during flight. That guidance applies to each axis, not the calculated combined magnitude. These values span the recording, which may include ground time; confirm the airborne interval in the original log.</p>
      <div className="flight-log-metric-grid">
        {sensors.length ? sensors.flatMap((item) => [
          <Metric key={`${item.imu}-x`} name={`IMU ${item.imu} VibeX`} value={item.vibeX} unit="m/s²" />,
          <Metric key={`${item.imu}-y`} name={`IMU ${item.imu} VibeY`} value={item.vibeY} unit="m/s²" />,
          <Metric key={`${item.imu}-z`} name={`IMU ${item.imu} VibeZ`} value={item.vibeZ} unit="m/s²" />,
          <Metric key={`${item.imu}-magnitude`} name={`IMU ${item.imu} combined magnitude`} value={item.magnitude} unit="m/s²" />,
          <div className="flight-log-metric" key={`${item.imu}-clipping`}><strong>IMU {item.imu} clipping</strong><span>{item.clippingEvents === null ? 'Not reported' : `${item.clippingEvents.toLocaleString()} observed clip-counter increase`}</span></div>,
        ]) : <Metric name="Vibration" value={null} unit="m/s²" />}
        <div className="flight-log-metric"><strong>Exploratory whole-log co-movement</strong><span>{report.throttle?.vibrationCorrelation === null || report.throttle?.vibrationCorrelation === undefined ? 'Not enough paired data' : `${numberText(report.throttle.vibrationCorrelation, 2)} throttle / combined vibration magnitude correlation`}</span><small>{report.throttle?.pairedVibrationSamples ?? 0} paired samples · includes ground time and possible mode changes; cannot identify a faulty part</small></div>
      </div>
      <TraceChart title="VIBE axes and combined magnitude over recorded time" points={vibrationTrace} channels={[
        { key: 'vibeXMs2', name: 'VibeX', color: 'var(--ds-axis-x)' },
        { key: 'vibeYMs2', name: 'VibeY', color: 'var(--ds-axis-y)' },
        { key: 'vibeZMs2', name: 'VibeZ', color: 'var(--ds-axis-z)' },
        { key: 'magnitudeMs2', name: 'Combined magnitude', color: 'var(--p-accent)' }, // gitleaks:allow -- public chart field and CSS variable
      ]} unit="m/s²" />
    </section>

    <section aria-label="Attitude and rate tracking review">
      <h3>Flight control tracking</h3>
      <p className="flight-log-hint">Error is the gap between requested and measured motion. Peaks are clues to inspect alongside the original log.</p>
      <div className="flight-log-metric-grid">
        <Metric name="Roll attitude error" value={report.attitude?.rollErrorDeg} unit="°" />
        <Metric name="Pitch attitude error" value={report.attitude?.pitchErrorDeg} unit="°" />
        <Metric name="Yaw attitude error" value={report.attitude?.yawErrorDeg} unit="°" />
        <Metric name="Roll rate error" value={report.rate?.rollErrorDegS} unit="°/s" />
        <Metric name="Pitch rate error" value={report.rate?.pitchErrorDegS} unit="°/s" />
        <Metric name="Yaw rate error" value={report.rate?.yawErrorDegS} unit="°/s" />
      </div>
      <details className="flight-log-traces"><summary>Explore attitude and throttle traces</summary>
        <TraceChart title="Roll · actual and desired" points={report.traces.attitude} channels={[{ key: 'rollDeg', name: 'Actual', color: 'var(--p-accent)' }, { key: 'desiredRollDeg', name: 'Desired', color: 'var(--p-lilac)' }]} unit="°" />
        <TraceChart title="Pitch · actual and desired" points={report.traces.attitude} channels={[{ key: 'pitchDeg', name: 'Actual', color: 'var(--p-accent)' }, { key: 'desiredPitchDeg', name: 'Desired', color: 'var(--p-lilac)' }]} unit="°" />
        <TraceChart title="Throttle output" points={report.traces.throttle} channels={[{ key: 'output', name: 'Output', color: 'var(--p-accent)' }]} unit="logged output" />
      </details>
    </section>

    <section aria-label="Recorded channels and limitations">
      <h3>Recorded evidence</h3>
      <div className="flight-log-groups">{Object.entries(report.groups).map(([group, count]) => <span key={group}><b>{group}</b> {count.toLocaleString()}</span>)}</div>
      {(report.truncated || report.skippedBytes > 0) && <p className="flight-log-hint">{report.truncated ? 'The file ended within a record. ' : ''}{report.skippedBytes > 0 ? `${report.skippedBytes.toLocaleString()} bytes could not be assigned to parsed records.` : ''}</p>}
      {report.battery && <p className="flight-log-hint">Battery: {numberText(report.battery.voltageMinV, 2)}–{numberText(report.battery.voltageMaxV, 2)} V recorded; peak current {numberText(report.battery.currentMaxA, 1)} A.</p>}
      {report.modes.length > 0 && <p className="flight-log-hint">Mode records: {report.modes.map((mode) => `${mode.mode} at ${flightTime(mode.timeSeconds)}`).join(' · ')}</p>}
      {report.caveats.length > 0 && <ul className="flight-log-caveats">{report.caveats.map((item, index) => <li key={index}>{item}</li>)}</ul>}
    </section>
    <details className="flight-log-raw"><summary>Technical report</summary><pre>{JSON.stringify(report, null, 2)}</pre></details>
  </div>;
}

export function FlightLogs({ device }: { device: AircraftContext }) {
  const [status, setStatus] = useState<FlightLogStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [pending, setPending] = useState<'list' | 'download' | 'cancel' | null>(null);
  const [prepared, setPrepared] = useState(false);
  const [requestedList, setRequestedList] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState('');
  const [imported, setImported] = useState<{ name: string; analysis: FlightLogAnalysis } | null>(null);
  const [reportSource, setReportSource] = useState<'onboard' | 'local'>('onboard');

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<FlightLogStatus>('aircraft/logs/status', undefined, controller.signal);
        if (!controller.signal.aborted) { setStatus(next); setLoadError(''); }
      } catch (cause) {
        if (!controller.signal.aborted) setLoadError(errorText(cause));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 1000);
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);

  useEffect(() => setPrepared(false), [device.snapshot?.link.connectedAt, device.selectedId]);
  useEffect(() => { if (status?.artifact?.name) setReportSource('onboard'); }, [status?.artifact?.name]);

  const connected = device.live && !!device.aircraft;
  const ardupilot = device.aircraft?.heartbeat.autopilot === 3;
  const armed = !!device.aircraft?.heartbeat.armed;
  const liveAircraft = device.snapshot?.aircraft.filter((aircraft) =>
    device.now - aircraft.heartbeat.receivedAt >= 0 &&
    device.now - aircraft.heartbeat.receivedAt < 5000
  ) ?? [];
  const oneAircraft = liveAircraft.length === 1;
  const transferring = status?.state === 'listing' || status?.state === 'downloading';
  const canRead = connected && ardupilot && !armed && oneAircraft && prepared && !pending && !transferring;
  const entries = [...(status?.entries ?? [])].sort((a, b) => b.id - a.id);
  const progress = status?.progress;
  const progressPercent = progress && progress.total > 0
    ? Math.max(0, Math.min(100, Math.round(progress.received / progress.total * 100))) : null;

  const run = async (kind: 'list' | 'download' | 'cancel', logId?: number) => {
    if (pending === 'cancel' || (pending && kind !== 'cancel')) return;
    setPending(kind);
    setActionError('');
    if (kind === 'download') setReportSource('onboard');
    try {
      const path = kind === 'list' ? 'aircraft/logs/list' : kind === 'download' ? 'aircraft/logs/download' : 'aircraft/logs/cancel';
      const body = kind === 'cancel' ? {} : kind === 'list'
        ? { aircraftId: device.selectedId }
        : { aircraftId: device.selectedId, logId };
      await api(path, body);
      if (kind === 'list') setRequestedList(true);
      if (kind === 'cancel' && status?.state === 'listing') setRequestedList(false);
      setStatus(await api<FlightLogStatus>('aircraft/logs/status'));
    } catch (cause) {
      setActionError(errorText(cause));
    } finally {
      setPending((current) => current === kind ? null : current);
    }
  };

  const importLog = async (file: File | undefined) => {
    if (!file) return;
    setImportBusy(true);
    setImportError('');
    try {
      if (!file.size || file.size > MAX_LOCAL_LOG_BYTES)
        throw new Error('Choose a nonempty ArduPilot .BIN file of 64 MiB or less.');
      const analysis = analyzeDataFlash(new Uint8Array(await file.arrayBuffer()));
      setImported({ name: file.name, analysis });
      setReportSource('local');
    } catch (cause) {
      setImportError(errorText(cause));
    } finally {
      setImportBusy(false);
    }
  };

  return <div className="platform-stack flight-logs">
    <div className="platform-card flight-log-intro">
      <FileSearch size={23} aria-hidden="true" />
      <div>
        <h2>Review a recorded flight</h2>
        <p>Retrieve the flight controller’s onboard log, inspect its evidence, and save the original file. This tool is read-only: it does not arm, run motors, or change settings.</p>
      </div>
    </div>

    {!connected && <Connection device={device} compact guidance="Remove every propeller, disarm, and close other drone apps. Direct flight-controller USB with the flight battery off is best for large logs; the ground radio can also be used with the aircraft powered." />}

    <section className="platform-card flight-log-list" aria-label="Onboard flight logs">
      <div className="flight-log-heading">
        <div>
          <span className="platform-eyebrow">AIRCRAFT RECORDINGS</span>
          <h2>Onboard logs</h2>
          <p>{connected ? `System ${device.aircraft?.systemId} · ${armed ? 'Armed' : 'Disarmed'} · ${device.aircraft?.heartbeat.mode}` : 'Connect a disarmed ArduPilot aircraft to list its logs.'}</p>
        </div>
        {connected && <span className="flight-log-live"><Activity size={14} /> Live link</span>}
      </div>

      {connected && !ardupilot && <p className="platform-error">This aircraft is not reporting ArduPilot. Onboard DataFlash log review is available for ArduPilot only.</p>}
      {connected && armed && <p className="platform-error">Disarm before reading onboard logs.</p>}
      {connected && !oneAircraft && <p className="platform-error">More than one aircraft is responding. Power only the aircraft whose log you want to inspect.</p>}
      <label className="platform-check">
        <input type="checkbox" checked={prepared} disabled={!!pending || !!transferring || !connected || armed} onChange={(event) => setPrepared(event.target.checked)} />
        Propellers are removed and the aircraft is secure.
      </label>
      <div className="platform-actions">
        <button className="platform-primary" disabled={!canRead} onClick={() => void run('list')}>
          {pending === 'list' || status?.state === 'listing' ? <LoaderCircle className="platform-spin" size={16} /> : <RefreshCw size={16} />}
          {status?.state === 'listing' ? 'Reading log list…' : 'Find flight logs'}
        </button>
        {(transferring || pending === 'list' || pending === 'download') && <button className="platform-stop" disabled={pending === 'cancel'} onClick={() => void run('cancel')}><OctagonX size={15} /> Cancel transfer</button>}
      </div>
      {loadError && <p className="platform-error" role="alert">Log service unavailable: {loadError}</p>}
      {actionError && <p className="platform-error" role="alert">{actionError}</p>}
      {status?.error && <p className="platform-error" role="alert">{status.error}</p>}
      {transferring && <div className="flight-log-progress" role="status" aria-live="polite">
        <strong>{status.state === 'listing' ? 'Finding onboard logs' : 'Downloading flight log'}</strong>
        <span>{progress ? `${bytes(progress.received)} of ${bytes(progress.total)}` : 'Waiting for aircraft response…'}</span>
        {progress && <progress aria-label="Flight log transfer progress" value={progress.received} max={Math.max(1, progress.total)} />}
        {progressPercent !== null && <span>{progressPercent}%</span>}
      </div>}

      {entries.length > 0 && <div className="flight-log-entries" role="list">
        {entries.map((entry) => <div className="flight-log-entry" role="listitem" key={entry.id}>
          <div><strong>Flight log {entry.id}</strong><span>{logTime(entry.timeUtc)} · {bytes(entry.size)}</span>{entry.size > MAX_WIRE_LOG_BYTES && <small>Too large for Lucidity’s 16 MiB onboard transfer. Import a local .BIN below if available.</small>}</div>
          <button className="platform-button" disabled={!canRead || entry.size <= 0 || entry.size > MAX_WIRE_LOG_BYTES} onClick={() => void run('download', entry.id)}>
            <FileSearch size={15} /> {entry.size > MAX_WIRE_LOG_BYTES ? 'Too large' : 'Inspect'}
          </button>
        </div>)}
      </div>}
      {status && status.state !== 'listing' && entries.length === 0 && !status.error &&
        <p className="flight-log-empty">{requestedList ? 'No recorded logs were returned. Check that ArduPilot onboard logging is enabled and a flight was recorded.' : <>No onboard logs listed yet. Use <strong>Find flight logs</strong> after connecting.</>}</p>}
    </section>

    <section className="platform-card flight-log-import" aria-label="Open local flight log">
      <div><span className="platform-eyebrow">LOCAL ALTERNATIVE</span><h2>Open a .BIN file</h2><p>Analyze an existing ArduPilot log on this device, even without an aircraft connection. Files up to 64 MiB stay in this browser; nothing is uploaded.</p></div>
      <label className="platform-button flight-log-file-button">
        {importBusy ? <LoaderCircle className="platform-spin" size={15} /> : <FileSearch size={15} />}
        {importBusy ? 'Analyzing…' : 'Choose .BIN file'}
        <input type="file" accept=".bin,application/octet-stream" disabled={importBusy} onChange={(event) => { void importLog(event.target.files?.[0]); event.target.value = ''; }} />
      </label>
      {importError && <p className="platform-error" role="alert">{importError}</p>}
    </section>

    {(reportSource === 'local' ? imported : status?.artifact) && <section className="platform-card flight-log-result" aria-label="Flight log report">
      <div className="flight-log-heading">
        <div><span className="platform-eyebrow">{reportSource === 'local' ? 'LOCAL FILE · NO UPLOAD' : 'ONBOARD LOG · READ-ONLY REPORT'}</span><h2>{reportSource === 'local' ? imported?.name : status?.artifact?.name}</h2></div>
        {reportSource === 'onboard' && status?.artifact && <a className="platform-button" href={status.artifact.downloadUrl} download={status.artifact.name}><Download size={15} /> Save .BIN</a>}
      </div>
      {reportSource === 'onboard' && status?.artifact?.analysisError && <p className="platform-notice" role="status">The original log is saved, but Lucidity could not analyze it: {status.artifact.analysisError}</p>}
      <FlightReport analysis={reportSource === 'local' ? imported?.analysis : status?.artifact?.analysis} />
      <p className="flight-log-caution">A log can narrow the cause of a wobble, but it cannot prove prop fit, motor condition, frame stiffness, or wiring. Keep the aircraft grounded if it shivers in flight.</p>
    </section>}
  </div>;
}
