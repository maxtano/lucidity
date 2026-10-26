import { describe, expect, it, vi } from 'vitest';
import { inspectDroneBridge, inspectDroneBridgeInput, restoreDroneBridgeAirMode, restoreDroneBridgeGroundMode } from './dronebridge';

describe('DroneBridge ground-mode adapter', () => {
  it('reads only public info and changes only the ground mode', async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/system/info'))
        return new Response(JSON.stringify({ major_version: 2, minor_version: 4, esp_chip_model: 13 }));
      expect(url).toBe('http://192.168.2.1/api/settings');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ esp32_mode: 5 });
      return new Response('{}');
    }) as unknown as typeof fetch;
    expect((await inspectDroneBridge(fetcher)).reachable).toBe(true);
    await restoreDroneBridgeGroundMode(fetcher);
    expect(vi.mocked(fetcher).mock.calls.map(([url]) => url)).toEqual([
      'http://192.168.2.1/api/system/info',
      'http://192.168.2.1/api/system/info',
      'http://192.168.2.1/api/settings',
    ]);
  });

  it('refuses an unverified device', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ major_version: 2, minor_version: 4, esp_chip_model: 5 }))) as unknown as typeof fetch;
    await expect(restoreDroneBridgeGroundMode(fetcher)).rejects.toThrow('not verified');
    expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(1);
  });

  it('returns only numeric UART counters and never requests settings during inspection', async () => {
    const fetcher = vi.fn(async (url: string) => url.endsWith('/api/system/info')
      ? new Response(JSON.stringify({ major_version: 2, minor_version: 4, esp_chip_model: 13 }))
      : new Response(JSON.stringify({ read_bytes: 400, serial_dec_mav_msgs: 17, wifi_pass: 'fixture-only' }))) as unknown as typeof fetch;
    expect(await inspectDroneBridgeInput(fetcher)).toEqual({
      reachable: true, version: '2.4', chip: 13,
      message: 'DroneBridge setup mode is reachable from this Mac.',
      serialBytes: 400, decodedMavlink: 17,
    });
    expect(vi.mocked(fetcher).mock.calls.map(([url]) => url)).toEqual([
      'http://192.168.2.1/api/system/info', 'http://192.168.2.1/api/system/stats',
    ]);
  });

  it('restores only AIR mode after device verification', async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/system/info'))
        return new Response(JSON.stringify({ major_version: 2, minor_version: 4, esp_chip_model: 13 }));
      expect(url).toBe('http://192.168.2.1/api/settings');
      expect(JSON.parse(String(init?.body))).toEqual({ esp32_mode: 4 });
      return new Response('{}');
    }) as unknown as typeof fetch;
    await restoreDroneBridgeAirMode(fetcher);
    expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(2);
  });
});
