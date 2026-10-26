import { EscInspector } from './EscInspector';
import { useEffect, useState } from 'react';
import { Usb, CheckCircle2, ChevronDown, Music2 } from 'lucide-react';
import { Connection } from './Connection';
import { StartupInstaller } from './StartupInstaller';
import { musicDeviceState } from './music-device';
import { motifs } from './music-model';
import type { AircraftContext } from './useAircraft';

/** One setup panel for the whole library. Closing it never closes the USB connection. */
export function MusicConnection({ device }: { device: AircraftContext }) {
  const [expanded, setExpanded] = useState(false);
  const [visited, setVisited] = useState(false);
  const [installBusy, setInstallBusy] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const { report, configured, ready, installed, busy } = musicDeviceState(device);
  const listening = device.snapshot?.link.state === 'listening';
  const working = busy || installBusy;
  useEffect(() => { if (configured && !working) setExpanded(false); }, [configured, working]);
  const stock = report?.state === 'complete' && report.count === 4 && report.escs.every(e =>
    e.layout === 'J-H-40' && e.signature === '0xE8B2' && e.firmware === 'BLHeli_S' && e.version === '16.7');
  useEffect(() => { if (stock) setShowUpgrade(true); if (configured && !working) setShowUpgrade(false); }, [stock, configured, working]);
  useEffect(() => { setShowUpgrade(false); }, [device.selectedId]);
  const status = working ? 'Working with your motors…' : ready ? 'Ready for motor sounds' :
    device.aircraft?.heartbeat.armed && device.live ? 'Disarm your drone to use motor sounds' :
    configured && !device.live ? 'Waiting for drone connection' : device.live ? stock ? 'One-time firmware setup needed' : 'Connected · Check motor compatibility' :
    listening ? 'Waiting for drone heartbeat' : 'Connect your drone to get started';
  return <section className={`platform-card music-connection ${ready ? 'music-connection-ready' : ''}`} aria-label="Motor melody setup">
    <div className="platform-section-heading">
      <div className="music-setup-heading"><span className="music-setup-icon">{ready ? <CheckCircle2 size={22} /> : <Usb size={22} />}</span>
        <div><h2>Motor melody setup</h2><p role="status">{status}</p></div>
      </div>
      <button className={ready || expanded ? 'platform-button' : 'platform-primary'} disabled={working} aria-expanded={expanded} aria-controls="music-setup-controls"
        onClick={() => { setVisited(true); setExpanded(value => !value); }}>
        {expanded ? 'Hide setup' : ready ? 'Manage setup' : device.live ? 'Continue setup' : 'Connect drone'}<ChevronDown size={14} />
      </button>
    </div>
    {ready ? <div className="music-ready-summary"><span><CheckCircle2 size={14} />USB connected · 4 motors ready</span><span><Music2 size={14} />Startup: <strong>{installed?.name ?? 'Custom melody'}</strong></span></div> :
      <ol className="music-setup-steps" aria-label="Motor sound setup steps">
        <li className={device.live || working ? 'complete' : ''}>1. Connect by USB</li>
        <li className={configured ? 'complete' : ''}>2. Check motor sounds</li>
        <li>3. Choose a startup sound</li>
      </ol>}
    {!expanded && !working && <p className="music-setup-hint">{ready ? 'You’re connected. Choose a sound below; setup stays ready while you browse.' : 'Computer playback works right away. Motor sounds need USB to the flight controller and a connected flight battery.'}</p>}
    {working && <p role="status">{device.snapshot?.escStartup?.state === 'preparing' || device.snapshot?.escStartup?.state === 'installing' ? device.snapshot.escStartup.message : report?.message} Keep USB and battery connected.</p>}
    <div id="music-setup-controls" hidden={!expanded}>
      {visited && <Connection device={device} compact />}
      {visited && !configured && !showUpgrade && <EscInspector device={device} simple />}
      {showUpgrade && <StartupInstaller tune={motifs[0]} device={device} onBusy={setInstallBusy} />}
      {configured && <details className="music-technical-details"><summary>Firmware and motor details</summary>
        <p>Bluejay 0.21.0 · 24 kHz · J-H-40. Setup is saved on the drone; reconnect USB when you return.</p>
        <p>Direction settings: {report?.escs.map(e => `${e.index}: ${e.direction?.toLowerCase()}`).join(' · ')}.</p>
        <p>These are saved settings. Motor spin and flight checks are separate from melody playback.</p>
        <EscInspector device={device} simple />
      </details>}
      <p className="music-setup-hint">Hiding setup keeps the drone connected.</p>
    </div>
    {device.error && <p className="platform-error" role="alert">{device.error}</p>}
  </section>;
}
