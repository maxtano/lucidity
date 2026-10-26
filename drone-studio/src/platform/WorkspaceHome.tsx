import { SoundLibrary } from './SoundLibrary';
import type { Tune } from './music-model';
import { useRef } from 'react';
import { ArrowRight, ArrowUpRight, Cpu, Usb, Home, Grid2X2, Gauge, ShieldCheck } from 'lucide-react';
import { DroneStudy, WorkspaceArt } from './Visuals';
import { type ToolId } from './catalog';
import type { AircraftContext } from './useAircraft';
import { WorkspaceNavigation, useWorkspaceNavigation } from './WorkspaceNavigation';

export type WorkspacePage = 'home' | 'tools' | 'music' | 'show' | 'code';

export function WorkspaceHome({
  device,
  navigate,
  onSound,
}: {
  device: AircraftContext;
  navigate: (page: WorkspacePage, tool?: ToolId | null) => void;
  onSound: (tune: Tune) => void;
}) {
  const navigation = useWorkspaceNavigation();
  const top = useRef<HTMLDivElement>(null);
  const apps = useRef<HTMLDivElement>(null);
  return (
    <div className="platform-home" ref={top}>
      <WorkspaceNavigation>
        <nav className="app-local-navigation home-navigation" aria-label="Home navigation">
          <button
            className="selected"
            onClick={() => {
              top.current?.scrollIntoView();
              navigation?.dismiss();
            }}
          >
            <Home size={15} />
            Overview
          </button>
          <button
            onClick={() => {
              apps.current?.scrollIntoView({ block: 'start' });
              navigation?.dismiss();
            }}
          >
            <Grid2X2 size={15} />
            Browse apps
          </button>
          <h2 className="navigation-section-title">Quick start</h2>
          <button onClick={() => { navigate('tools', 'drone-check'); navigation?.dismiss(); }}><ShieldCheck size={15} />Check my drone<small>Beta</small></button>
          <button
            onClick={() => {
              navigate('tools', 'setup');
              navigation?.dismiss();
            }}
          >
            <Usb size={15} />
            Connect a drone
            <ArrowUpRight size={12} />
          </button>
          <button
            onClick={() => {
              navigate('tools', 'motors');
              navigation?.dismiss();
            }}
          >
            <Gauge size={15} />
            Motor bench
            <ArrowUpRight size={12} />
          </button>
          <button
            onClick={() => {
              navigate('tools', 'firmware');
              navigation?.dismiss();
            }}
          >
            <Cpu size={15} />
            Flash firmware
            <ArrowUpRight size={12} />
          </button>
        </nav>
      </WorkspaceNavigation>
      <section className="home-hero">
        <div className="home-hero-copy">
          <h1>Workspace</h1>
          <div className="home-hero-actions">
            <button className="platform-primary" onClick={() => navigate('tools', 'setup')}>
              <Usb size={15} />
              Connect your drone
              <ArrowRight size={15} />
            </button>
            <button className="platform-text-button" onClick={() => navigate('tools')}>
              Explore tools
              <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
        <DroneStudy />
      </section>

      <section className="home-checkup" aria-labelledby="home-checkup-title">
        <ShieldCheck size={26} aria-hidden="true" />
        <div><span className="check-eyebrow">NEW / BETA</span><h2 id="home-checkup-title">Check your whole build, in one place.</h2><p>Connections, configuration, hands-on checks, and a report of what still needs attention.</p></div>
        <button className="platform-primary" onClick={() => navigate('tools', 'drone-check')}>Check my drone<ArrowRight size={16} /></button>
      </section>
      <div className="platform-section-heading home-workspace-heading" ref={apps}>
        <h2>Apps</h2>
      </div>
      <div className="home-destinations">
        {(
          [
            {
              page: 'tools',
              title: 'Tools',
              detail: 'Parameters, motors & firmware',
            },
            {
              page: 'music',
              title: 'Music',
              detail: 'Melodies & buzzer tests',
            },
            {
              page: 'show',
              title: 'Drone Show',
              detail: 'Storyboards & simulation',
            },
            {
              page: 'code',
              title: 'Code',
              detail: 'Files & terminal',
            },
          ] as const
        ).map((card, i) => (
          <button
            className={`home-destination destination-${card.page}`}
            key={card.page}
            onClick={() => navigate(card.page)}
          >
            <div className="destination-top">
              <span>0{i + 1}</span>
              <ArrowUpRight size={16} />
            </div>
            <WorkspaceArt kind={card.page} />
            <h3>{card.title}</h3>
            <span className="destination-detail">
              {card.detail}
              <ArrowRight size={13} />
            </span>
          </button>
        ))}
      </div>

      <div className="home-bottom">
        <section className="home-bench-card">
          <span className="home-small-icon">
            <Cpu size={21} />
          </span>
          <div>
            <h3>
              {device.live
                ? `Aircraft system ${device.aircraft?.systemId}`
                : 'No aircraft connected'}
            </h3>
            <p>
              {device.live ? 'Live connection' : 'Connect a ground radio to inspect your aircraft.'}
            </p>
          </div>
          <button
            aria-label={device.live ? 'Open aircraft parameters' : 'Open connection setup'}
            onClick={() => navigate('tools', device.live ? 'parameters' : 'setup')}
          >
            <ArrowUpRight size={21} />
          </button>
        </section>
      </div>
      <SoundLibrary device={device} onEdit={onSound} />
    </div>
  );
}
