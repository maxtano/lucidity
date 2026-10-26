import { describe, expect, it } from 'vitest';
import type { MissionPrelaunchVerification } from './service';
import type { AircraftCommandAckEvent, AircraftTelemetry } from './types';
import {
  SimulatorLaunchTransaction,
  type SimulatorCommand,
  type SimulatorLaunchAdapter,
  type SimulatorLaunchGate,
  type SimulatorLaunchSample,
} from './simulator-launch-transaction';

const AIRCRAFT_ID = 'sitl:1:1';

function aircraft(at: number): AircraftTelemetry {
  return {
    id: AIRCRAFT_ID, systemId: 1, componentId: 1, protocolVersion: 2, signing: 'unsigned',
    heartbeat: { receivedAt: at, armed: false, mode: 'Stabilize', customMode: 0,
      systemStatus: 'Standby', autopilot: 3, vehicleType: 2 },
    attitude: null, gps: { receivedAt: at, fix: '3D', fixType: 3, satellites: 13,
      latitude: 47.397742, longitude: 8.545594, hdop: 1.1 },
    position: { receivedAt: at, latitude: 47.397742, longitude: 8.545594,
      relativeAltitudeM: 0, altitudeMslM: 488, groundSpeedMps: 0 },
    battery: { receivedAt: at, voltageV: 12.5, currentA: 0.2, remainingPercent: 95 },
    receiver: { receivedAt: at, channels: [1500, 1500, 1000, 1500, 1800, 1000], rssi: 100 },
    version: { receivedAt: at, flightVersion: '4.7.1', releaseType: 0 },
    ekfStatus: { receivedAt: at, flags: 4 | 16 | 32 },
    extendedState: { receivedAt: at, landedState: 1, vtolState: 0 },
    messages: [],
  };
}

function gate(): SimulatorLaunchGate {
  const proof: MissionPrelaunchVerification = {
    verificationId: 'verification-1', planId: 'plan-1', aircraftId: AIRCRAFT_ID,
    storyboardId: 'show-1', revision: 1, connectionGeneration: 7,
    verifiedAt: 900, expiresAt: 15_000, missionCount: 4, heightM: 2, holdSeconds: 5,
    message: 'SITL fixture readback',
  };
  return {
    proof, review: { planId: proof.planId, storyboardId: proof.storyboardId, revision: proof.revision },
    preflight: { kind: 'sitl-fixture', verificationId: proof.verificationId,
      aircraftId: AIRCRAFT_ID, linkGeneration: 7, observedAt: 1000, expiresAt: 15_000,
      gpsHomeEkfHealthy: true, batteryHealthy: true, receiverAndFailsafesChecked: true,
      pilotTakeoverRouteChecked: true },
  };
}

type Change = (fake: FakeSitl) => void;

class FakeSitl implements SimulatorLaunchAdapter {
  readonly kind = 'injected-sitl' as const;
  readonly transport = 'loopback-tcp' as const;
  readonly endpoint = '127.0.0.1:5760' as const;
  readonly groundSystemId = 254;
  readonly groundComponentId = 190;
  now = 1000;
  linkGeneration = 7;
  linkState: SimulatorLaunchSample['linkState'] = 'listening';
  plane = aircraft(this.now);
  commands: SimulatorCommand[] = [];
  acks: AircraftCommandAckEvent[] = [];
  events: { at: number; change: Change }[] = [];
  onCommand: (command: SimulatorCommand, fake: FakeSitl) => void = (command, fake) => fake.accept(command.command);

  sample() { return { now: this.now, linkGeneration: this.linkGeneration,
    linkState: this.linkState, aircraft: [structuredClone(this.plane)] }; }
  commandAckCursor() { return this.acks.length; }
  commandAcks(afterId: number, aircraftId: string) {
    return this.acks.filter(ack => ack.id > afterId && ack.aircraftId === aircraftId);
  }
  async sendCommand(command: SimulatorCommand) { this.commands.push(command); this.onCommand(command, this); }
  async waitForUpdate(timeoutMs: number) {
    this.now += Math.min(timeoutMs, 100);
    this.plane.heartbeat.receivedAt = this.now; // SITL keepalive, without changing armed or mode.
    for (const event of this.events.filter(item => item.at <= this.now)) event.change(this);
    this.events = this.events.filter(item => item.at > this.now);
  }
  schedule(change: Change, delay = 100) { this.events.push({ at: this.now + delay, change }); }
  ack(command: number, result = 0, overrides: Partial<AircraftCommandAckEvent> = {}) {
    this.acks.push({ id: this.acks.length + 1, aircraftId: AIRCRAFT_ID, sourceSystem: 1,
      sourceComponent: 1, receivedAt: this.now, command, result, progress: null,
      resultParam2: 0, targetSystem: 254, targetComponent: 190, ...overrides });
  }
  accept(command: number) {
    this.schedule(fake => {
      fake.ack(command);
      if (command === 224) fake.plane.missionCurrent = { receivedAt: fake.now, seq: 1, total: 3,
        state: 1, mode: 1, missionId: 0 };
      if (command === 400) {
        fake.plane.heartbeat.armed = true;
        fake.plane.ekfStatus = { receivedAt: fake.now, flags: 4 | 16 | 32 };
      }
      if (command === 300) {
        fake.plane.heartbeat.mode = 'Auto';
        fake.plane.missionCurrent = { receivedAt: fake.now, seq: 1, total: 3,
          state: 1, mode: 1, missionId: 0 };
        fake.plane.extendedState = { receivedAt: fake.now, landedState: 2, vtolState: 0 };
        fake.plane.position!.relativeAltitudeM = 0.8;
        fake.plane.position!.receivedAt = fake.now;
      }
      if (command === 176) fake.plane.heartbeat.mode = 'Land';
    });
  }
}

