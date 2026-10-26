import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { AircraftSnapshot } from '../aircraft/types';
import type { MissionPrelaunchVerification } from '../aircraft/service';
import { compileHoverMission } from '../aircraft/mission-plan';
import type { MissionItem } from '../aircraft/mission-protocol';
import { createFirstLiveHoverStoryboard } from '../core/first-live-show';
import { createOneFootHoverStoryboard } from './first-flight-preview';
import { FlightMissionPanel, flightMissionHardwareReady, flightMissionLandAvailable, flightMissionLaunchReady, flightMissionRecoveryAvailable, flightMissionRecoveryDisconnectAvailable, flightMissionStorageProofCurrent, missionReadbackClearForReplan } from './FlightMissionPanel';

vi.mock('./Modal', () => ({ Modal: ({ title, children }: { title: string; children: ReactNode }) =>
  <section aria-label={title}>{children}</section> }));

function snapshot(): AircraftSnapshot {
  return {
    now: 100_000,
    link: { state: 'listening', path: '/dev/cu.mock', baudRate: 115200, connectedAt: 1,
      error: null, bytesReceived: 10, packetsReceived: 1, invalidFrames: 0,
      lastPacketAt: 100_000, transmittedBytes: 0 },
    aircraft: [{
      id: 'quad', systemId: 1, componentId: 1, protocolVersion: 2, signing: 'unsigned',
      heartbeat: { receivedAt: 100_000, armed: false, mode: 'STABILIZE', customMode: 0,
        systemStatus: 'STANDBY', autopilot: 3, vehicleType: 2 },
      attitude: null, gps: null, position: null, battery: null, messages: [],
    }],
  };
}

const homeItem: MissionItem = {
  seq: 0, frame: 0, command: 16, current: 1, autocontinue: 1,
  param1: 0, param2: 0, param3: 0, param4: 0,
  x: 377_749_000, y: -1_224_194_000, z: 12,
};

