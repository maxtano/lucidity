import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Code2, Home, Music2, WandSparkles, Wrench } from 'lucide-react';
import type { WorkspacePage } from './WorkspaceHome';
import { LucidityMark } from './Visuals';

export const workspaceApps = [
  { id: 'home', name: 'Home', description: 'Your starting point', Icon: Home },
  { id: 'tools', name: 'Tools', description: 'Configure, test & update', Icon: Wrench },
  { id: 'music', name: 'Music', description: 'Compose motor melodies', Icon: Music2 },
  { id: 'show', name: 'Drone Show', description: 'Design motion & light', Icon: WandSparkles },
  { id: 'code', name: 'Code', description: 'Files, scripts & terminal', Icon: Code2 },
] as const;

export function AppSwitcher({
  page,
  routes,
  compact = false,
  onSwitch,
}: {
  page: WorkspacePage;
  routes: Record<WorkspacePage, string>;
  compact?: boolean;
  onSwitch: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLElement>(null);
  const id = useId();
  const current = workspaceApps.find((app) => app.id === page)!;
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLAnchorElement>(`a[data-app="${page}"]`)?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, page]);
  return (
    <div
      className={`app-switcher ${compact ? 'is-compact' : ''}`}
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          close(true);
        }
      }}
    >
      <button
        ref={trigger}
        className="app-switcher-trigger"
        aria-label={`Switch app, current app: ${current.name}`}
        aria-expanded={open}
        aria-controls={id}
        title={compact ? `${current.name} · Switch app` : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className={`app-emblem app-color-${page}`}>
          <current.Icon size={20} />
        </span>
        <span className="app-switcher-label">
          <small>LUCIDITY</small>
          <strong>{current.name}</strong>
        </span>
        <ChevronsUpDown size={15} className="app-switcher-chevron" />
      </button>
      <nav
        hidden={!open}
        ref={menu}
        id={id}
        className="app-switcher-popover"
        aria-label="Switch app"
        onKeyDown={(event) => {
          const links = [...event.currentTarget.querySelectorAll('a')];
          const index = links.indexOf(document.activeElement as HTMLAnchorElement);
          let next: number | undefined;
          if (event.key === 'ArrowDown') next = (index + 1) % links.length;
          if (event.key === 'ArrowUp') next = (index + links.length - 1) % links.length;
          if (event.key === 'Home') next = 0;
          if (event.key === 'End') next = links.length - 1;
          if (next !== undefined) {
            event.preventDefault();
            links[next]?.focus();
          }
        }}
      >
        <div className="app-switcher-heading">
          <LucidityMark />
          <span>Apps</span>
        </div>
        {workspaceApps.map(({ id: app, name, description, Icon }) => (
          <a
            key={app}
            data-app={app}
            href={routes[app]}
            aria-current={page === app ? 'page' : undefined}
            onClick={() => {
              close(true);
              onSwitch();
            }}
          >
            <span className={`app-emblem app-color-${app}`}>
              <Icon size={18} />
            </span>
            <span>
              <strong>{name}</strong>
              <small>{description}</small>
            </span>
            {page === app && <Check size={15} />}
          </a>
        ))}
      </nav>
    </div>
  );
}