describe('injected loopback SITL launch transaction; never connected to physical aircraft', () => {
  it('rejects a non-SITL endpoint and stale storage/preflight proof before any command', async () => {
    const wrong = new FakeSitl();
    expect(() => new SimulatorLaunchTransaction({ ...wrong, endpoint: '/dev/cu.usbmodem11401' } as unknown as SimulatorLaunchAdapter))
      .toThrow(/disabled outside/i);
    const fake = new FakeSitl();
    const runner = new SimulatorLaunchTransaction(fake);
    const stale = gate();
    stale.proof.expiresAt = 999;
    expect(await runner.launch(stale)).toMatchObject({ state: 'rejected' });
    expect(fake.commands).toHaveLength(0);
  });

  it('cannot be instantiated in a production runtime even with a loopback-shaped adapter', () => {
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      expect(() => new SimulatorLaunchTransaction(new FakeSitl())).toThrow(/disabled outside/i);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it.each([
    ['missing', undefined],
    ['predicted position only', { receivedAt: 1000, flags: 4 | 32 | 512 }],
    ['constant-position mode', { receivedAt: 1000, flags: 4 | 16 | 32 | 128 }],
    ['uninitialized', { receivedAt: 1000, flags: 4 | 16 | 32 | 1024 }],
    ['GPS glitching', { receivedAt: 1000, flags: 4 | 16 | 32 | 32768 }],
    ['stale', { receivedAt: -3000, flags: 4 | 16 | 32 }],
  ])('rejects %s EKF status despite nominal GPS before any command', async (_, report) => {
    const fake = new FakeSitl();
    fake.plane.ekfStatus = report;
    const runner = new SimulatorLaunchTransaction(fake);
    expect(await runner.launch(gate())).toMatchObject({ state: 'rejected', issuedCommands: [] });
  });

  it('rechecks EKF after reset and refuses ARM if the position estimate degraded', async () => {
    const fake = new FakeSitl();
    fake.onCommand = (command, instance) => {
      instance.accept(command.command);
      if (command.command === 224)
        instance.schedule(other => { other.plane.ekfStatus = { receivedAt: other.now, flags: 4 | 32 | 512 }; });
    };
    const runner = new SimulatorLaunchTransaction(fake);
    expect(await runner.launch(gate())).toMatchObject({ state: 'unknown', issuedCommands: [224] });
    expect(fake.commands.map(item => item.command)).toEqual([224]);
  });

  it('requires a new healthy EKF report after ARM before it can send START', async () => {
    const fake = new FakeSitl();
    fake.onCommand = (command, instance) => {
      instance.accept(command.command);
      if (command.command === 400)
        instance.schedule(other => { other.plane.ekfStatus = { receivedAt: 1000, flags: 4 | 16 | 32 }; });
    };
    const runner = new SimulatorLaunchTransaction(fake);
    expect(await runner.launch(gate())).toMatchObject({ state: 'unknown', issuedCommands: [224, 400] });
    expect(runner.snapshot().reason).toMatch(/new healthy EKF report/i);
    expect(fake.commands.map(item => item.command)).toEqual([224, 400]);
  });

  it('refuses START if EKF degrades after ARM even when ARM ACK and heartbeat succeed', async () => {
    const fake = new FakeSitl();
    fake.onCommand = (command, instance) => {
      instance.accept(command.command);
      if (command.command === 400)
        instance.schedule(other => { other.plane.ekfStatus = { receivedAt: other.now, flags: 4 | 16 | 32 | 32768 }; });
    };
    const runner = new SimulatorLaunchTransaction(fake);
    expect(await runner.launch(gate())).toMatchObject({ state: 'unknown', issuedCommands: [224, 400] });
    expect(fake.commands.map(item => item.command)).toEqual([224, 400]);
  });

  it('correlates reset, normal ARM, and start with fresh ACK and state, then observes landing', async () => {
    const fake = new FakeSitl();
    const runner = new SimulatorLaunchTransaction(fake);
    expect(await runner.launch(gate())).toMatchObject({ state: 'active', issuedCommands: [224, 400, 300] });
    expect(fake.commands.map(item => item.params)).toEqual([
      [1, 0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0],
    ]);
    fake.now += 100;
    fake.plane.heartbeat.receivedAt = fake.now;
    fake.plane.missionCurrent = { receivedAt: fake.now, seq: 2, total: 3, state: 1, mode: 1, missionId: 0 };
    fake.plane.missionItemReached = { receivedAt: fake.now, seq: 1 };
    fake.plane.extendedState = { receivedAt: fake.now, landedState: 2, vtolState: 0 };
    fake.plane.position!.receivedAt = fake.now;
    fake.plane.position!.relativeAltitudeM = 2;
    expect(runner.observe().state).toBe('active');
    fake.now += 100;
    fake.plane.heartbeat.receivedAt = fake.now;
    fake.plane.missionCurrent = { receivedAt: fake.now, seq: 3, total: 3, state: 1, mode: 1, missionId: 0 };
    fake.plane.missionItemReached = { receivedAt: fake.now, seq: 2 };
    fake.plane.extendedState.receivedAt = fake.now;
    fake.plane.position!.receivedAt = fake.now;
    expect(runner.observe().state).toBe('active');
    fake.now += 100;
    fake.plane.heartbeat = { ...fake.plane.heartbeat, armed: false, receivedAt: fake.now };
    fake.plane.extendedState = { receivedAt: fake.now, landedState: 1, vtolState: 0 };
    fake.plane.position = { ...fake.plane.position!, receivedAt: fake.now, relativeAltitudeM: 0.05 };
    expect(runner.observe().state).toBe('landed');
    expect(fake.commands.map(item => item.command)).toEqual([224, 400, 300]);
  });

  it('ignores wrong and stale reset ACKs, and never sends ARM after ambiguity', async () => {
    const fake = new FakeSitl();
    fake.onCommand = (command, instance) => {
      instance.schedule(other => {
        other.ack(command.command, 0, { targetSystem: 17 });
        other.ack(command.command, 0, { sourceSystem: 2 });
        other.ack(command.command, 0, { receivedAt: 999 });
        other.plane.missionCurrent = { receivedAt: other.now, seq: 1, total: 3, state: 1, mode: 1, missionId: 0 };
      });
    };
    const runner = new SimulatorLaunchTransaction(fake);
    expect(await runner.launch(gate())).toMatchObject({ state: 'unknown', issuedCommands: [224] });
    expect(fake.commands).toHaveLength(1);
  });

  it('does not accept an ACK without fresh MISSION_CURRENT reset evidence', async () => {
    const fake = new FakeSitl();
    fake.plane.missionCurrent = { receivedAt: fake.now, seq: 1, total: 3, state: 1, mode: 1, missionId: 0 };
    fake.onCommand = (command, instance) => instance.schedule(other => other.ack(command.command));
    const runner = new SimulatorLaunchTransaction(fake);
    expect(await runner.launch(gate())).toMatchObject({ state: 'unknown', issuedCommands: [224] });
    expect(fake.commands).toHaveLength(1);
  });

  it('rejects a MISSION_CURRENT total that disagrees with Copter 4.7.1 HOME exclusion', async () => {
    const fake = new FakeSitl();
    fake.onCommand = (command, instance) => instance.schedule(other => {
      other.ack(command.command);
      other.plane.missionCurrent = { receivedAt: other.now, seq: 1, total: 4,
        state: 2, mode: 0, missionId: 0 };
    });
    const runner = new SimulatorLaunchTransaction(fake);
    expect(await runner.launch(gate())).toMatchObject({ state: 'unknown', issuedCommands: [224] });
    expect(fake.commands).toHaveLength(1);
  });

  it('halts on negative ARM ACK and reports recent prearm status text', async () => {
    const fake = new FakeSitl();
    fake.onCommand = (command, instance) => {
      if (command.command !== 400) return instance.accept(command.command);
      instance.schedule(other => {
        other.ack(400, 4);
        other.plane.messages.push({ receivedAt: other.now, severity: 3, text: 'PreArm: RC not found' });
      });
    };
    const runner = new SimulatorLaunchTransaction(fake);
    expect(await runner.launch(gate())).toMatchObject({ state: 'rejected', issuedCommands: [224, 400] });
    expect(runner.snapshot().reason).toMatch(/PreArm: RC not found/);
    expect(fake.commands.map(item => item.command)).toEqual([224, 400]);
  });

  it('does not retry when ARM may have succeeded but its ACK is missing', async () => {
    const fake = new FakeSitl();
    fake.onCommand = (command, instance) => {
      if (command.command !== 400) return instance.accept(command.command);
      instance.schedule(other => { other.plane.heartbeat.armed = true; });
    };
    const runner = new SimulatorLaunchTransaction(fake);
    expect(await runner.launch(gate())).toMatchObject({ state: 'unknown', issuedCommands: [224, 400] });
    expect(fake.plane.heartbeat.armed).toBe(true);
    expect(fake.commands.map(item => item.command)).toEqual([224, 400]);
  });

  it('leaves an armed aircraft unresolved after a negative START ACK, without a retry', async () => {
    const fake = new FakeSitl();
    fake.onCommand = (command, instance) => {
      if (command.command !== 300) return instance.accept(command.command);
      instance.schedule(other => other.ack(300, 4));
    };
    const runner = new SimulatorLaunchTransaction(fake);
    expect(await runner.launch(gate())).toMatchObject({ state: 'unknown', issuedCommands: [224, 400, 300] });
    expect(fake.plane.heartbeat.armed).toBe(true);
    expect(fake.plane.heartbeat.mode).toBe('Stabilize');
    expect(fake.commands.map(item => item.command)).toEqual([224, 400, 300]);
  });

  it('does not treat an accepted START ACK as takeoff without AUTO telemetry', async () => {
    const fake = new FakeSitl();
    fake.onCommand = (command, instance) => {
      if (command.command !== 300) return instance.accept(command.command);
      instance.schedule(other => other.ack(300));
    };
    const runner = new SimulatorLaunchTransaction(fake);
    expect(await runner.launch(gate())).toMatchObject({ state: 'unknown', issuedCommands: [224, 400, 300] });
    expect(fake.plane.heartbeat.armed).toBe(true);
    expect(fake.plane.heartbeat.mode).toBe('Stabilize');
  });

  it('stops on link loss during reset without sending ARM or retrying reset', async () => {
    const fake = new FakeSitl();
    fake.onCommand = (command, instance) => instance.schedule(other => {
      other.linkState = 'disconnected';
      other.ack(command.command);
    });
    const runner = new SimulatorLaunchTransaction(fake);
    expect(await runner.launch(gate())).toMatchObject({ state: 'unknown', issuedCommands: [224] });
    expect(fake.commands).toHaveLength(1);
  });

  it('treats takeover and link loss as distinct non-completion states', async () => {
    const fake = new FakeSitl();
    const runner = new SimulatorLaunchTransaction(fake);
    expect((await runner.launch(gate())).state).toBe('active');
    fake.now += 100;
    fake.plane.heartbeat = { ...fake.plane.heartbeat, receivedAt: fake.now, mode: 'Loiter' };
    expect(runner.observe().state).toBe('takeover');
    await expect(runner.land()).rejects.toThrow(/requires an active AUTO run/);
    expect(runner.snapshot().state).toBe('takeover');
    expect(fake.commands.map(item => item.command)).toEqual([224, 400, 300]);

    const second = new FakeSitl();
    const secondRunner = new SimulatorLaunchTransaction(second);
    expect((await secondRunner.launch(gate())).state).toBe('active');
    second.linkState = 'disconnected';
    expect(secondRunner.observe().state).toBe('unknown');
    second.linkGeneration++;
    second.linkState = 'listening';
    expect(secondRunner.observe().state).toBe('unknown');
  });

  it('normal Land sends mode 9, never an in-air DISARM', async () => {
    const fake = new FakeSitl();
    const runner = new SimulatorLaunchTransaction(fake);
    expect((await runner.launch(gate())).state).toBe('active');
    expect(await runner.land()).toMatchObject({ state: 'landing', issuedCommands: [224, 400, 300, 176] });
    expect(fake.commands.at(-1)?.params).toEqual([1, 9, 0, 0, 0, 0, 0]);
    fake.now += 100;
    fake.plane.heartbeat = { ...fake.plane.heartbeat, receivedAt: fake.now, armed: false };
    fake.plane.extendedState = { receivedAt: fake.now, landedState: 1, vtolState: 0 };
    fake.plane.position = { ...fake.plane.position!, receivedAt: fake.now, relativeAltitudeM: 0.01 };
    expect(runner.observe().state).toBe('landed');
    expect(fake.commands.every(item => item.command !== 400 || item.params[0] === 1)).toBe(true);
  });
});
