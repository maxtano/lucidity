import { EscInspector } from './EscInspector';
import { lazy, Suspense, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Circle,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { toolGroups, findTools, type ToolId } from './catalog';
import type { AircraftContext } from './useAircraft';
import { Connection } from './Connection';
import { Parameters } from './Parameters';
import { RadioSetup } from './RadioSetup';
import { Firmware } from './Firmware';
import { FlightLogs } from './FlightLogs';
import { LevelCalibration } from './LevelCalibration';
import { MotorBenchPanel, type MotorChecks, type MotorNumber } from '../components/MotorBenchPanel';
import { api, errorText } from './client';
import { toolSections, toolIcons } from './tool-navigation';
import { WorkspaceNavigation, useWorkspaceNavigation } from './WorkspaceNavigation';
const DroneCheck = lazy(() => import('../checkup/DroneCheck').then(module => ({ default: module.DroneCheck })));
function MotorWorkspace({ device }: { device: AircraftContext }) {
  const [pending, setPending] = useState<'pulse' | 'stop' | null>(null),
    [error, setError] = useState('');
  const pulse = async (motor: MotorNumber, checks: MotorChecks) => {
    setPending('pulse');
    setError('');
    try {
      await api('aircraft/motor-test', { aircraftId: device.selectedId, motor, ...checks });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending((old) => (old === 'pulse' ? null : old));
    }
  };
  const stop = async () => {
    setPending('stop');
    try {
      await api('aircraft/motor-test-stop', { aircraftId: device.selectedId });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(null);
    }
  };
  return (
    <>
      <div className="motor-labels">
        {['A', 'B', 'C', 'D'].map((letter) => (
          <div key={letter}>
            <span className="motor-glyph">✣</span>
            <strong>Motor test {letter}</strong>
            <small>Physical position unverified</small>
          </div>
        ))}
      </div>
      <p className="platform-notice">
        Test letters identify the firmware’s motor-test sequence. They are not proof of physical
        position or rotation direction. Inspect FRAME_TYPE and output assignments, then record what
        you observe.
      </p>
      <MotorBenchPanel
        snapshot={device.snapshot}
        aircraft={device.aircraft}
        now={device.now}
        busy={!!pending}
        pulsePending={pending === 'pulse'}
        stopPending={pending === 'stop'}
        serviceUnavailable={!!device.error}
        onPulse={(motor, checks) => void pulse(motor, checks)}
        onStop={() => void stop()}
      />
      {error && (
        <p className="platform-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
export function ToolsWorkspace({
  device,
  selected,
  onSelect,
}: {
  device: AircraftContext;
  selected: ToolId | null;
  onSelect: (id: ToolId | null) => void;
}) {
  const navigation = useWorkspaceNavigation();
  const select = (id: ToolId | null) => {
    onSelect(id);
    navigation?.dismiss();
  };
  const [query, setQuery] = useState('');
  const [section, setSection] = useState('all');
  const [availableOnly, setAvailableOnly] = useState(false);
  const tool = toolGroups.find((t) => t.id === selected);
  const filtered = findTools(query).filter(
    (t) =>
      (!availableOnly || t.action !== 'planned') &&
      (section === 'all' || toolSections.find((s) => s.id === section)?.tools.includes(t.id))
  );
  const SelectedIcon = tool ? toolIcons[tool.id] : SlidersHorizontal;
  return (
    <div className="tools-layout">
      <WorkspaceNavigation>
        <nav className="app-local-navigation tools-navigation" aria-label="Tool navigation">
          <button
            className={!selected ? 'selected' : ''}
            aria-current={!selected ? 'page' : undefined}
            onClick={() => select(null)}
          >
            <SlidersHorizontal size={15} />
            All tools<span className="navigation-count">{toolGroups.length}</span>
          </button>
          <div className="tools-side-list">
            {toolSections.map((group) => (
              <div className="tools-side-group" key={group.id}>
                <h2>{group.title}</h2>
                {group.tools.map((id) => {
                  const t = toolGroups.find((item) => item.id === id)!;
                  const Icon = toolIcons[id];
                  return (
                    <button
                      key={id}
                      className={selected === id ? 'selected' : ''}
                      aria-current={selected === id ? 'page' : undefined}
                      onClick={() => select(id)}
                    >
                      <Icon size={14} />
                      <span>{t.name}</span>
                      {t.action === 'planned' && (
                        <span
                          className="capability-dot pending"
                          title="Integration pending"
                          aria-label="Integration pending"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </nav>
      </WorkspaceNavigation>
      <section className="tools-main">
        {tool?.action === 'checkup' ? <Suspense fallback={<p className="platform-loading">Opening drone checks…</p>}><DroneCheck device={device} /></Suspense> : tool ? (
          <>
            <div className="platform-page-heading">
              <button className="platform-back" onClick={() => onSelect(null)}>
                Tools /
              </button>
              <div className="tool-title-row">
                <span className="tool-title-icon">
                  <SelectedIcon size={24} />
                </span>
                <h1>{tool.name}</h1>
              </div>
            </div>
            {tool.action !== 'radio' && <div className="tool-scope">
              <details>
                <summary>Capabilities</summary>
                <p>{tool.description}</p>
                <ul>
                  {tool.features.map((f) => (
                    <li key={f}>
                      <Circle size={7} />
                      {f}
                    </li>
                  ))}
                </ul>
                <p>
                  Target families: {tool.families.join(', ')}. Current support:{' '}
                  {tool.capability.toLowerCase()}.
                </p>
              </details>
            </div>}
            {tool.action === 'esc' ? (
              <><Connection device={device} compact /><EscInspector device={device} /></>
            ) : tool.action === 'radio' ? (
              <RadioSetup device={device} />
            ) : tool.action === 'flight-logs' ? (
              <FlightLogs device={device} />
            ) : tool.action === 'parameters' ? (
              tool.id === 'sensors' ? <div className="platform-stack">
                {!device.live && <Connection device={device} compact guidance="Connect a disarmed ArduCopter flight controller directly by USB. Remove all propellers and unplug the flight battery before level calibration." />}
                <LevelCalibration device={device} />
                <Parameters device={device} prefixes={tool.prefixes} />
              </div>
                : <Parameters device={device} prefixes={tool.prefixes} />
            ) : tool.action === 'connection' ? (
              <Connection device={device} />
            ) : tool.action === 'motors' ? (
              <MotorWorkspace device={device} />
            ) : tool.action === 'firmware' ? (
              <Firmware />
            ) : (
              <div className="platform-card platform-adapter">
                <SlidersHorizontal size={28} />
                <h2>{tool.capability}</h2>
                <p>
                  Device operations are not connected yet. Review the listed capabilities and available tools.
                </p>
                <ul>
                  {tool.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="platform-page-heading workspace-heading-row">
              <h1>Tools</h1>
              <button className="platform-primary" onClick={() => onSelect('setup')}>
                Connect a drone <ArrowRight size={15} />
              </button>
            </div>
            <div className="platform-toolbar tools-search-row">
              <label className="platform-search">
                <Search size={16} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find a tool, setting, firmware, or task…"
                  aria-label="Search all tools"
                />
              </label>
              <span>{filtered.length} tools</span>
            </div>
            <div className="tools-filters" aria-label="Filter tool areas">
              <div className="tools-filter-tabs">
                {[{ id: 'all', title: 'All tools' }, ...toolSections].map((group) => (
                  <button
                    key={group.id}
                    aria-pressed={section === group.id}
                    onClick={() => setSection(group.id)}
                  >
                    {group.title}
                  </button>
                ))}
              </div>
              <label className="tools-available">
                <input
                  type="checkbox"
                  checked={availableOnly}
                  onChange={(e) => setAvailableOnly(e.target.checked)}
                />
                Available integrations
              </label>
            </div>
            <div className="tools-grid">
              {filtered.map((t) => {
                const Icon = toolIcons[t.id];
                return (
                  <button className="tool-card" key={t.id} onClick={() => onSelect(t.id)}>
                    <div className="tool-card-top">
                      <span className="tool-icon">
                        <Icon size={20} />
                      </span>
                      <ArrowUpRight size={15} />
                    </div>
                    <h3>{t.name}</h3>
                    <span className={`tool-card-status ${t.action === 'planned' ? 'pending' : ''}`}>
                      <i />
                      {t.capability}
                    </span>
                  </button>
                );
              })}
            </div>
            {!filtered.length && (
              <div className="platform-empty">
                <Search size={24} />
                <h3>No matching tool</h3>
                <p>
                  Try a different group or search for “receiver”, “battery”, or a parameter prefix.
                </p>
              </div>
            )}
            <details className="tools-coverage-note">
              <summary>Supported integrations</summary>
              <p>
                ArduPilot parameters and MAVLink diagnostics are available. Betaflight MSP,
                PX4-specific setup, ESC writes, other sensor calibration commands, and mission
                execution need additional adapters. ArduCopter level calibration is available in
                Sensors & GPS.
              </p>
            </details>
          </>
        )}
      </section>
    </div>
  );
}
