import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, Circle, Cpu, Download, LoaderCircle, Radio, RefreshCw, ShieldCheck, Square, Usb, XCircle } from 'lucide-react';
import type { AircraftPort, AircraftSnapshot } from '../aircraft/types';
import type { EscInspection } from '../aircraft/esc-types';
import type { ParameterSnapshot } from '../aircraft/parameters';
import type { AircraftContext } from '../platform/useAircraft';
import { api, downloadFile, errorText } from '../platform/client';
import { refreshEscPrerequisites } from '../platform/esc-client';
import { motorPulseBlockReason, type MotorNumber } from '../components/MotorBenchPanel';
import { Badge, Button, Card, Notice } from '../design-system';
import { check, currentBaseline, defaultProfile, evaluateEscs, fresh, readReports, replaceResults, saveReport, summarizeReport, type BuildProfile, type CheckReport, type CheckResult } from './model';
import { assertIdle, configurationHash, runAutomatic, runRadioCheck, type CheckClient, type RunnerOptions } from './runner';
import './checkup.css';

const steps = ['Prepare', 'Automatic checks', 'Hands-on checks', 'Radio & power', 'Report'];
const labels: Record<CheckResult['state'], string> = { passed: 'Passed', failed: 'Needs a fix', blocked: 'Not verified', unsupported: 'Not covered', pending: 'To do' };
const groupLabels = { connection: 'Connections', configuration: 'Configuration', sensors: 'Sensors & controller', 'hands-on': 'Hands-on', radio: 'Radio & power', field: 'Before flight' };
export function CheckResults({ results, title = 'Check details' }: { results: CheckResult[]; title?: string }) {
  const rank = { failed: 0, blocked: 1, pending: 2, unsupported: 3, passed: 4 };
  return <div className="check-results" aria-label={title}>{[...results].sort((a, b) => rank[a.state] - rank[b.state]).map(r => <details className={`check-result check-result-${r.state}`} key={r.id} open={r.state === 'failed' || r.state === 'blocked' && ['run', 'radio-path', 'esc'].includes(r.id)}>
    <summary>{r.state === 'passed' ? <CheckCircle2 size={17} /> : r.state === 'failed' ? <XCircle size={17} /> : <Circle size={17} />}
      <span>{r.title}<small>{groupLabels[r.group]}{r.source === 'operator' ? ' · Your observation' : ''}</small></span><Badge tone={r.state === 'passed' ? 'success' : r.state === 'failed' ? 'danger' : 'neutral'}>{labels[r.state]}</Badge><ChevronDown size={14} />
    </summary><div><p>{r.detail}</p>{r.state !== 'passed' && <p><strong>Next:</strong> {r.next}</p>}<small>Recorded {new Date(r.at).toLocaleString()}</small></div>
  </details>)}</div>;
}
type ReportStorage = Pick<Storage, 'getItem' | 'setItem'>;
function browserStorage(): ReportStorage | undefined { try { return localStorage; } catch { return undefined; } }
export function DroneCheck({ device, client = api, storage = browserStorage(), timing }: { device: AircraftContext; client?: CheckClient; storage?: ReportStorage; timing?: Pick<RunnerOptions, 'now' | 'wait'> }) {
  const loadHistory = () => storage ? readReports(storage) : [];
  const [step, setStep] = useState(0);
  const [history, setHistory] = useState(loadHistory);
  const [profile, setProfile] = useState<BuildProfile>(() => loadHistory()[0]?.profile ?? defaultProfile);
  const [report, setReport] = useState<CheckReport | null>(null);
  const [historical, setHistorical] = useState(false);
  const [ports, setPorts] = useState<AircraftPort[]>([]);
  const [path, setPath] = useState(device.snapshot?.link.path ?? '');
  const [radioPath, setRadioPath] = useState('');
  const [prepared, setPrepared] = useState(false), [direct, setDirect] = useState(false), [radioPrepared, setRadioPrepared] = useState(false);
  const [busy, setBusy] = useState<'' | 'automatic' | 'radio' | 'esc' | 'motor'>('');
  const [progress, setProgress] = useState(''), [error, setError] = useState(''), [storageError, setStorageError] = useState('');
  const [filter, setFilter] = useState<'attention' | 'all'>('attention');
  const [motor, setMotor] = useState<MotorNumber>(1);
  const [pulse, setPulse] = useState<{ motor: MotorNumber; availableAt: number; state: string } | null>(null);
  const [motorReady, setMotorReady] = useState(false);
  const controller = useRef<AbortController | null>(null), locked = useRef(false), mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const sameDrone = !!report && !historical && !device.error && currentBaseline(report, device.snapshot, device.now);
  const automaticComplete = report?.outcome === 'complete' && !!report.baseline;
  const canObserve = sameDrone && automaticComplete;
  const totals = report ? summarizeReport(report) : null;
  const persist = (next: CheckReport) => {
    try { if (!storage) throw new Error('Storage unavailable'); saveReport(storage, next); if (mounted.current) { setHistory(loadHistory()); setStorageError(''); } }
    catch { if (mounted.current) setStorageError('This report could not be saved on this browser. Download it before leaving.'); }
    if (mounted.current) setReport(next);
  };
  const scan = async () => {
    try { const result = await client<{ ports: AircraftPort[] }>('aircraft/ports'); if (!mounted.current) return; setPorts(result.ports); setError(''); }
    catch (e) { if (mounted.current) setError(errorText(e)); }
  };
  useEffect(() => { mounted.current = true; void scan(); return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => { setPrepared(false); setDirect(false); setMotorReady(false); setPulse(null); }, [device.snapshot?.link.connectedAt, device.snapshot?.link.path]);
  const go = (next: number) => { setStep(next); requestAnimationFrame(() => heading.current?.focus()); };
  const update = (results: CheckResult[]) => { if (report) persist(replaceResults(report, results, Date.now())); };
  const run = async (kind: 'automatic' | 'radio') => {
    if (locked.current || !prepared && kind === 'automatic' || kind === 'automatic' && !direct || kind === 'radio' && (!radioPrepared || !report)) return;
    locked.current = true;
    const abort = new AbortController(); controller.current = abort;
    setBusy(kind); setError(''); setHistorical(false); setProgress('Preparing the check…');
    if (kind === 'automatic') { setReport(null); setPulse(null); setMotorReady(false); go(1); }
    try {
      const options = { profile: kind === 'radio' ? report!.profile : profile, path: kind === 'radio' ? radioPath : path, signal: abort.signal, client, ...timing, progress: (text: string) => { if (mounted.current) setProgress(text); } };
      const next = kind === 'automatic' ? await runAutomatic(options) : replaceResults(report!, await runRadioCheck(options, report!), Date.now());
      persist(next);
    } finally {
      controller.current = null; locked.current = false;
      if (mounted.current) { setBusy(''); setProgress(''); if (kind === 'radio') setRadioPrepared(false); }
    }
  };
  const disconnect = async () => {
    if (locked.current) return;
    locked.current = true; setError('');
    try { const s = await client<AircraftSnapshot>('aircraft/status'); assertIdle(s); await client('aircraft/disconnect', {}); await scan(); }
    catch (e) { setError(errorText(e)); }
    finally { locked.current = false; }
  };
  const assertBaseline = async () => {
    const s = await client<AircraftSnapshot>('aircraft/status');
    if (!report || historical || !currentBaseline(report, s, s.now)) throw new Error('Reconnect the original controller by USB and run a fresh automatic check first.');
    assertIdle(s);
    const p = await client<ParameterSnapshot>(`aircraft/parameters?aircraftId=${encodeURIComponent(report.baseline!.aircraftId)}`);
    if (p.state !== 'complete' || await configurationHash(p) !== report.baseline!.configurationHash) throw new Error('Configuration changed or is incomplete. Rerun automatic checks before continuing.');
    return s;
  };
  const inspectEsc = async () => {
    if (locked.current || !canObserve || !direct || !prepared || !report) return;
    locked.current = true; setBusy('esc'); setError('');
    const currentReport = report;
    try {
      await assertBaseline();
      await refreshEscPrerequisites(currentReport.baseline!.aircraftId, () => !mounted.current, client);
      if (!mounted.current) return;
      await assertBaseline();
      const esc = await client<EscInspection>('aircraft/esc/read', { aircraftId: currentReport.baseline!.aircraftId, propsRemoved: true, directUsb: true });
      persist(replaceResults(currentReport, [evaluateEscs(esc, Date.now())], Date.now()));
    } catch (e) { if (mounted.current) { setError(errorText(e)); update([check('esc', 'Read all four ESCs', 'hands-on', 'blocked', errorText(e), 'Check direct USB, flight battery and supported passthrough configuration; then retry.', Date.now())]); } }
    finally { locked.current = false; if (mounted.current) setBusy(''); }
  };
  const pulseMotor = async () => {
    if (locked.current || !canObserve || !motorReady || !prepared || !report) return;
    locked.current = true; setBusy('motor'); setPulse(null); setError('');
    const n = motor;
    try {
      const s = await assertBaseline();
      const a = s.aircraft.find(a => a.id === report.baseline!.aircraftId);
      const reason = motorPulseBlockReason({ snapshot: s, aircraft: a, now: s.now, busy: false, serviceUnavailable: false });
      if (reason) throw new Error(reason);
      const result = await client<AircraftSnapshot>('aircraft/motor-test', { aircraftId: a!.id, motor: n, propsRemoved: true, areaClear: true, hardwareCool: true });
      if (mounted.current && result.motorTest) setPulse({ motor: n, state: result.motorTest.state, availableAt: result.motorTest.availableAt });
      update([check(`motor-${n}`, `Motor ${String.fromCharCode(64 + n)}: position and direction`, 'hands-on', 'pending', 'A bounded pulse was requested. Movement and direction still need your observation.', 'Wait for the pulse and cooldown, then record what happened.', Date.now(), 'operator')]);
    } catch (e) { if (mounted.current) setError(errorText(e)); }
    finally { locked.current = false; if (mounted.current) setBusy(''); }
  };
  const stopMotor = async () => {
    if (!report?.baseline) return;
    try { await client('aircraft/motor-test-stop', { aircraftId: report.baseline.aircraftId }); setError('Stop requested. Verify the motors have stopped; the command is not physical confirmation.'); setPulse(null); }
    catch (e) { setError(errorText(e)); }
  };
  const observe = (id: string, ok: boolean, detail: string) => {
    const item = report?.results.find(r => r.id === id);
    if (!item || !canObserve || busy) return;
    const next = !ok && id.startsWith('motor-') ? 'Inspect motor mapping, wiring, power and direction before another test.' : item.next;
    update([{ ...item, source: 'operator', state: ok ? 'passed' : 'failed', detail, next, at: Date.now() }]);
  };
  const motorBlock = motorPulseBlockReason({ snapshot: device.snapshot, aircraft: device.aircraft, now: device.now, busy: !!busy, serviceUnavailable: !!device.error });
  const shown = report?.results.filter(r => filter === 'all' || r.state !== 'passed') ?? [];
  const portLabel = (p: AircraftPort) => `${p.manufacturer ?? 'USB device'} · ${p.path}`;
  return <div className="drone-check">
    <header className="check-heading"><div><span className="check-eyebrow">LUCIDITY / GUIDED DIAGNOSTICS</span><h1>Check my drone <Badge>Beta</Badge></h1><p>One place to check your build, find problems, and see what still needs verifying.</p></div><ShieldCheck size={31} aria-hidden="true" /></header>
    <nav className="check-steps" aria-label="Drone check steps">{steps.map((name, i) => <button key={name} type="button" aria-current={step === i ? 'step' : undefined} disabled={!!busy} onClick={() => go(i)}><span>{i + 1}</span>{name}</button>)}</nav>
    {error && <Notice tone="warning" role="alert">{error}</Notice>}
    {storageError && <Notice tone="warning">{storageError}</Notice>}
    {device.error && <Notice tone="warning">The local device service is unavailable. {device.error}</Notice>}
    <section className="check-stage" aria-labelledby="check-stage-title">
      <div className="check-stage-heading"><div><small>STEP {step + 1} OF 5</small><h2 id="check-stage-title" ref={heading} tabIndex={-1}>{steps[step]}</h2></div>{report && <Badge>{report.profile.name}</Badge>}</div>
      {busy === 'automatic' || busy === 'radio' ? <Card className="check-running"><LoaderCircle className="platform-spin" size={28} /><h3>{busy === 'radio' ? 'Checking the radio path' : 'Checking your drone'}</h3><p role="status">{progress}</p><p>Requests and measurements only. This phase does not arm, spin motors, or change saved settings.</p><Button onClick={() => controller.current?.abort()}><Square size={14} />Cancel check</Button><small>Leaving this tool cancels further automatic checks. A request already sent may still finish.</small></Card> : <>
      {step === 0 && <>
        <div className="check-intro"><div><h3>Start with the controller’s USB connection.</h3><p>Connect the flight controller and ground radio to your computer. We’ll check the controller first, then guide you through testing the radio separately.</p><p>Allow about 10 minutes for a supported build, plus any fixes. The automatic phase is shorter; physical checks move at your pace.</p></div><div className="check-path" aria-label="Direct USB check path"><span><Usb size={21} />Computer</span><ArrowRight size={15} /><span><Cpu size={21} />Controller</span><ArrowRight size={15} /><span><Activity size={21} />Your build</span></div></div>
        <div className="check-form-grid"><label>Build name<input className="ds-input" value={profile.name} maxLength={60} onChange={e => setProfile({ ...profile, name: e.target.value })} /></label><label>Flight controller USB<select className="ds-select" value={path} onChange={e => { setPath(e.target.value); setPrepared(false); setDirect(false); }}><option value="">{ports.length ? 'Select the controller’s USB device' : 'No USB devices detected'}</option>{ports.map(p => <option key={p.path} value={p.path}>{portLabel(p)}</option>)}</select></label></div>
        <div className="check-options"><label className="platform-check"><input type="checkbox" checked={profile.gps} onChange={e => setProfile({ ...profile, gps: e.target.checked })} />My build uses GPS-assisted flight.</label><label className="platform-check"><input type="checkbox" checked={profile.radio} onChange={e => setProfile({ ...profile, radio: e.target.checked })} />I use a ground telemetry radio.</label></div>
        <div className="check-preparation"><h3>Before we begin</h3><label className="platform-check"><input type="checkbox" checked={prepared} onChange={e => setPrepared(e.target.checked)} />All propellers are removed, the drone is secure, the flight battery is connected, and other drone apps are closed.</label><label className="platform-check"><input type="checkbox" checked={direct} onChange={e => setDirect(e.target.checked)} />The selected USB device is connected directly to the flight controller.</label></div>
        <div className="check-actions"><Button variant="primary" disabled={!path || !prepared || !direct || !profile.name.trim()} onClick={() => void run('automatic')}>Start automatic checks <ArrowRight size={16} /></Button><Button onClick={() => void scan()}><RefreshCw size={15} />Scan USB</Button>{device.snapshot?.link.state === 'listening' && <Button onClick={() => void disconnect()}>Disconnect current device</Button>}</div>
        <details className="check-scope"><summary>What this beta covers</summary><p>ArduPilot USB at 115200 baud; configuration rules and bounded motor pulses for ArduCopter 4.7.1 stable; supported SiLabs BLHeli_S / Bluejay ESC reads. Other firmware and unreported sensors remain unverified. Expected motor count: four. Physical motors, props, wiring ratings, and battery suitability require inspection.</p><p>Check counts reflect available evidence. We do not turn every parameter into a claimed safety test. Firmware updates and automatic fixes are outside this flow.</p></details>
        {!!history.length && <section className="check-history"><h3>Saved on this computer</h3>{history.map(r => <button key={r.id} onClick={() => { setReport(r); setHistorical(true); go(4); }}><span>{r.profile.name}<small>{new Date(r.finishedAt).toLocaleString()}</small></span><span>View saved report <ArrowRight size={14} /></span></button>)}</section>}
      </>}
      {step === 1 && (report ? <>
        <div className="check-summary"><strong>{totals!.title}</strong><span>{totals!.passed} passed · {totals!.failed} need a fix · {totals!.remaining} still to verify</span></div>
        <p>{report.parameterCount} configuration values received. These are inputs to the checks below, not that many independent safety tests.</p>
        <CheckResults results={report.results.filter(r => ['connection', 'configuration', 'sensors'].includes(r.group))} />
        <div className="check-actions"><Button variant="primary" disabled={!automaticComplete || historical} onClick={() => go(2)}>Continue to hands-on checks <ArrowRight size={16} /></Button><Button onClick={() => go(0)}>Review connection / rerun</Button><Button onClick={() => go(4)}>View report</Button></div>
      </> : <div className="check-empty"><Activity size={30} /><h3>Ready when your drone is connected</h3><p>Choose your controller and confirm the bench setup to start real checks.</p><Button variant="primary" onClick={() => go(0)}>Prepare my drone</Button></div>)}
      {step === 2 && <>
        {!canObserve && <Notice tone="warning">Run a fresh automatic check on the direct USB connection before recording hands-on results. Saved reports are historical.</Notice>}
        <Card><div className="check-card-heading"><div><h3>Read the motor controllers</h3><p>Identify each ESC’s firmware and saved direction setting. Reading may briefly restart ESCs and play startup beeps.</p></div><Cpu size={23} /></div>
          <div className="check-options"><label className="platform-check"><input type="checkbox" checked={prepared} disabled={!!busy} onChange={e => setPrepared(e.target.checked)} />Props are removed, the drone is secure, and the flight battery is connected.</label><label className="platform-check"><input type="checkbox" checked={direct} disabled={!!busy} onChange={e => setDirect(e.target.checked)} />The controller is directly connected by USB.</label></div>
          <Button disabled={!canObserve || !prepared || !direct || !!busy} onClick={() => void inspectEsc()}>{busy === 'esc' ? 'Reading ESCs…' : 'Read ESCs'}</Button>
          {report?.results.find(r => r.id === 'esc') && <CheckResults results={report.results.filter(r => r.id === 'esc')} />}
        </Card>
        <Card><div className="check-card-heading"><div><h3>Observe each motor</h3><p>One motor at a time · 5% · 1 second. Test letters follow the firmware’s sequence; they do not establish physical position.</p></div><Badge tone="warning">Moves real motors</Badge></div>
          <p>Compare the motor that moves and its rotation with the correct diagram for your frame. If you cannot establish the expected mapping, leave this item unverified.</p>
          <div className="check-motors" role="group" aria-label="Motor to check">{([1, 2, 3, 4] as MotorNumber[]).map(n => <Button key={n} aria-pressed={motor === n} disabled={!!busy} onClick={() => setMotor(n)}>{String.fromCharCode(64 + n)}{report?.results.find(r => r.id === `motor-${n}`)?.state === 'passed' && <Check size={14} />}</Button>)}</div>
          <label className="platform-check check-confirm"><input type="checkbox" checked={motorReady} disabled={!!busy} onChange={e => setMotorReady(e.target.checked)} />Props are removed; the area is clear, hardware is cool, and I am ready to watch this motor.</label>
          <div className="check-actions"><Button variant="primary" disabled={!canObserve || !prepared || !motorReady || !!motorBlock} onClick={() => void pulseMotor()}>Pulse motor {String.fromCharCode(64 + motor)}</Button><Button variant="danger" disabled={!report?.baseline || !(busy === 'motor' || pulse)} onClick={() => void stopMotor()}><Square size={14} />Stop motor test</Button></div>
          {motorBlock && <p className="check-help">{motorBlock}</p>}
          {pulse && <div className="check-observation"><p>Motor {String.fromCharCode(64 + pulse.motor)}: command {pulse.state}. {device.now < pulse.availableAt ? 'Wait for the cooldown before recording.' : 'What did you observe?'}</p><div className="check-actions"><Button disabled={!canObserve || !!busy || device.now < pulse.availableAt} onClick={() => observe(`motor-${pulse.motor}`, true, `Operator observed motor ${String.fromCharCode(64 + pulse.motor)} in the expected position and direction for their frame after a bounded pulse.`)}>Correct motor and direction</Button><Button disabled={!canObserve || !!busy || device.now < pulse.availableAt} onClick={() => observe(`motor-${pulse.motor}`, false, 'Operator observed the wrong motor, incorrect direction, or no movement. Inspect mapping, wiring and power before another test.')}>Wrong / no movement</Button></div><small>These are your observations. A command acknowledgement does not prove movement.</small></div>}
          {report && <CheckResults results={report.results.filter(r => r.id.startsWith('motor-'))} />}
        </Card>
        <Card><h3>Check movement and assembly</h3><div className="check-live-readings"><span>Roll <strong>{device.live && fresh(device.aircraft?.attitude?.receivedAt, device.now) ? `${device.aircraft!.attitude!.rollDeg.toFixed(1)}°` : 'Unavailable'}</strong></span><span>Pitch <strong>{device.live && fresh(device.aircraft?.attitude?.receivedAt, device.now) ? `${device.aircraft!.attitude!.pitchDeg.toFixed(1)}°` : 'Unavailable'}</strong></span></div>
          <p>Gently tilt the drone. Roll should follow side-to-side tilt and pitch should follow nose-up/down movement with the expected sign for your controller’s orientation.</p>
          <div className="check-actions"><Button disabled={!canObserve || !!busy || !fresh(device.aircraft?.attitude?.receivedAt, device.now)} onClick={() => observe('orientation', true, 'Operator compared live roll/pitch to physical movement and confirmed the configured orientation.')}>Orientation matches</Button><Button disabled={!canObserve || !!busy} onClick={() => observe('orientation', false, 'Operator observed an orientation mismatch.')}>Does not match</Button></div>
          <h4>Receiver channels</h4><div className="check-channels">{device.live && fresh(device.aircraft?.receiver?.receivedAt, device.now) ? device.aircraft?.receiver?.channels.map((v, i) => <span key={i}>CH {i + 1}<strong>{v ?? '—'}</strong></span>) : <p>Live receiver channels are not available. This check remains unverified.</p>}</div><p>Move each stick and required switch. Confirm the expected channel, direction, endpoints and switch positions.</p>
          <div className="check-actions"><Button disabled={!canObserve || !!busy || !fresh(device.aircraft?.receiver?.receivedAt, device.now)} onClick={() => observe('receiver-motion', true, 'Operator checked primary sticks and required switches against their receiver mapping using live channel values.')}>Inputs match my setup</Button><Button disabled={!canObserve || !!busy} onClick={() => observe('receiver-motion', false, 'Operator observed missing or incorrect receiver movement or switch mapping.')}>Inputs need a fix</Button></div>
          <h4>Physical inspection</h4><p>With power disconnected, inspect solder joints, connectors, fasteners, wire clearance and motor mounting. Record a completed inspection after reconnecting and checking the build.</p><Button disabled={!canObserve || !!busy} onClick={() => observe('assembly', true, 'Operator confirms completing a power-disconnected inspection of wiring, connectors, fasteners and motor clearance for this build.')}>I completed the physical inspection</Button>
          {report && <CheckResults results={report.results.filter(r => ['orientation', 'receiver-motion', 'assembly'].includes(r.id))} />}
        </Card><div className="check-actions"><Button variant="primary" disabled={!!busy} onClick={() => go(report?.profile.radio ? 3 : 4)}>Continue with outstanding items <ArrowRight size={16} /></Button></div>
      </>}
      {step === 3 && <>
        <div className="check-intro"><div><h3>Prove the radio works without the USB shortcut.</h3><p>Leave the ground radio attached to the computer. Unplug the controller’s USB cable and keep the drone powered by its flight battery. Then select the ground radio below.</p><p>We compare the controller hardware UID and configuration, request a response over radio, and observe the link for 12 seconds.</p></div><div className="check-path"><span><Usb size={21} />Computer</span><ArrowRight size={15} /><span><Radio size={21} />Radio</span><ArrowRight size={15} /><span><Cpu size={21} />Drone</span></div></div>
        {!report?.baseline?.uid && <Notice tone="warning">A completed USB baseline with a controller hardware UID is required before this check.</Notice>}
        {report && !report.profile.radio && <Notice>This build was recorded without a ground radio. Start a new check with that option enabled if you add one.</Notice>}
        <div className="check-form-grid"><label>Ground radio USB<select className="ds-select" value={radioPath} onChange={e => { setRadioPath(e.target.value); setRadioPrepared(false); }}><option value="">Choose the ground radio</option>{ports.filter(p => p.path !== report?.baseline?.path).map(p => <option key={p.path} value={p.path}>{portLabel(p)}</option>)}</select></label><Button onClick={() => void scan()}><RefreshCw size={15} />Scan USB</Button></div>
        <label className="platform-check check-confirm"><input type="checkbox" checked={radioPrepared} onChange={e => setRadioPrepared(e.target.checked)} />Controller USB is unplugged, props are removed, and the flight battery is powering the drone and air radio.</label>
        <div className="check-actions"><Button variant="primary" disabled={!radioPath || !radioPrepared || !report?.baseline?.uid || !report.profile.radio || historical} onClick={() => void run('radio')}>Switch to radio and check <ArrowRight size={16} /></Button><Button onClick={() => go(4)}>Continue to report</Button></div>
        {report && <CheckResults results={report.results.filter(r => r.group === 'radio')} />}
        <Notice>Nearby communication does not establish usable flight range. Range and operational failsafe checks remain in your report.</Notice>
      </>}
      {step === 4 && (report ? <>
        <div className="check-summary"><strong>{totals!.title}</strong><span>{totals!.passed} passed · {totals!.failed} need a fix · {totals!.remaining} still to verify</span></div>
        <Notice tone="warning">{historical ? 'Saved report — historical evidence.' : 'This report records observations from this session.'} It is not flight clearance. Recheck after hardware, firmware, configuration or power changes; complete fresh preflight checks at the flight site.</Notice>
        <div className="check-report-meta"><span>Build<strong>{report.profile.name}</strong></span><span>Controller<strong>{report.baseline ? `ArduPilot ${report.baseline.firmware}` : 'Not identified'}</strong></span><span>Recorded<strong>{new Date(report.finishedAt).toLocaleString()}</strong></span><span>Rules<strong>{report.ruleset}</strong></span></div>
        <div className="check-actions"><Button variant="primary" onClick={() => downloadFile(`lucidity-drone-check-${new Date(report.startedAt).toISOString().slice(0, 10)}.json`, JSON.stringify(report, null, 2))}><Download size={16} />Download report</Button><Button onClick={() => { setReport(null); setHistorical(false); setPrepared(false); setDirect(false); setPulse(null); go(0); }}>Start a fresh check</Button></div>
        <div className="check-filter" role="group" aria-label="Report filter"><Button aria-pressed={filter === 'attention'} onClick={() => setFilter('attention')}>Needs attention ({report.results.filter(r => r.state !== 'passed').length})</Button><Button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All checks ({report.results.length})</Button></div>
        <CheckResults results={shown} />
        {!historical && <div className="check-actions"><Button onClick={() => go(2)}>Review hands-on checks</Button><Button onClick={() => go(3)}>Retest radio path</Button></div>}
      </> : <div className="check-empty"><ShieldCheck size={30} /><h3>Your report will appear here</h3><p>Run checks to create a report backed by device readings and your observations.</p><Button variant="primary" onClick={() => go(0)}>Prepare my drone</Button></div>)}
      </>}
    </section>
    <footer className="check-footer"><span><ShieldCheck size={14} />Beta · Results describe only what was checked.</span>{step > 0 && !busy && <Button variant="ghost" onClick={() => go(step - 1)}><ArrowLeft size={14} />Back</Button>}</footer>
  </div>;
}
