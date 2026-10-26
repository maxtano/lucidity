import { describe, expect, it } from 'vitest';
import { analyzeDataFlash, DataFlashAnalysisError } from './dataflash-analysis';

const size: Record<string, number> = {
  b: 1, B: 1, M: 1, h: 2, H: 2, c: 2, C: 2,
  i: 4, I: 4, e: 4, E: 4, L: 4, f: 4, n: 4,
  d: 8, q: 8, Q: 8, N: 16, Z: 64, a: 64, '?': 8,
};

function fmt(type: number, name: string, format: string, labels: string): Uint8Array {
  const record = new Uint8Array(89);
  record.set([0xa3, 0x95, 0x80, type, 3 + [...format].reduce((sum, ch) => sum + size[ch], 0)]);
  const write = (offset: number, length: number, value: string) => {
    record.set(new TextEncoder().encode(value).subarray(0, length), offset);
  };
  write(5, 4, name);
  write(9, 16, format);
  write(25, 64, labels);
  return record;
}

function row(type: number, format: string, values: number[]): Uint8Array {
  const record = new Uint8Array(3 + [...format].reduce((sum, ch) => sum + size[ch], 0));
  record.set([0xa3, 0x95, type]);
  const view = new DataView(record.buffer);
  let at = 3;
  for (let i = 0; i < format.length; i++) {
    const value = values[i], ch = format[i];
    switch (ch) {
      case 'B': case 'M': view.setUint8(at, value); break;
      case 'I': view.setUint32(at, value, true); break;
      case 'Q': view.setBigUint64(at, BigInt(value), true); break;
      case 'f': view.setFloat32(at, value, true); break;
      default: throw new Error(`Unsupported fixture field ${ch}`);
    }
    at += size[ch];
  }
  return record;
}

function join(parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, item) => sum + item.length, 0));
  let at = 0;
  for (const part of parts) { bytes.set(part, at); at += part.length; }
  return bytes;
}

function flight(): Uint8Array {
  const parts = [
    fmt(1, 'ATT', 'QffffffB', 'TimeUS,DesRoll,Roll,DesPitch,Pitch,DesYaw,Yaw,AEKF'),
    fmt(2, 'RATE', 'Qffffff', 'TimeUS,RDes,R,PDes,P,YDes,Y'),
    fmt(3, 'VIBE', 'QBfffI', 'TimeUS,IMU,VibeX,VibeY,VibeZ,Clip'),
    fmt(4, 'CTUN', 'Qf', 'TimeUS,ThO'),
    fmt(5, 'BAT', 'QBff', 'TimeUS,Inst,Volt,Curr'),
    fmt(6, 'MODE', 'QMB', 'TimeUS,Mode,Rsn'),
    // Unsupported format is a valid definition length, but must never break
    // subsequent record alignment or interpretation of supported messages.
    fmt(7, 'MYST', 'Q?', 'TimeUS,Unknown'),
  ];
  const unsupported = new Uint8Array(19);
  unsupported.set([0xa3, 0x95, 7, 0xa3, 0x95, 0x80]);
  parts.push(unsupported);
  parts.push(row(6, 'QMB', [0, 0, 1]));
  for (let i = 0; i < 30; i++) {
    const time = i * 1_000_000;
    parts.push(row(4, 'Qf', [time, 0.2 + i * 0.02]));
    parts.push(row(3, 'QBfffI', [time, 0, 2 + i * 0.1, 0, 0, 2 * i]));
    parts.push(row(1, 'QffffffB', [time, 0, i < 15 ? 1 : 4, 0, 2, 359, 1, 3]));
    parts.push(row(2, 'Qffffff', [time, 0, i < 15 ? 4 : 10, 0, 5, 0, 3]));
  }
  parts.push(row(5, 'QBff', [29_000_000, 0, 14.5, 8.4]));
  parts.push(row(6, 'QMB', [29_000_000, 2, 1]));
  return join(parts);
}

