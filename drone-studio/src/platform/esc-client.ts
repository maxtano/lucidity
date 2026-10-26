import { api } from './client';
import type { AircraftSnapshot } from '../aircraft/types';

/** Refresh prerequisites on the existing connection; never reconnect between sounds. */
export async function refreshEscPrerequisites(aircraftId: string, cancelled: () => boolean, client: typeof api = api) {
  const snapshot = await client<AircraftSnapshot>('aircraft/status');
  const target = snapshot.aircraft.find(aircraft => aircraft.id === aircraftId);
  const recent = (at: number | undefined, limit: number) => at !== undefined && snapshot.now >= at && snapshot.now - at < limit;
  if (!recent(target?.heartbeat.receivedAt, 3000) || !recent(target?.battery?.receivedAt, 3000))
    await client('aircraft/request-telemetry', { aircraftId });
  if (cancelled()) throw new Error('ESC preparation cancelled.');
  const cached = await client<{ parameters: { name: string; value: number; receivedAt: number }[] }>(`aircraft/parameters?aircraftId=${encodeURIComponent(aircraftId)}`);
  if ([['SERVO_BLH_AUTO', 1], ['SERVO_BLH_PORT', 0]].every(([name, value]) =>
    cached.parameters.some(p => p.name === name && p.value === value && recent(p.receivedAt, 45_000)))) return;
  await client('aircraft/parameters/read', { aircraftId });
  for (let i = 0; i < 60; i++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    if (cancelled()) throw new Error('ESC preparation cancelled.');
    const state = await client<{ state: string }>(`aircraft/parameters?aircraftId=${encodeURIComponent(aircraftId)}`);
    if (state.state === 'complete') return;
  }
  throw new Error('Parameter read did not finish. Check the connection and try again.');
}
