import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AircraftSnapshot, AircraftTelemetry } from '../aircraft/types';
import type { BenchShowStatus } from '../aircraft/bench-show-plan';
import type { StoryboardBenchPlan } from '../core/bench-storyboard';
import {
  BenchShowPanel,
  benchShowConnectionIdentity,
  benchShowReviewIdentity,
  benchShowStopAvailable,
  benchShowTimeline,
  currentBenchShow,
} from './BenchShowPanel';

const aircraft = (): AircraftTelemetry => ({
  id: 'serial:bench/1/1',
  systemId: 1,
  componentId: 1,
  protocolVersion: 2,
  signing: 'unsigned',
  heartbeat: {
    receivedAt: 100_000,
    armed: false,
    mode: 'Stabilize',
    customMode: 0,
    systemStatus: 'Standby',
    autopilot: 3,
    vehicleType: 2,
  },
  attitude: null,
  gps: null,
  position: null,
  battery: null,
  messages: [],
  version: { receivedAt: 100_000, flightVersion: '4.7.1', releaseType: 255 },
});
const snapshot = (): AircraftSnapshot => ({
  now: 100_100,
  link: {
    state: 'listening',
    path: 'bench',
    baudRate: 115200,
    connectedAt: 99_000,
    error: null,
    bytesReceived: 1000,
    packetsReceived: 20,
    invalidFrames: 0,
    lastPacketAt: 100_000,
    transmittedBytes: 0,
  },
  aircraft: [aircraft()],
  request: {
    state: 'verified',
    aircraftId: 'serial:bench/1/1',
    startedAt: 99_900,
    message: 'Firmware identified',
  },
});
const plan = (): StoryboardBenchPlan => ({
  source: { id: 'authored-show', name: 'My first motor storyboard', revision: 2, planKey: 'authored-key' },
  durationMs: 25000,
  cues: [
    { sceneId: 'opening', sceneName: 'Opening pulse', motor: 2, atMs: 4000 },
    { sceneId: 'middle', sceneName: 'Middle pulse', motor: 4, atMs: 10000 },
    { sceneId: 'closing', sceneName: 'Closing pulse', motor: 1, atMs: 18000 },
  ],
});
const run = (overrides: Partial<BenchShowStatus> = {}): BenchShowStatus => ({
  runId: 'run-1',
  aircraftId: 'serial:bench/1/1',
  source: plan().source,
  state: 'running',
  startedAt: 100_000,
  elapsedMs: 0,
  durationMs: plan().durationMs,
  message: 'Storyboard started.',
  cues: plan().cues.map((cue) => ({ ...cue, state: 'waiting' })),
  ...overrides,
});
const render = (
  state = snapshot(),
  extra: { busy?: boolean; serviceUnavailable?: boolean; now?: number; plan?: StoryboardBenchPlan | null; planError?: string } = {}
) =>
  renderToStaticMarkup(
    <BenchShowPanel
      snapshot={state}
      aircraft={state.aircraft[0]}
      plan={extra.plan === null ? undefined : extra.plan ?? plan()}
      planError={extra.planError}
      now={extra.now ?? state.now}
      busy={extra.busy ?? false}
      serviceUnavailable={extra.serviceUnavailable ?? false}
      onStart={() => { throw new Error('Rendering cannot start hardware'); }}
      onStop={() => { throw new Error('Rendering cannot send a stop'); }}
    />
  );

