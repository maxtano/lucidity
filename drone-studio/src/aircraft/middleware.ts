import { projectSchema } from '../core/model';
import type { IncomingMessage } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { z } from 'zod';
import { AircraftService, AircraftServiceError, AIRCRAFT_BAUD_RATE } from './service';
import { MotorTestError } from './motor-test';
import { ZorroStopError } from './zorro-stop';

const MAX_BODY_BYTES = 4096;
const MAX_STORYBOARD_BODY_BYTES = 64 * 1024;
const connectSchema = z
  .object({ path: z.string().min(1).max(220), baudRate: z.literal(AIRCRAFT_BAUD_RATE) })
  .strict();
const disconnectSchema = z.object({}).strict();
const requestSchema = z.object({ aircraftId: z.string().min(1).max(120) }).strict();
const parameterReadSchema = requestSchema.extend({
  names: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,15}$/)).min(1).max(16).optional(),
}).strict();
const tuneSchema = z.object({
  name: z.string().min(1).max(60), bpm: z.number().int().min(60).max(240),
  notes: z.array(z.object({ midi: z.number().int().min(48).max(95).nullable(), beats: z.number() }).strict()).min(1).max(128),
}).strict();
const parameterSchema = requestSchema
  .extend({
    name: z.string().regex(/^[A-Z][A-Z0-9_]{0,15}$/),
    value: z.number().finite(),
    expected: z.number().finite(),
    confirmed: z.literal(true),
  })
  .strict();
const levelCalibrationSchema = requestSchema.extend({
  propsRemoved: z.literal(true),
  batteryDisconnected: z.literal(true),
  physicallyLevel: z.literal(true),
  still: z.literal(true),
  directUsb: z.literal(true),
  confirmed: z.literal(true),
}).strict();
const motorTestSchema = requestSchema
  .extend({
    motor: z.number().int().min(1).max(4),
    propsRemoved: z.literal(true),
    areaClear: z.literal(true),
    hardwareCool: z.literal(true),
  })
  .strict();
const showRunSchema = z.object({ runId: z.string().uuid() }).strict();
const showStartSchema = requestSchema.extend({
  storyboard: projectSchema,
  reviewedPlanKey: z.string().min(1).max(8192),
  runId: z.string().uuid(),
  propsRemoved: z.literal(true),
  areaClear: z.literal(true),
  hardwareCool: z.literal(true),
}).strict();
const idleStartSchema = requestSchema.extend({
  storyboard: projectSchema,
  runId: z.string().uuid(),
  propsRemoved: z.literal(true),
  areaClear: z.literal(true),
  hardwareCool: z.literal(true),
  radioReady: z.literal(true),
}).strict();
const missionPlanSchema = requestSchema.extend({ storyboard: projectSchema }).strict();
const missionUploadSchema = requestSchema.extend({
  planId: z.string().uuid(), storyboard: projectSchema, propsRemoved: z.literal(true), confirmed: z.literal(true),
}).strict();
const missionVerifySchema = requestSchema.extend({
  planId: z.string().uuid(), storyboard: projectSchema,
}).strict();
const missionLaunchSchema = requestSchema.extend({
  storyboard: projectSchema, verificationId: z.string().uuid(),
  checks: z.object({ propsInstalled: z.literal(true), areaClear: z.literal(true),
    pilotReady: z.literal(true), modeSwitchReady: z.literal(true) }).strict(),
}).strict();
const missionLandSchema = z.object({ runId: z.string().uuid() }).strict();
const missionReconcileSchema = requestSchema.extend({ propsRemoved: z.literal(true), confirmed: z.literal(true) }).strict();
const missionCancelSchema = z.object({ planId: z.string().uuid() }).strict();
const logDownloadSchema = requestSchema.extend({ logId: z.number().int().min(0).max(65535) }).strict();
type Service = Pick<
  AircraftService,
  | 'ports'
  | 'snapshot'
  | 'connect'
  | 'disconnect'
  | 'requestTelemetry'
  | 'motorTest'
  | 'stopMotorTest'
  | 'dispose'
