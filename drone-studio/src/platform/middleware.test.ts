import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkbenchMiddleware } from './middleware';
import type { WorkbenchService } from './workbench-service';
import type { AircraftService } from '../aircraft/service';
function fixture() {
  const service = {
    root: '/tmp/workbench-test',
    files: vi.fn(async () => []),
    run: vi.fn(async () => ({ id: 'job' })),
    save: vi.fn(),
    esp: vi.fn(),
    stop: vi.fn(),
    firmware: vi.fn(),
  };
  const aircraft = {
    snapshot: vi.fn(() => ({ link: { state: 'disconnected' } })),
    ports: vi.fn(async () => [{ path: '/dev/cu.usbmodemTEST' }]),
  };
  const middleware = createWorkbenchMiddleware(
    service as unknown as WorkbenchService,
    aircraft as unknown as AircraftService
  );
  const request = (
    options: {
      url?: string;
      method?: string;
      peer?: string;
      headers?: Record<string, string | undefined>;
      body?: unknown;
      hold?: boolean;
    } = {}
  ) => {
    const stream = new PassThrough();
    const req = Object.assign(stream, {
      url: options.url ?? '/api/workbench/run',
      method: options.method ?? 'POST',
      headers: {
        host: '127.0.0.1:5173',
        origin: 'http://127.0.0.1:5173',
        'content-type': 'application/json',
        'x-lucidity-workbench': '1',
        ...options.headers,
      },
      socket: { remoteAddress: options.peer ?? '127.0.0.1' },
      aborted: false,
    }) as unknown as IncomingMessage;
    const res = {
      statusCode: 200,
      destroyed: false,
      writableEnded: false,
      body: '',
      setHeader: vi.fn(),
      on: vi.fn(),
      end(body: string) {
        this.body = body;
        this.writableEnded = true;
      },
    };
    const pending = Promise.resolve(middleware(req, res as unknown as ServerResponse, vi.fn()));
    if (!options.hold)
      stream.end(JSON.stringify(options.body ?? { command: 'echo test', confirmed: true }));
    return { pending, res, stream };
  };
  return { service, aircraft, request };
}
afterEach(() => vi.useRealTimers());
describe('workbench request boundary', () => {
  it.each([
    { peer: '192.168.1.2' },
    { headers: { origin: 'https://example.com' } },
    { headers: { host: 'localhost.evil.test' } },
  ])('rejects nonlocal or cross-origin requests before execution %#', async (options) => {
    const f = fixture();
    const r = f.request(options);
    await r.pending;
    expect(r.res.statusCode).toBe(403);
    expect(f.service.run).not.toHaveBeenCalled();
  });
  it('requires the custom header and explicit execution acknowledgement', async () => {
    const f = fixture();
    let r = f.request({ headers: { 'x-lucidity-workbench': undefined } });
    await r.pending;
    expect(r.res.statusCode).toBe(415);
    r = f.request({ body: { command: 'echo test' } });
    await r.pending;
    expect(r.res.statusCode).toBe(400);
    expect(f.service.run).not.toHaveBeenCalled();
  });
  it('rejects unbounded body sizes and times out an incomplete body', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let r = f.request({ headers: { 'content-length': '9000000' } });
    await r.pending;
    expect(r.res.statusCode).toBe(400);
    r = f.request({ hold: true });
    await vi.advanceTimersByTimeAsync(15001);
    await r.pending;
    expect(r.res.body).toContain('timed out');
    expect(f.service.run).not.toHaveBeenCalled();
  });
  it('executes an acknowledged command only while the hardware link is disconnected', async () => {
    const f = fixture();
    const r = f.request();
    await r.pending;
    expect(f.service.run).toHaveBeenCalledWith('echo test');
    f.aircraft.snapshot.mockReturnValue({ link: { state: 'listening' } });
    const blocked = f.request();
    await blocked.pending;
    expect(blocked.res.body).toContain('Disconnect');
    expect(f.service.run).toHaveBeenCalledTimes(1);
  });
  it('does not flash an unenumerated port', async () => {
    const f = fixture();
    const r = f.request({
      url: '/api/workbench/esp',
      body: { port: '/dev/cu.usbmodemOTHER', action: 'identify', confirmed: true },
    });
    await r.pending;
    expect(r.res.statusCode).toBe(400);
    expect(f.service.esp).not.toHaveBeenCalled();
  });
  it('has no built-in assistant endpoint', async () => {
    const f = fixture();
    const r = f.request({
      url: '/api/workbench/assistant',
      body: { prompt: 'Read status', aircraftId: '', history: [] },
    });
    await r.pending;
    expect(r.res.statusCode).toBe(404);
  });
});
