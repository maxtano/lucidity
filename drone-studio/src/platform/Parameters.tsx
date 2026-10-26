import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, Search, Upload, X } from 'lucide-react';
import type { AircraftParameter, ParameterSnapshot } from '../aircraft/parameters';
import type { AircraftContext } from './useAircraft';
import { api, downloadFile, errorText } from './client';
import { parameterLabel } from './catalog';
export function Parameters({
  device,
  prefixes = [],
}: {
  device: AircraftContext;
  prefixes?: string[];
}) {
  const [data, setData] = useState<ParameterSnapshot | null>(null),
    [query, setQuery] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<AircraftParameter | null>(null),
    [value, setValue] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [backup, setBackup] = useState<Record<string, number> | null>(null),
    [onlyChanged, setOnlyChanged] = useState(false),
    [limit, setLimit] = useState(100);
  const input = useRef<HTMLInputElement>(null);
  const id = device.selectedId;
  useEffect(() => {
    setData(null);
    setEditing(null);
    setMessage('');
    setError('');
    setBackup(null);
    setOnlyChanged(false);
  }, [id]);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<ParameterSnapshot>(
          `aircraft/parameters?aircraftId=${encodeURIComponent(id)}`,
          undefined,
          controller.signal
        );
        if (!controller.signal.aborted) setData(next);
      } catch (e) {
        if (!controller.signal.aborted) setError(errorText(e));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 1500);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id]);
  const read = async () => {
    setBusy(true);
    setError('');
    try {
      setData(await api<ParameterSnapshot>('aircraft/parameters/read', { aircraftId: id }));
      setMessage('Reading the parameters reported by this aircraft…');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const exportBackup = () => {
    if (data)
      downloadFile(
        `lucidity-parameters-${Date.now()}.json`,
        JSON.stringify(
          {
            format: 'lucidity-parameters-v1',
            exportedAt: Date.now(),
            firmware: device.aircraft?.version?.flightVersion,
            ...data,
          },
          null,
          2
        )
      );
  };
  const write = async () => {
    if (!editing || !confirmed || !value.trim() || !Number.isFinite(Number(value))) return;
    setBusy(true);
    setError('');
    try {
      // Preserve the observed list before the request. Failure to save prevents a write.
      localStorage.setItem(
        'lucidity.parameters.before-write.v1',
        JSON.stringify({ at: Date.now(), ...data })
      );
      const result = await api<{ before: number; after: number; name: string }>(
        'aircraft/parameters/set',
        {
          aircraftId: id,
          name: editing.name,
          value: Number(value),
          expected: editing.value,
          confirmed: true,
        }
      );
      setMessage(
        `${result.name}: ${result.before} → ${result.after}. Readback verified. Some settings require a reboot; persistence across reboot has not been checked.`
      );
      setEditing(null);
      setConfirmed(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const rows = (data?.parameters ?? [])
    .filter(
      (p) =>
        (!prefixes.length || prefixes.some((prefix) => p.name.startsWith(prefix))) &&
        `${p.name} ${p.value} ${parameterLabel(p.name, p.value) ?? ''}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (!onlyChanged || (backup && p.name in backup && backup[p.name] !== p.value))
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const writable =
    device.live &&
    !device.aircraft?.heartbeat.armed &&
    device.aircraft?.heartbeat.autopilot === 3 &&
    device.aircraft.signing === 'unsigned';
  return (
    <div className="platform-stack">
      <div className="platform-card">
        <div className="platform-section-heading">
          <div>
            <h2>Parameter values</h2>
            {data?.startedAt && (
              <p>
                {data.received} / {data.expected || 'unknown'} received · {data.state}
              </p>
            )}
          </div>
          <button
            className="platform-primary"
            disabled={!writable || busy}
            onClick={() => void read()}
          >
            <RefreshCw size={14} />
            Read from drone
          </button>
        </div>
        <div className="platform-toolbar">
          <label className="platform-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(100);
              }}
              placeholder="Search FRAME_TYPE, SERVO, Motor 1…"
              aria-label="Search parameters"
            />
          </label>
          <button
            className="platform-button"
            disabled={!data?.parameters.length}
            onClick={exportBackup}
          >
            <Download size={14} />
            Backup
          </button>
          <button className="platform-button" onClick={() => input.current?.click()}>
            <Upload size={14} />
            Compare backup
          </button>
          <input
            ref={input}
            type="file"
            accept=".json"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                if (file.size > 5000000) throw new Error('Backup must be under 5 MB.');
                const source = JSON.parse(await file.text());
                if (source.format !== 'lucidity-parameters-v1' || !Array.isArray(source.parameters))
                  throw new Error('Choose a Lucidity parameter backup.');
                const values: Record<string, number> = {};
                for (const p of source.parameters) {
                  if (typeof p.name !== 'string' || !Number.isFinite(p.value))
                    throw new Error('Invalid backup parameter.');
                  values[p.name] = p.value;
                }
                setBackup(values);
                setOnlyChanged(true);
                setMessage('Backup loaded for comparison only. No aircraft settings changed.');
              } catch (err) {
                setError(errorText(err));
              }
            }}
          />
        </div>
        {backup && (
          <label className="platform-check">
            <input
              type="checkbox"
              checked={onlyChanged}
              onChange={(e) => setOnlyChanged(e.target.checked)}
            />
            Only values different from imported backup · {Object.keys(backup).length} backup entries
          </label>
        )}
        {!writable && (
          <p className="platform-notice">
            Connect a disarmed ArduPilot aircraft with fresh telemetry to read or change settings.
            {!!data?.parameters.length && ' Retained values are historical.'}
          </p>
        )}
        {data?.state === 'partial' && (
          <p className="platform-notice">
            Some parameters did not arrive. Read again before treating this as a complete backup.
          </p>
        )}
        {message && (
          <p role="status" className="platform-notice">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="platform-error">
            {error}
          </p>
        )}
      </div>
      {editing && (
        <section className="platform-card parameter-review" aria-label="Review parameter change">
          <div className="platform-section-heading">
            <h2>Review {editing.name}</h2>
            <button
              aria-label="Close parameter review"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              <X size={18} />
            </button>
          </div>
          <p>
            Current value: <strong>{editing.value}</strong>{' '}
            {parameterLabel(editing.name, editing.value)} · Reported type {editing.type}
          </p>
          <label>
            New value
            <input
              type="number"
              step="any"
              value={value}
              disabled={busy}
              onChange={(e) => {
                setValue(e.target.value);
                setConfirmed(false);
              }}
            />
          </label>
          <p>
            The full parameter list is available for expert configuration. Firmware-specific ranges,
            units, and descriptions are not yet imported; confirm this setting against your firmware
            documentation.
          </p>
          <label className="platform-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I reviewed this value for my aircraft. Save a local backup, write, then verify.
          </label>
          <button
            className="platform-primary"
            disabled={
              !writable || busy || !confirmed || !value.trim() || !Number.isFinite(Number(value))
            }
            onClick={() => void write()}
          >
            {busy ? 'Writing and verifying…' : 'Write & verify'}
          </button>
        </section>
      )}
      <div className="platform-table-wrap">
        <table className="platform-table">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Reported value</th>
              {backup && <th>Backup</th>}
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((p) => (
              <tr key={p.name}>
                <td>
                  <code>{p.name}</code>
                </td>
                <td>
                  <strong>{p.value}</strong>
                  {parameterLabel(p.name, p.value) && (
                    <span className="parameter-friendly">{parameterLabel(p.name, p.value)}</span>
                  )}
                </td>
                {backup && <td>{backup[p.name] ?? 'Not in backup'}</td>}
                <td>
                  <button
                    className="platform-button"
                    disabled={!writable || busy}
                    onClick={() => {
                      setEditing({ ...p });
                      setValue(String(p.value));
                      setConfirmed(false);
                    }}
                  >
                    Review edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="platform-empty">
            <Search size={22} />
            <h3>
              {data?.parameters.length ? 'No matching parameters' : 'No parameter values loaded'}
            </h3>
            {!!data?.parameters.length && <p>Try a different search or tool category.</p>}
          </div>
        )}
        {rows.length > limit && (
          <button className="platform-button" onClick={() => setLimit(limit + 100)}>
            Show 100 more · {rows.length} total
          </button>
        )}
      </div>
    </div>
  );
}