> &
  Partial<Pick<AircraftService, 'requestRadioChannels' | 'parameters' | 'readParameters' | 'setParameter' |
    'calibrateLevel' |
    'startBenchShow' | 'renewBenchShow' | 'stopBenchShow' | 'startZorroStop' | 'renewZorroStop' | 'stopZorroStop' |
    'playTune' | 'readEscs' | 'escStatus' | 'prepareEscStartup' | 'installEscStartup' | 'replayEscStartup' | 'runPrearmChecks' |
    'prepareMission' | 'uploadMission' | 'verifyMissionForLaunch' | 'cancelMission' | 'readMission' |
    'checkMissionLaunch' | 'launchMission' | 'landMission' | 'flightRunStatus' | 'reconcileMissionRun' |
    'logStatus' | 'listLogs' | 'downloadLog' | 'cancelLogTransfer' | 'logFile'>>;

function readBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const length = req.headers['content-length'];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
      req.resume();
      reject(new AircraftServiceError(`Aircraft requests must be at most ${maxBytes / 1024} KiB.`, 413));
      return;
    }
    let bytes = 0;
    const chunks: Buffer[] = [];
    const cleanup = () => {
      clearTimeout(timer);
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onAborted);
    };
    const fail = (error: Error) => {
      cleanup();
      req.resume();
      reject(error);
    };
    const onData = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes)
        fail(new AircraftServiceError(`Aircraft requests must be at most ${maxBytes / 1024} KiB.`, 413));
      else chunks.push(Buffer.from(chunk));
    };
    const onEnd = () => {
      cleanup();
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new AircraftServiceError('Invalid aircraft request JSON.'));
      }
    };
    const onError = () => fail(new AircraftServiceError('Aircraft request could not be read.'));
    const onAborted = () => fail(new AircraftServiceError('Aircraft request was cancelled.', 400));
    const timer = setTimeout(
      () => fail(new AircraftServiceError('Aircraft request timed out.', 408)),
      5000
    );
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
  });
}