describe('ArduPilot DataFlash read-only analysis', () => {
  it('reads FMT-defined ATT/RATE/VIBE/CTUN/BAT/MODE and keeps measurements bounded', () => {
    const report = analyzeDataFlash(flight());
    expect(report.format).toBe('ArduPilot DataFlash');
    expect(report.groups).toEqual({ ATT: 30, RATE: 30, VIBE: 30, CTUN: 30, BAT: 1, MODE: 2 });
    expect(report.durationSeconds).toBe(29);
    expect(report.attitude?.rollErrorDeg?.peak).toBe(4);
    expect(report.attitude?.yawErrorDeg?.peak).toBe(2); // heading wrap, not 358 degrees
    expect(report.rate?.rollErrorDegS?.peak).toBe(10);
    expect(report.vibration?.sensors[0].clippingEvents).toBe(58);
    expect(report.vibration?.sensors[0].vibeX?.peak).toBeCloseTo(4.9, 4);
    expect(report.vibration?.sensors[0].vibeY?.peak).toBe(0);
    expect(report.vibration?.sensors[0].vibeZ?.peak).toBe(0);
    expect(report.vibration?.sensors[0].magnitude?.peak).toBeCloseTo(4.9, 4);
    expect(report.throttle?.pairedVibrationSamples).toBe(30);
    expect(report.throttle?.vibrationCorrelation).toBeGreaterThan(0.99);
    expect(report.battery?.voltageMinV).toBeCloseTo(14.5, 4);
    expect(report.modes.map(item => item.mode)).toEqual([0, 2]);
    expect(report.traces.attitude).toHaveLength(30);
    expect(report.truncated).toBe(false);
    expect(report.caveats.join(' ')).toMatch(/not a diagnosis/);
  });

  it('keeps each VIBE axis separate when the combined magnitude exceeds the axis guidance', () => {
    const report = analyzeDataFlash(join([
      fmt(3, 'VIBE', 'QBfffI', 'TimeUS,IMU,VibeX,VibeY,VibeZ,Clip'),
      row(3, 'QBfffI', [1_000_000, 0, 24, 24, 22, 0]),
      row(3, 'QBfffI', [2_000_000, 0, 25, 0, 0, 0]),
      row(3, 'QBfffI', [3_000_000, 0, 0, 26, 0, 0]),
      row(3, 'QBfffI', [4_000_000, 0, 0, 0, 27, 0]),
    ]));
    const sensor = report.vibration?.sensors[0];
    expect(sensor?.vibeX?.peak).toBe(25);
    expect(sensor?.vibeX?.peakTimeSeconds).toBe(1);
    expect(sensor?.vibeY?.peak).toBe(26);
    expect(sensor?.vibeY?.peakTimeSeconds).toBe(2);
    expect(sensor?.vibeZ?.peak).toBe(27);
    expect(sensor?.vibeZ?.peakTimeSeconds).toBe(3);
    expect(sensor?.magnitude?.peak).toBeCloseTo(Math.hypot(24, 24, 22), 4);
    expect(sensor?.magnitude?.peak).toBeGreaterThan(40);
    expect(sensor?.magnitude?.peakTimeSeconds).toBe(0);
    expect(report.traces.vibration[0]).toMatchObject({
      timeSeconds: 0, vibeXMs2: 24, vibeYMs2: 24, vibeZMs2: 22,
    });
    expect(report.caveats.join(' ')).toMatch(/each VibeX\/Y\/Z axis.*not the calculated combined magnitude/);
  });

  it('accepts a typed-array slice and reports missing log groups without invented numbers', () => {
    const source = join([fmt(1, 'ATT', 'QffffffB', 'TimeUS,DesRoll,Roll,DesPitch,Pitch,DesYaw,Yaw,AEKF'),
      row(1, 'QffffffB', [1_000_000, 0, 3, 0, 2, 0, 0, 3])]);
    const padded = new Uint8Array(source.length + 20);
    padded.set(source, 10);
    const report = analyzeDataFlash(padded.subarray(10, 10 + source.length));
    expect(report.groups.ATT).toBe(1);
    expect(report.attitude?.rollErrorDeg?.peakTimeSeconds).toBe(0);
    expect(report.traces.attitude[0].timeSeconds).toBe(0);
    expect(report.rate).toBeNull();
    expect(report.vibration).toBeNull();
    expect(report.battery).toBeNull();
    expect(report.throttle).toBeNull();
    expect(report.caveats.join(' ')).toMatch(/No VIBE records/);
  });

  it('rejects non-DataFlash input and marks a truncated final record', () => {
    expect(() => analyzeDataFlash(new Uint8Array(90))).toThrow(DataFlashAnalysisError);
    const full = flight();
    const partial = full.subarray(0, full.length - 5);
    expect(analyzeDataFlash(partial).truncated).toBe(true);
  });
});
