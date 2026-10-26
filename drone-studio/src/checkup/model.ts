import { z } from 'zod';
import type { AircraftSnapshot, AircraftTelemetry } from '../aircraft/types';
import type { ParameterSnapshot } from '../aircraft/parameters';
import type { EscInspection } from '../aircraft/esc-types';

export const RULESET = 'arducopter-bench-beta-1';
export const profileSchema = z.object({ name: z.string().trim().min(1).max(60), gps: z.boolean(), radio: z.boolean() });
export type BuildProfile = z.infer<typeof profileSchema>;
export const defaultProfile: BuildProfile = { name: 'My drone', gps: true, radio: true };
export const resultSchema = z.object({
  id: z.string().max(100), title: z.string().max(160), group: z.enum(['connection', 'configuration', 'sensors', 'hands-on', 'radio', 'field']),
  state: z.enum(['passed', 'failed', 'blocked', 'unsupported', 'pending']),
  source: z.enum(['device', 'operator', 'coverage']), detail: z.string().max(1500), next: z.string().max(800), at: z.number().finite(),
});
export type CheckResult = z.infer<typeof resultSchema>;
export type CheckGroup = CheckResult['group'];
export const reportSchema = z.object({
  schema: z.literal(1), ruleset: z.literal(RULESET), id: z.string().max(100), profile: profileSchema,
  startedAt: z.number().finite(), finishedAt: z.number().finite(), outcome: z.enum(['complete', 'cancelled', 'interrupted']),
  baseline: z.object({ aircraftId: z.string().max(120), path: z.string().max(220), connectedAt: z.number().finite(), uid: z.string().max(100).optional(),
    firmware: z.string().max(40), configurationHash: z.string().max(64) }).optional(),
  results: z.array(resultSchema).max(300), parameterCount: z.number().int().min(0).max(65535),
});
export type CheckReport = z.infer<typeof reportSchema>;
export const fresh = (at: number | undefined, now: number, after = -Infinity) => at !== undefined && at >= after && at <= now && now - at < 5000;
export function check(id: string, title: string, group: CheckGroup, state: CheckResult['state'], detail: string, next: string, at: number, source: CheckResult['source'] = 'device'): CheckResult {
  return { id, title, group, state, detail, next, at, source };
}
export function remainingChecks(profile: BuildProfile, now: number): CheckResult[] {
  return [
    check('esc', 'Read all four ESCs', 'hands-on', 'pending', 'Firmware and direction settings have not been read in this run.', 'Connect directly by USB and use Read ESCs.', now),
    ...[1, 2, 3, 4].map(n => check(`motor-${n}`, `Motor ${String.fromCharCode(64 + n)}: position and direction`, 'hands-on', 'pending', 'Physical behavior has not been observed.', 'Run a props-off pulse and record what you observe against your frame’s motor diagram.', now, 'operator')),
    check('orientation', 'Board orientation follows the drone', 'hands-on', 'pending', 'A live attitude reading does not prove the board is mounted correctly.', 'Tilt the drone gently and compare the live roll and pitch.', now, 'operator'),
    check('receiver-motion', 'Receiver sticks and switches', 'hands-on', 'pending', 'Input movement and switch assignments need an observation.', 'Move each stick and required switch; compare the live channel values.', now, 'operator'),
    check('assembly', 'Wiring and mechanical inspection', 'hands-on', 'pending', 'Solder joints, connectors, fasteners and motor clearance need a physical inspection.', 'Inspect the build with power disconnected; confirm no loose connections or damaged parts.', now, 'operator'),
    ...(profile.radio ? [check('radio-path', 'Battery-powered ground-radio path', 'radio', 'pending', 'Direct USB does not verify the wireless path.', 'Unplug the controller USB, leave the flight battery connected, and run the radio check.', now)] : []),
    check('failsafe-operation', 'Failsafe behavior under operating conditions', 'field', 'unsupported', 'This beta reads failsafe configuration; it does not certify actual loss-of-link, RTL or battery-failsafe behavior.', 'Follow the firmware’s supported failsafe verification procedure before flight.', now, 'coverage'),
    check('flight-site', 'Fresh checks at the flight site', 'field', 'pending', 'Weather, airspace, surroundings, battery condition, propeller installation and current arming checks remain to be reviewed.', 'Repeat the flight controller’s pre-arm checks at the flight site and complete the physical preflight inspection.', now, 'operator'),
    check('flight-load', 'Flight behavior and power under load', 'field', 'unsupported', 'A USB bench session cannot verify thrust, loaded power delivery, tuning, or RF range.', 'Complete a controlled first-flight and range-check procedure appropriate to the build.', now, 'coverage'),
  ];
}
export function emptyReport(profile: BuildProfile, now: number, id: string): CheckReport {
  return { schema: 1, ruleset: RULESET, id, profile: { ...profile }, startedAt: now, finishedAt: now, outcome: 'complete', results: remainingChecks(profile, now), parameterCount: 0 };
}
export function replaceResults(report: CheckReport, results: CheckResult[], now: number): CheckReport {
  const updates = new Map(results.map(r => [r.id, r]));
  const existing = new Set(report.results.map(r => r.id));
  return { ...report, finishedAt: now, results: [...report.results.map(r => updates.get(r.id) ?? r), ...results.filter(r => !existing.has(r.id))] };
}
export function summarizeReport(report: CheckReport) {
  const count = (state: CheckResult['state']) => report.results.filter(r => r.state === state).length;
  return { passed: count('passed'), failed: count('failed'), remaining: report.results.filter(r => r.state !== 'passed' && r.state !== 'failed').length,
    title: report.outcome === 'cancelled' ? 'Check paused' : report.outcome === 'interrupted' ? 'Check interrupted' : count('failed') ? 'Issues to resolve' : 'Checks recorded' };
}
export function currentBaseline(report: CheckReport, snapshot?: AircraftSnapshot, now = Date.now()) {
  const b = report.baseline, a = snapshot?.aircraft.find(a => a.id === b?.aircraftId);
  return !!b && !!snapshot && snapshot.link.path === b.path && snapshot.link.connectedAt === b.connectedAt && snapshot.link.state === 'listening' &&
    snapshot.aircraft.length === 1 && !!a && !a.heartbeat.armed && fresh(a.heartbeat.receivedAt, now) &&
    a.version?.flightVersion === b.firmware && (!b.uid || a.version.uid === b.uid);
}

