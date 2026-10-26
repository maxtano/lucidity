import { describe, expect, it } from 'vitest';
import { defaultProfile } from './model';
import { controllerPath, radioPath, syntheticClient } from './fixtures';
import { runAutomatic, runRadioCheck, type RunnerOptions } from './runner';
const options = (f: ReturnType<typeof syntheticClient>, signal = new AbortController().signal): RunnerOptions => ({ profile: defaultProfile, path: controllerPath, signal, progress: () => {}, client: f.client, wait: f.wait, now: f.now });
describe('bounded diagnostic orchestration', () => {
  it('runs fresh reads and returns real evaluated results without writes, arming, or motor activity', async () => {
    const f = syntheticClient(); const r = await runAutomatic(options(f));
    expect(r.outcome).toBe('complete'); expect(r.baseline?.uid).toBe('uid:123456789');
    expect(r.results.find(r => r.id === 'link-window')?.state).toBe('passed');
    expect(r.results.find(r => r.id === 'prearm')?.state).toBe('passed');
    expect(f.calls.some(c => /set|install|motor|arm-disarm/.test(c.path))).toBe(false);
    expect(r.baseline?.configurationHash).toHaveLength(64);
  });
  it('cancels without issuing later checks and preserves pending coverage', async () => {
    const f = syntheticClient(), c = new AbortController();
    const o = options(f, c.signal); o.progress = text => { if (text.startsWith('Observing')) c.abort(); };
    const r = await runAutomatic(o); expect(r.outcome).toBe('cancelled');
    expect(f.calls.some(c => c.path === 'aircraft/prearm-check')).toBe(false);
    expect(r.results.find(r => r.id === 'motor-1')?.state).toBe('pending');
  });
  it('does not send a diagnostic request to an armed aircraft', async () => {
    const f = syntheticClient(); f.controls.mutation = s => { s.aircraft[0].heartbeat.armed = true; };
    const r = await runAutomatic(options(f)); expect(r.outcome).toBe('interrupted');
    expect(f.calls).toHaveLength(1);
  });
  it('stops when a second aircraft appears', async () => {
    const f = syntheticClient(); f.controls.mutation = s => { s.aircraft.push({ ...s.aircraft[0], id: 'other' }); };
    expect((await runAutomatic(options(f))).outcome).toBe('interrupted');
    expect(f.calls.some(c => c.path === 'aircraft/request-telemetry')).toBe(false);
  });
  it('bounds a no-heartbeat wait and preserves a specific connection diagnosis', async () => {
    const f = syntheticClient(); f.controls.absent = true;
    const r = await runAutomatic(options(f));
    expect(r.results.find(r => r.id === 'run')?.detail).toContain('no aircraft heartbeat');
    expect(f.calls.filter(c => c.path === 'aircraft/status').length).toBeLessThanOrEqual(21);
  });
  it('detects reconnects and stale heartbeats during the observation window', async () => {
    for (const reconnect of [true, false]) {
      const f = syntheticClient(); f.controls.mutation = s => { if (s.now > 13000) { if (reconnect) s.link.connectedAt = 13000; else s.aircraft[0].heartbeat.receivedAt = 1; } };
      expect((await runAutomatic(options(f))).outcome).toBe('interrupted');
    }
  });
  it('keeps partial configuration unverified', async () => {
    const f = syntheticClient(); f.controls.partial = true;
    const r = await runAutomatic(options(f));
    expect(r.results.find(r => r.id === 'parameters')?.state).toBe('blocked');
    expect(r.results.find(r => r.id === 'frame')?.state).toBe('blocked');
  });
  it('does not call invalid frames packet loss or declare the observation healthy', async () => {
    const f = syntheticClient(); f.controls.mutation = s => { s.link.invalidFrames = Math.floor(s.now / 1000); };
    const r = await runAutomatic(options(f)); expect(r.results.find(r => r.id === 'link-window')?.state).toBe('failed');
    expect(r.results.find(r => r.id === 'link-window')?.detail).toContain('invalid frames');
  });
  it('requires the direct USB port to be absent before testing the radio', async () => {
    const f = syntheticClient(); const baseline = await runAutomatic(options(f)); f.calls.length = 0;
    const r = await runRadioCheck({ ...options(f), path: radioPath }, baseline);
    expect(r[0].state).toBe('blocked'); expect(r[0].detail).toContain('still present');
    expect(f.calls.some(c => c.path === 'aircraft/disconnect')).toBe(false);
  });
  it('verifies the same hardware and configuration over a separate path', async () => {
    const f = syntheticClient(); const baseline = await runAutomatic(options(f)); f.controls.controllerPresent = false;
    const r = await runRadioCheck({ ...options(f), path: radioPath }, baseline);
    expect(r[0].state).toBe('passed');
  });
  it('rejects radio identity mismatch and missing hardware UID', async () => {
    const f = syntheticClient(); const baseline = await runAutomatic(options(f)); f.controls.controllerPresent = false;
    f.controls.mutation = s => { if (s.aircraft[0]) s.aircraft[0].version!.uid = 'uid:another'; };
    const r = await runRadioCheck({ ...options(f), path: radioPath }, baseline);
    expect(r[0].state).toBe('blocked'); expect(r[0].detail).toContain('does not match');
    baseline.baseline!.uid = undefined; f.calls.length = 0;
    await runRadioCheck({ ...options(f), path: radioPath }, baseline);
    expect(f.calls).toHaveLength(0);
  });
  it('does not compare a partial radio configuration as a match', async () => {
    const f = syntheticClient(); const baseline = await runAutomatic(options(f)); f.controls.controllerPresent = false; f.controls.partial = true;
    const r = await runRadioCheck({ ...options(f), path: radioPath }, baseline);
    expect(r[0].state).toBe('blocked'); expect(r[0].detail).toContain('Configuration');
  });
});
