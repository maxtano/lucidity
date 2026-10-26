import { createRoot } from 'react-dom/client';
import App from '../App';
import { createStoryboard, saveStoryboard } from '../core/storyboards';
import { defaultProject } from '../core/model';
import '../styles.css';

if (!import.meta.env.DEV) throw new Error('This fixture is development-only.');

// Separate, tab-scoped storage exercises reload recovery without touching user work.
const key = 'lucidity.fixture.storyboard-deletion';
const stored = sessionStorage.getItem(key);
const values = new Map<string, string>(stored ? JSON.parse(stored) : []);
let failWrites = false;
const storage: Storage = {
  get length() { return values.size; },
  getItem: (name) => values.get(name) ?? null,
  setItem: (name, value) => {
    if (failWrites) throw new DOMException('Fixture storage is full', 'QuotaExceededError');
    const next = new Map(values).set(name, value);
    sessionStorage.setItem(key, JSON.stringify([...next]));
    values.set(name, value);
  },
  removeItem: (name) => { values.delete(name); },
  clear: () => values.clear(),
  key: (index) => [...values.keys()][index] ?? null,
};
if (!stored) {
  const first = createStoryboard('Fixture first', 'fixture-first');
  // Reuse the fallback ID to catch restoration accidentally keeping fallback content.
  const last = createStoryboard('Fixture active', defaultProject.id);
  saveStoryboard(storage, first, 1);
  saveStoryboard(storage, last, 2);
  storage.setItem('lucidity.studio.project.v1', JSON.stringify(last));
}
// The fixture cannot reach any aircraft or assistant endpoint.
window.fetch = async () => { throw new Error('Network is disabled in this fixture.'); };
const root = createRoot(document.getElementById('root')!);
root.render(<>
  <aside style={{ padding: 16 }}>
    <strong>Isolated storyboard deletion fixture · no aircraft connection</strong>
    <label style={{ marginLeft: 16 }}>
      <input type="checkbox" onChange={(event) => { failWrites = event.target.checked; }} />
      Simulate storage failure
    </label>
  </aside>
  <App storage={storage} />
</>);
import.meta.hot?.dispose(() => root.unmount());