describe('storyboard run timing and identity', () => {
  it('uses the authored cue order, duration, and selected motor channels', () => {
    expect(benchShowTimeline(plan())).toMatchObject({ elapsedMs: 0, phase: 'Authored storyboard schedule' });
    expect(benchShowTimeline(plan(), run({ elapsedMs: 3999 })).phase).toBe('Lead-in · first cue at 4s');
    for (const cue of plan().cues) {
      expect(benchShowTimeline(plan(), run({ elapsedMs: cue.atMs })).cue?.sceneId).toBe(cue.sceneId);
      expect(benchShowTimeline(plan(), run({ elapsedMs: cue.atMs + 999 })).cue?.sceneId).toBe(cue.sceneId);
      expect(benchShowTimeline(plan(), run({ elapsedMs: cue.atMs + 1000 })).cue).toBeUndefined();
    }
    expect(benchShowTimeline(plan(), run({ elapsedMs: 19000 })).phase).toBe('Final telemetry checks');
    expect(benchShowTimeline(undefined, run()).cue).toBeUndefined();
  });

  it('uses frozen service time after cancellation and never turns elapsed time into success', () => {
    expect(benchShowTimeline(plan(), run({ state: 'cancelled', elapsedMs: 4500 }))).toEqual({
      elapsedMs: 4500, cue: undefined, phase: 'Schedule ended',
    });
    expect(benchShowTimeline(plan(), run({ elapsedMs: NaN })).elapsedMs).toBe(0);
    expect(benchShowTimeline(plan(), run({ elapsedMs: -1 })).elapsedMs).toBe(0);
    expect(benchShowTimeline(plan(), run({ elapsedMs: 30000 })).elapsedMs).toBe(25000);
    const state = snapshot();
    state.benchShow = run({ elapsedMs: 25000 });
    const html = render(state);
    expect(html).toContain('Storyboard running · props off');
    expect(html).not.toContain('Schedule complete');
    expect(html).not.toContain('Every scheduled pulse moved and stopped');
    state.benchShow = run({ state: 'cancelled', elapsedMs: 4500 });
    expect(render(state)).not.toContain('class="is-active"');
  });

  it('invalidates assignment review and old results when the connection or storyboard changes', () => {
    const state = snapshot();
    state.benchShow = run();
    const original = benchShowReviewIdentity(state, state.aircraft[0], plan());
    expect(currentBenchShow(state, state.aircraft[0], plan())).toBe(state.benchShow);
    expect(currentBenchShow(state, state.aircraft[0])).toBeUndefined();
    for (const source of [
      { ...plan().source, revision: 3 },
      { ...plan().source, planKey: 'edited-timing' },
      { ...plan().source, id: 'another-storyboard' },
      { ...plan().source, name: 'Renamed storyboard' },
    ]) {
      const edited = { ...plan(), source };
      expect(benchShowReviewIdentity(state, state.aircraft[0], edited)).not.toBe(original);
      expect(currentBenchShow(state, state.aircraft[0], edited)).toBeUndefined();
    }
    const other = { ...state.aircraft[0], id: 'other' };
    expect(benchShowReviewIdentity(state, other, plan())).not.toBe(original);
    expect(currentBenchShow(state, other, plan())).toBeUndefined();
    state.link.connectedAt = 105_000;
    expect(benchShowReviewIdentity(state, state.aircraft[0], plan())).not.toBe(original);
    expect(currentBenchShow(state, state.aircraft[0], plan())).toBeUndefined();
    state.link.connectedAt = 99_000;
    const connection = benchShowConnectionIdentity(state, state.aircraft[0]);
    state.link.path = 'different';
    expect(benchShowConnectionIdentity(state, state.aircraft[0])).not.toBe(connection);
  });

  it('keeps stop usable for an active or starting run despite changed storyboard or stale armed telemetry', () => {
    const state = snapshot();
    expect(benchShowStopAvailable(state, state.aircraft[0])).toBe(false);
    expect(benchShowStopAvailable(state, state.aircraft[0], true)).toBe(true);
    state.benchShow = run({ source: { ...plan().source, revision: 1 } });
    state.aircraft[0].heartbeat.armed = true;
    state.aircraft[0].heartbeat.receivedAt = 0;
    expect(benchShowStopAvailable(state, state.aircraft[0])).toBe(true);
    expect(currentBenchShow(state, state.aircraft[0], plan())).toBeUndefined();
    expect(benchShowStopAvailable(state, { ...aircraft(), id: 'other' })).toBe(false);
    state.benchShow.state = 'stopping';
    expect(benchShowStopAvailable(state, state.aircraft[0])).toBe(true);
    state.benchShow.state = 'completed';
    expect(benchShowStopAvailable(state, state.aircraft[0])).toBe(false);
    state.link.state = 'disconnected';
    expect(benchShowStopAvailable(state, state.aircraft[0], true)).toBe(false);
  });
});