/** Local request guard is independent of Vite's --host setting and accepts no command proxy. */
export function createAircraftMiddleware(service: Service): Connect.NextHandleFunction {
  return async (req, res, next) => {
    const path = req.url?.split('?')[0];
    if (!path?.startsWith('/api/aircraft/')) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const json = (status: number, body: unknown) => {
      if (res.destroyed || res.writableEnded) return;
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
    };
    const host = req.headers.host ?? '';
    const peer = req.socket.remoteAddress;
    if (
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer ?? '') ||
      !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)
    )
      return json(403, {
        error: 'Aircraft access is available only on the local studio computer.',
      });
    if (
      req.headers.origin &&
      req.headers.origin !== `http://${host}` &&
      req.headers.origin !== `https://${host}`
    )
      return json(403, { error: 'Cross-origin aircraft requests are not allowed.' });
    try {
      if (path === '/api/aircraft/ports' && req.method === 'GET')
        return json(200, { ports: await service.ports() });
      if (path === '/api/aircraft/status' && req.method === 'GET')
        return json(200, service.snapshot());
      if (path === '/api/aircraft/logs/status' && req.method === 'GET')
        return json(200, service.logStatus?.() ?? { state: 'error', entries: [], progress: null, error: 'Flight logs are unavailable.', artifact: null });
      if (path === '/api/aircraft/logs/file' && req.method === 'GET') {
        const name = new URL(req.url!, 'http://localhost').searchParams.get('name') ?? '';
        if (!/^[A-Za-z0-9._-]{1,120}\.bin$/.test(name))
          return json(400, { error: 'Invalid flight log name.' });
        if (!service.logFile) return json(501, { error: 'Flight log download unavailable.' });
        const bytes = service.logFile(name);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
        res.setHeader('Content-Length', bytes.length);
        return res.end(bytes);
      }
      if (path === '/api/aircraft/mission/launch-status' && req.method === 'GET')
        return json(200, service.flightRunStatus?.() ?? { state: 'idle', reason: 'Physical runner unavailable.' });
      if (path === '/api/aircraft/parameters' && req.method === 'GET') {
        const id = new URL(req.url!, 'http://localhost').searchParams.get('aircraftId') ?? '';
        return json(200, service.parameters?.(id) ?? { parameters: [], state: 'idle' });
      }
      if (['/api/aircraft/ports', '/api/aircraft/status'].includes(path))
        return json(405, { error: 'Method not allowed.' });
      if (
        path !== '/api/aircraft/esc/read' &&
        path !== '/api/aircraft/esc/startup/prepare' &&
        path !== '/api/aircraft/esc/startup/install' &&
        path !== '/api/aircraft/esc/startup/replay' &&
        path !== '/api/aircraft/tune/play' &&
        path !== '/api/aircraft/parameters/read' &&
        path !== '/api/aircraft/parameters/set' &&
        path !== '/api/aircraft/calibrate-level' &&
        path !== '/api/aircraft/connect' &&
        path !== '/api/aircraft/disconnect' &&
        path !== '/api/aircraft/bench-show/start' &&
        path !== '/api/aircraft/bench-show/renew' &&
        path !== '/api/aircraft/bench-show/stop' &&
        path !== '/api/aircraft/idle-show/start' &&
        path !== '/api/aircraft/idle-show/renew' &&
        path !== '/api/aircraft/idle-show/stop' &&
        path !== '/api/aircraft/mission/plan' &&
        path !== '/api/aircraft/mission/upload' &&
        path !== '/api/aircraft/mission/verify' &&
        path !== '/api/aircraft/mission/launch-check' &&
        path !== '/api/aircraft/mission/launch' &&
        path !== '/api/aircraft/mission/land' &&
        path !== '/api/aircraft/mission/reconcile' &&
        path !== '/api/aircraft/mission/cancel' &&
        path !== '/api/aircraft/mission/readback' &&
        path !== '/api/aircraft/logs/list' &&
        path !== '/api/aircraft/logs/download' &&
        path !== '/api/aircraft/logs/cancel' &&
        path !== '/api/aircraft/motor-test' &&
        path !== '/api/aircraft/motor-test-stop' &&
        path !== '/api/aircraft/request-telemetry'
        && path !== '/api/aircraft/request-radio'
        && path !== '/api/aircraft/prearm-check'
      )
        return json(404, { error: 'Unknown aircraft endpoint.' });
      if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
      if (
        req.headers['x-lucidity-aircraft'] !== '1' ||
        !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')
      )
        return json(415, { error: 'Use the studio aircraft client with a JSON request.' });
      const body = await readBody(req, path === '/api/aircraft/bench-show/start' || path === '/api/aircraft/idle-show/start' || path === '/api/aircraft/mission/plan' || path === '/api/aircraft/mission/upload' || path === '/api/aircraft/mission/verify' || path === '/api/aircraft/mission/launch-check' || path === '/api/aircraft/mission/launch' ? MAX_STORYBOARD_BODY_BYTES : MAX_BODY_BYTES);
      if (req.aborted || res.destroyed) return;
      if (path === '/api/aircraft/esc/read') {
        const request = requestSchema.extend({ propsRemoved: z.literal(true), directUsb: z.literal(true) }).strict().parse(body);
        if (!service.readEscs) return json(501, { error: 'ESC reader unavailable.' });
        return json(200, await service.readEscs(request.aircraftId, request));
      }
      if (path === '/api/aircraft/esc/startup/prepare') {
        const request = requestSchema.extend({ propsRemoved: z.literal(true), directUsb: z.literal(true), tune: tuneSchema, melodyOnly: z.boolean().optional() }).strict().parse(body);
        if (!service.prepareEscStartup) return json(501, { error: 'Startup installer unavailable.' });
        return json(200, await service.prepareEscStartup(request.aircraftId, request.tune, request));
      }
      if (path === '/api/aircraft/esc/startup/replay') {
        const request = requestSchema.extend({ propsRemoved: z.literal(true), directUsb: z.literal(true), tune: tuneSchema }).strict().parse(body);
        if (!service.replayEscStartup) return json(501, { error: 'Startup playback unavailable.' });
        return json(200, await service.replayEscStartup(request.aircraftId, request.tune, request));
      }
      if (path === '/api/aircraft/esc/startup/install') {
        const request = requestSchema.extend({ planId: z.string().uuid(), propsRemoved: z.literal(true), directUsb: z.literal(true),
          confirmed: z.literal(true), firmwareChangeConfirmed: z.boolean() }).strict().parse(body);
        if (!service.installEscStartup) return json(501, { error: 'Startup installer unavailable.' });
        return json(200, await service.installEscStartup(request.aircraftId, request.planId, request));
      }
      if (path === '/api/aircraft/tune/play') {
        const request = requestSchema.extend({ propsRemoved: z.literal(true), tune: z.object({
          name: z.string().min(1).max(60), bpm: z.number().int().min(60).max(240),
          notes: z.array(z.object({ midi: z.number().int().min(48).max(95).nullable(), beats: z.number() }).strict()).min(1).max(128),
        }).strict() }).strict().parse(body);
        if (!service.playTune) return json(501, { error: 'Drone sound adapter unavailable.' });
        return json(200, await service.playTune(request.aircraftId, request.tune, request.propsRemoved));
      }
      if (path === '/api/aircraft/parameters/read') {
        const request = parameterReadSchema.parse(body);
        if (!service.readParameters) return json(501, { error: 'Parameter adapter unavailable.' });
        return json(200, await service.readParameters(request.aircraftId, request.names));
      }
      if (path === '/api/aircraft/parameters/set') {
        const request = parameterSchema.parse(body);
        if (!service.setParameter) return json(501, { error: 'Parameter adapter unavailable.' });
        return json(
          200,
          await service.setParameter(
            request.aircraftId,
            request.name,
            request.value,
            request.expected
          )
        );
      }
      if (path === '/api/aircraft/calibrate-level') {
        const { aircraftId, ...checks } = levelCalibrationSchema.parse(body);
        if (!service.calibrateLevel) return json(501, { error: 'Level calibration unavailable.' });
        return json(200, await service.calibrateLevel(aircraftId, checks));
      }
      if (path === '/api/aircraft/connect') {
        const request = connectSchema.parse(body);
        return json(200, await service.connect(request.path, request.baudRate));
      }
      if (path === '/api/aircraft/request-telemetry') {
        const request = requestSchema.parse(body);
        return json(200, await service.requestTelemetry(request.aircraftId));
      }
      if (path === '/api/aircraft/logs/list') {
        const request = requestSchema.parse(body);
        if (!service.listLogs) return json(501, { error: 'Flight log listing unavailable.' });
        return json(200, service.listLogs(request.aircraftId));
      }
      if (path === '/api/aircraft/logs/download') {
        const request = logDownloadSchema.parse(body);
        if (!service.downloadLog) return json(501, { error: 'Flight log download unavailable.' });
        return json(200, service.downloadLog(request.aircraftId, request.logId));
      }
      if (path === '/api/aircraft/logs/cancel') {
        disconnectSchema.parse(body);
        if (!service.cancelLogTransfer) return json(501, { error: 'Flight log cancellation unavailable.' });
        return json(200, service.cancelLogTransfer());
      }
      if (path === '/api/aircraft/request-radio') {
        const request = requestSchema.parse(body);
        if (!service.requestRadioChannels) return json(501, { error: 'Radio input adapter unavailable.' });
        return json(200, await service.requestRadioChannels(request.aircraftId));
      }
      if (path === '/api/aircraft/prearm-check') {
        const request = requestSchema.parse(body);
        if (!service.runPrearmChecks) return json(501, { error: 'Pre-arm checks are unavailable.' });
        return json(200, await service.runPrearmChecks(request.aircraftId));
      }
      if (path === '/api/aircraft/mission/plan') {
        const request = missionPlanSchema.parse(body);
        if (!service.prepareMission) return json(501, { error: 'Mission planner unavailable.' });
        return json(200, service.prepareMission(request.aircraftId, request.storyboard));
      }
      if (path === '/api/aircraft/mission/upload') {
        const request = missionUploadSchema.parse(body);
        if (!service.uploadMission) return json(501, { error: 'Mission upload unavailable.' });
        const onClose = () => {
          if (!res.writableEnded) {
            try { service.cancelMission?.(request.planId); } catch { /* Already complete or not yet started. */ }
          }
        };
        res.once('close', onClose);
        try {
          return json(200, await service.uploadMission(request.aircraftId, request.planId, request.storyboard, request));
        } finally {
          res.removeListener('close', onClose);
        }
      }
      if (path === '/api/aircraft/mission/verify') {
        const request = missionVerifySchema.parse(body);
        if (!service.verifyMissionForLaunch) return json(501, { error: 'Stored mission verification unavailable.' });
        return json(200, await service.verifyMissionForLaunch(request.aircraftId, request.planId, request.storyboard));
      }
      if (path === '/api/aircraft/mission/launch-check') {
        const request = missionVerifySchema.parse(body);
        if (!service.checkMissionLaunch) return json(501, { error: 'Field launch checks unavailable.' });
        return json(200, await service.checkMissionLaunch(request.aircraftId, request.planId, request.storyboard));
      }
      if (path === '/api/aircraft/mission/launch') {
        const request = missionLaunchSchema.parse(body);
        if (!service.launchMission) return json(501, { error: 'Physical mission launch unavailable.' });
        return json(200, await service.launchMission(request.aircraftId, request.storyboard,
          request.verificationId, request.checks));
      }
      if (path === '/api/aircraft/mission/land') {
        const request = missionLandSchema.parse(body);
        if (!service.landMission) return json(501, { error: 'Physical LAND unavailable.' });
        return json(200, await service.landMission(request.runId));
      }
      if (path === '/api/aircraft/mission/reconcile') {
        const request = missionReconcileSchema.parse(body);
        if (!service.reconcileMissionRun) return json(501, { error: 'Flight recovery unavailable.' });
        return json(200, await service.reconcileMissionRun(request.aircraftId, request));
      }
      if (path === '/api/aircraft/mission/cancel') {
        const request = missionCancelSchema.parse(body);
        if (!service.cancelMission) return json(501, { error: 'Mission cancellation unavailable.' });
        return json(200, service.cancelMission(request.planId));
      }
      if (path === '/api/aircraft/mission/readback') {
        const request = requestSchema.parse(body);
        if (!service.readMission) return json(501, { error: 'Mission readback unavailable.' });
        return json(200, await service.readMission(request.aircraftId));
      }
      if (path === '/api/aircraft/bench-show/start') {
        const { aircraftId, runId, storyboard, reviewedPlanKey, ...checks } = showStartSchema.parse(body);
        if (!service.startBenchShow) return json(501, { error: 'Bench show adapter unavailable.' });
        return json(200, service.startBenchShow(aircraftId, runId, checks, storyboard, reviewedPlanKey));
      }
      if (path === '/api/aircraft/bench-show/renew' || path === '/api/aircraft/bench-show/stop') {
        const { runId } = showRunSchema.parse(body);
        if (!service.renewBenchShow || !service.stopBenchShow)
          return json(501, { error: 'Bench show adapter unavailable.' });
        return json(200, path.endsWith('/renew')
          ? service.renewBenchShow(runId)
          : await service.stopBenchShow(runId));
      }
      if (path === '/api/aircraft/idle-show/start') {
        const { aircraftId, runId, storyboard, ...checks } = idleStartSchema.parse(body);
        if (!service.startZorroStop) return json(501, { error: 'Idle-show adapter unavailable.' });
        return json(200, await service.startZorroStop(aircraftId, runId, storyboard, checks));
      }
      if (path === '/api/aircraft/idle-show/renew' || path === '/api/aircraft/idle-show/stop') {
        const { runId } = showRunSchema.parse(body);
        if (!service.renewZorroStop || !service.stopZorroStop)
          return json(501, { error: 'Idle-show adapter unavailable.' });
        return json(200, path.endsWith('/renew')
          ? service.renewZorroStop(runId)
          : await service.stopZorroStop(runId));
      }
      if (path === '/api/aircraft/motor-test') {
        const { aircraftId, motor, ...checks } = motorTestSchema.parse(body);
        return json(200, await service.motorTest(aircraftId, motor, checks));
      }
      if (path === '/api/aircraft/motor-test-stop') {
        const request = requestSchema.parse(body);
        return json(200, await service.stopMotorTest(request.aircraftId));
      }
      disconnectSchema.parse(body);
      return json(200, await service.disconnect());
    } catch (error) {
      return json(
        error instanceof AircraftServiceError || error instanceof MotorTestError || error instanceof ZorroStopError
          ? error.status
          : 400,
        {
          error:
            error instanceof z.ZodError
              ? 'The aircraft request is invalid.'
              : error instanceof Error
                ? error.message.slice(0, 240)
                : 'The aircraft request failed.',
        }
      );
    }
  };
}

/** Dev/preview-only physical telemetry boundary; never starts or opens a port automatically. */
export function aircraftApiPlugin(service: Service = new AircraftService()): Plugin {
  const middleware = createAircraftMiddleware(service);
  const shutdown = () => {
    void service.dispose().catch(() => {});
  };
  return {
    name: 'lucidity-aircraft-api',
    configureServer(server) {
      server.middlewares.use(middleware);
      server.httpServer?.once('close', shutdown);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
      server.httpServer.once('close', shutdown);
    },
    async closeBundle() {
      await service.dispose();
    },
  };
}
