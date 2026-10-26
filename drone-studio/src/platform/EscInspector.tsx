import { useEffect, useRef, useState } from 'react';
import { Cpu, Download } from 'lucide-react';
import type { EscInspection } from '../aircraft/esc-types';
import type { AircraftContext } from './useAircraft';
import { api, downloadFile, errorText } from './client';
import { refreshEscPrerequisites } from './esc-client';

export function EscInspector({ device, simple = false }: { device: AircraftContext; simple?: boolean }) {
  const [propsRemoved, setPropsRemoved] = useState(false);
  const [directUsb, setDirectUsb] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [result, setResult] = useState<EscInspection | null>(null);
  useEffect(() => { setPropsRemoved(false); setDirectUsb(false); setResult(null); setError(''); }, [device.selectedId]);
  const report = device.snapshot?.esc?.aircraftId === device.selectedId ? device.snapshot.esc : result?.aircraftId === device.selectedId ? result : null;
  const busy = pending || report?.state === 'reading';
  return <section className="platform-card esc-inspector" aria-label="ESC firmware reader">
    <div className="platform-section-heading"><h2>{simple ? 'Check motor sounds' : 'Read ESC firmware'}</h2><Cpu size={20} /></div>
    <p>Connect USB to your flight controller and plug in the flight battery. Remove all propellers before continuing.</p>
    <p>{simple ? 'Lucidity checks whether your motors can play custom sounds. You may hear startup beeps during the check; your settings stay the same.' : 'This reads BLHeli_S and Bluejay settings on supported SiLabs ESCs. Telemetry pauses during the read; ESCs may sound their normal startup beeps when restarted. Settings are not changed.'}</p>
    <div className="drone-preview-checks">
      <label><input type="checkbox" checked={propsRemoved} disabled={busy} onChange={e => setPropsRemoved(e.target.checked)} />All propellers are removed.</label>
      <label><input type="checkbox" checked={directUsb} disabled={busy} onChange={e => setDirectUsb(e.target.checked)} />The flight controller is connected directly by USB.</label>
    </div>
    <div className="platform-actions"><button className="platform-primary" disabled={!device.live || !propsRemoved || !directUsb || busy} onClick={async () => {
      if (lock.current) return;
      lock.current = true; setPending(true); setError('');
      const aircraftId = device.selectedId;
      try {
        // Refresh the passthrough prerequisites instead of relying on an old configuration snapshot.
        await refreshEscPrerequisites(aircraftId, () => !mounted.current);
        if (!mounted.current) return;
        setResult(await api<EscInspection>('aircraft/esc/read', { aircraftId, propsRemoved, directUsb }));
      } catch (e) { setError(errorText(e)); }
      finally { lock.current = false; setPending(false); }
    }}>{busy ? 'Checking…' : simple ? 'Check compatibility' : 'Read ESCs'}</button>
    {report?.finishedAt && <button className="platform-button" onClick={() => downloadFile('lucidity-esc-readback.json', JSON.stringify(report, null, 2))}><Download size={14} />Download readback</button>}</div>
    {pending && !report && <p role="status">Checking passthrough settings, then reading the ESCs…</p>}
    {error && <p className="platform-error" role="alert">{error}</p>}
    {report && <>
      <p role={report.state === 'failed' ? 'alert' : 'status'}>{report.message}</p>
      {!!report.escs.length && <div className="esc-readback-table"><table>
        <thead><tr><th>ESC</th><th>Firmware / target</th><th>Direction setting</th><th>Startup melody</th></tr></thead>
        <tbody>{report.escs.map(esc => <tr key={esc.index}>
          <td>{esc.index}</td><td>{esc.firmware ?? 'Unreadable'} {esc.version}<br />{esc.layout}{esc.firmwareName && <small> · {esc.firmwareName}</small>}{esc.error && <p>{esc.error}</p>}</td>
          <td>{esc.direction ?? 'Unknown'}</td><td>{esc.startupMelody === 'supported' ? 'Supported by firmware' : esc.startupMelody === 'unsupported' ? 'Requires different ESC firmware' : 'Unknown'}</td>
        </tr>)}</tbody>
      </table></div>}
      {report.finishedAt && <small>Read {new Date(report.finishedAt).toLocaleTimeString()}. ESC numbers follow passthrough output order; physical positions are unverified. Use Motor melody setup in Music to enable supported startup sounds.</small>}
    </>}
    {!device.live && !busy && <p>Connect a disarmed ArduPilot flight controller to start a read.</p>}
  </section>;
}