describe('props-on mission preparation UI', () => {
  it('shows storage proof only for the exact live, disarmed storyboard and before expiry', () => {
    const project = createFirstLiveHoverStoryboard('flight-candidate');
    const plan = { ...compileHoverMission(project), planId: 'plan-1' };
    const proof: MissionPrelaunchVerification = {
      verificationId: 'proof-1', planId: plan.planId, aircraftId: 'quad',
      storyboardId: project.id, revision: project.revision, connectionGeneration: 3,
      verifiedAt: 100_000, expiresAt: 115_000, missionCount: 4,
      heightM: 2, holdSeconds: 5, message: 'Storage only; no flight authorized.',
    };
    const context = {
      project, plan, aircraftId: 'quad', connectedAt: 1, verifiedConnectionAt: 1,
      now: 100_001, live: true,
      missionState: { state: 'verified' as const, aircraftId: 'quad', planId: plan.planId,
        missionCount: 4, message: 'Readback verified.' },
    };
    expect(flightMissionStorageProofCurrent(proof, context)).toBe(true);
    expect(flightMissionStorageProofCurrent(proof, { ...context, now: proof.expiresAt })).toBe(false);
    expect(flightMissionStorageProofCurrent(proof, { ...context, connectedAt: 2 })).toBe(false);
    expect(flightMissionStorageProofCurrent(proof, { ...context, live: false })).toBe(false);
    expect(flightMissionStorageProofCurrent(proof, { ...context, project: { ...project, revision: project.revision + 1 } })).toBe(false);
    expect(flightMissionStorageProofCurrent(proof, { ...context, aircraftId: 'other' })).toBe(false);
    expect(flightMissionStorageProofCurrent(proof, { ...context, missionState: { ...context.missionState, state: 'unknown' as const } })).toBe(false);
    expect(flightMissionStorageProofCurrent(null, context)).toBe(false);
  });

  it('replans only after an empty or home-only full mission readback', () => {
    expect(missionReadbackClearForReplan({ count: 0, items: [] })).toBe(true);
    expect(missionReadbackClearForReplan({ count: 1, items: [homeItem] })).toBe(true);
    expect(missionReadbackClearForReplan({ count: 1, items: [{ ...homeItem, frame: 3 }] })).toBe(true);
    expect(missionReadbackClearForReplan({ count: 1, items: [{ ...homeItem, frame: 6 }] })).toBe(true);
    expect(missionReadbackClearForReplan({ count: 1, items: [{ ...homeItem, command: 22 }] })).toBe(false);
    expect(missionReadbackClearForReplan({ count: 1, items: [{ ...homeItem, seq: 1 }] })).toBe(false);
    expect(missionReadbackClearForReplan({ count: 2, items: [homeItem, { ...homeItem, seq: 1, command: 22 }] })).toBe(false);
    expect(missionReadbackClearForReplan({ count: 0, items: [homeItem] })).toBe(false);
    expect(missionReadbackClearForReplan({ count: 1, items: [{ ...homeItem, frame: 2 }] })).toBe(false);
    expect(missionReadbackClearForReplan({ count: 1, items: [{ ...homeItem, x: 900_000_001 }] })).toBe(false);
    expect(missionReadbackClearForReplan({ count: 1, items: [{ ...homeItem, y: -1_800_000_001 }] })).toBe(false);
    expect(missionReadbackClearForReplan({ count: 1, items: [{ ...homeItem, x: 1.5 }] })).toBe(false);
    expect(missionReadbackClearForReplan({ count: 1, items: [{ ...homeItem, z: Number.NaN }] })).toBe(false);
  });

  it('requires one live disarmed MAVLink2 ArduCopter quad before planning', () => {
    const data = snapshot();
    const quad = data.aircraft[0];
    expect(flightMissionHardwareReady(data, quad, data.now)).toBe(true);
    expect(flightMissionHardwareReady(data, quad, data.now + 5_000)).toBe(false);
    expect(flightMissionHardwareReady(data, quad, data.now, 'service offline')).toBe(false);
    quad.heartbeat.armed = true;
    expect(flightMissionHardwareReady(data, quad, data.now)).toBe(false);
    quad.heartbeat.armed = false;
    quad.protocolVersion = 1;
    expect(flightMissionHardwareReady(data, quad, data.now)).toBe(false);
    quad.protocolVersion = 2;
    quad.signing = 'unverified';
    expect(flightMissionHardwareReady(data, quad, data.now)).toBe(false);
    quad.signing = 'unsigned';
    data.aircraft.push({ ...quad, id: 'second' });
    expect(flightMissionHardwareReady(data, quad, data.now)).toBe(false);
    data.aircraft.pop();
    data.link.state = 'disconnected';
    expect(flightMissionHardwareReady(data, quad, data.now)).toBe(false);
  });

  it('enables one field launch only with a fresh, exact check and all physical confirmations', () => {
    const base = {
      check: { ready: true as const, verificationId: 'proof', expiresAt: 115_000, message: 'Ready.' },
      checkedConnectionAt: 1, connectedAt: 1, checkedAircraftId: 'quad', aircraftId: 'quad',
      checkedPlanId: 'plan', planId: 'plan',
      checks: { propsInstalled: true, areaClear: true, pilotReady: true, modeSwitchReady: true },
      now: 100_001, live: true, pending: false, uncertain: false,
      runState: 'idle' as const, runCommandsIssued: 0,
    };
    expect(flightMissionLaunchReady(base)).toBe(true);
    expect(flightMissionLaunchReady({ ...base, now: base.check.expiresAt })).toBe(false);
    expect(flightMissionLaunchReady({ ...base, connectedAt: 2 })).toBe(false);
    expect(flightMissionLaunchReady({ ...base, aircraftId: 'other' })).toBe(false);
    expect(flightMissionLaunchReady({ ...base, planId: 'other' })).toBe(false);
    expect(flightMissionLaunchReady({ ...base, checks: { ...base.checks, pilotReady: false } })).toBe(false);
    expect(flightMissionLaunchReady({ ...base, pending: true })).toBe(false);
    expect(flightMissionLaunchReady({ ...base, uncertain: true })).toBe(false);
    expect(flightMissionLaunchReady({ ...base, runState: 'active' })).toBe(false);
    expect(flightMissionLaunchReady({ ...base, runState: 'unknown' })).toBe(false);
    expect(flightMissionLaunchReady({ ...base, runState: 'rejected', runCommandsIssued: 1 })).toBe(false);
    expect(flightMissionLaunchReady({ ...base, check: null })).toBe(false);
  });

  it('offers LAND only for the exact healthy live aircraft during an active run', () => {
    const data = snapshot();
    const aircraft = data.aircraft[0];
    aircraft.heartbeat.armed = true;
    aircraft.heartbeat.mode = 'Auto';
    const run = { runId: 'run-1', aircraftId: 'quad', state: 'active' as const,
      reason: 'Mission active.', issuedCommands: [224, 400, 300], progress: null };
    expect(flightMissionLandAvailable(run, data, aircraft, data.now)).toBe(true);
    expect(flightMissionLandAvailable({ ...run, state: 'landing' }, data, aircraft, data.now)).toBe(false);
    expect(flightMissionLandAvailable({ ...run, aircraftId: 'other' }, data, aircraft, data.now)).toBe(false);
    expect(flightMissionLandAvailable(run, data, aircraft, data.now + 5000)).toBe(false);
    aircraft.heartbeat.mode = 'LOITER';
    expect(flightMissionLandAvailable(run, data, aircraft, data.now)).toBe(false);
    aircraft.heartbeat.mode = 'Auto';
    expect(flightMissionLandAvailable(run, data, aircraft, data.now)).toBe(true);
    aircraft.heartbeat.mode = 'AUTO';
    expect(flightMissionLandAvailable(run, data, aircraft, data.now)).toBe(false);
    aircraft.heartbeat.mode = 'Auto';
    data.link.state = 'disconnected';
    expect(flightMissionLandAvailable(run, data, aircraft, data.now)).toBe(false);
  });

  it('offers interrupted-run reconciliation only for the same freshly observed props-off ground aircraft', () => {
    const data = snapshot();
    const aircraft = data.aircraft[0];
    aircraft.extendedState = { receivedAt: data.now, landedState: 1, vtolState: 0 };
    aircraft.position = { receivedAt: data.now, latitude: 37.77, longitude: -122.41,
      relativeAltitudeM: 0, altitudeMslM: 10, groundSpeedMps: 0 };
    const run = { runId: 'run-1', aircraftId: 'quad', state: 'unknown' as const,
      reason: 'Result unknown.', issuedCommands: [400], progress: null };
    expect(flightMissionRecoveryAvailable(run, data, aircraft, data.now)).toBe(false);
    expect(flightMissionRecoveryAvailable(run, data, aircraft, data.now, aircraft.id)).toBe(true);
    expect(flightMissionRecoveryAvailable({ ...run, state: 'rejected' }, data, aircraft, data.now, aircraft.id)).toBe(true);
    expect(flightMissionRecoveryAvailable({ ...run, state: 'rejected', issuedCommands: [] }, data, aircraft, data.now, aircraft.id)).toBe(false);
    expect(flightMissionRecoveryAvailable({ ...run, state: 'landed' }, data, aircraft, data.now, aircraft.id)).toBe(false);
    expect(flightMissionRecoveryAvailable(run, data, aircraft, data.now, 'another-quad')).toBe(false);
    const newGeneration = { ...aircraft, id: 'new-link:1:1' };
    const restarted = { ...run, runId: null, aircraftId: null, planId: null, issuedCommands: [] };
    data.aircraft = [newGeneration];
    expect(flightMissionRecoveryAvailable(restarted, data, newGeneration, data.now)).toBe(false);
    expect(flightMissionRecoveryAvailable(restarted, data, newGeneration, data.now, newGeneration.id)).toBe(true);
    expect(flightMissionRecoveryAvailable(run, data, newGeneration, data.now, newGeneration.id)).toBe(true);
    expect(flightMissionRecoveryAvailable(restarted, data, newGeneration, data.now, 'old-link:1:1')).toBe(false);
    data.aircraft = [aircraft];
    aircraft.heartbeat.armed = true;
    expect(flightMissionRecoveryAvailable(run, data, aircraft, data.now, aircraft.id)).toBe(false);
    aircraft.heartbeat.armed = false;
    aircraft.extendedState.landedState = 2;
    expect(flightMissionRecoveryAvailable(run, data, aircraft, data.now, aircraft.id)).toBe(false);
    aircraft.extendedState.landedState = 1;
    aircraft.position.relativeAltitudeM = 1;
    expect(flightMissionRecoveryAvailable(run, data, aircraft, data.now, aircraft.id)).toBe(false);
    aircraft.position.relativeAltitudeM = 0;
    expect(flightMissionRecoveryAvailable(run, data, aircraft, data.now + 3000, aircraft.id)).toBe(false);
    data.link.state = 'disconnected';
    expect(flightMissionRecoveryAvailable(run, data, aircraft, data.now, aircraft.id)).toBe(false);
  });

  it('releases the ground port during unknown recovery only after physical props-off ground confirmation', () => {
    const run = { runId: null, aircraftId: null, state: 'unknown' as const,
      reason: 'Interrupted.', issuedCommands: [] as number[], progress: null };
    expect(flightMissionRecoveryDisconnectAvailable(run, false, true)).toBe(false);
    expect(flightMissionRecoveryDisconnectAvailable(run, true, false)).toBe(false);
    expect(flightMissionRecoveryDisconnectAvailable(run, true, true)).toBe(true);
    expect(flightMissionRecoveryDisconnectAvailable({ ...run, state: 'active' }, true, true)).toBe(false);
    expect(flightMissionRecoveryDisconnectAvailable({ ...run, state: 'rejected' }, true, true)).toBe(false);
    expect(flightMissionRecoveryDisconnectAvailable({ ...run, state: 'rejected', issuedCommands: [400] }, true, true)).toBe(true);
  });

  it('separates props-off upload and guarded props-on field run', () => {
    const html = renderToStaticMarkup(<FlightMissionPanel project={createOneFootHoverStoryboard()} saved onClose={() => {}} />);
    expect(html).toContain('Mission review · guarded flight');
    expect(html).toContain('Exact near-ground height has not been validated');
    expect(html).toContain('Upload &amp; verify with props off');
    expect(html).toContain('Launch this storyboard');
    expect(html).toContain('Pilot has flown AltHold and Loiter on this quad');
    expect(html).toContain('href="#/tools/receiver"');
    expect(html).toContain('Radio setup');
    expect(html).toContain('Verify stored mission');
    expect(html).toMatch(/disabled=""[^>]*title="Read-only download of all four mission items; sends no ARM or AUTO command\."[^>]*>.*?Verify stored mission/);
    expect(html).toContain('Zorro mode switch and takeover tested; pilot at controls');
    expect(html).toContain('Connect and assign while disarmed. Propellers may be installed for read-only planning and mission checks.');
    expect(html).toContain('At the field · read-only check');
    expect(html).toContain('Every propeller is physically removed for this upload.');
    expect(html).toContain('Check flight readiness');
    expect(html).toContain('Run storyboard');
    expect(html).toMatch(/disabled=""[^>]*>.*?Run storyboard/);
    expect(html).not.toContain('Request LAND');
  });
});
