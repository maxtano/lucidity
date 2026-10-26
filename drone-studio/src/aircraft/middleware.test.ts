import { compileStoryboardBenchPlan, createBenchStoryboard } from '../core/bench-storyboard';
import { createZorroStopStoryboard } from '../core/zorro-test';
import { createFirstLiveHoverStoryboard } from '../core/first-live-show';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aircraftApiPlugin, createAircraftMiddleware } from './middleware';
import { AircraftServiceError } from './service';
import type { AircraftSnapshot } from './types';

const path = '/dev/cu.usbmodemTEST';
function fixture() {
  const snapshot: AircraftSnapshot = {
    now: 1000,
    link: {
      state: 'disconnected',
      path: null,
      baudRate: 115200,
      connectedAt: null,
      error: null,
      bytesReceived: 0,
      packetsReceived: 0,
      invalidFrames: 0,
      lastPacketAt: null,
      transmittedBytes: 0,
    },
    aircraft: [],
  };
  const service = {
    ports: vi.fn(async () => [{ path }]),
    readEscs: vi.fn(async () => ({ state: 'complete' as const, aircraftId: 'one', path, startedAt: 1000, message: 'Read complete', count: 0, escs: [], telemetryRestored: true })),
    snapshot: vi.fn(() => snapshot),
    connect: vi.fn(async () => snapshot),
    disconnect: vi.fn(async () => snapshot),
    requestTelemetry: vi.fn(async () => snapshot),
    requestRadioChannels: vi.fn(async () => snapshot),
    calibrateLevel: vi.fn(async () => ({ aircraftId: 'one', state: 'accepted' as const, ack: { result: 0, receivedAt: 1000 },
      before: { AHRS_TRIM_X: 0, AHRS_TRIM_Y: 0, attitude: null },
      after: { AHRS_TRIM_X: 0, AHRS_TRIM_Y: 0, attitude: null }, message: 'Acknowledged; level remains unproven.' })),
    runPrearmChecks: vi.fn(async () => ({ requestedAt: 1000 })),
    motorTest: vi.fn(async () => snapshot),
    stopMotorTest: vi.fn(async () => snapshot),
    startBenchShow: vi.fn(() => snapshot),
    renewBenchShow: vi.fn(() => snapshot),
    stopBenchShow: vi.fn(async () => snapshot),
    startZorroStop: vi.fn(async () => snapshot),
    renewZorroStop: vi.fn(() => snapshot),
    stopZorroStop: vi.fn(async () => snapshot),
    checkMissionLaunch: vi.fn(async () => ({ ready: true as const,
      verificationId: '460f29dc-32a8-4916-a620-06cb6fb09ff7', expiresAt: 2000, message: 'Ready for review.' })),
    launchMission: vi.fn(async () => ({ runId: '460f29dc-32a8-4916-a620-06cb6fb09ff7', aircraftId: 'one', planId: 'plan',
      state: 'active' as const, reason: 'AUTO observed', issuedCommands: [224, 400, 300], progress: null })),
    landMission: vi.fn(async () => ({ runId: '460f29dc-32a8-4916-a620-06cb6fb09ff7',
      aircraftId: 'one', planId: 'plan', state: 'landing' as const,
      reason: 'LAND accepted', issuedCommands: [224, 400, 300, 176], progress: null })),
    flightRunStatus: vi.fn(() => ({ runId: null, aircraftId: null, planId: null, state: 'idle' as const,
      reason: 'idle', issuedCommands: [], progress: null })),
    logStatus: vi.fn(() => ({ state: 'idle' as const, entries: [{ id: 7, size: 3, numLogs: 1, lastLogNum: 7, timeUtc: 0 }], progress: null, error: null, artifact: null })),
    listLogs: vi.fn(() => ({ state: 'listing' as const, entries: [], progress: null, error: null, artifact: null })),
    downloadLog: vi.fn(() => ({ state: 'downloading' as const, entries: [], progress: { received: 0, total: 3 }, error: null, artifact: null })),
    cancelLogTransfer: vi.fn(() => ({ state: 'error' as const, entries: [], progress: null, error: 'Cancelled', artifact: null })),
    logFile: vi.fn(() => Buffer.from([0xa3, 0x95, 0x80])),
    reconcileMissionRun: vi.fn(async () => ({ recovered: true as const, message: 'Reconciled.' })),
    dispose: vi.fn(async () => {}),
  };
  const middleware = createAircraftMiddleware(service);
  function request(
    options: {
      url?: string;
      method?: string;
      peer?: string;
      headers?: Record<string, string | undefined>;
      body?: string;
      held?: boolean;
    } = {}
  ) {
    const input = new PassThrough();
    const req = Object.assign(input, {
      url: options.url ?? '/api/aircraft/status',
      method: options.method ?? 'GET',
      headers: {
        host: '127.0.0.1:5173',
        origin: 'http://127.0.0.1:5173',
        'content-type': 'application/json',
        'x-lucidity-aircraft': '1',
        ...options.headers,
      },
      socket: { remoteAddress: options.peer ?? '127.0.0.1' },
      aborted: false,
    }) as unknown as IncomingMessage;
    const headers = new Map<string, unknown>();
    const output = {
      destroyed: false,
      writableEnded: false,
      statusCode: 200,
      body: '',
      setHeader(name: string, value: unknown) {
        headers.set(name, value);
      },
      end(body: string) {
        this.body = body;
        this.writableEnded = true;
      },
    };
    const next = vi.fn();
    const pending = Promise.resolve(middleware(req, output as unknown as ServerResponse, next));
    if (!options.held) input.end(options.body ?? '{}');
    return { pending, output, headers, next, input };
  }
  return { service, request, snapshot };
}
afterEach(() => vi.useRealTimers());

