import type { AircraftSnapshot, AircraftPort, AircraftTelemetry } from '../aircraft/types';
import type { ParameterSnapshot } from '../aircraft/parameters';
import { api } from '../platform/client';
import { check, emptyReport, evaluateAutomatic, fresh, replaceResults, type BuildProfile, type CheckReport, type CheckResult } from './model';

export type CheckClient = <T>(path: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
export interface RunnerOptions {
  profile: BuildProfile; path: string; signal: AbortSignal;
  progress: (text: string) => void;
  client?: CheckClient; now?: () => number; wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}
export function waitForCheck(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new Error('Check cancelled.')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
export function assertIdle(s: AircraftSnapshot) {
  if (s.aircraft.some(a => a.heartbeat.armed)) throw new Error('The aircraft reports armed. Disarm it before checking.');
  if (s.esc?.state === 'reading' || s.escStartup?.state === 'installing' || s.request?.state === 'pending' ||
      s.motorTest && (s.motorTest.state === 'pending' || s.now < s.motorTest.availableAt) ||
      s.benchShow && ['running', 'stopping'].includes(s.benchShow.state) ||
      s.zorroStop && ['arming', 'running', 'stopping'].includes(s.zorroStop.state))
    throw new Error('Another device operation is active. Finish or stop it before starting a check.');
}
function target(s: AircraftSnapshot) {
  if (s.link.state !== 'listening') throw new Error('The device connection is no longer open. Check the cable and power.');
  if (s.aircraft.length !== 1) throw new Error('Exactly one aircraft must respond. Power only the drone you want to check.');
  const a = s.aircraft[0];
  if (!fresh(a.heartbeat.receivedAt, s.now)) throw new Error('Aircraft heartbeat stopped or became stale. Check power and the connection.');
  if (a.heartbeat.armed) throw new Error('Aircraft armed during the check. Checks stopped. Disarm before retrying.');
  if (a.heartbeat.autopilot !== 3 || a.componentId !== 1 || a.signing !== 'unsigned') throw new Error('This beta requires a supported unsigned ArduPilot autopilot connection.');
  return a;
}
function sameConnection(s: AircraftSnapshot, first: AircraftSnapshot, a: AircraftTelemetry) {
  const current = target(s);
  if (s.link.path !== first.link.path || s.link.connectedAt !== first.link.connectedAt || current.id !== a.id ||
      a.version?.uid && current.version?.uid !== a.version.uid)
    throw new Error('The aircraft or connection changed. Start a new check; previous results are historical.');
  return current;
}
function io(options: RunnerOptions) {
  const client = options.client ?? api, wait = options.wait ?? waitForCheck;
  const call: CheckClient = async <T>(path: string, body?: unknown) => {
    options.signal.throwIfAborted();
    const timeout = AbortSignal.timeout(15000);
    const value = await client<T>(path, body, AbortSignal.any([options.signal, timeout]));
    options.signal.throwIfAborted();
    return value;
  };
  return { call, wait };
}
async function connect(options: RunnerOptions, call: CheckClient, wait: RunnerOptions['wait'] & {}) {
  let s = await call<AircraftSnapshot>('aircraft/status');
  assertIdle(s);
  if (s.link.state === 'listening' && s.link.path !== options.path) throw new Error('Another USB device is connected. Use Disconnect here before selecting this device.');
  if (s.link.state !== 'listening') s = await call<AircraftSnapshot>('aircraft/connect', { path: options.path, baudRate: 115200 });
  options.progress('Listening for one disarmed aircraft…');
  for (let i = 0; i < 20; i++) {
    options.signal.throwIfAborted();
    s = await call<AircraftSnapshot>('aircraft/status');
    if (s.link.path !== options.path || s.link.state !== 'listening') throw new Error('USB connection closed or changed while waiting for the aircraft.');
    if (s.aircraft.length) { const a = target(s); return { snapshot: s, aircraft: a }; }
    await wait(750, options.signal);
  }
  throw new Error('USB opened, but no aircraft heartbeat arrived. Check aircraft power. For a radio, check the air-radio link and its connection to the controller.');
}
export async function configurationHash(parameters: ParameterSnapshot): Promise<string> {
  const data = JSON.stringify(parameters.parameters.map(p => [p.name, p.type, p.value]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function collectParameters(options: RunnerOptions, call: CheckClient, wait: (ms: number, signal: AbortSignal) => Promise<void>, first: AircraftSnapshot, a: AircraftTelemetry) {
  let p = await call<ParameterSnapshot>('aircraft/parameters/read', { aircraftId: a.id });
  for (let i = 0; i < 32 && p.state === 'reading'; i++) {
    options.progress(`Reading configuration · ${p.received} of ${p.expected || '?'} values…`);
    await wait(1000, options.signal);
    sameConnection(await call<AircraftSnapshot>('aircraft/status'), first, a);
    p = await call<ParameterSnapshot>(`aircraft/parameters?aircraftId=${encodeURIComponent(a.id)}`);
  }
  return p;
}
async function observe(options: RunnerOptions, call: CheckClient, wait: (ms: number, signal: AbortSignal) => Promise<void>, first: AircraftSnapshot, a: AircraftTelemetry) {
  const initial = await call<AircraftSnapshot>('aircraft/status');
  sameConnection(initial, first, a);
  let last = initial, largestAge = 0;
  const heartbeats = new Set<number>();
  for (let i = 0; i < 12; i++) {
    options.progress(`Observing the connection · ${i + 1} of 12 samples…`);
    await wait(1000, options.signal);
    last = await call<AircraftSnapshot>('aircraft/status');
    const current = sameConnection(last, first, a);
    heartbeats.add(current.heartbeat.receivedAt);
    largestAge = Math.max(largestAge, last.now - current.heartbeat.receivedAt);
  }
  const packets = last.link.packetsReceived - initial.link.packetsReceived;
  const invalid = last.link.invalidFrames - initial.link.invalidFrames;
  const elapsed = last.now - initial.now;
  const passed = elapsed >= 10000 && heartbeats.size >= 3 && packets > 0 && invalid === 0;
  return { snapshot: last, result: check('link-window', 'Connection observation window', 'connection', passed ? 'passed' : 'failed',
    `${Math.round(elapsed / 1000)} s · ${packets} valid packets · ${invalid} invalid frames · ${heartbeats.size} fresh heartbeat times · largest observed heartbeat age ${largestAge} ms. This is a nearby bench observation, not an RF range test.`,
    'Check the USB cable, radio link and electrical noise, then rerun. A stationary sample does not establish range or loaded performance.', last.now) };
}
export async function runAutomatic(options: RunnerOptions): Promise<CheckReport> {
  const now = options.now ?? Date.now;
  let report = emptyReport(options.profile, now(), crypto.randomUUID());
  const { call, wait } = io(options);
  try {
    options.progress('Opening the selected USB device…');
    const { snapshot: first, aircraft: initial } = await connect(options, call, wait);
    options.progress('Requesting fresh firmware and telemetry…');
    let snapshot = await call<AircraftSnapshot>('aircraft/request-telemetry', { aircraftId: initial.id });
    const a = sameConnection(snapshot, first, initial);
    const parameters = await collectParameters(options, call, wait, first, a);
    const observed = await observe(options, call, wait, first, a);
    report = replaceResults(report, [observed.result], now());
    let prearmAt: number | undefined;
    options.progress('Requesting the controller’s pre-arm checks…');
    try { prearmAt = (await call<{ requestedAt: number }>('aircraft/prearm-check', { aircraftId: a.id })).requestedAt; }
    catch (e) { if (options.signal.aborted) throw e; }
    await wait(3000, options.signal);
    snapshot = await call<AircraftSnapshot>('aircraft/status');
    const current = sameConnection(snapshot, first, a);
    const rules = evaluateAutomatic(snapshot, current, parameters, options.profile, prearmAt);
    const verified = snapshot.request?.aircraftId === a.id && snapshot.request.startedAt >= (first.link.connectedAt ?? Infinity) && ['verified', 'partial'].includes(snapshot.request.state);
    rules.unshift(check('return-link', 'Two-way telemetry request', 'connection', verified ? 'passed' : 'blocked', snapshot.request?.message ?? 'No verified request result.', 'A receiving heartbeat alone does not verify commands can reach the controller. Rerun the connection check.', snapshot.now));
    report = replaceResults(report, rules, now());
    report.parameterCount = parameters.received;
    report.baseline = { aircraftId: a.id, path: options.path, connectedAt: first.link.connectedAt!, uid: current.version && snapshot.request && current.version.receivedAt >= snapshot.request.startedAt ? current.version.uid : undefined,
      firmware: current.version?.flightVersion ?? 'unknown', configurationHash: await configurationHash(parameters) };
  } catch (e) {
    report.outcome = options.signal.aborted ? 'cancelled' : 'interrupted';
    report = replaceResults(report, [check('run', 'Automatic check completion', 'connection', 'blocked', options.signal.aborted ? 'Stopped before all checks completed. Requests already sent may still finish; no further checks will be sent.' : e instanceof Error ? e.message : 'The check could not finish.', 'Resolve the connection issue and rerun. Outstanding items are not passes.', now())], now());
  }
  return report;
}
export async function runRadioCheck(options: RunnerOptions, report: CheckReport): Promise<CheckResult[]> {
  const { call, wait } = io(options);
  const now = options.now ?? Date.now;
  try {
    const baseline = report.baseline;
    if (!baseline?.uid) throw new Error('Run direct-USB checks first. A hardware UID is required to compare the same drone across connections.');
    if (options.path === baseline.path) throw new Error('Select the ground radio’s USB device, not the controller’s direct USB path.');
    const ports = await call<{ ports: AircraftPort[] }>('aircraft/ports');
    if (ports.ports.some(p => p.path === baseline.path)) throw new Error('The controller USB device is still present. Unplug it to isolate battery power and the radio path.');
    const before = await call<AircraftSnapshot>('aircraft/status');
    assertIdle(before);
    if (before.link.state === 'listening') await call('aircraft/disconnect', {});
    const { snapshot: first, aircraft: initial } = await connect(options, call, wait);
    options.progress('Comparing the controller identity through the ground radio…');
    const s = await call<AircraftSnapshot>('aircraft/request-telemetry', { aircraftId: initial.id });
    const a = sameConnection(s, first, initial);
    if (!fresh(a.version?.receivedAt, s.now, first.link.connectedAt ?? Infinity) || a.version?.uid !== baseline.uid)
      throw new Error('The controller UID does not match the USB check, or fresh identity is unavailable. Do not combine these results.');
    if (a.version.flightVersion !== baseline.firmware) throw new Error('Firmware changed since the USB check. Start a new check.');
    const parameters = await collectParameters(options, call, wait, first, a);
    if (parameters.state !== 'complete' || await configurationHash(parameters) !== baseline.configurationHash)
      throw new Error('Configuration changed or could not be fully read over radio. Rerun the direct-USB baseline.');
    const observed = await observe(options, call, wait, first, a);
    const current = sameConnection(observed.snapshot, first, a);
    const response = !!s.request && ['verified', 'partial'].includes(s.request.state) && s.request.aircraftId === a.id && s.request.startedAt >= (first.link.connectedAt ?? Infinity);
    const voltage = fresh(current.battery?.receivedAt, observed.snapshot.now) && (current.battery?.voltageV ?? 0) > 0;
    return [check('radio-path', 'Battery-powered ground-radio path', 'radio', observed.result.state === 'passed' && response && voltage ? 'passed' : 'blocked',
      `Matching hardware UID and configuration. Direct USB absent. Battery reported ${current.battery?.voltageV ?? '?'} V. Two-way request ${response ? 'verified' : 'unconfirmed'}. ${observed.result.detail}`,
      'This verifies the observed nearby link after your power confirmation. Field range and failsafe operation still need testing.', now())];
  } catch (e) {
    return [check('radio-path', 'Battery-powered ground-radio path', 'radio', 'blocked', options.signal.aborted ? 'Radio check cancelled. It was not verified.' : e instanceof Error ? e.message : 'Radio check failed.', 'Fix the reported connection issue here, then retest the radio path.', now())];
  }
}
