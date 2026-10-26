import type { Tune } from './music-model';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, PanelLeftClose, PanelLeftOpen, Usb, X } from 'lucide-react';
import { useAircraft } from './useAircraft';
import { ToolsWorkspace } from './ToolsWorkspace';
import { CodeWorkspace } from './CodeWorkspace';
import { Music } from './MusicWorkspace';
import { toolGroups, type ToolId } from './catalog';
import { WorkspaceHome } from './WorkspaceHome';
import { AppSwitcher } from './AppSwitcher';
import { ThemeControl } from './ThemeControl';
import { WorkspaceNavigationContext } from './WorkspaceNavigation';
import './platform.css';
import './navigation.css';
const Show = lazy(() => import('../App'));
type Page = 'home' | 'tools' | 'music' | 'show' | 'code';
export function parseRoute(hash: string): { page: Page; tool: ToolId | null } {
  const [page, tool] = hash.replace(/^#\/?/, '').split('/');
  return {
    page: ['tools', 'music', 'show', 'code'].includes(page) ? (page as Page) : 'home',
    tool: toolGroups.some((t) => t.id === tool) ? (tool as ToolId) : null,
  };
}
export default function Lucidity() {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  const [showVisited, setShowVisited] = useState(route.page === 'show'),
    [musicVisited, setMusicVisited] = useState(route.page === 'music'),
    [codeVisited, setCodeVisited] = useState(route.page === 'code');
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('lucidity.navigation.autohide.v2') !== 'false';
    } catch {
      return true;
    }
  });
  const [hoveringNavigation, setHoveringNavigation] = useState(false);
  const [focusingNavigation, setFocusingNavigation] = useState(false);
  const navigationExpanded = mobile ? drawerOpen : !collapsed || hoveringNavigation || focusingNavigation;
  const [navigationTarget, setNavigationTarget] = useState<HTMLDivElement | null>(null);
  const sidebar = useRef<HTMLElement>(null);
  const sidebarToggle = useRef<HTMLButtonElement>(null);
  const lastRoutes = useRef<Record<Page, string>>({
    home: '#/home',
    tools: '#/tools',
    music: '#/music',
    show: '#/show',
    code: '#/code',
  });
  lastRoutes.current[route.page] =
    `#/${route.page}${route.page === 'tools' && route.tool ? `/${route.tool}` : ''}`;
  const device = useAircraft();
  const [musicDraft, setMusicDraft] = useState<Tune>();
  const content = useRef<HTMLElement>(null);
  const dismissNavigation = () => {
    if (mobile) {
      setDrawerOpen(false);
      requestAnimationFrame(() => {
        if (!document.querySelector('[role="dialog"][aria-modal="true"]:not([hidden])'))
          content.current?.focus();
      });
    }
  };
  const toggleNavigation = () =>
    mobile ? setDrawerOpen((open) => !open) : setCollapsed((value) => !value);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const change = () => {
      setMobile(query.matches);
      setDrawerOpen(false);
    };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('lucidity.navigation.autohide.v2', String(collapsed));
    } catch {
      /* Layout preference is optional. */
    }
  }, [collapsed]);
  useEffect(() => {
    if (!mobile || !drawerOpen) return;
    sidebar.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setDrawerOpen(false);
        requestAnimationFrame(() => sidebarToggle.current?.focus());
      }
      if (event.key === 'Tab') {
        const elements = [
          ...(sidebar.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], select, input, [tabindex="0"]'
          ) ?? []),
        ].filter((element) => element.getClientRects().length);
        const first = elements[0],
          last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [mobile, drawerOpen]);
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
  }, [route.page, route.tool]);
  useEffect(() => {
    const change = () => {
      const next = parseRoute(location.hash);
      setRoute(next);
      if (next.page === 'show') setShowVisited(true);
      if (next.page === 'music') setMusicVisited(true);
      if (next.page === 'code') setCodeVisited(true);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const navigate = (page: Page, tool?: ToolId | null) => {
    location.hash = `/${page}${tool ? `/${tool}` : ''}`;
  };
  const status = device.error
    ? 'Service unavailable'
    : device.live
      ? 'Live aircraft'
      : device.snapshot?.link.state === 'listening'
        ? 'Waiting for aircraft'
        : device.snapshot?.link.state === 'connecting'
          ? 'Connecting'
          : device.snapshot?.link.state === 'error'
            ? 'Connection error'
            : 'No drone connected';
  return (
    <WorkspaceNavigationContext.Provider
      value={{
        target: navigationTarget,
        dismiss: dismissNavigation,
        toggle: toggleNavigation,
        expanded: navigationExpanded,
      }}
    >
      <div
        className={`lucidity-platform ${collapsed && !mobile ? 'navigation-collapsed' : ''} ${collapsed && !mobile && navigationExpanded ? 'navigation-peeking' : ''}`}
      >
        <a
          className="platform-skip"
          href="#workspace-content"
          onClick={(event) => {
            event.preventDefault();
            content.current?.focus();
          }}
        >
          Skip to workspace
        </a>
        {mobile && (
          <header className="shell-mobile-bar" inert={drawerOpen}>
            <button
              ref={sidebarToggle}
              className="shell-icon-button"
              aria-label="Open app navigation"
              aria-expanded={drawerOpen}
              aria-controls="workspace-sidebar"
              onClick={() => setDrawerOpen(true)}
            >
              <PanelLeftOpen size={19} />
            </button>
            <AppSwitcher
              page={route.page}
              routes={lastRoutes.current}
              onSwitch={dismissNavigation}
            />
          </header>
        )}
        <div className="platform-body">
          {mobile && drawerOpen && (
            <div
              className="shell-navigation-backdrop"
              onClick={() => {
                setDrawerOpen(false);
                requestAnimationFrame(() => sidebarToggle.current?.focus());
              }}
            />
          )}
          <aside
            id="workspace-sidebar"
            className={`workspace-sidebar ${mobile ? 'is-mobile' : ''}`}
            ref={sidebar}
            onPointerEnter={event => { if (event.pointerType === 'mouse') setHoveringNavigation(true); }}
            onPointerLeave={() => setHoveringNavigation(false)}
            onFocusCapture={() => setFocusingNavigation(true)}
            onBlurCapture={event => {
              if (!event.currentTarget.contains(event.relatedTarget)) setFocusingNavigation(false);
            }}
            hidden={mobile && !drawerOpen}
            role={mobile && drawerOpen ? 'dialog' : undefined}
            aria-modal={mobile && drawerOpen ? true : undefined}
            aria-label={
              mobile
                ? `${route.page === 'show' ? 'Drone Show' : route.page} navigation`
                : 'Workspace navigation'
            }
          >
            {!mobile && (
              <AppSwitcher
                page={route.page}
                routes={lastRoutes.current}
                compact={!navigationExpanded}
                onSwitch={dismissNavigation}
              />
            )}
            <div className="shell-navigation-heading">
              <span>
                {route.page === 'home'
                  ? 'YOUR WORKSPACE'
                  : route.page === 'tools'
                    ? 'WORKBENCH'
                    : route.page === 'music'
                      ? 'SOUND LIBRARY'
                      : route.page === 'show'
                        ? 'SHOW STUDIO'
                        : 'EXPLORER'}
              </span>
              <button
                className="shell-icon-button"
                aria-label={
                  mobile
                    ? 'Close app navigation'
                    : collapsed
                      ? 'Pin sidebar open'
                      : 'Auto-hide sidebar'
                }
                title={
                  mobile ? 'Close navigation' : collapsed ? 'Pin sidebar open' : 'Auto-hide sidebar'
                }
                aria-controls="workspace-navigation-content"
                aria-expanded={navigationExpanded}
                onClick={() => {
                  if (mobile) {
                    setDrawerOpen(false);
                    requestAnimationFrame(() => sidebarToggle.current?.focus());
                  } else setCollapsed(!collapsed);
                }}
              >
                {mobile ? (
                  <X size={17} />
                ) : collapsed ? (
                  <PanelLeftOpen size={17} />
                ) : (
                  <PanelLeftClose size={17} />
                )}
              </button>
            </div>
            <div
              id="workspace-navigation-content"
              className="workspace-navigation-content"
              ref={setNavigationTarget}
              hidden={!navigationExpanded && !mobile}
            />
            <div className="shell-sidebar-footer">
              <div className="shell-device">
                <button
                  className="shell-device-summary"
                  title={status}
                  aria-label={`${status}. Open connection details`}
                  onClick={() => {
                    navigate('tools', 'setup');
                    dismissNavigation();
                  }}
                >
                  <span className={`shell-device-icon ${device.live ? 'live' : ''}`}>
                    <Usb size={17} />
                    <i />
                  </span>
                  <span>
                    <strong>{status}</strong>
                    <small>
                      {device.live
                        ? `${device.aircraft?.heartbeat.armed ? 'Armed' : 'Disarmed'} · ${device.aircraft?.heartbeat.mode}`
                        : 'Connect when you’re ready'}
                    </small>
                  </span>
                  <ArrowUpRight size={13} />
                </button>
                {device.snapshot?.aircraft.length ? (
                  <select
                    aria-label="Active aircraft"
                    value={device.selectedId}
                    onChange={(event) => device.setSelectedId(event.target.value)}
                  >
                    {device.snapshot.aircraft.map((aircraft) => (
                      <option key={aircraft.id} value={aircraft.id}>
                        System {aircraft.systemId} · Component {aircraft.componentId}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              <ThemeControl />
            </div>
          </aside>
          <main
            className="platform-content"
            id="workspace-content"
            tabIndex={-1}
            ref={content}
            inert={mobile && drawerOpen}
          >
            {route.page === 'home' && (
              <WorkspaceHome device={device} navigate={navigate} onSound={t => { setMusicDraft(t); navigate('music'); }} />
            )}
            {route.page === 'tools' && (
              <ToolsWorkspace
                device={device}
                selected={route.tool}
                onSelect={(tool) => navigate('tools', tool)}
              />
            )}
            {musicVisited && (
              <div className="platform-page" hidden={route.page !== 'music'}>
                <Music active={route.page === 'music'} device={device} draft={musicDraft} />
              </div>
            )}
            {codeVisited && (
              <div className="platform-page" hidden={route.page !== 'code'}>
                <CodeWorkspace active={route.page === 'code'} />
              </div>
            )}
            {showVisited && (
              <div className="platform-show" hidden={route.page !== 'show'}>
                <Suspense fallback={<p className="platform-loading">Opening Drone Show…</p>}>
                  <Show active={route.page === 'show'} onPlatformHome={() => navigate('home')} />
                </Suspense>
              </div>
            )}
          </main>
        </div>
      </div>
    </WorkspaceNavigationContext.Provider>
  );
}
