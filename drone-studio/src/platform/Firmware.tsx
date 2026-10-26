import { useEffect, useRef, useState } from 'react';
import { Cpu, FileUp, RefreshCw, Square } from 'lucide-react';
import type { AircraftPort } from '../aircraft/types';
import type { Job } from './workbench-service';
import { api, errorText } from './client';
export function Firmware() {
  const [ports, setPorts] = useState<AircraftPort[]>([]),
    [port, setPort] = useState(''),
    [family, setFamily] = useState('ESP32'),
    [image, setImage] = useState<{ name: string; sha256: string; bytes: number } | null>(null),
    [address, setAddress] = useState(''),
    [checked, setChecked] = useState(false),
    [jobs, setJobs] = useState<Job[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const scan = async () => {
    try {
      setPorts((await api<{ ports: AircraftPort[] }>('aircraft/ports')).ports);
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    void scan();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<{ jobs: Job[] }>('workbench/jobs', undefined, controller.signal);
        if (!controller.signal.aborted) setJobs(result.jobs);
      } catch {
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 1000);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  const run = async (action: 'identify' | 'flash') => {
    setBusy(true);
    setError('');
    try {
      const job = await api<Job>('workbench/esp', {
        port,
        action,
        ...(action === 'flash' ? { filename: image?.name, address } : {}),
        confirmed: true,
      });
      setJobs((old) => [job, ...old]);
      setChecked(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const running = jobs.find((j) => j.state === 'running');
  return (
    <div className="platform-stack">
      <div className="platform-card">
        <span className="platform-eyebrow">FIRMWARE TARGET</span>
        <div className="firmware-families">
          {['ESP32', 'ArduPilot / PX4', 'Betaflight', 'ESC'].map((name) => (
            <button
              key={name}
              className={name === family ? 'selected' : ''}
              aria-pressed={name === family}
              onClick={() => {
                setFamily(name);
                setChecked(false);
              }}
            >
              <Cpu size={22} />
              <strong>{name}</strong>
              <small>{name === 'ESP32' ? 'Local esptool' : 'Adapter pending'}</small>
            </button>
          ))}
        </div>
      </div>
      {family === 'ESP32' ? (
        <>
          <div className="platform-card">
            <h2>Flash ESP firmware</h2>
            <p>
              Disconnect the aircraft link. Use firmware for your exact board; detecting a USB port
              does not confirm compatibility.
            </p>
            <h3 className="firmware-step-title">
              <span>01</span> Identify your board
            </h3>
            <div className="platform-form-row">
              <label>
                USB board
                <select
                  value={port}
                  onChange={(e) => {
                    setPort(e.target.value);
                    setChecked(false);
                  }}
                >
                  <option value="">Choose a detected device</option>
                  {ports.map((p) => (
                    <option key={p.path} value={p.path}>
                      {p.manufacturer ?? 'USB'} · {p.path}
                    </option>
                  ))}
                </select>
              </label>
              <button className="platform-button" onClick={() => void scan()}>
                <RefreshCw size={14} />
                Scan
              </button>
              <button
                className="platform-button"
                disabled={!port || busy || !!running}
                onClick={() => void run('identify')}
              >
                Identify chip
              </button>
            </div>
            <h3 className="firmware-step-title">
              <span>02</span> Choose your firmware
            </h3>
            <div className="firmware-upload">
              <FileUp size={27} />
              <div>
                <strong>
                  {image
                    ? `${image.name} · ${(image.bytes / 1024).toFixed(1)} KB`
                    : 'Choose a firmware binary'}
                </strong>
                <p>
                  {image
                    ? 'File staged locally. No device has been flashed.'
                    : 'A single .bin image, up to 16 MB. Multi-image bundles require a prepared merged image.'}
                </p>
              </div>
              <button
                className="platform-button"
                disabled={busy || !!running}
                onClick={() => input.current?.click()}
              >
                Choose .bin
              </button>
              <input
                hidden
                ref={input}
                type="file"
                accept=".bin"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  setBusy(true);
                  setError('');
                  setImage(null);
                  setChecked(false);
                  try {
                    if (file.size > 16000000) throw new Error('Firmware must be under 16 MB.');
                    const content = await new Promise<string>((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = () => resolve(String(reader.result).split(',')[1]);
                      reader.onerror = reject;
                      reader.readAsDataURL(file);
                    });
                    setImage(await api('workbench/firmware', { content }));
                  } catch (err) {
                    setError(errorText(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </div>
            {image && <p className="firmware-checksum">SHA-256 {image.sha256}</p>}
            <h3 className="firmware-step-title">
              <span>03</span> Review and flash
            </h3>
            <label className="firmware-address">
              Flash address from your firmware’s instructions
              <input
                placeholder="e.g. 0x0 — verify for your image"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setChecked(false);
                }}
              />
            </label>
            <label className="platform-check">
              <input
                type="checkbox"
                checked={checked}
                disabled={busy || !!running}
                onChange={(e) => setChecked(e.target.checked)}
              />
              I verified the board, image, and address. This overwrites flash at that address. I
              have any backup I need.
            </label>
            <button
              className="platform-primary"
              disabled={
                !image ||
                !port ||
                !/^0x[0-9a-fA-F]{1,8}$/.test(address) ||
                !checked ||
                busy ||
                !!running
              }
              onClick={() => void run('flash')}
            >
              Flash selected ESP
            </button>
          </div>
          <details className="firmware-help">
            <summary>esptool setup</summary>
            <p>
              Requires Python and esptool on this computer. If esptool is missing, install it in the
              Code terminal with <code>python3 -m pip install esptool</code>, then identify the
              chip.
            </p>
          </details>
        </>
      ) : (
        <div className="platform-card">
          <h2>{family} flashing unavailable</h2>
          <p>
            The device adapter, compatibility checks, and recovery flow are not implemented. ESP
            flashing supports ESP images only.
          </p>
        </div>
      )}
      {jobs
        .filter((j) => j.label.startsWith('esptool'))
        .slice(0, 3)
        .map((job) => (
          <div className="platform-card" key={job.id}>
            <div className="platform-section-heading">
              <h3>{job.label}</h3>
              <span>{job.state}</span>
              {job.state === 'running' && (
                <button
                  className="platform-stop"
                  onClick={() =>
                    void api('workbench/stop', { id: job.id }).catch((e) => setError(errorText(e)))
                  }
                >
                  <Square size={14} />
                  Stop
                </button>
              )}
            </div>
            <pre className="firmware-output">{job.output || 'Starting esptool…'}</pre>
            <p>
              {job.state === 'completed'
                ? 'Command completed. Inspect the verification output and reconnect to check the firmware boots.'
                : job.state === 'failed' || job.state === 'stopped'
                  ? 'Flash state may be incomplete. Inspect the output before retrying.'
                  : 'Keep the board connected.'}
            </p>
          </div>
        ))}
      {error && (
        <p className="platform-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
