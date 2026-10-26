import type { AircraftContext } from './useAircraft';
import { motifs } from './music-model';
import { supportedMusicEsc, hasInstalledMelody } from '../aircraft/esc-melody-capability';
export { hasInstalledMelody } from '../aircraft/esc-melody-capability';

/** Readiness belongs to this live connection, never localStorage or a tune's name. */
export function musicDeviceState(device: AircraftContext) {
  const report = device.snapshot?.esc?.aircraftId === device.selectedId ? device.snapshot.esc : undefined;
  const startup = device.snapshot?.escStartup?.aircraftId === device.selectedId ? device.snapshot.escStartup : undefined;
  const busy = report?.state === 'reading' || startup?.state === 'preparing' || startup?.state === 'installing';
  const configured = report?.state === 'complete' && report.telemetryRestored && report.count === 4 &&
    report.escs.length === 4 && report.escs.every(supportedMusicEsc) && !startup?.recoveryRequired;
  const ready = !!configured && device.live && !device.aircraft?.heartbeat.armed && !busy;
  const installed = configured ? motifs.find(t => hasInstalledMelody(report, t)) : undefined;
  return { report, busy, configured: !!configured, ready, installed };
}
