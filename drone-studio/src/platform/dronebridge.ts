/** Fixed-address DroneBridge AP adapter. Never request /api/settings: it contains link secrets. */
export type DroneBridgeInfo = {
  reachable: boolean;
  version?: string;
  chip?: number;
  serialBytes?: number;
  decodedMavlink?: number;
  message: string;
};

type Fetcher = typeof fetch;
const base = 'http://192.168.2.1';

export async function inspectDroneBridge(fetcher: Fetcher = fetch): Promise<DroneBridgeInfo> {
  try {
    const response = await fetcher(`${base}/api/system/info`, {
      signal: AbortSignal.timeout(2500),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Radio did not answer.');
    const info: unknown = await response.json();
    if (!info || typeof info !== 'object') throw new Error('Unexpected radio response.');
    const values = info as Record<string, unknown>;
    if (!Number.isInteger(values.major_version) || !Number.isInteger(values.minor_version) ||
      !Number.isInteger(values.esp_chip_model))
      throw new Error('This address did not identify as a DroneBridge radio.');
    return {
      reachable: true,
      version: `${values.major_version}.${values.minor_version}`,
      chip: values.esp_chip_model as number,
      message: 'DroneBridge setup mode is reachable from this Mac.',
    };
  } catch {
    return {
      reachable: false,
      message: 'Setup is not reachable. Check that this Mac joined the selected radio’s setup Wi-Fi. Radios in normal ESP-NOW mode do not expose this page.',
    };
  }
}

/** Return only UART counters; the settings endpoint includes link secrets and is never read. */
export async function inspectDroneBridgeInput(fetcher: Fetcher = fetch): Promise<DroneBridgeInfo> {
  const info = await inspectDroneBridge(fetcher);
  if (!info.reachable) return info;
  try {
    const response = await fetcher(`${base}/api/system/stats`, {
      signal: AbortSignal.timeout(2500),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Radio statistics unavailable.');
    const stats: unknown = await response.json();
    if (!stats || typeof stats !== 'object') throw new Error('Unexpected radio statistics.');
    const values = stats as Record<string, unknown>;
    const serialBytes = values.read_bytes;
    const decodedMavlink = values.serial_dec_mav_msgs;
    if (!Number.isSafeInteger(serialBytes) || (serialBytes as number) < 0 ||
      !Number.isSafeInteger(decodedMavlink) || (decodedMavlink as number) < 0)
      throw new Error('Radio statistics are incomplete.');
    return { ...info, serialBytes: serialBytes as number, decodedMavlink: decodedMavlink as number };
  } catch {
    return { ...info, message: 'DroneBridge setup is reachable, but UART counters are unavailable.' };
  }
}

async function restoreDroneBridgeMode(mode: 4 | 5, fetcher: Fetcher): Promise<{ message: string }> {
  const info = await inspectDroneBridge(fetcher);
  if (!info.reachable || info.chip !== 13)
    throw new Error('A DroneBridge ESP32-C6 radio was not verified at the setup address.');
  // Firmware accepts a partial settings object and leaves omitted values unchanged.
  // This never reads, submits, rotates, or logs Wi-Fi or ESP-NOW secrets.
  const response = await fetcher(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ esp32_mode: mode }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('The radio did not accept the mode change.');
  return { message: `${mode === 4 ? 'AIR' : 'GROUND'} ESP-NOW mode sent. The radio is rebooting; its setup Wi-Fi should disappear. Reconnect your Mac to normal Wi-Fi and check the USB aircraft link in Lucidity.` };
}

export function restoreDroneBridgeGroundMode(fetcher: Fetcher = fetch): Promise<{ message: string }> {
  return restoreDroneBridgeMode(5, fetcher);
}

export function restoreDroneBridgeAirMode(fetcher: Fetcher = fetch): Promise<{ message: string }> {
  return restoreDroneBridgeMode(4, fetcher);
}
