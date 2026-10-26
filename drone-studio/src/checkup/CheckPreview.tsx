import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DroneCheck } from './DroneCheck';
import { syntheticClient } from './fixtures';
import { Button, Notice } from '../design-system';
import { ThemeControl } from '../platform/ThemeControl';
import '../styles.css';
import '../platform/platform.css';
import './checkup.css';

const fixture = syntheticClient();
const memory = new Map<string, string>();
const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); } };
function Preview() {
  const [snapshot, setSnapshot] = useState(fixture.snapshot);
  const [unplugged, setUnplugged] = useState(false);
  useEffect(() => { const id = setInterval(() => setSnapshot(fixture.snapshot()), 50); return () => clearInterval(id); }, []);
  return <main style={{ maxWidth: 1180, margin: '0 auto', padding: 24 }}>
    <Notice tone="warning">DEVELOPMENT SIMULATION · Synthetic readings only. No device connection, hardware command or real report storage.</Notice>
    <div className="check-actions"><Button onClick={() => { fixture.controls.controllerPresent = !fixture.controls.controllerPresent; setUnplugged(!fixture.controls.controllerPresent); }}>{unplugged ? 'Simulate reconnecting controller USB' : 'Simulate unplugging controller USB'}</Button></div>
    <ThemeControl />
    <DroneCheck device={{ snapshot, aircraft: snapshot.aircraft[0], selectedId: snapshot.aircraft[0]?.id ?? '', setSelectedId: () => {}, now: snapshot.now, live: snapshot.link.state === 'listening', error: '' }} client={fixture.client} storage={storage} timing={{ now: fixture.now, wait: async (ms, signal) => { await new Promise(resolve => setTimeout(resolve, 40)); await fixture.wait(ms, signal); } }} />
  </main>;
}
if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<Preview />);
