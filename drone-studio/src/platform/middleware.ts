import { type Plugin, type Connect } from 'vite';
import { z } from 'zod';
import type { AircraftService } from '../aircraft/service';
import { WorkbenchService, defaultWorkbenchRoot } from './workbench-service';
import { readWorkbenchBody } from './http';
import { inspectDroneBridge, inspectDroneBridgeInput, restoreDroneBridgeAirMode, restoreDroneBridgeGroundMode } from './dronebridge';
export function createWorkbenchMiddleware(
  service: WorkbenchService,
  aircraft: AircraftService
): Connect.NextHandleFunction {
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    const path = req.url?.split('?')[0];
    if (!path?.startsWith('/api/workbench/')) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const json = (status: number, body: unknown) => {
      if (res.destroyed || res.writableEnded) return;
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    const host = req.headers.host ?? '';
    if (
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') ||
      !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ||
      (req.headers.origin && ![`http://${host}`, `https://${host}`].includes(req.headers.origin))
    )
      return json(403, { error: 'Workbench access is local and same-origin only.' });
    try {
      if (req.method === 'GET') {
        if (path === '/api/workbench/dronebridge')
          return json(200, await inspectDroneBridge());
        if (path === '/api/workbench/dronebridge/input')
          return json(200, await inspectDroneBridgeInput());
        if (path === '/api/workbench/status')
          return json(200, {
            root: service.root,
          });
        if (path === '/api/workbench/files') return json(200, { files: await service.files() });
        if (path === '/api/workbench/file')
          return json(
            200,
            await service.read(new URL(req.url!, 'http://localhost').searchParams.get('name') ?? '')
          );
        if (path === '/api/workbench/jobs') return json(200, { jobs: service.listJobs() });
        return json(404, { error: 'Unknown workbench endpoint.' });
      }
      if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
      if (
        req.headers['x-lucidity-workbench'] !== '1' ||
        !req.headers['content-type']?.startsWith('application/json')
      )
        return json(415, { error: 'Use the Lucidity workbench client.' });
      const body = await readWorkbenchBody(
        req,
        path === '/api/workbench/firmware' ? 23000000 : 512000
      );
      if (req.aborted || res.destroyed) return;
      if (path === '/api/workbench/dronebridge/ground-mode') {
        z.object({ confirmedGroundRadio: z.literal(true) }).strict().parse(body);
        if (aircraft.snapshot().link.state !== 'disconnected')
          throw new Error('Disconnect the USB aircraft link before changing radio mode.');
        return json(200, await restoreDroneBridgeGroundMode());
      }
      if (path === '/api/workbench/dronebridge/air-mode') {
        z.object({ confirmedAirRadio: z.literal(true) }).strict().parse(body);
        if (aircraft.snapshot().link.state !== 'disconnected')
          throw new Error('Disconnect the USB aircraft link before changing radio mode.');
        return json(200, await restoreDroneBridgeAirMode());
      }
      if (path === '/api/workbench/file') {
        const b = z
          .object({ name: z.string(), content: z.string().max(200000) })
          .strict()
          .parse(body);
        return json(200, await service.save(b.name, b.content));
      }
      if (path === '/api/workbench/run') {
        const b = z
          .object({ command: z.string().max(4000), confirmed: z.literal(true) })
          .strict()
          .parse(body);
        if (aircraft.snapshot().link.state !== 'disconnected')
          throw new Error('Disconnect the aircraft link before running terminal commands.');
        return json(200, await service.run(b.command));
      }
      if (path === '/api/workbench/stop') {
        const b = z.object({ id: z.string() }).strict().parse(body);
        service.stop(b.id);
        return json(200, { stopped: true });
      }
      if (path === '/api/workbench/firmware') {
        const b = z
          .object({ content: z.string().max(22000000) })
          .strict()
          .parse(body);
        return json(200, await service.firmware(b.content));
      }
      if (path === '/api/workbench/esp') {
        const b = z
          .object({
            port: z.string(),
            action: z.enum(['identify', 'flash']),
            filename: z.string().optional(),
            address: z.string().optional(),
            confirmed: z.literal(true),
          })
          .strict()
          .parse(body);
        if (aircraft.snapshot().link.state !== 'disconnected')
          throw new Error('Disconnect the aircraft link to release the serial device first.');
        if (!(await aircraft.ports()).some((p) => p.path === b.port))
          throw new Error('This USB device is no longer connected.');
        return json(200, await service.esp(b.port, b.action, b.filename, b.address));
      }
      return json(404, { error: 'Unknown workbench endpoint.' });
    } catch (error) {
      return json(400, {
        error:
          error instanceof z.ZodError
            ? 'Invalid workbench request.'
            : error instanceof Error
              ? error.message
              : 'Workbench request failed.',
      });
    }
  };
  return middleware;
}

export function workbenchApiPlugin(aircraft: AircraftService): Plugin {
  let service: WorkbenchService;
  let middleware: Connect.NextHandleFunction;
  return {
    name: 'lucidity-workbench',
    configResolved(resolved) {
      service = new WorkbenchService(
        defaultWorkbenchRoot(resolved.root),
        () => aircraft.snapshot().link.state === 'disconnected'
      );
      aircraft.setExternalBusy(() => service.busy);
      middleware = createWorkbenchMiddleware(service, aircraft);
    },
    configureServer(server) {
      server.middlewares.use(middleware);
      server.httpServer?.once('close', () => service.dispose());
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
      server.httpServer.once('close', () => service.dispose());
    },
    closeBundle() {
      service?.dispose();
    },
  };
}
