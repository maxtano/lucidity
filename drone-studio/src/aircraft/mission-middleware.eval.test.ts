import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { createOneFootHoverStoryboard } from '../components/first-flight-preview';
import { createAircraftMiddleware } from './middleware';

const aircraftId = 'test-aircraft';
const planId = '460f29dc-32a8-4916-a620-06cb6fb09ff7';
const storyboard = createOneFootHoverStoryboard('middleware-eval');

function fixture() {
  const service = {
    prepareMission: vi.fn(() => ({ eligible: false as const, reason: 'One-foot preview is not flight eligible.' })),
    uploadMission: vi.fn(async () => ({ state: 'verified' as const })),
    verifyMissionForLaunch: vi.fn(async () => ({
      verificationId: 'fixture-verification', planId, aircraftId,
      storyboardId: storyboard.id, revision: storyboard.revision,
      connectionGeneration: 1, verifiedAt: 100_000, expiresAt: 115_000,
      missionCount: 4, heightM: 2, holdSeconds: 5,
      message: 'Storage only; no flight authorized.',
    })),
    cancelMission: vi.fn(() => ({ mission: { state: 'unknown' as const } })),
  };
  const middleware = createAircraftMiddleware(service as unknown as Parameters<typeof createAircraftMiddleware>[0]);
  async function post(url: string, body: unknown, options?: {
    headers?: Record<string, string>;
    remoteAddress?: string;
  }) {
    const input = new PassThrough();
    const request = Object.assign(input, {
      url, method: 'POST',
      headers: {
        host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173',
        'content-type': 'application/json', 'x-lucidity-aircraft': '1',
        ...options?.headers,
      },
      socket: { remoteAddress: options?.remoteAddress ?? '127.0.0.1' }, aborted: false,
    }) as unknown as IncomingMessage;
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200, body: '', writableEnded: false, destroyed: false,
      setHeader() {},
      end(value: string) { this.body = value; this.writableEnded = true; },
    });
    const pending = Promise.resolve(middleware(request, response as unknown as ServerResponse, () => {}));
    input.end(JSON.stringify(body));
    await pending;
    return response;
  }
  return { service, post };
}

describe('local mission HTTP boundary', () => {
  it('returns an ineligible one-foot study as a reviewable result without calling upload', async () => {
    const f = fixture();
    const result = await f.post('/api/aircraft/mission/plan', { aircraftId, storyboard });
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({ eligible: false, reason: expect.any(String) });
    expect(f.service.prepareMission).toHaveBeenCalledOnce();
    expect(f.service.uploadMission).not.toHaveBeenCalled();
  });

  it('rejects upload without exact storyboard and both physical confirmations', async () => {
    const f = fixture();
    const base = { aircraftId, planId, storyboard, propsRemoved: true, confirmed: true };
    for (const body of [
      { ...base, storyboard: undefined },
      { ...base, propsRemoved: false },
      { ...base, confirmed: false },
      { ...base, command: 'arm' },
    ]) {
      const result = await f.post('/api/aircraft/mission/upload', body);
      expect(result.statusCode).toBe(400);
    }
    expect(f.service.uploadMission).not.toHaveBeenCalled();
    const good = await f.post('/api/aircraft/mission/upload', base);
    expect(good.statusCode).toBe(200);
    expect(f.service.uploadMission).toHaveBeenCalledExactlyOnceWith(aircraftId, planId, storyboard, base);
  });

  it('accepts a scoped cancel request and rejects unrecognized or extra fields', async () => {
    const f = fixture();
    const good = await f.post('/api/aircraft/mission/cancel', { planId });
    expect(good.statusCode).toBe(200);
    expect(f.service.cancelMission).toHaveBeenCalledExactlyOnceWith(planId);
    for (const body of [{ planId: 'not-a-uuid' }, { planId, command: 'arm' }]) {
      const bad = await f.post('/api/aircraft/mission/cancel', body);
      expect(bad.statusCode).toBe(400);
    }
    expect(f.service.cancelMission).toHaveBeenCalledTimes(1);
  });

  it('permits props-on, read-only storyboard-bound verification while upload still requires props off', async () => {
    const f = fixture();
    const body = { aircraftId, planId, storyboard };
    const good = await f.post('/api/aircraft/mission/verify', body);
    expect(good.statusCode).toBe(200);
    expect(JSON.parse(good.body)).toMatchObject({ missionCount: 4, message: expect.stringContaining('Storage only') });
    expect(f.service.verifyMissionForLaunch).toHaveBeenCalledExactlyOnceWith(aircraftId, planId, storyboard);
    expect(f.service.uploadMission).not.toHaveBeenCalled();
    for (const invalid of [
      { ...body, storyboard: undefined },
      { ...body, propsRemoved: true },
      { ...body, propsRemoved: false },
      { ...body, planId: 'not-a-uuid' },
      { ...body, command: 'arm' },
    ]) {
      const result = await f.post('/api/aircraft/mission/verify', invalid);
      expect(result.statusCode).toBe(400);
    }
    expect(f.service.verifyMissionForLaunch).toHaveBeenCalledTimes(1);
    const invalidClients: Array<{ headers?: Record<string, string>; remoteAddress?: string }> = [
      { headers: { 'x-lucidity-aircraft': '' } },
      { headers: { origin: 'https://other.example' } },
      { remoteAddress: '192.0.2.5' },
    ];
    for (const options of invalidClients) {
      const rejected = await f.post('/api/aircraft/mission/verify', body, options);
      expect([403, 415]).toContain(rejected.statusCode);
    }
    expect(f.service.verifyMissionForLaunch).toHaveBeenCalledTimes(1);
    const launch = await f.post('/api/aircraft/mission/start', body);
    expect(launch.statusCode).toBe(404);
  });
});
