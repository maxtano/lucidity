/** Read-only, bounded summary of ArduPilot DataFlash binary logs.
 *
 * FMT is self-describing: its message length and field format, rather than a
 * hard-coded vehicle layout, determine where the next record starts. The
 * format characters and field names follow ArduPilot's LogStructure.h and
 * Copter LogMessages metadata. Unsupported records are skipped safely.
 */

const HEADER_A = 0xa3;
const HEADER_B = 0x95;
const FMT_TYPE = 0x80;
const FMT_LENGTH = 89;
const MAX_LOG_BYTES = 64 * 1024 * 1024;
const MAX_RECORDS = 1_000_000;
const MAX_METRIC_SAMPLES = 50_000;
const MAX_TRACE_SAMPLES = 600;
const MAX_MODE_CHANGES = 128;

type GroupName = 'ATT' | 'RATE' | 'VIBE' | 'CTUN' | 'BAT' | 'MODE';
type Value = number | string | null;
type Row = Record<string, Value>;
type Definition = { length: number; name: string; format: string; labels: string[]; supported: boolean };

export type NumericSummary = {
  samples: number;
  mean: number;
  p95: number;
  peak: number;
  peakTimeSeconds: number | null;
};

export type FlightLogAnalysis = {
  format: 'ArduPilot DataFlash';
  bytes: number;
  parsedRecords: number;
  skippedBytes: number;
  truncated: boolean;
  durationSeconds: number | null;
  groups: Record<GroupName, number>;
  attitude: { rollErrorDeg: NumericSummary | null; pitchErrorDeg: NumericSummary | null; yawErrorDeg: NumericSummary | null } | null;
  rate: { rollErrorDegS: NumericSummary | null; pitchErrorDegS: NumericSummary | null; yawErrorDegS: NumericSummary | null } | null;
  vibration: {
    sensors: {
      imu: number;
      vibeX: NumericSummary | null;
      vibeY: NumericSummary | null;
      vibeZ: NumericSummary | null;
      magnitude: NumericSummary | null;
      clippingEvents: number | null;
    }[];
  } | null;
  throttle: {
    outputMin: number;
    outputMax: number;
    pairedVibrationSamples: number;
    vibrationCorrelation: number | null;
  } | null;
  battery: { voltageMinV: number | null; voltageMaxV: number | null; currentMaxA: number | null } | null;
  modes: { timeSeconds: number; mode: number }[];
  traces: {
    attitude: { timeSeconds: number; rollDeg: number; desiredRollDeg: number; pitchDeg: number; desiredPitchDeg: number }[];
    rate: { timeSeconds: number; rollDegS: number; desiredRollDegS: number; pitchDegS: number; desiredPitchDegS: number }[];
    vibration: { timeSeconds: number; imu: number; vibeXMs2: number; vibeYMs2: number; vibeZMs2: number; magnitudeMs2: number }[];
    throttle: { timeSeconds: number; output: number }[];
  };
  caveats: string[];
};

export class DataFlashAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataFlashAnalysisError';
  }
}

type Observation = { time: number | null; value: number };

function formatSize(char: string): number {
  switch (char) {
    case 'b': case 'B': case 'M': return 1;
    case 'h': case 'H': case 'c': case 'C': return 2;
    case 'i': case 'I': case 'f': case 'e': case 'E': case 'L': case 'n': return 4;
    case 'd': case 'q': case 'Q': return 8;
    case 'N': return 16;
    case 'Z': case 'a': return 64;
    default: return 0;
  }
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let end = offset;
  while (end < offset + length && bytes[end] !== 0) end++;
  let result = '';
  for (let i = offset; i < end; i++) result += String.fromCharCode(bytes[i]);
  return result;
}

function definition(bytes: Uint8Array, at: number): { type: number; value: Definition } | null {
  if (at + FMT_LENGTH > bytes.length) return null;
  const type = bytes[at + 3];
  const length = bytes[at + 4];
  const name = ascii(bytes, at + 5, 4);
  const format = ascii(bytes, at + 9, 16);
  const labels = ascii(bytes, at + 25, 64).split(',');
  const payloadSize = [...format].reduce((size, char) => size + formatSize(char), 0);
  const supported = length >= 3 && length <= 255 && name.length > 0 &&
    format.length > 0 && labels.length === format.length &&
    [...format].every(char => formatSize(char) > 0) && payloadSize === length - 3;
  if (length < 3 || !name || !format) return null;
  return { type, value: { length, name, format, labels, supported } };
}

