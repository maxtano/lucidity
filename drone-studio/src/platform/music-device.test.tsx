import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EscInspection } from '../aircraft/esc-types';
import type { AircraftContext } from './useAircraft';
import type { AircraftSnapshot, AircraftTelemetry } from '../aircraft/types';
import { settings } from '../aircraft/esc-test-fixtures';
import { decodeEscSettings } from '../aircraft/esc-protocol';
import { encodeBluejayMelody } from './bluejay-melody';
import { motifs } from './music-model';
import { musicDeviceState, hasInstalledMelody } from './music-device';
import { SoundLibrary } from './SoundLibrary';
import { MusicConnection } from './MusicConnection';

function fixture(): AircraftContext {
  const esc: EscInspection = {
    aircraftId: 'synthetic-music-aircraft', path: '/dev/cu.usbmodemTEST',
    startedAt: 900, finishedAt: 1000, state: 'complete', message: 'Synthetic test readback',
    count: 4, telemetryRestored: true,
    escs: Array.from({ length: 4 }, (_, index) => {
      const bytes = settings(true);
      bytes[0x05] = 1;
      bytes[0x0b] = index === 1 ? 2 : 1;
      bytes.write('Bluejay (.0)', 0x60);
      Buffer.from(encodeBluejayMelody(motifs[0])).copy(bytes, 0x70);
      return decodeEscSettings(index + 1, 0xe8b2, 1, bytes);
    }),
  };
  const aircraft: AircraftTelemetry = { id: esc.aircraftId, systemId: 1, componentId: 1, protocolVersion: 2, signing: 'unsigned',
    heartbeat: { receivedAt: 1000, armed: false, mode: 'Stabilize', customMode: 0, systemStatus: 'Standby', autopilot: 3, vehicleType: 2 },
    attitude: null, gps: null, position: null, battery: null, messages: [] };
  const snapshot: AircraftSnapshot = { now: 1000, esc, aircraft: [aircraft], link: {
    state: 'listening', path: esc.path, connectedAt: 1000, baudRate: 115200, error: null, bytesReceived: 1,
    packetsReceived: 1, invalidFrames: 0, lastPacketAt: 1000, transmittedBytes: 0,
  } };
  return { snapshot, aircraft, live: true, now: 1000, error: '', selectedId: aircraft.id, setSelectedId: () => {} };
}
describe('Music setup and installed-sound readiness', () => {
  it('recognizes a startup from verified bytes, not its name', () => {
    const device = fixture();
    expect(musicDeviceState(device)).toMatchObject({ ready: true, installed: motifs[0] });
    expect(hasInstalledMelody(device.snapshot!.esc, { ...motifs[0], name: 'Renamed' })).toBe(true);
    expect(hasInstalledMelody(device.snapshot!.esc, { ...motifs[1], name: motifs[0].name })).toBe(false);
    device.snapshot!.esc!.escs[3].settingsHex = device.snapshot!.esc!.escs[3].settingsHex!.slice(0, 224) + '00'.repeat(128);
    expect(hasInstalledMelody(device.snapshot!.esc, motifs[0])).toBe(false);
  });
  it('does not carry readiness across disconnection, aircraft changes, arming, busy or partial reads', () => {
    const modifications: ((device: AircraftContext) => void)[] = [
      d => { d.live = false; }, d => { d.selectedId = 'another'; },
      d => { d.aircraft!.heartbeat.armed = true; }, d => { d.snapshot!.esc!.state = 'reading'; },
      d => { d.snapshot!.esc!.state = 'partial'; }, d => { d.snapshot!.esc!.telemetryRestored = false; },
      d => { d.snapshot!.esc!.escs.pop(); }, d => { d.snapshot!.esc!.escs[3].firmwareName = 'Bluejay (.1)'; },
      d => { d.snapshot!.escStartup = { aircraftId: d.selectedId, state: 'failed', message: '', verifiedEscs: [], recoveryRequired: true }; },
    ];
    for (const modify of modifications) { const device = fixture(); modify(device); expect(musicDeviceState(device).ready).toBe(false); }
  });
  it('puts setup above the library and makes only the installed sound available for motor replay', () => {
    const device = fixture();
    const setup = renderToStaticMarkup(<MusicConnection device={device} />);
    expect(setup).toContain('Ready for motor sounds'); expect(setup).toContain('Startup:'); expect(setup).toContain('First light');
    const library = renderToStaticMarkup(<SoundLibrary device={device} onEdit={() => {}} />);
    expect(library.match(/>Play on drone</g)).toHaveLength(1);
    expect(library.match(/>Set as startup</g)).toHaveLength(14);
    expect(library.match(/>Play on computer</g)).toHaveLength(15);
    expect(library).not.toContain('Motor melody setup</button>');
    expect(library).toContain('Current startup');
    device.live = false;
    const disconnected = renderToStaticMarkup(<SoundLibrary device={device} onEdit={() => {}} />);
    expect(disconnected.match(/disabled=""/g)).toHaveLength(15);
  });
});
