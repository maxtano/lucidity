import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshEscPrerequisites } from './esc-client';
import { api } from './client';
vi.mock('./client', () => ({ api: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });
const snapshot = { now: 100_000, aircraft: [{ id: 'one', heartbeat: { receivedAt: 99_900 }, battery: { receivedAt: 99_900 } }] };
const parameters = { parameters: [{ name: 'SERVO_BLH_AUTO', value: 1, receivedAt: 90_000 }, { name: 'SERVO_BLH_PORT', value: 0, receivedAt: 90_000 }] };
describe('reuse a prepared ESC connection', () => {
  it('reuses fresh telemetry and required parameters instead of restarting setup for each sound', async () => {
    vi.mocked(api).mockResolvedValueOnce(snapshot).mockResolvedValueOnce(parameters);
    await refreshEscPrerequisites('one', () => false);
    expect(vi.mocked(api).mock.calls.map(c => [c[0], c[1]])).toEqual([
      ['aircraft/status', undefined], ['aircraft/parameters?aircraftId=one', undefined],
    ]);
  });
  it('refreshes stale telemetry and parameters before the hardware operation', async () => {
    vi.useFakeTimers();
    vi.mocked(api).mockResolvedValueOnce({ ...snapshot, now: 200_000 }).mockResolvedValueOnce({})
      .mockResolvedValueOnce(parameters).mockResolvedValueOnce({}).mockResolvedValueOnce({ state: 'complete' });
    const pending = refreshEscPrerequisites('one', () => false);
    await vi.advanceTimersByTimeAsync(500); await pending;
    expect(vi.mocked(api).mock.calls.map(c => c[0])).toEqual([
      'aircraft/status', 'aircraft/request-telemetry', 'aircraft/parameters?aircraftId=one',
      'aircraft/parameters/read', 'aircraft/parameters?aircraftId=one',
    ]);
  });
  it('stops before preparing a write if the modal was closed', async () => {
    vi.mocked(api).mockResolvedValueOnce(snapshot);
    await expect(refreshEscPrerequisites('one', () => true)).rejects.toThrow('cancelled');
    expect(api).toHaveBeenCalledTimes(1);
  });
});