/** Pure versioned rules: timestamps and observations are inputs, never wall-clock or AI decisions. */
export function evaluateAutomatic(snapshot: AircraftSnapshot, a: AircraftTelemetry, parameters: ParameterSnapshot, profile: BuildProfile, prearmAt?: number): CheckResult[] {
  const now = snapshot.now;
  const results: CheckResult[] = [];
  const add = (id: string, title: string, group: CheckGroup, state: CheckResult['state'], detail: string, next = 'Review this item and rerun the automatic checks.') => results.push(check(id, title, group, state, detail, next, now));
  add('firmware', 'Supported controller firmware', 'configuration', a.heartbeat.autopilot === 3 && a.heartbeat.vehicleType === 2 && a.version?.flightVersion === '4.7.1' && a.version.releaseType === 255 ? 'passed' : 'unsupported', `Reported firmware: ${a.version?.flightVersion ?? 'unknown'}. Configuration rules in this beta cover ArduCopter 4.7.1 stable.`, 'Other firmware requires a qualified rule set. Raw observations remain available.');
  add('identity', 'Hardware identity', 'connection', a.version?.uid ? 'passed' : 'blocked', a.version?.uid ? 'A controller hardware UID was reported. It can be compared across USB and radio.' : 'No hardware UID was reported; a system number alone cannot establish the same physical drone.', 'Request fresh firmware information. Cross-link identity requires a hardware UID.');
  const complete = parameters.state === 'complete' && parameters.expected > 0 && parameters.received === parameters.expected && parameters.aircraftId === a.id && parameters.startedAt !== null && parameters.startedAt >= (snapshot.link.connectedAt ?? Infinity);
  add('parameters', 'Complete configuration read', 'configuration', complete ? 'passed' : 'blocked', `${parameters.received} of ${parameters.expected || '?'} parameter indexes received.`, 'Keep the link connected and rerun. Partial data cannot clear configuration checks.');
  const supported = results.find(r => r.id === 'firmware')!.state === 'passed';
  const values = new Map(parameters.parameters.filter(p => p.receivedAt >= (parameters.startedAt ?? Infinity)).map(p => [p.name, p.value]));
  const rule = (id: string, title: string, names: string[], test: (v: number[]) => boolean, guidance: string) => {
    const v = names.map(n => values.get(n));
    add(id, title, 'configuration', !supported ? 'unsupported' : !complete || v.some(x => x === undefined || !Number.isFinite(x)) ? 'blocked' : test(v as number[]) ? 'passed' : 'failed', names.map((n, i) => `${n} = ${v[i] ?? 'not received'}`).join(' · '), guidance);
  };
  rule('frame', 'Quadcopter frame configured', ['FRAME_CLASS'], v => v[0] === 1, 'This beta’s four-motor workflow requires a quadcopter. Confirm the real airframe and its output mapping.');
  rule('arming-checks', 'Pre-arm checks enabled', ['ARMING_SKIPCHK'], v => v[0] === 0, 'Restore the firmware’s full pre-arm checks. Resolve failures instead of bypassing them.');
  rule('battery-monitor', 'Battery monitor configured', ['BATT_MONITOR'], v => v[0] > 0 && Number.isInteger(v[0]), 'Configure and calibrate the monitor for the actual power hardware. This checks that monitoring is enabled, not calibration accuracy.');
  rule('battery-thresholds', 'Battery voltage thresholds ordered', ['BATT_LOW_VOLT', 'BATT_CRT_VOLT'], v => v[0] > v[1] && v[1] > 0, 'Set battery-specific low and critical voltages, with the critical voltage lower. Correct ordering does not establish suitability for your pack.');
  rule('battery-failsafe', 'Low-battery action enabled', ['BATT_FS_LOW_ACT'], v => Number.isInteger(v[0]) && v[0] > 0 && v[0] <= 7, 'Review the low-battery action for this aircraft. A configured action is not an operational failsafe test.');
  rule('receiver-failsafe', 'Receiver failsafe enabled', ['FS_THR_ENABLE'], v => [1, 3, 4, 5, 6, 7].includes(v[0]), 'Review the receiver failsafe action and verify it using the firmware’s procedure.');
  if (profile.radio) rule('gcs-failsafe', 'Ground-station failsafe enabled', ['FS_GCS_ENABLE'], v => [1, 3, 4, 5, 6, 7].includes(v[0]), 'Review behavior on loss of the ground station. The action must suit your intended operation.');
  const axes = ['ROLL', 'PITCH', 'THROTTLE', 'YAW'];
  rule('rc-mapping', 'Stick channels are distinct', axes.map(axis => `RCMAP_${axis}`), v => v.every(x => Number.isInteger(x) && x >= 1 && x <= 16) && new Set(v).size === 4, 'Assign each primary stick axis to a distinct receiver channel, then verify movement.');
  for (const axis of axes) {
    const n = values.get(`RCMAP_${axis}`);
    if (n && Number.isInteger(n) && n <= 16) rule(`rc-range-${axis}`, `${axis.toLowerCase()} input endpoints`, [`RC${n}_MIN`, `RC${n}_TRIM`, `RC${n}_MAX`], v => v[0] < v[2] && v[1] >= v[0] && v[1] <= v[2], 'Calibrate receiver endpoints. Ordered values do not verify stick direction or travel.');
  }
  for (let motor = 1; motor <= 4; motor++) {
    const outputs = [...values].filter(([n, v]) => /^SERVO\d+_FUNCTION$/.test(n) && v === 32 + motor).map(([n]) => n);
    add(`output-${motor}`, `Motor ${motor} has one assigned output`, 'configuration', !supported ? 'unsupported' : !complete ? 'blocked' : outputs.length === 1 ? 'passed' : 'failed', outputs.length ? outputs.join(', ') : 'No output assignment received.', 'Compare the firmware motor diagram with the real wiring. Output number does not establish physical position.');
  }
  for (let n = 1; n <= 16; n++) if ((values.get(`SERVO${n}_FUNCTION`) ?? 0) > 0) {
    rule(`output-range-${n}`, `Output ${n} limits ordered`, [`SERVO${n}_MIN`, `SERVO${n}_MAX`], v => v[0] < v[1], 'Review limits for this output protocol. Ordered values are not ESC calibration.');
  }
  const h = a.health, healthFresh = fresh(h?.receivedAt, now, prearmAt ?? snapshot.link.connectedAt ?? Infinity);
  for (const [name, mask] of [['Gyroscope', 1], ['Accelerometer', 2], ['Compass', 4], ['Barometer', 8]] as const) {
    add(`sensor-${mask}`, `${name} reports healthy`, 'sensors', !healthFresh || !h || !(h.present & mask) || !(h.enabled & mask) ? 'blocked' : h.healthy & mask ? 'passed' : 'failed', !h ? 'No system-health report received.' : `Present: ${!!(h.present & mask)} · enabled: ${!!(h.enabled & mask)} · healthy: ${!!(h.healthy & mask)}`, 'Check sensor availability, configuration and calibration. Missing or disabled sensors require review.');
  }
  const ack = a.lastPrearmAck;
  const ackFresh = prearmAt !== undefined && fresh(ack?.receivedAt, now, prearmAt) && ack?.command === 401 && (ack.targetSystem === 0 || ack.targetSystem === 254) && (ack.targetComponent === 0 || ack.targetComponent === 190);
  const prearmMask = 1 << 28;
  add('prearm', 'Flight-controller pre-arm result', 'sensors', ackFresh && ack?.result === 3 ? 'unsupported' : !ackFresh || ack?.result !== 0 || !healthFresh || !h || !(h.present & prearmMask) || !(h.enabled & prearmMask) ? 'blocked' : h.healthy & prearmMask ? 'passed' : 'failed',
    ackFresh && ack?.result === 0 ? `Check request accepted. Fresh pre-arm health: ${healthFresh && h && (h.present & prearmMask) && (h.enabled & prearmMask) ? h.healthy & prearmMask ? 'passed' : 'failed' : 'unavailable'}.` : 'A supported, fresh pre-arm result was not established.', 'Resolve the controller’s pre-arm messages and rerun. Accepting the request alone is not a pass.');
  const messages = a.messages.filter(m => m.receivedAt >= (prearmAt ?? now) && (m.severity <= 3 || /pre.?arm:/i.test(m.text)));
  if (messages.length) add('controller-messages', 'Controller reported issues', 'sensors', 'failed', messages.map(m => m.text).join(' · ').slice(0, 1400), 'Resolve the controller messages and rerun. Messages are observations from this check window.');
  add('attitude', 'Fresh attitude readings', 'sensors', fresh(a.attitude?.receivedAt, now) ? 'passed' : 'blocked', a.attitude ? `Roll ${a.attitude.rollDeg.toFixed(1)}° · pitch ${a.attitude.pitchDeg.toFixed(1)}°` : 'No attitude reading.', 'Check controller reporting, then verify physical orientation in Hands-on.');
  add('battery-reading', 'Fresh battery voltage', 'sensors', fresh(a.battery?.receivedAt, now) && a.battery?.voltageV != null && a.battery.voltageV > 0 ? 'passed' : 'blocked', `Reported pack voltage: ${a.battery?.voltageV ?? 'unknown'} V. This does not verify capacity or loaded performance.`, 'Connect the flight battery and verify the monitor against the actual pack.');
  add('receiver-data', 'Fresh receiver channels', 'sensors', fresh(a.receiver?.receivedAt, now) && (a.receiver?.channels.filter(v => v !== null).length ?? 0) >= 4 ? 'passed' : 'blocked', `${a.receiver?.channels.filter(v => v !== null).length ?? 0} reported channels.`, 'Power the transmitter and receiver. Receiver input reporting may be unsupported on this firmware.');
  if (profile.gps) add('gps-fix', 'GPS position fix', 'sensors', fresh(a.gps?.receivedAt, now) && (a.gps?.fixType ?? 0) >= 3 ? 'passed' : 'blocked', `${a.gps?.fix ?? 'No GPS report'} · ${a.gps?.satellites ?? '?'} satellites. A fix does not establish navigation accuracy.`, 'Move to a clear outdoor location and rerun before GPS-assisted flight.');
  return results;
}
export function evaluateEscs(report: EscInspection, now: number): CheckResult {
  const readable = report.escs.filter(e => !e.error && e.firmware && e.firmware !== 'Unknown' && e.direction);
  return check('esc', 'Read all four ESCs', 'hands-on', report.state === 'complete' && report.count === 4 && readable.length === 4 && report.telemetryRestored ? 'passed' : 'blocked',
    report.escs.map(e => `ESC ${e.index}: ${e.firmware ?? 'unknown'} ${e.version ?? ''} · ${e.direction ?? 'unreadable'}`).join('; ') || report.message,
    'A settings read does not establish physical motor direction. Verify each motor with props removed.', now);
}
const HISTORY_KEY = 'lucidity.checkup.reports.v1';
export function readReports(storage: Pick<Storage, 'getItem'>): CheckReport[] {
  try { const raw = storage.getItem(HISTORY_KEY); if (!raw || raw.length > 600000) return []; return z.array(reportSchema).max(5).parse(JSON.parse(raw)); } catch { return []; }
}
export function saveReport(storage: Pick<Storage, 'getItem' | 'setItem'>, report: CheckReport) {
  const safe = reportSchema.parse(report);
  storage.setItem(HISTORY_KEY, JSON.stringify([safe, ...readReports(storage).filter(r => r.id !== safe.id)].slice(0, 5)));
}
