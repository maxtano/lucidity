import { describe, expect, it } from 'vitest';
import { currentBaseline, defaultProfile, emptyReport, evaluateAutomatic, evaluateEscs, readReports, replaceResults, saveReport, summarizeReport } from './model';
import { syntheticParameters, syntheticSnapshot } from './fixtures';
const evaluate = (edit?: (s: ReturnType<typeof syntheticSnapshot>, p: ReturnType<typeof syntheticParameters>) => void) => {
  const s = syntheticSnapshot(), p = syntheticParameters(); edit?.(s, p);
  return evaluateAutomatic(s, s.aircraft[0], p, defaultProfile, 9000);
};
describe('deterministic drone-check rules', () => {
  it('evaluates the same evidence identically and keeps physical/field coverage separate', () => {
    expect(evaluate()).toEqual(evaluate());
    expect(evaluate().every(r => r.state === 'passed')).toBe(true);
    const report = replaceResults(emptyReport(defaultProfile, 1, 'test'), evaluate(), 2);
    expect(report.results.find(r => r.id === 'motor-1')?.state).toBe('pending');
    expect(report.results.find(r => r.id === 'flight-load')?.state).toBe('unsupported');
    expect(summarizeReport(report).title).toBe('Checks recorded');
  });
  it('never treats command acceptance without fresh pre-arm health as success', () => {
    expect(evaluate(s => { s.aircraft[0].health!.receivedAt = 8000; }).find(r => r.id === 'prearm')?.state).toBe('blocked');
    expect(evaluate(s => { s.aircraft[0].health!.enabled &= ~(1 << 28); }).find(r => r.id === 'prearm')?.state).toBe('blocked');
    expect(evaluate(s => { s.aircraft[0].health!.healthy &= ~(1 << 28); }).find(r => r.id === 'prearm')?.state).toBe('failed');
  });
  it('rejects stale and misaddressed pre-arm acknowledgements', () => {
    expect(evaluate(s => { s.aircraft[0].lastPrearmAck!.receivedAt = 8000; }).find(r => r.id === 'prearm')?.state).toBe('blocked');
    expect(evaluate(s => { s.aircraft[0].lastPrearmAck!.targetSystem = 23; }).find(r => r.id === 'prearm')?.state).toBe('blocked');
    expect(evaluate(s => { s.aircraft[0].lastPrearmAck!.result = 3; }).find(r => r.id === 'prearm')?.state).toBe('unsupported');
  });
  it('does not clear configuration rules with a partial or foreign parameter collection', () => {
    for (const edit of [(p: ReturnType<typeof syntheticParameters>) => { p.state = 'partial'; }, (p: ReturnType<typeof syntheticParameters>) => { p.aircraftId = 'other'; }]) {
      const r = evaluate((_, p) => edit(p));
      expect(r.filter(r => r.group === 'configuration' && r.id !== 'firmware').every(r => r.state === 'blocked')).toBe(true);
    }
  });
  it('checks ArduCopter 4.7 low-battery action by its current parameter name', () => {
    const configured = evaluate().find(r => r.id === 'battery-failsafe');
    expect(configured?.state).toBe('passed');
    expect(configured?.detail).toContain('BATT_FS_LOW_ACT = 1');
    expect(evaluate((_, p) => {
      p.parameters.find(item => item.name === 'BATT_FS_LOW_ACT')!.value = 0;
    }).find(r => r.id === 'battery-failsafe')?.state).toBe('failed');
    expect(evaluate((_, p) => {
      p.parameters.find(item => item.name === 'BATT_FS_LOW_ACT')!.name = 'BATT_FS_LOW';
    }).find(r => r.id === 'battery-failsafe')?.state).toBe('blocked');
  });
  it('requires the ArduCopter 4.7 pre-arm skip mask rather than an obsolete parameter', () => {
    expect(evaluate().find(r => r.id === 'arming-checks')?.state).toBe('passed');
    expect(evaluate((_, p) => {
      p.parameters.find(item => item.name === 'ARMING_SKIPCHK')!.value = 1;
    }).find(r => r.id === 'arming-checks')?.state).toBe('failed');
    expect(evaluate((_, p) => {
      p.parameters.find(item => item.name === 'ARMING_SKIPCHK')!.name = 'ARMING_CHECK';
    }).find(r => r.id === 'arming-checks')?.state).toBe('blocked');
  });
  it('does not apply firmware-specific parameter rules to other releases', () => {
    const r = evaluate(s => { s.aircraft[0].version!.flightVersion = '4.8.0'; });
    expect(r.find(r => r.id === 'arming-checks')?.state).toBe('unsupported');
  });
  it('flags disabled checks, duplicate outputs, wrong thresholds and unhealthy sensors', () => {
    const r = evaluate((s, p) => {
      s.aircraft[0].health!.healthy &= ~2;
      p.parameters.find(p => p.name === 'ARMING_SKIPCHK')!.value = 1;
      p.parameters.find(p => p.name === 'BATT_CRT_VOLT')!.value = 22;
      p.parameters.find(p => p.name === 'SERVO2_FUNCTION')!.value = 33;
    });
    for (const id of ['arming-checks', 'battery-thresholds', 'output-1', 'output-2', 'sensor-2']) expect(r.find(r => r.id === id)?.state).toBe('failed');
  });
  it('does not report stale telemetry or absent sensors as healthy', () => {
    const r = evaluate(s => { s.aircraft[0].attitude!.receivedAt = 1; s.aircraft[0].health!.present = 0; s.aircraft[0].receiver = undefined; });
    for (const id of ['attitude', 'sensor-1', 'receiver-data']) expect(r.find(r => r.id === id)?.state).toBe('blocked');
  });
  it('requires readable ESCs and restored telemetry, without asserting physical rotation', () => {
    expect(evaluateEscs({ aircraftId: 'x', path: 'usb', startedAt: 1, count: 4, state: 'complete', message: '', telemetryRestored: false,
      escs: Array.from({ length: 4 }, (_, i) => ({ index: i + 1, firmware: 'Bluejay', direction: 'Normal' })) }, 2).state).toBe('blocked');
  });
  it('invalidates the live baseline after reconnect, arming, identity change or stale service data', () => {
    const s = syntheticSnapshot(); const r = emptyReport(defaultProfile, 1000, 'r');
    r.baseline = { aircraftId: s.aircraft[0].id, path: s.link.path!, connectedAt: s.link.connectedAt!, uid: s.aircraft[0].version!.uid, firmware: '4.7.1', configurationHash: '' };
    expect(currentBaseline(r, s, s.now)).toBe(true);
    expect(currentBaseline(r, s, s.now + 5000)).toBe(false);
    const other = structuredClone(s); other.link.connectedAt = other.link.connectedAt! + 1;
    expect(currentBaseline(r, other, s.now)).toBe(false);
    other.link.connectedAt = s.link.connectedAt; other.aircraft[0].version!.uid = 'different';
    expect(currentBaseline(r, other, s.now)).toBe(false);
  });
  it('stores bounded, versioned history and rejects corrupted reports', () => {
    let raw: string | null = null; const store = { getItem: () => raw, setItem: (_: string, value: string) => { raw = value; } };
    for (let i = 0; i < 8; i++) saveReport(store, emptyReport(defaultProfile, i, String(i)));
    expect(readReports(store)).toHaveLength(5);
    raw = raw!.replace('arducopter-bench-beta-1', 'future-version'); expect(readReports(store)).toEqual([]);
    raw = '{invalid'; expect(readReports(store)).toEqual([]);
    raw = 'x'.repeat(600001); expect(readReports(store)).toEqual([]);
  });
});