describe('local aircraft API guard and lifecycle', () => {
  it('requires the exact physical level-calibration confirmations before invoking the service', async () => {
    const f = fixture();
    const body = { aircraftId: 'one', propsRemoved: true, batteryDisconnected: true,
      physicallyLevel: true, still: true, directUsb: true, confirmed: true };
    for (const invalid of [
      { ...body, batteryDisconnected: false },
      { ...body, directUsb: undefined },
      { ...body, confirmed: false },
      { ...body, command: 241 },
      { ...body, _param5: 2 },
    ]) {
      const result = f.request({ url: '/api/aircraft/calibrate-level', method: 'POST', body: JSON.stringify(invalid) });
      await result.pending;
      expect(result.output.statusCode).toBe(400);
    }
    expect(f.service.calibrateLevel).not.toHaveBeenCalled();
    const valid = f.request({ url: '/api/aircraft/calibrate-level', method: 'POST', body: JSON.stringify(body) });
    await valid.pending;
    expect(valid.output.statusCode).toBe(200);
    expect(f.service.calibrateLevel).toHaveBeenCalledExactlyOnceWith('one', {
      propsRemoved: true, batteryDisconnected: true, physicallyLevel: true,
      still: true, directUsb: true, confirmed: true,
    });
  });
  it('limits flight-log endpoints to read-only list, exact download and cancel shapes', async () => {
    const f = fixture();
    const status = f.request({ url: '/api/aircraft/logs/status' });
    await status.pending;
    expect(status.output.statusCode).toBe(200);
    const list = f.request({ url: '/api/aircraft/logs/list', method: 'POST', body: JSON.stringify({ aircraftId: 'one' }) });
    await list.pending;
    expect(f.service.listLogs).toHaveBeenCalledExactlyOnceWith('one');
    const get = f.request({ url: '/api/aircraft/logs/download', method: 'POST', body: JSON.stringify({ aircraftId: 'one', logId: 7 }) });
    await get.pending;
    expect(f.service.downloadLog).toHaveBeenCalledExactlyOnceWith('one', 7);
    const invalid = f.request({ url: '/api/aircraft/logs/download', method: 'POST', body: JSON.stringify({ aircraftId: 'one', logId: 7, erase: true }) });
    await invalid.pending;
    expect(invalid.output.statusCode).toBe(400);
    const cancel = f.request({ url: '/api/aircraft/logs/cancel', method: 'POST', body: '{}' });
    await cancel.pending;
    expect(f.service.cancelLogTransfer).toHaveBeenCalledOnce();
    const file = f.request({ url: '/api/aircraft/logs/file?name=flight-log.bin' });
    await file.pending;
    expect(file.output.statusCode).toBe(200);
    expect(f.service.logFile).toHaveBeenCalledExactlyOnceWith('flight-log.bin');
    const traversal = f.request({ url: '/api/aircraft/logs/file?name=..%2Fsecret.bin' });
    await traversal.pending;
    expect(traversal.output.statusCode).toBe(400);
    const erase = f.request({ url: '/api/aircraft/logs/erase', method: 'POST', body: '{}' });
    await erase.pending;
    expect(erase.output.statusCode).toBe(404);
  });
  it('exposes only reviewed physical launch, status, LAND and props-off recovery shapes', async () => {
    const f = fixture();
    const storyboard = createFirstLiveHoverStoryboard('physical-api-fixture');
    const planId = '460f29dc-32a8-4916-a620-06cb6fb09ff7';
    const checks = { propsInstalled: true, areaClear: true, pilotReady: true, modeSwitchReady: true };
    const check = f.request({ url: '/api/aircraft/mission/launch-check', method: 'POST',
      body: JSON.stringify({ aircraftId: 'one', planId, storyboard }) });
    await check.pending;
    expect(check.output.statusCode).toBe(200);
    expect(f.service.checkMissionLaunch).toHaveBeenCalledExactlyOnceWith('one', planId, storyboard);
    for (const extra of [{ command: 400 }, { forceArm: true }, { checks: { ...checks, pilotReady: false } }]) {
      const r = f.request({ url: '/api/aircraft/mission/launch', method: 'POST',
        body: JSON.stringify({ aircraftId: 'one', storyboard, verificationId: planId, checks, ...extra }) });
      await r.pending; expect(r.output.statusCode).toBe(400);
    }
    expect(f.service.launchMission).not.toHaveBeenCalled();
    const launch = f.request({ url: '/api/aircraft/mission/launch', method: 'POST',
      body: JSON.stringify({ aircraftId: 'one', storyboard, verificationId: planId, checks }) });
    await launch.pending;
    expect(launch.output.statusCode).toBe(200);
    expect(f.service.launchMission).toHaveBeenCalledExactlyOnceWith('one', storyboard, planId, checks);
    const status = f.request({ url: '/api/aircraft/mission/launch-status' });
    await status.pending;
    expect(status.output.statusCode).toBe(200);
    const land = f.request({ url: '/api/aircraft/mission/land', method: 'POST', body: JSON.stringify({ runId: planId }) });
    await land.pending;
    expect(f.service.landMission).toHaveBeenCalledExactlyOnceWith(planId);
    const forbidden = f.request({ url: '/api/aircraft/mission/land', method: 'POST',
      body: JSON.stringify({ runId: planId, disarm: true }) });
    await forbidden.pending; expect(forbidden.output.statusCode).toBe(400);
    const recovery = f.request({ url: '/api/aircraft/mission/reconcile', method: 'POST',
      body: JSON.stringify({ aircraftId: 'one', propsRemoved: true, confirmed: true }) });
    await recovery.pending; expect(recovery.output.statusCode).toBe(200);
    const unsafeRecovery = f.request({ url: '/api/aircraft/mission/reconcile', method: 'POST',
      body: JSON.stringify({ aircraftId: 'one', propsRemoved: false, confirmed: true }) });
    await unsafeRecovery.pending; expect(unsafeRecovery.output.statusCode).toBe(400);
    const raw = f.request({ url: '/api/aircraft/command-long', method: 'POST', body: '{}' });
    await raw.pending; expect(raw.output.statusCode).toBe(404);
  });
  it('rejects unreviewed startup writes and arbitrary firmware/address payloads', async () => {
    const { request } = fixture();
    const planId = '460f29dc-32a8-4916-a620-06cb6fb09ff7';
    const valid = { aircraftId: 'one', planId, propsRemoved: true, directUsb: true, confirmed: true, firmwareChangeConfirmed: true };
    for (const body of [{ ...valid, confirmed: false }, { ...valid, planId: '' }, { ...valid, image: 'deadbeef' }, { ...valid, address: 0x1c00 }, { ...valid, propsRemoved: false }]) {
      const r = request({ url: '/api/aircraft/esc/startup/install', method: 'POST', body: JSON.stringify(body) });
      await r.pending; expect(r.output.statusCode).toBe(400);
    }
    const r = request({ url: '/api/aircraft/esc/startup/install', method: 'POST', body: JSON.stringify(valid) });
    await r.pending; expect(r.output.statusCode).toBe(501); // Valid shape; fake service deliberately has no writer.
  });
  it('validates replay safety checks and rejects raw commands or firmware data', async () => {
    const { request } = fixture();
    const valid = { aircraftId: 'one', propsRemoved: true, directUsb: true, tune: { name: 'Tune', bpm: 120, notes: [{ midi: 72, beats: 1 }] } };
    for (const body of [{ ...valid, propsRemoved: false }, { ...valid, directUsb: false }, { ...valid, command: 1 }, { ...valid, image: 'deadbeef' }]) {
      const r = request({ url: '/api/aircraft/esc/startup/replay', method: 'POST', body: JSON.stringify(body) });
      await r.pending; expect(r.output.statusCode).toBe(400);
    }
    const r = request({ url: '/api/aircraft/esc/startup/replay', method: 'POST', body: JSON.stringify(valid) });
    await r.pending; expect(r.output.statusCode).toBe(501);
  });
  it('requires explicit ESC inspection checks and rejects arbitrary protocol fields', async () => {
    const { service, request } = fixture();
    for (const body of [
      { aircraftId: 'one' },
      { aircraftId: 'one', propsRemoved: false, directUsb: true },
      { aircraftId: 'one', propsRemoved: true, directUsb: true, command: 59 },
    ]) {
      const r = request({ url: '/api/aircraft/esc/read', method: 'POST', body: JSON.stringify(body) });
      await r.pending; expect(r.output.statusCode).toBe(400);
    }
    expect(service.readEscs).not.toHaveBeenCalled();
    const r = request({ url: '/api/aircraft/esc/read', method: 'POST', body: JSON.stringify({ aircraftId: 'one', propsRemoved: true, directUsb: true }) });
    await r.pending; expect(r.output.statusCode).toBe(200); expect(service.readEscs).toHaveBeenCalledTimes(1);
  });
  it('returns JSON status/ports and passes unrelated routes through without opening hardware', async () => {
    const f = fixture();
    const status = f.request();
    await status.pending;
    expect(JSON.parse(status.output.body)).toEqual(f.snapshot);
    expect(status.headers.get('Cache-Control')).toBe('no-store');
    const ports = f.request({ url: '/api/aircraft/ports' });
    await ports.pending;
    expect(JSON.parse(ports.output.body)).toEqual({ ports: [{ path }] });
    const other = f.request({ url: '/api/agent/status' });
    await other.pending;
    expect(other.next).toHaveBeenCalledOnce();
    expect(f.service.connect).not.toHaveBeenCalled();
  });

  it.each([
    { peer: '192.168.1.2' },
    { peer: '203.0.113.4', headers: { host: 'localhost:5173' } },
    { headers: { host: 'evil.example:5173' } },
    { headers: { host: '127.0.0.1.evil.example' } },
    { headers: { origin: 'https://evil.example' } },
    { headers: { origin: 'null' } },
  ])('rejects nonlocal or cross-origin access %# before touching the service', async (options) => {
    const f = fixture();
    const r = f.request(options);
    await r.pending;
    expect(r.output.statusCode).toBe(403);
    expect(f.service.snapshot).not.toHaveBeenCalled();
    expect(f.service.ports).not.toHaveBeenCalled();
  });

  it.each(['::1', '::ffff:127.0.0.1'])('accepts canonical local peer %s', async (peer) => {
    const f = fixture();
    const r = f.request({ peer });
    await r.pending;
    expect(r.output.statusCode).toBe(200);
  });

  it('strictly validates each explicit action and returns its snapshot', async () => {
    const f = fixture();
    const connect = f.request({
      url: '/api/aircraft/connect',
      method: 'POST',
      body: JSON.stringify({ path, baudRate: 115200 }),
    });
    await connect.pending;
    expect(f.service.connect).toHaveBeenCalledExactlyOnceWith(path, 115200);
    expect(JSON.parse(connect.output.body)).toEqual(f.snapshot);
    const read = f.request({
      url: '/api/aircraft/request-telemetry',
      method: 'POST',
      body: JSON.stringify({ aircraftId: 'link:1:1' }),
    });
    await read.pending;
    expect(f.service.requestTelemetry).toHaveBeenCalledExactlyOnceWith('link:1:1');
    const radio = f.request({
      url: '/api/aircraft/request-radio', method: 'POST',
      body: JSON.stringify({ aircraftId: 'link:1:1' }),
    });
    await radio.pending;
    expect(f.service.requestRadioChannels).toHaveBeenCalledExactlyOnceWith('link:1:1');
    expect(JSON.parse(radio.output.body)).toEqual(f.snapshot);
    const disconnect = f.request({ url: '/api/aircraft/disconnect', method: 'POST' });
    await disconnect.pending;
    expect(f.service.disconnect).toHaveBeenCalledOnce();
    expect(JSON.parse(disconnect.output.body)).toEqual(f.snapshot);
  });

  it('routes only reviewed storyboard bench shows and run-scoped renewal/stop requests', async () => {
    const f = fixture();
    const runId = '460f29dc-32a8-4916-a620-06cb6fb09ff7';
    const storyboard = createBenchStoryboard();
    const reviewedPlanKey = compileStoryboardBenchPlan(storyboard).source.planKey;
    const checks = { propsRemoved: true, areaClear: true, hardwareCool: true };
    const start = f.request({ url: '/api/aircraft/bench-show/start', method: 'POST',
      body: JSON.stringify({ aircraftId: 'link:1:1', runId, storyboard, reviewedPlanKey, ...checks }) });
    await start.pending;
    expect(start.output.statusCode).toBe(200);
    expect(f.service.startBenchShow).toHaveBeenCalledExactlyOnceWith('link:1:1', runId, checks, storyboard, reviewedPlanKey);
    for (const action of ['renew', 'stop']) {
      const r = f.request({ url: `/api/aircraft/bench-show/${action}`, method: 'POST',
        body: JSON.stringify({ runId }) });
      await r.pending;
      expect(r.output.statusCode).toBe(200);
    }
    expect(f.service.renewBenchShow).toHaveBeenCalledExactlyOnceWith(runId);
    expect(f.service.stopBenchShow).toHaveBeenCalledExactlyOnceWith(runId);
    for (const extra of [{ throttle: 50 }, { duration: 60 }, { cues: [] }, { propsRemoved: false }]) {
      const r = f.request({ url: '/api/aircraft/bench-show/start', method: 'POST',
        body: JSON.stringify({ aircraftId: 'link:1:1', runId, storyboard, reviewedPlanKey, ...checks, ...extra }) });
      await r.pending;
      expect(r.output.statusCode).toBe(400);
    }
    const invalid = f.request({ url: '/api/aircraft/bench-show/renew', method: 'POST',
      body: JSON.stringify({ runId: 'arbitrary', aircraftId: 'link:1:1' }) });
    await invalid.pending;
    expect(invalid.output.statusCode).toBe(400);
    expect(f.service.startBenchShow).toHaveBeenCalledTimes(1);
    expect(f.service.renewBenchShow).toHaveBeenCalledTimes(1);
  });

  it('accepts only the fixed props-off idle storyboard and physical checks at the API boundary', async () => {
    const f = fixture();
    const runId = '460f29dc-32a8-4916-a620-06cb6fb09ff7';
    const storyboard = createZorroStopStoryboard();
    const checks = { propsRemoved: true, areaClear: true, hardwareCool: true, radioReady: true };
    const base = { aircraftId: 'link:1:1', runId, storyboard, ...checks };
    for (const changed of [{ propsRemoved: false }, { radioReady: false }, { throttle: 20 }, { forceArm: true }]) {
      const r = f.request({ url: '/api/aircraft/idle-show/start', method: 'POST', body: JSON.stringify({ ...base, ...changed }) });
      await r.pending;
      expect(r.output.statusCode).toBe(400);
    }
    expect(f.service.startZorroStop).not.toHaveBeenCalled();
    const start = f.request({ url: '/api/aircraft/idle-show/start', method: 'POST', body: JSON.stringify(base) });
    await start.pending;
    expect(start.output.statusCode).toBe(200);
    expect(f.service.startZorroStop).toHaveBeenCalledExactlyOnceWith(base.aircraftId, runId, storyboard, checks);
    for (const action of ['renew', 'stop']) {
      const r = f.request({ url: `/api/aircraft/idle-show/${action}`, method: 'POST', body: JSON.stringify({ runId }) });
      await r.pending;
      expect(r.output.statusCode).toBe(200);
    }
    expect(f.service.renewZorroStop).toHaveBeenCalledExactlyOnceWith(runId);
    expect(f.service.stopZorroStop).toHaveBeenCalledExactlyOnceWith(runId);
  });

  it('rejects the obsolete start request without a storyboard or without its review key', async () => {
    const f = fixture();
    const base = { aircraftId: 'link:1:1', runId: '460f29dc-32a8-4916-a620-06cb6fb09ff7',
      propsRemoved: true, areaClear: true, hardwareCool: true };
    for (const body of [base, { ...base, storyboard: createBenchStoryboard() },
      { ...base, reviewedPlanKey: 'anything' }, { ...base, storyboard: {}, reviewedPlanKey: 'anything' }]) {
      const request = f.request({ url: '/api/aircraft/bench-show/start', method: 'POST', body: JSON.stringify(body) });
      await request.pending;
      expect(request.output.statusCode).toBe(400);
    }
    expect(f.service.startBenchShow).not.toHaveBeenCalled();
  });

  it('permits a bounded storyboard above 4 KiB only on start and rejects oversized content before parsing', async () => {
    const f = fixture();
    const storyboard = createBenchStoryboard();
    storyboard.cues[0].metadata = { note: 'x'.repeat(5000) };
    const body = JSON.stringify({ aircraftId: 'link:1:1', runId: '460f29dc-32a8-4916-a620-06cb6fb09ff7',
      propsRemoved: true, areaClear: true, hardwareCool: true, storyboard,
      reviewedPlanKey: compileStoryboardBenchPlan(storyboard).source.planKey });
    expect(Buffer.byteLength(body)).toBeGreaterThan(4096);
    const valid = f.request({ url: '/api/aircraft/bench-show/start', method: 'POST', body });
    await valid.pending;
    expect(valid.output.statusCode).toBe(200);
    for (const options of [{ headers: { 'content-length': '65537' }, body: '{' }, { body: ' '.repeat(65537) }]) {
      const oversized = f.request({ url: '/api/aircraft/bench-show/start', method: 'POST', ...options });
      await oversized.pending;
      expect(oversized.output.statusCode).toBe(413);
    }
    for (const endpoint of ['bench-show/renew', 'bench-show/stop', 'motor-test']) {
      const other = f.request({ url: `/api/aircraft/${endpoint}`, method: 'POST', body });
      await other.pending;
      expect(other.output.statusCode).toBe(413);
    }
    expect(f.service.startBenchShow).toHaveBeenCalledOnce();
  });

  it.each([
    ['/connect', { path, baudRate: 9600 }],
    ['/connect', { path, baudRate: 115200, command: 'arm' }],
    ['/connect', { path }],
    ['/disconnect', { path }],
    ['/request-telemetry', { aircraftId: 'link:1:1', bytes: [1, 2] }],
    ['/request-telemetry', { aircraftId: '' }],
    ['/motor-test', { aircraftId: 'link:1:1', motor: 1 }],
    [
      '/motor-test',
      { aircraftId: 'link:1:1', motor: 0, propsRemoved: true, areaClear: true, hardwareCool: true },
    ],
    [
      '/motor-test',
      { aircraftId: 'link:1:1', motor: 5, propsRemoved: true, areaClear: true, hardwareCool: true },
    ],
    [
      '/motor-test',
      {
        aircraftId: 'link:1:1',
        motor: 1,
        propsRemoved: false,
        areaClear: true,
        hardwareCool: true,
      },
    ],
    [
      '/motor-test',
      {
        aircraftId: 'link:1:1',
        motor: 1,
        propsRemoved: true,
        areaClear: true,
        hardwareCool: true,
        throttle: 100,
      },
    ],
    ['/motor-test-stop', { aircraftId: 'link:1:1', duration: 20 }],
  ])('rejects malformed action %s without forwarding any fields', async (suffix, body) => {
    const f = fixture();
    const r = f.request({
      url: `/api/aircraft${suffix}`,
      method: 'POST',
      body: JSON.stringify(body),
    });
    await r.pending;
    expect(r.output.statusCode).toBe(400);
    expect(f.service.connect).not.toHaveBeenCalled();
    expect(f.service.disconnect).not.toHaveBeenCalled();
    expect(f.service.requestTelemetry).not.toHaveBeenCalled();
    expect(f.service.motorTest).not.toHaveBeenCalled();
    expect(f.service.stopMotorTest).not.toHaveBeenCalled();
  });

  it('forwards only a confirmed fixed bench pulse or a targeted stop request', async () => {
    const f = fixture();
    const checks = { propsRemoved: true, areaClear: true, hardwareCool: true };
    const pulse = f.request({
      url: '/api/aircraft/motor-test',
      method: 'POST',
      body: JSON.stringify({ aircraftId: 'link:1:1', motor: 1, ...checks }),
    });
    await pulse.pending;
    expect(pulse.output.statusCode).toBe(200);
    expect(f.service.motorTest).toHaveBeenCalledExactlyOnceWith('link:1:1', 1, checks);
    const stop = f.request({
      url: '/api/aircraft/motor-test-stop',
      method: 'POST',
      body: JSON.stringify({ aircraftId: 'link:1:1' }),
    });
    await stop.pending;
    expect(stop.output.statusCode).toBe(200);
    expect(f.service.stopMotorTest).toHaveBeenCalledExactlyOnceWith('link:1:1');
  });

  it.each([
    { 'x-lucidity-aircraft': '' },
    { 'content-type': 'text/plain' },
    { 'content-type': 'application/json-malformed' },
  ])('requires the studio header and JSON content type %#', async (headers) => {
    const f = fixture();
    const r = f.request({ url: '/api/aircraft/disconnect', method: 'POST', headers });
    await r.pending;
    expect(r.output.statusCode).toBe(415);
    expect(f.service.disconnect).not.toHaveBeenCalled();
  });

  it('has no generic command routes and disallows method substitution', async () => {
    const f = fixture();
    for (const suffix of ['arm', 'write', 'mission', 'set-parameter']) {
      const r = f.request({ url: `/api/aircraft/${suffix}`, method: 'POST' });
      await r.pending;
      expect(r.output.statusCode).toBe(404);
    }
    for (const [suffix, method] of [
      ['connect', 'GET'],
      ['status', 'POST'],
      ['ports', 'OPTIONS'],
    ]) {
      const r = f.request({ url: `/api/aircraft/${suffix}`, method });
      await r.pending;
      expect(r.output.statusCode).toBe(405);
    }
  });

  it('caps both declared and streamed request bodies and rejects malformed JSON', async () => {
    const f = fixture();
    for (const options of [
      { headers: { 'content-length': '4097' }, body: '{}' },
      { body: ' '.repeat(4097) },
    ]) {
      const r = f.request({ url: '/api/aircraft/disconnect', method: 'POST', ...options });
      await r.pending;
      expect(r.output.statusCode).toBe(413);
    }
    const invalid = f.request({ url: '/api/aircraft/disconnect', method: 'POST', body: '{' });
    await invalid.pending;
    expect(invalid.output.statusCode).toBe(400);
    expect(f.service.disconnect).not.toHaveBeenCalled();
  });

  it('bounds a stalled body and removes request listeners', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const r = f.request({ url: '/api/aircraft/disconnect', method: 'POST', held: true });
    await vi.advanceTimersByTimeAsync(5000);
    await r.pending;
    expect(r.output.statusCode).toBe(408);
    expect(r.input.listenerCount('data')).toBe(0);
    expect(r.input.listenerCount('aborted')).toBe(0);
    expect(f.service.disconnect).not.toHaveBeenCalled();
    r.input.end();
  });

  it('surfaces service conflicts without raw input or silent retries', async () => {
    const f = fixture();
    f.service.connect.mockRejectedValue(
      new AircraftServiceError('Disconnect the existing link first.', 409)
    );
    const r = f.request({
      url: '/api/aircraft/connect',
      method: 'POST',
      body: JSON.stringify({ path, baudRate: 115200 }),
    });
    await r.pending;
    expect(r.output.statusCode).toBe(409);
    expect(f.service.connect).toHaveBeenCalledTimes(1);
  });

  it('registers dev and preview middleware and disposes on server shutdown', async () => {
    const f = fixture();
    const plugin = aircraftApiPlugin(f.service);
    const dev = { middlewares: { use: vi.fn() }, httpServer: new EventEmitter() };
    const preview = { middlewares: { use: vi.fn() }, httpServer: new EventEmitter() };
    (plugin.configureServer as (server: unknown) => void)(dev);
    (plugin.configurePreviewServer as (server: unknown) => void)(preview);
    expect(dev.middlewares.use).toHaveBeenCalledOnce();
    expect(preview.middlewares.use).toHaveBeenCalledOnce();
    expect(f.service.connect).not.toHaveBeenCalled();
    dev.httpServer.emit('close');
    preview.httpServer.emit('close');
    await (plugin.closeBundle as () => Promise<void>)();
    expect(f.service.dispose).toHaveBeenCalledTimes(3);
  });
});

it('exposes only a strictly shaped, same-origin pre-arm request', async () => {
  const f = fixture();
  for (const body of [{ aircraftId: 'one', command: 400 }, { aircraftId: 'one', force: true }, {}]) {
    const r = f.request({ url: '/api/aircraft/prearm-check', method: 'POST', body: JSON.stringify(body) });
    await r.pending; expect(r.output.statusCode).toBe(400);
  }
  const foreign = f.request({ url: '/api/aircraft/prearm-check', method: 'POST', body: JSON.stringify({ aircraftId: 'one' }), headers: { origin: 'https://elsewhere.test' } });
  await foreign.pending; expect(foreign.output.statusCode).toBe(403);
  expect(f.service.runPrearmChecks).not.toHaveBeenCalled();
  const r = f.request({ url: '/api/aircraft/prearm-check', method: 'POST', body: JSON.stringify({ aircraftId: 'one' }) });
  await r.pending; expect(r.output.statusCode).toBe(200);
  expect(f.service.runPrearmChecks).toHaveBeenCalledExactlyOnceWith('one');
});
