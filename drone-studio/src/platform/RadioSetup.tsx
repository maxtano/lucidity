import { useEffect, useMemo, useState } from 'react';
import { Activity, Radio, RefreshCw } from 'lucide-react';
import type { AircraftParameter, ParameterSnapshot } from '../aircraft/parameters';
import type { AircraftSnapshot } from '../aircraft/types';
import {
  channelPercent, channelValue, configuredFlightModes, flightModeSlot,
  radioAssignments, receiverIsFresh,
} from '../aircraft/radio-setup';
import type { AircraftContext } from './useAircraft';
import { api, errorText } from './client';
import { Connection } from './Connection';
import './RadioSetup.css';

const setupNames = [
  'RCMAP_ROLL', 'RCMAP_PITCH', 'RCMAP_THROTTLE', 'RCMAP_YAW', 'FLTMODE_CH', 'RC6_OPTION',
  'FLTMODE1', 'FLTMODE2', 'FLTMODE3', 'FLTMODE4', 'FLTMODE5', 'FLTMODE6',
];

const flightModeRanges = ['≤1230', '1231–1360', '1361–1490', '1491–1620', '1621–1749', '≥1750'];

export function RadioSetup({ device }: { device: AircraftContext }) {
  const [parameters, setParameters] = useState<AircraftParameter[]>([]);
  const [busy, setBusy] = useState<'channels' | 'mapping' | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [monitor, setMonitor] = useState<AircraftSnapshot | null>(null);
  const id = device.selectedId;
  const aircraft = monitor?.aircraft.find((item) => item.id === id) ?? device.aircraft;
  const now = monitor?.now ?? device.now;
  const live = !!aircraft && monitor?.link.state === 'listening'
    ? now - aircraft.heartbeat.receivedAt >= 0 && now - aircraft.heartbeat.receivedAt < 5000
    : device.live;
  const fresh = live && receiverIsFresh(aircraft, now);
  const assignments = useMemo(() => radioAssignments(parameters), [parameters]);
  const modeSlots = useMemo(() => configuredFlightModes(parameters), [parameters]);
  const modeChannelReported = parameters.some((parameter) => parameter.name === 'FLTMODE_CH');
  const modePwm = fresh && modeChannelReported ? channelValue(aircraft, assignments.mode) : null;
  const selectedSlot = flightModeSlot(modePwm);
  const ch6 = fresh ? channelValue(aircraft, 6) : null;
  const rc6Option = parameters.find((parameter) => parameter.name === 'RC6_OPTION')?.value;
  const armingMessage = aircraft?.messages
    .filter((item) => /\b(?:PreArm|Arm):/i.test(item.text))
    .reduce<(typeof aircraft.messages)[number] | null>(
      (latest, item) => !latest || item.receivedAt > latest.receivedAt ? item : latest, null
    ) ?? null;
  const armingMessageAge = armingMessage && now >= armingMessage.receivedAt
    ? Math.round((now - armingMessage.receivedAt) / 1000) : null;

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<AircraftSnapshot>('aircraft/status', undefined, controller.signal);
        if (!controller.signal.aborted) setMonitor(result);
      } catch { /* Global connection panel reports link errors. */ }
      if (!controller.signal.aborted) timer = setTimeout(poll, 250);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);

  useEffect(() => {
    setParameters([]);
    setError('');
    setMessage('');
    if (!id) return;
    const controller = new AbortController();
    void api<ParameterSnapshot>(
      `aircraft/parameters?aircraftId=${encodeURIComponent(id)}`,
      undefined,
      controller.signal
    ).then((result) => {
      if (!controller.signal.aborted) setParameters(result.parameters);
    }).catch(() => {});
    return () => controller.abort();
  }, [id]);

  const requestChannels = async () => {
    setBusy('channels');
    setError('');
    try {
      await api('aircraft/request-radio', { aircraftId: id });
      setMessage('Fresh RC channels received. Move one transmitter control at a time.');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };
  const readMapping = async () => {
    setBusy('mapping');
    setError('');
    try {
      const result = await api<ParameterSnapshot>('aircraft/parameters/read', {
        aircraftId: id,
        names: setupNames,
      });
      setParameters(result.parameters);
      setMessage('Aircraft channel mapping and six flight-mode slots read. Transmitter settings remain on the radio.');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };
  const supported = aircraft?.heartbeat.autopilot === 3;
  const controls = [
    ['Roll', assignments.roll], ['Pitch', assignments.pitch],
    ['Throttle', assignments.throttle], ['Yaw', assignments.yaw],
  ] as const;
  const used = new Set<number>(supported ? [...controls.map(([, channel]) => channel), assignments.mode ?? 0, assignments.stop ?? 0] : []);
  const extraChannels = Array.from({ length: Math.min(18, aircraft?.receiver?.channels.length ?? 0) }, (_, i) => i + 1)
    .filter((number) => !used.has(number));
  const row = (label: string, channel: number | null, key: string) => {
    const value = fresh ? channelValue(aircraft, channel) : null;
    return <div className="radio-channel" key={key}>
      <div className="radio-channel-label"><strong>{label}</strong><span>{channel ? `CH${channel}` : 'Unassigned'}</span></div>
      <div className="radio-channel-track" role="meter" aria-label={`${label} channel`} aria-valuemin={800} aria-valuemax={2200} aria-valuenow={value ?? undefined}>
        <span style={{ left: `${channelPercent(value)}%` }} className={value === null ? 'missing' : ''} />
      </div>
      <output>{value === null ? '—' : Math.round(value)}</output>
    </div>;
  };
  return <div className="platform-stack radio-setup">
    <div className="platform-card radio-intro">
      <Radio size={22} aria-hidden="true" />
      <div>
        <h2>Check your controls</h2>
        <p>Move each stick and switch. The bars show what the flight controller actually receives. This screen sends no motor commands.</p>
      </div>
    </div>
    {!live ? <Connection device={device} compact check="radio" guidance="Remove every propeller. Disconnect the flight battery, connect the flight controller directly by USB, and turn on your transmitter. Close QGroundControl first." /> : <>
      <div className="platform-card radio-monitor">
        <div className="radio-monitor-top">
          <div>
            <span className="platform-eyebrow">CONNECTED AIRCRAFT</span>
            <h2>{aircraft?.heartbeat.autopilot === 3 ? 'ArduPilot radio input' : 'MAVLink radio input'}</h2>
            <p>{fresh ? 'Receiving channels now' : 'Waiting for fresh RC channels'} · {aircraft?.heartbeat.armed ? 'Armed — setup locked' : 'Disarmed'}</p>
          </div>
          <span className={`radio-live ${fresh ? 'is-live' : ''}`}><Activity size={14} /> {fresh ? 'Live' : 'No RC data'}</span>
        </div>
        <div className="radio-actions">
          <button className="platform-button" disabled={!!busy || !live || !!aircraft?.heartbeat.armed} onClick={() => void requestChannels()}>
            <RefreshCw size={15} /> {busy === 'channels' ? 'Requesting…' : 'Request live channels'}
          </button>
          {supported && <button className="platform-button" disabled={!!busy || !!aircraft?.heartbeat.armed} onClick={() => void readMapping()}>
            {busy === 'mapping' ? 'Reading…' : 'Read modes & mapping'}
          </button>}
        </div>
        {supported && !assignments.reported && <p className="radio-hint">Showing standard ArduPilot channel numbers until the aircraft mapping is read.</p>}
        {!supported && <p className="radio-hint">This aircraft does not report as ArduPilot. Raw channel numbers are available below; mapped control names need a firmware adapter.</p>}
        {supported && <section className="radio-arming-status" aria-label="Arming status">
          <div className="radio-arming-heading"><strong>Arming status</strong><span>Aircraft-reported · no control sent</span></div>
          <div className="radio-arming-facts">
            <div><span>Current mode</span><strong>{aircraft?.heartbeat.mode ?? 'Unknown'}</strong></div>
            <div><span>CH6 input</span><strong>{ch6 === null ? 'No fresh input' : `${Math.round(ch6)} µs`}</strong></div>
            <div><span>RC6 function</span><strong>{rc6Option === undefined ? 'Not read' : rc6Option === 31 ? 'Motor stop (31)' : `Option ${rc6Option}`}</strong></div>
          </div>
          <div className="radio-arming-message" role="status">
            <span>{armingMessage ? `Last FC message${armingMessageAge === null ? '' : armingMessageAge > 30 ? ` · older (${armingMessageAge}s ago)` : ` · ${armingMessageAge}s ago`}` : 'Flight controller message'}</span>
            <p>{armingMessage?.text ?? 'No PreArm/Arm message received yet. This is not proof that arming checks passed.'}</p>
          </div>
          <p className="radio-hint">CH6 is shown as raw input. Lucidity cannot infer whether your motor-stop switch is engaged from its PWM value alone.</p>
        </section>}
        <div className="radio-channels" aria-live="off">
          {supported && controls.map(([label, channel]) => row(label, channel, label))}
          {supported && row('Flight mode', assignments.mode, 'mode')}
          {supported && assignments.stop && row('Motor stop', assignments.stop, 'stop')}
        </div>
        {supported && <section className="radio-modes" aria-label="Flight-mode switch slots">
          <div className="radio-modes-heading">
            <strong>Flight-mode slots</strong>
            <span>{!modeChannelReported
              ? 'Read modes & mapping to identify the mode channel'
              : assignments.mode === null
              ? 'Flight-mode channel disabled'
              : selectedSlot === null
                ? `CH${assignments.mode} · waiting for live PWM`
                : `CH${assignments.mode} · ${Math.round(modePwm!)} µs → slot ${selectedSlot}`}</span>
          </div>
          <div className="radio-mode-slots" role="list">
            {modeSlots.map(({ slot, code, name }) => <div
              className={`radio-mode-slot ${selectedSlot === slot ? 'is-selected' : ''}`}
              role="listitem"
              aria-current={selectedSlot === slot ? 'true' : undefined}
              key={slot}
            >
              <span className="radio-mode-slot-number">{String(slot).padStart(2, '0')}</span>
              <strong>{name}</strong>
              <span>{flightModeRanges[slot - 1]} µs</span>
              {code === null && <span className="radio-mode-slot-unread">Read modes to confirm</span>}
            </div>)}
          </div>
          <p className="radio-hint">A 3-position switch can select slots 1, 4 and 6. Verify each live highlight before assigning modes. Aircraft reports {aircraft?.heartbeat.mode ?? 'unknown'} now; a failsafe or override can make it differ from the switch selection.</p>
        </section>}
        <button className="radio-show-all" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Hide other channels' : 'Show other channels'}
        </button>
        {(showAll || !supported) && <div className="radio-channels radio-extra">{extraChannels.map((channel) => row(`Channel ${channel}`, channel, `extra-${channel}`))}</div>}
        {message && <p className="radio-hint" role="status">{message}</p>}
        {error && <p className="platform-error" role="alert">{error}</p>}
      </div>
      <div className="platform-card radio-next">
        <strong>What to look for</strong>
        <p>Roll, pitch, throttle and yaw should each move one bar. Your flight-mode switch should change its own channel. A working motor-stop switch does not confirm the sticks.</p>
        <p>The aircraft reports channels, not the transmitter model. Transmitter mixes remain on the radio; this monitor does not change settings.</p>
      </div>
    </>}
  </div>;
}
