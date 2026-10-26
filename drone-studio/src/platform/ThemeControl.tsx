import { useEffect, useLayoutEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
  APPEARANCE_KEY,
  parseAppearance,
  readAppearance,
  resolveAppearance,
  type Appearance,
} from './appearance';
import './theme.css';
import './workspace-refinement.css';

const systemQuery = '(prefers-color-scheme: dark)';
let sessionPreference: Appearance | undefined;

function initialPreference(): Appearance {
  if (sessionPreference) return sessionPreference;
  try {
    return readAppearance(window.localStorage);
  } catch {
    return 'system';
  }
}

/** Persistent bottom-left control; the same preference also themes body portals. */
export function ThemeControl() {
  const [preference, setPreference] = useState(initialPreference);
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(systemQuery).matches
  );
  const theme = resolveAppearance(preference, systemDark);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--ds-bg').trim());
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia(systemQuery);
    const onSystem = () => setSystemDark(media.matches);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== APPEARANCE_KEY && event.key !== null) return;
      sessionPreference = parseAppearance(event.newValue);
      setPreference(sessionPreference);
    };
    onSystem();
    media.addEventListener('change', onSystem);
    window.addEventListener('storage', onStorage);
    return () => {
      media.removeEventListener('change', onSystem);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const choose = (next: Appearance) => {
    sessionPreference = next;
    setPreference(next);
    try {
      window.localStorage.setItem(APPEARANCE_KEY, next);
    } catch {
      /* Keep the session choice when storage is unavailable. */
    }
  };
  const Icon = theme === 'light' ? Sun : Moon;
  return (
    <div className="theme-control" role="group" aria-label="Appearance">
      <button
        type="button"
        className="theme-toggle"
        role="switch"
        aria-label="Dark mode"
        aria-checked={theme === 'dark'}
        title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        onClick={() => choose(theme === 'light' ? 'dark' : 'light')}
      >
        <Icon size={18} aria-hidden="true" />
        <span className="theme-control-label">{theme === 'light' ? 'Light mode' : 'Dark mode'}</span>
        <span className="theme-toggle-track" aria-hidden="true"><span /></span>
      </button>
      <button type="button" className="theme-system" aria-pressed={preference === 'system'} onClick={() => choose('system')}>
        <Monitor size={13} aria-hidden="true" />{preference === 'system' ? 'Following system' : 'Use system appearance'}
      </button>
    </div>
  );
}