describe('storyboard run review UI', () => {
  it('requires explicit assignment and fresh checks for the named authored version', () => {
    const html = render();
    expect(html).toContain('My first motor storyboard');
    expect(html).toContain('Revision 2');
    expect(html).toContain('3 authored motor cues · 25 seconds');
    expect(html).toContain('Opening pulse');
    expect(html).toContain('Closing pulse');
    expect(html).toContain('Assign Drone 1 to System 1 / Component 1');
    expect(html.match(/type="checkbox" disabled=""/g)).toHaveLength(3);
    expect(html).not.toContain('checked=""');
    expect(html).toContain('class="bench-show-start" type="button" disabled=""');
    expect(html).toContain('Start storyboard run');
    expect(html).toContain('Runs the motor cues authored in this storyboard');
    expect(html).toContain('does not measure rotation, position, or height');
    expect(html).not.toContain('24-second');
    expect(html).not.toContain('FIXED SAMPLE');
  });

  it('has no fallback sample when the project is missing or invalid', () => {
    const html = render(snapshot(), { plan: null, planError: 'Add a motor cue to this storyboard.' });
    expect(html).toContain('Add a motor cue to this storyboard.');
    expect(html).toContain('Storyboard required');
    expect(html).not.toContain('Storyboard motor channel preview');
    expect(html).toContain('class="bench-show-start" type="button" disabled=""');
    expect(html).not.toContain('Motor A');
    expect(html).not.toContain('Motor D');
  });

  it('never presents another revision’s result as the current storyboard, but keeps Stop', () => {
    const state = snapshot();
    state.benchShow = run({ source: { ...plan().source, revision: 1 }, elapsedMs: 4500 });
    const html = render(state, { serviceUnavailable: true });
    expect(html).toContain('A different storyboard version is running');
    expect(html).toContain('revision 1');
    expect(html).toContain('Stop remains available below');
    expect(html).toContain('class="bench-show-stop" type="button">');
    expect(html).not.toContain('4.5 / 25 s');
    expect(html).not.toContain('SERVICE REPORTED');
    state.benchShow.state = 'completed';
    expect(render(state)).toContain('Previous run belongs to a different storyboard version');
    expect(render(state)).not.toContain('Every scheduled pulse moved and stopped');
  });

  it('preserves Stop during an active run when the service is unavailable', () => {
    const state = snapshot();
    state.benchShow = run({ elapsedMs: 4500 });
    state.aircraft[0].heartbeat.armed = true;
    const html = render(state, { busy: true, serviceUnavailable: true });
    expect(html).toContain('class="bench-show-stop" type="button">');
    expect(html).toContain('showing the last reported schedule time');
    expect(html).toContain('4.5 / 25 s');
    state.benchShow.state = 'stopping';
    const stopping = render(state, { busy: true });
    expect(stopping).toContain('class="bench-show-stop" type="button" disabled=""');
    expect(stopping).toContain('Requesting stop…');
  });

  it('matches motor cues by scene and separates telemetry from observation', () => {
    const state = snapshot();
    state.now = 125_100;
    state.benchShow = run({
      state: 'completed', elapsedMs: 25000, message: 'Three authored cues completed.',
      cues: plan().cues.map((cue) => ({ ...cue, state: 'confirmed' })),
    });
    const html = render(state);
    expect(html).toContain('Schedule complete · observation needed');
    expect(html.match(/Disarmed heartbeat received/g)).toHaveLength(3);
    expect(html).toContain('Awaiting your observation. Command results do not prove motor movement.');
    expect(html).toContain('Every scheduled pulse moved and stopped');
    expect(html).not.toContain('Operator observed:');
    expect(html).not.toContain('Movement confirmed');
    state.benchShow.cues[2].sceneId = 'wrong-scene';
    expect(render(state).match(/Disarmed heartbeat received/g)).toHaveLength(2);
    expect(render(state)).toContain('Not run');
  });

  it('honestly labels failed or skipped cues and disables observation during cooldown', () => {
    const state = snapshot();
    state.benchShow = run({
      state: 'failed', elapsedMs: 4500, message: '<b>Rejected</b>',
      cues: plan().cues.map((cue, index) => ({ ...cue, state: index === 0 ? 'failed' : 'waiting' })),
    });
    state.motorTest = {
      state: 'rejected', aircraftId: state.aircraft[0].id, motor: 2,
      startedAt: 104_000, availableAt: 109_000, message: 'Rejected',
    };
    const html = render(state, { now: 105_000 });
    expect(html).toContain('Schedule ended early · verify the motors');
    expect(html).toContain('&lt;b&gt;Rejected&lt;/b&gt;');
    expect(html).toContain('Cue not confirmed');
    expect(html.match(/Not run/g)).toHaveLength(2);
    expect(html).toContain('Wait for current commands and cooldown');
    expect(html).toContain('type="button" disabled="" aria-pressed="false">Motors stopped');
    expect(html).not.toContain('Every scheduled pulse moved and stopped');
  });
});