function readValue(view: DataView, bytes: Uint8Array, at: number, char: string): Value {
  switch (char) {
    case 'b': return view.getInt8(at);
    case 'B': case 'M': return view.getUint8(at);
    case 'h': return view.getInt16(at, true);
    case 'H': return view.getUint16(at, true);
    case 'i': return view.getInt32(at, true);
    case 'I': return view.getUint32(at, true);
    case 'f': return view.getFloat32(at, true);
    case 'd': return view.getFloat64(at, true);
    case 'c': return view.getInt16(at, true) / 100;
    case 'C': return view.getUint16(at, true) / 100;
    case 'e': return view.getInt32(at, true) / 100;
    case 'E': return view.getUint32(at, true) / 100;
    case 'L': return view.getInt32(at, true) / 1e7;
    case 'q': {
      const value = view.getBigInt64(at, true);
      return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(value) : null;
    }
    case 'Q': {
      const value = view.getBigUint64(at, true);
      return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
    }
    case 'n': case 'N': case 'Z': return ascii(bytes, at, formatSize(char));
    case 'a': return null;
    default: return null;
  }
}

function readRow(view: DataView, bytes: Uint8Array, at: number, spec: Definition): Row {
  const row: Row = {};
  let offset = at + 3;
  for (let i = 0; i < spec.format.length; i++) {
    const char = spec.format[i];
    row[spec.labels[i]] = readValue(view, bytes, offset, char);
    offset += formatSize(char);
  }
  return row;
}

function numeric(row: Row, name: string): number | null {
  const value = row[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function timeSeconds(row: Row): number | null {
  const micros = numeric(row, 'TimeUS');
  if (micros !== null && micros >= 0) return micros / 1e6;
  const millis = numeric(row, 'TimeMS');
  return millis !== null && millis >= 0 ? millis / 1e3 : null;
}

function appendBounded<T>(items: T[], item: T, seen: number, max = MAX_METRIC_SAMPLES): void {
  // Deterministic thinning keeps coverage across a long log without unbounded
  // memory. Metrics are approximate if the group exceeds MAX_METRIC_SAMPLES.
  if (items.length >= max) {
    for (let i = 1; i < items.length; i += 2) items[Math.floor(i / 2)] = items[i];
    items.length = Math.floor(items.length / 2);
  }
  const stride = Math.max(1, Math.pow(2, Math.floor(Math.log2(Math.max(1, seen / max)))));
  if (seen % stride === 0 && items.length < max) items.push(item);
}

function metric(observations: Observation[]): NumericSummary | null {
  if (!observations.length) return null;
  const ordered = observations.map(item => item.value).sort((a, b) => a - b);
  const peak = observations.reduce((best, item) => item.value > best.value ? item : best);
  return {
    samples: observations.length,
    mean: observations.reduce((sum, item) => sum + item.value, 0) / observations.length,
    p95: ordered[Math.min(ordered.length - 1, Math.ceil(0.95 * ordered.length) - 1)],
    peak: peak.value,
    peakTimeSeconds: peak.time,
  };
}

function trace<T>(items: T[]): T[] {
  if (items.length <= MAX_TRACE_SAMPLES) return items;
  const result: T[] = [];
  for (let i = 0; i < MAX_TRACE_SAMPLES; i++)
    result.push(items[Math.round(i * (items.length - 1) / (MAX_TRACE_SAMPLES - 1))]);
  return result;
}

function correlation(pairs: { x: number; y: number }[]): number | null {
  if (pairs.length < 20) return null;
  const n = pairs.length;
  const sumX = pairs.reduce((s, p) => s + p.x, 0);
  const sumY = pairs.reduce((s, p) => s + p.y, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;
  let xx = 0, yy = 0, xy = 0;
  for (const pair of pairs) {
    const dx = pair.x - meanX;
    const dy = pair.y - meanY;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }
  return xx > 0 && yy > 0 ? Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy))) : null;
}

