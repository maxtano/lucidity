import { compileStoryboardBenchPlan, createBenchStoryboard } from '../core/bench-storyboard';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BenchShowClient } from './bench-show-client';
import type { AircraftSnapshot } from './types';

const storyboard = createBenchStoryboard();
const source = compileStoryboardBenchPlan(storyboard).source;
const reviewedPlanKey = source.planKey;
const checks = { propsRemoved: true, areaClear: true, hardwareCool: true };
function fixture() {
  vi.useFakeTimers();
  let visible = true;
  let id = '';
  const calls: string[] = [];
  const snapshot = (state = 'running') => ({ benchShow: { runId: id, source, state } }) as AircraftSnapshot;
  const response = (state = 'running') => new Response(JSON.stringify(snapshot(state)));
  const fetcher = vi.fn<typeof fetch>(async (input, options) => {
    const action = String(input).split('/').pop()!;
    calls.push(action);
    id = JSON.parse(String(options?.body)).runId;
    return response(action === 'stop' ? 'cancelled' : 'running');
  });
  const onError = vi.fn();
  const client = new BenchShowClient({ fetch: fetcher, isVisible: () => visible, onError });
  return { client, calls, fetcher, onError, snapshot, response, hide: () => { visible = false; } };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('bench show client lease ownership', () => {
  it('preserves the browser fetch receiver for start, renewal and stop', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    vi.stubGlobal('fetch', async function (this: unknown, input: RequestInfo | URL, options?: RequestInit) {
      // Browser fetch rejects an arbitrary object receiver; Node fetch and arrow mocks do not.
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      const action = String(input).split('/').pop()!;
      calls.push(action);
      const { runId } = JSON.parse(String(options?.body));
      return new Response(JSON.stringify({ benchShow: {
        runId, source, state: action === 'stop' ? 'cancelled' : 'running',
      } }));
    });
    const client = new BenchShowClient({ isVisible: () => true });
    await client.start('aircraft', checks, storyboard, reviewedPlanKey);
    await vi.advanceTimersByTimeAsync(500);
    await client.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toEqual(['start', 'renew', 'stop']);
  });

  it('submits the reviewed authored project and rejects a stale review before any request', async () => {
    const f = fixture();
    const edited = structuredClone(storyboard);
    edited.cues[0].duration = 8;
    await expect(f.client.start('aircraft', checks, edited, reviewedPlanKey)).rejects.toThrow(/changed after review/);
    expect(f.fetcher).not.toHaveBeenCalled();
    await f.client.start('aircraft', checks, storyboard, reviewedPlanKey);
    const payload = JSON.parse(String(f.fetcher.mock.calls[0][1]?.body));
    expect(payload).toMatchObject({ aircraftId: 'aircraft', ...checks, storyboard, reviewedPlanKey });
    await f.client.stop();
  });

  it('does not lease a response that names a different storyboard plan', async () => {
    const f = fixture();
    f.fetcher.mockImplementationOnce(async (_input, options) => {
      const { runId } = JSON.parse(String(options?.body));
      return new Response(JSON.stringify({ benchShow: { runId, state: 'running', source: { ...source, planKey: 'other' } } }));
    });
    await expect(f.client.start('aircraft', checks, storyboard, reviewedPlanKey)).rejects.toThrow(/not confirmed/);
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.calls).toEqual(['stop']);
  });

  it('sends no requests before explicit start and stops renewing after Stop', async () => {
    const f = fixture();
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.calls).toEqual([]);
    await f.client.start('aircraft', checks, storyboard, reviewedPlanKey);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.calls).toEqual(['start', 'renew', 'renew']);
    await f.client.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.calls).toEqual(['start', 'renew', 'renew', 'stop']);
  });

  it('never renews a pending start, including a late response after closing the view', async () => {
    const f = fixture();
    let finish!: (value: Response) => void;
    f.fetcher.mockImplementationOnce(async (_input, options) => new Promise((resolve) => {
      const runId = JSON.parse(String(options?.body)).runId;
      finish = () => resolve(new Response(JSON.stringify({ benchShow: { runId, source, state: 'running' } })));
    }));
    const start = f.client.start('aircraft', checks, storyboard, reviewedPlanKey);
    const rejected = expect(start).rejects.toThrow('cancelled');
    f.client.dispose();
    await vi.advanceTimersByTimeAsync(4000);
    expect(f.calls).toEqual(['stop']);
    finish(f.response());
    await rejected;
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.calls).toEqual(['stop', 'stop']);
  });

  it('cancels on renewal error without retry or resuming', async () => {
    const f = fixture();
    await f.client.start('aircraft', checks, storyboard, reviewedPlanKey);
    f.fetcher.mockRejectedValueOnce(new Error('offline'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.onError).toHaveBeenCalledOnce();
    expect(f.calls).toEqual(['start', 'stop']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.calls).toEqual(['start', 'stop']);
  });

  it('ends the lease on a hanging renewal instead of waiting indefinitely', async () => {
    const f = fixture();
    await f.client.start('aircraft', checks, storyboard, reviewedPlanKey);
    f.fetcher.mockImplementationOnce(async (_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
    }));
    await vi.advanceTimersByTimeAsync(2200);
    expect(f.onError).toHaveBeenCalledOnce();
    expect(f.calls).toEqual(['start', 'stop']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.calls).toEqual(['start', 'stop']);
  });

  it('cancels when hidden; observing status never adopts another view’s run', async () => {
    const f = fixture();
    f.client.observe({} as AircraftSnapshot);
    f.client.observe(f.snapshot());
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.calls).toEqual([]);
    await f.client.start('aircraft', checks, storyboard, reviewedPlanKey);
    f.hide();
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.calls).toEqual(['start', 'stop']);
  });

  it('releases its lease after its own terminal result, but ignores unrelated results', async () => {
    const f = fixture();
    await f.client.start('aircraft', checks, storyboard, reviewedPlanKey);
    f.client.observe({ benchShow: { runId: 'other', state: 'completed' } } as AircraftSnapshot);
    await vi.advanceTimersByTimeAsync(500);
    expect(f.calls).toEqual(['start', 'renew']);
    f.client.observe(f.snapshot('completed'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.calls).toEqual(['start', 'renew']);
  });
});
