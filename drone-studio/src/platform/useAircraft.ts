import { useEffect, useState } from 'react';
import type { AircraftSnapshot } from '../aircraft/types';
import { api, errorText } from './client';
export function useAircraft() {
  const [observation, setObservation] = useState<{ snapshot: AircraftSnapshot; at: number } | null>(
    null
  );
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const snapshot = await api<AircraftSnapshot>(
          'aircraft/status',
          undefined,
          controller.signal
        );
        if (!controller.signal.aborted) {
          setObservation({ snapshot, at: Date.now() });
          setError('');
        }
      } catch (e) {
        if (!controller.signal.aborted) setError(errorText(e));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 1000);
      }
    };
    void poll();
    const tick = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, []);
  const snapshot = observation?.snapshot;
  const aircraft = snapshot?.aircraft.find((a) => a.id === selectedId) ?? snapshot?.aircraft[0];
  const now = observation ? observation.snapshot.now + Math.max(0, clock - observation.at) : clock;
  const live =
    !!aircraft &&
    !error &&
    snapshot?.link.state === 'listening' &&
    snapshot.esc?.state !== 'reading' &&
    now >= aircraft.heartbeat.receivedAt &&
    now - aircraft.heartbeat.receivedAt < 5000;
  return { snapshot, aircraft, now, live, error, selectedId: aircraft?.id ?? '', setSelectedId };
}
export type AircraftContext = ReturnType<typeof useAircraft>;