function relativeMetric(observations: Observation[], origin: number): NumericSummary | null {
  const summary = metric(observations);
  return summary && {
    ...summary,
    peakTimeSeconds: summary.peakTimeSeconds === null ? null :
      Math.max(0, summary.peakTimeSeconds - origin),
  };
}

/** Reads an existing .BIN; it never communicates with or changes the aircraft. */
export function analyzeDataFlash(input: Uint8Array | ArrayBuffer): FlightLogAnalysis {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < FMT_LENGTH) throw new DataFlashAnalysisError('This file is too short for an ArduPilot DataFlash log.');
  if (bytes.length > MAX_LOG_BYTES) throw new DataFlashAnalysisError('This log exceeds Lucidity’s 64 MiB analysis limit. Keep the original .BIN file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const formats = new Map<number, Definition>();
  const groups: FlightLogAnalysis['groups'] = { ATT: 0, RATE: 0, VIBE: 0, CTUN: 0, BAT: 0, MODE: 0 };
  const attitudeRoll: Observation[] = [], attitudePitch: Observation[] = [], attitudeYaw: Observation[] = [];
  const rateRoll: Observation[] = [], ratePitch: Observation[] = [], rateYaw: Observation[] = [];
  const vibration = new Map<number, {
    x: Observation[]; y: Observation[]; z: Observation[]; magnitude: Observation[];
    firstClip: number | null; lastClip: number | null; increments: number;
  }>();
  const throttleRows: { time: number; output: number }[] = [];
  const vibrationRows: { time: number; magnitude: number }[] = [];
  const attitudeTrace: FlightLogAnalysis['traces']['attitude'] = [];
  const rateTrace: FlightLogAnalysis['traces']['rate'] = [];
  const vibeTrace: FlightLogAnalysis['traces']['vibration'] = [];
  const modes: FlightLogAnalysis['modes'] = [];
  let voltageMin = Infinity, voltageMax = -Infinity, currentMax = -Infinity;
  let minTime = Infinity, maxTime = -Infinity, parsedRecords = 0, skippedBytes = 0, fmtCount = 0;
  let truncated = false;
  let at = 0;
  while (at + 3 <= bytes.length && parsedRecords < MAX_RECORDS) {
    if (bytes[at] !== HEADER_A || bytes[at + 1] !== HEADER_B) { at++; skippedBytes++; continue; }
    const type = bytes[at + 2];
    if (type === FMT_TYPE) {
      const parsed = definition(bytes, at);
      if (!parsed) { truncated = at + FMT_LENGTH > bytes.length; at++; skippedBytes++; continue; }
      formats.set(parsed.type, parsed.value);
      fmtCount++;
      parsedRecords++;
      at += FMT_LENGTH;
      continue;
    }
    const spec = formats.get(type);
    if (!spec) { at++; skippedBytes++; continue; }
    if (at + spec.length > bytes.length) { truncated = true; break; }
    parsedRecords++;
    if (!spec.supported || !(spec.name in groups)) { at += spec.length; continue; }
    const name = spec.name as GroupName;
    const row = readRow(view, bytes, at, spec);
    at += spec.length;
    groups[name]++;
    const time = timeSeconds(row);
    if (time !== null) { minTime = Math.min(minTime, time); maxTime = Math.max(maxTime, time); }
    if (name === 'ATT') {
      const r = numeric(row, 'Roll'), dr = numeric(row, 'DesRoll');
      const p = numeric(row, 'Pitch'), dp = numeric(row, 'DesPitch');
      const y = numeric(row, 'Yaw'), dy = numeric(row, 'DesYaw');
      if (r !== null && dr !== null) appendBounded(attitudeRoll, { time, value: Math.abs(r - dr) }, groups.ATT);
      if (p !== null && dp !== null) appendBounded(attitudePitch, { time, value: Math.abs(p - dp) }, groups.ATT);
      if (y !== null && dy !== null) {
        const difference = Math.abs(((y - dy + 540) % 360) - 180);
        appendBounded(attitudeYaw, { time, value: difference }, groups.ATT);
      }
      if (time !== null && r !== null && dr !== null && p !== null && dp !== null)
        appendBounded(attitudeTrace, { timeSeconds: time, rollDeg: r, desiredRollDeg: dr, pitchDeg: p, desiredPitchDeg: dp }, groups.ATT);
    } else if (name === 'RATE') {
      const r = numeric(row, 'R'), dr = numeric(row, 'RDes');
      const p = numeric(row, 'P'), dp = numeric(row, 'PDes');
      const y = numeric(row, 'Y'), dy = numeric(row, 'YDes');
      if (r !== null && dr !== null) appendBounded(rateRoll, { time, value: Math.abs(r - dr) }, groups.RATE);
      if (p !== null && dp !== null) appendBounded(ratePitch, { time, value: Math.abs(p - dp) }, groups.RATE);
      if (y !== null && dy !== null) appendBounded(rateYaw, { time, value: Math.abs(y - dy) }, groups.RATE);
      if (time !== null && r !== null && dr !== null && p !== null && dp !== null)
        appendBounded(rateTrace, { timeSeconds: time, rollDegS: r, desiredRollDegS: dr, pitchDegS: p, desiredPitchDegS: dp }, groups.RATE);
    } else if (name === 'VIBE') {
      const imu = numeric(row, 'IMU') ?? 0;
      const x = numeric(row, 'VibeX'), y = numeric(row, 'VibeY'), z = numeric(row, 'VibeZ');
      const clip = numeric(row, 'Clip') ?? numeric(row, 'Clip0');
      let sensor = vibration.get(imu);
      if (!sensor) {
        sensor = { x: [], y: [], z: [], magnitude: [], firstClip: null, lastClip: null, increments: 0 };
        vibration.set(imu, sensor);
      }
      if (clip !== null) {
        if (sensor.firstClip === null) sensor.firstClip = clip;
        if (sensor.lastClip !== null && clip >= sensor.lastClip) sensor.increments += clip - sensor.lastClip;
        sensor.lastClip = clip;
      }
      if (x !== null) appendBounded(sensor.x, { time, value: x }, groups.VIBE);
      if (y !== null) appendBounded(sensor.y, { time, value: y }, groups.VIBE);
      if (z !== null) appendBounded(sensor.z, { time, value: z }, groups.VIBE);
      if (x !== null && y !== null && z !== null) {
        const magnitude = Math.hypot(x, y, z);
        appendBounded(sensor.magnitude, { time, value: magnitude }, groups.VIBE);
        if (time !== null) {
          appendBounded(vibeTrace, { timeSeconds: time, imu, vibeXMs2: x, vibeYMs2: y, vibeZMs2: z, magnitudeMs2: magnitude }, groups.VIBE);
          if (imu === 0) appendBounded(vibrationRows, { time, magnitude }, groups.VIBE);
        }
      }
    } else if (name === 'CTUN') {
      const output = numeric(row, 'ThO');
      if (time !== null && output !== null) appendBounded(throttleRows, { time, output }, groups.CTUN);
    } else if (name === 'BAT') {
      if ((numeric(row, 'Inst') ?? 0) === 0) {
        const volts = numeric(row, 'Volt'), amps = numeric(row, 'Curr');
        if (volts !== null) { voltageMin = Math.min(voltageMin, volts); voltageMax = Math.max(voltageMax, volts); }
        if (amps !== null) currentMax = Math.max(currentMax, amps);
      }
    } else if (name === 'MODE') {
      const mode = numeric(row, 'Mode') ?? numeric(row, 'ModeNum');
      if (time !== null && mode !== null && modes.length < MAX_MODE_CHANGES &&
          (modes.length === 0 || modes[modes.length - 1].mode !== mode))
        modes.push({ timeSeconds: time, mode });
    }
  }
  if (!fmtCount) throw new DataFlashAnalysisError('No valid ArduPilot DataFlash FMT records were found. Select an onboard .BIN log.');
  if (parsedRecords >= MAX_RECORDS || at + 3 > bytes.length && at < bytes.length) truncated = true;
  const origin = minTime === Infinity ? 0 : minTime;
  const sensors = [...vibration.entries()].sort(([a], [b]) => a - b).map(([imu, data]) => ({
    imu,
    vibeX: relativeMetric(data.x, origin),
    vibeY: relativeMetric(data.y, origin),
    vibeZ: relativeMetric(data.z, origin),
    magnitude: relativeMetric(data.magnitude, origin),
    clippingEvents: data.firstClip === null ? null : data.increments,
  }));
  const paired: { x: number; y: number }[] = [];
  if (throttleRows.length && vibrationRows.length) {
    let t = 0;
    for (const v of vibrationRows) {
      while (t + 1 < throttleRows.length && throttleRows[t + 1].time <= v.time) t++;
      const item = throttleRows[t];
      if (item.time <= v.time && v.time - item.time <= 0.25) paired.push({ x: item.output, y: v.magnitude });
    }
  }
  const outputValues = throttleRows.map(item => item.output);
  const relative = (time: number) => Math.max(0, time - origin);
  const caveats = [
    'This is a measurement summary, not a diagnosis or flight clearance. It cannot establish prop retention, frame stiffness, a loose joint, or a safe tune.',
    'The log may include powered ground time or multiple flights. Duration is the observed log span, not necessarily airborne time.',
    'VIBE is filtered accelerometer data; a fast visible shiver may need higher-rate IMU and motor/ESC evidence to identify its source.',
    'ArduPilot’s 30 m/s² vibration guidance applies to each VibeX/Y/Z axis during flight, not the calculated combined magnitude. This report does not identify the airborne interval.',
  ];
  if (truncated) caveats.push('The file or record scan ended early; the summary may be incomplete.');
  if (skippedBytes) caveats.push(`${skippedBytes} bytes did not match a defined DataFlash record; the log may be partial or contain unsupported sections.`);
  if (Object.values(groups).some(count => count > MAX_METRIC_SAMPLES)) caveats.push('Long-group statistics and traces were deterministically thinned to stay within memory limits.');
  if (!groups.VIBE) caveats.push('No VIBE records were found, so vibration and clipping cannot be assessed from this file.');
  if (!groups.ATT && !groups.RATE) caveats.push('No ATT or RATE records were found, so target-versus-actual control tracking is unavailable.');
  if (paired.length < 20) caveats.push('Too few time-aligned throttle/VIBE samples to summarize whether they varied together.');
  else caveats.push('Throttle/VIBE correlation covers the whole log, including possible ground time and mode changes. Even a nonzero value does not establish an in-air vibration problem or its cause.');
  return {
    format: 'ArduPilot DataFlash', bytes: bytes.length, parsedRecords, skippedBytes, truncated,
    durationSeconds: minTime === Infinity ? null : maxTime - minTime, groups,
    attitude: groups.ATT ? { rollErrorDeg: relativeMetric(attitudeRoll, origin), pitchErrorDeg: relativeMetric(attitudePitch, origin), yawErrorDeg: relativeMetric(attitudeYaw, origin) } : null,
    rate: groups.RATE ? { rollErrorDegS: relativeMetric(rateRoll, origin), pitchErrorDegS: relativeMetric(ratePitch, origin), yawErrorDegS: relativeMetric(rateYaw, origin) } : null,
    vibration: groups.VIBE ? { sensors } : null,
    throttle: outputValues.length ? {
      outputMin: Math.min(...outputValues), outputMax: Math.max(...outputValues),
      pairedVibrationSamples: paired.length, vibrationCorrelation: correlation(paired),
    } : null,
    battery: groups.BAT ? {
      voltageMinV: voltageMin === Infinity ? null : voltageMin,
      voltageMaxV: voltageMax === -Infinity ? null : voltageMax,
      currentMaxA: currentMax === -Infinity ? null : currentMax,
    } : null,
    modes: modes.map(item => ({ ...item, timeSeconds: relative(item.timeSeconds) })),
    traces: {
      attitude: trace(attitudeTrace).map(item => ({ ...item, timeSeconds: relative(item.timeSeconds) })),
      rate: trace(rateTrace).map(item => ({ ...item, timeSeconds: relative(item.timeSeconds) })),
      vibration: trace(vibeTrace).map(item => ({ ...item, timeSeconds: relative(item.timeSeconds) })),
      throttle: trace(throttleRows.map(item => ({ timeSeconds: item.time, output: item.output }))).map(item => ({ ...item, timeSeconds: relative(item.timeSeconds) })),
    },
    caveats,
  };
}
