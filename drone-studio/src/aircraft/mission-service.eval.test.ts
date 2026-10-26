import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MavLinkProtocolV2, ardupilotmega, common, minimal, standard } from 'node-mavlink';
import { createOneFootHoverStoryboard } from '../components/first-flight-preview';
import type { Project } from '../core/model';
import { AircraftService, type AircraftPortOptions, type AircraftSerialPort } from './service';

const path = '/dev/cu.usbmodemMISSIONTEST';
const reply = new MavLinkProtocolV2(1, 1);
let replySequence = 0;
const packet = (message: InstanceType<typeof minimal.Heartbeat> | InstanceType<typeof common.GpsRawInt> | InstanceType<typeof common.GlobalPositionInt> | InstanceType<typeof common.MissionCount> | InstanceType<typeof common.MissionItemInt> | InstanceType<typeof common.MissionRequest> | InstanceType<typeof common.MissionAck> | InstanceType<typeof common.CommandAck> | InstanceType<typeof common.ParamValue> | InstanceType<typeof common.ExtendedSysState> | InstanceType<typeof common.SysStatus> | InstanceType<typeof common.RcChannels> | InstanceType<typeof ardupilotmega.EkfStatusReport> | InstanceType<typeof standard.AutopilotVersion>) =>
  reply.serialize(message, replySequence++ % 256);

function storyboard(): Project {
  const project = createOneFootHoverStoryboard('mission-service-eval');
  project.revision = 1;
  project.limits.maxAltitude = 3;
  project.cues[0].duration = 11;
  project.cues[0].droneEdits!['1'].keyframes = [
    { time: 0, position: [0, 0, 0] },
    { time: 3, position: [0, 0, 2.5] },
    { time: 8, position: [0, 0, 2.5] },
    { time: 11, position: [0, 0, 0] },
  ];
  return project;
}

class MissionPort extends EventEmitter {
  isOpen = false;
  /** A normal GCS mission occupying the aircraft is the default; upload must refuse it. */
  existingCount = 2;
  expectedUploadCount = 0;
  uploaded = new Map<number, InstanceType<typeof common.MissionItemInt>>();
  corruptReadback = false;
  badHome = false;
  writes: Buffer[] = [];
  open(callback: (error: Error | null) => void) { this.isOpen = true; callback(null); }
  close(callback: (error: Error | null) => void) { this.isOpen = false; this.emit('close'); callback(null); }
  write(buffer: Buffer, callback: (error: Error | null) => void) {
    this.writes.push(buffer);
    callback(null);
    const protocol = new MavLinkProtocolV2();
    const { msgid } = protocol.header(buffer);
    if (msgid === common.MissionRequestList.MSG_ID) {
      const message = new common.MissionCount();
      message.targetSystem = 254; message.targetComponent = 190;
      message.missionType = 0; message.count = this.existingCount;
      this.emit('data', packet(message));
    }
    if (msgid === common.MissionRequestInt.MSG_ID) {
      const request = protocol.data(protocol.payload(buffer), common.MissionRequestInt);
      const message = new common.MissionItemInt();
      message.targetSystem = 254; message.targetComponent = 190;
      if (this.uploaded.size === this.expectedUploadCount && this.expectedUploadCount > 0) {
        const uploaded = this.uploaded.get(request.seq)!;
        Object.assign(message, uploaded);
        message.targetSystem = 254; message.targetComponent = 190;
        if (this.corruptReadback && request.seq === 2) message.param1 += 1;
      } else {
        message.missionType = 0; message.seq = request.seq;
        message.frame = 6; message.command = request.seq === 0 ? (this.badHome ? 21 : 16) : 22;
        message.current = request.seq === 0 ? 1 : 0; message.autocontinue = 1;
        message.param1 = message.param2 = message.param3 = message.param4 = 0;
        message.x = message.y = 0; message.z = request.seq === 0 ? 0 : 2.5;
      }
      this.emit('data', packet(message));
    }
    if (msgid === common.MissionCount.MSG_ID) {
      const count = protocol.data(protocol.payload(buffer), common.MissionCount);
      this.expectedUploadCount = count.count;
      this.uploaded.clear();
      const message = new common.MissionRequest();
      message.targetSystem = 254; message.targetComponent = 190; message.missionType = 0; message.seq = 0;
      this.emit('data', packet(message));
    }
    if (msgid === common.MissionItemInt.MSG_ID) {
      const incoming = protocol.data(protocol.payload(buffer), common.MissionItemInt);
      this.uploaded.set(incoming.seq, incoming);
      if (this.uploaded.size < this.expectedUploadCount) {
        const message = new common.MissionRequest();
        message.targetSystem = 254; message.targetComponent = 190;
        message.missionType = 0; message.seq = this.uploaded.size;
        this.emit('data', packet(message));
      } else {
        this.existingCount = this.expectedUploadCount;
        const message = new common.MissionAck();
        message.targetSystem = 254; message.targetComponent = 190; message.missionType = 0; message.type = 0;
        this.emit('data', packet(message));
      }
    }
    if (msgid === common.CommandLong.MSG_ID) {
      const command = protocol.data(protocol.payload(buffer), common.CommandLong);
      if (command.command === 401) {
        const ack = new common.CommandAck();
        ack.command = 401; ack.result = 0; ack.targetSystem = 254; ack.targetComponent = 190;
        this.emit('data', packet(ack));
      }
    }
    return true;
  }
  heartbeat() {
    const message = new minimal.Heartbeat();
    message.type = 2; message.autopilot = 3; message.baseMode = 1 as typeof message.baseMode;
    message.customMode = 0; message.systemStatus = 3; message.mavlinkVersion = 3;
    this.emit('data', packet(message));
  }
  gpsAndPosition() {
    const gps = new common.GpsRawInt();
    gps.fixType = 6; gps.lat = 473977420; gps.lon = 85455940;
    gps.eph = 121; gps.satellitesVisible = 12;
    this.emit('data', packet(gps));
    const position = new common.GlobalPositionInt();
    position.lat = 473977420; position.lon = 85455940;
    position.alt = 488100; position.relativeAlt = 100;
    this.emit('data', packet(position));
  }
  parameter(name: string, value: number) {
    const parameter = new common.ParamValue();
    parameter.paramId = name; parameter.paramValue = value; parameter.paramType = 9;
    parameter.paramCount = 28; parameter.paramIndex = 0;
    this.emit('data', packet(parameter));
  }
  flightTelemetry(uid = 0n) {
    this.heartbeat();
    this.gpsAndPosition();
    const landed = new common.ExtendedSysState(); landed.landedState = 1;
    this.emit('data', packet(landed));
    const ekf = new ardupilotmega.EkfStatusReport(); ekf.flags = 4 | 16 | 32;
    this.emit('data', packet(ekf));
    const battery = new common.SysStatus(); battery.voltageBattery = 16300; battery.batteryRemaining = 86;
    this.emit('data', packet(battery));
    const rc = new common.RcChannels();
    rc.chancount = 6; rc.chan1Raw = 1500; rc.chan2Raw = 1500; rc.chan3Raw = 1000;
    rc.chan4Raw = 1500; rc.chan5Raw = 1100; rc.chan6Raw = 1000;
    this.emit('data', packet(rc));
    const version = Object.assign(new standard.AutopilotVersion(), {
      capabilities: 0n, flightSwVersion: 0x040701ff, uid,
    });
    this.emit('data', packet(version));
  }
}

async function fixture(flightJournalPath?: string) {
  const port = new MissionPort();
  const missionBackupDirectory = await mkdtemp(join(tmpdir(), 'lucidity-mission-eval-'));
  const service = new AircraftService({
    listPorts: async () => [{ path }],
    createPort: (_options: AircraftPortOptions) => port as unknown as AircraftSerialPort,
    missionBackupDirectory,
    flightJournalPath,
  });
  await service.connect(path);
  port.heartbeat();
  const aircraftId = service.snapshot().aircraft[0].id;
  return { service, port, aircraftId, project: storyboard(), missionBackupDirectory };
}

async function verifiedHoverFixture(flightJournalPath?: string) {
  const f = await fixture(flightJournalPath);
  f.port.existingCount = 0;
  f.port.gpsAndPosition();
  const prepared = f.service.prepareMission(f.aircraftId, f.project);
  if (!prepared.eligible) throw new Error(prepared.reason);
  await f.service.uploadMission(f.aircraftId, prepared.plan.planId, f.project,
    { propsRemoved: true, confirmed: true });
  return { ...f, planId: prepared.plan.planId };
}

afterEach(() => vi.useRealTimers());

const flightParameters: Record<string, number> = {
  ARMING_SKIPCHK: 0, FRAME_CLASS: 1, AUTO_OPTIONS: 0,
  FS_THR_ENABLE: 3, FS_THR_VALUE: 975, RC_FS_TIMEOUT: 1,
  FS_GCS_ENABLE: 0, FS_OPTIONS: 0, FS_EKF_ACTION: 1,
  BATT_MONITOR: 4, BATT_CAPACITY: 650, BATT_LOW_VOLT: 14,
  BATT_LOW_TIMER: 10, BATT_FS_LOW_ACT: 1,
  RC6_OPTION: 31, DISARM_DELAY: 10, FENCE_ENABLE: 0, MAV_OPTIONS: 0,
  FLTMODE_CH: 5, FLTMODE1: 0, FLTMODE2: 0, FLTMODE3: 2,
  FLTMODE4: 2, FLTMODE5: 5, FLTMODE6: 5, RC3_MIN: 1000,
};

describe('physical launch field check with injected USB packets', () => {
  async function launchFixture(overrides: Record<string, number> = {}, flightJournalPath?: string) {
    const f = await verifiedHoverFixture(flightJournalPath);
    const values = { ...flightParameters, ...overrides };
    // All parameter values and flight telemetry enter the real decoder through
    // the fake USB port. Only the request timing is shortened for this eval.
    vi.spyOn(f.service, 'readParameters').mockImplementation(async (_id, names) => {
      for (const name of names ?? []) f.port.parameter(name, values[name]);
      return f.service.parameters(f.aircraftId);
    });
    vi.spyOn(f.service, 'requestTelemetry').mockImplementation(async () => {
      f.port.flightTelemetry();
      return {
        ...f.service.snapshot(),
        request: { state: 'verified', aircraftId: f.aircraftId, startedAt: Date.now(), message: 'Mock reporting streams verified.' },
      };
    });
    f.port.flightTelemetry();
    return f;
  }

  it('issues a short-lived proof only for complete decoded Copter, RC, GPS, EKF, battery and mission evidence', async () => {
    const f = await launchFixture();
    const checked = await f.service.checkMissionLaunch(f.aircraftId, f.planId, f.project);
    expect(checked).toMatchObject({ ready: true, verificationId: expect.any(String) });
    expect(checked.message).toMatch(/operator confirmations.*GCS-link loss is not verified/i);
    expect(f.service.currentMissionVerification(checked.verificationId, f.aircraftId, f.project).missionCount).toBe(4);
    const commands = f.port.writes
      .filter(buffer => new MavLinkProtocolV2().header(buffer).msgid === common.CommandLong.MSG_ID)
      .map(buffer => new MavLinkProtocolV2().data(new MavLinkProtocolV2().payload(buffer), common.CommandLong).command);
    expect(commands).toContain(401);
    expect(commands).not.toContain(400);
    expect(commands).not.toContain(300);
    await f.service.dispose();
  });

  it.each([
    [{ BATT_LOW_TIMER: 0 }, /BATT_LOW_TIMER=0 disables/i],
    [{ FS_THR_ENABLE: 1 }, /RC-loss/i],
    [{ ARMING_SKIPCHK: 1 }, /Arming checks/i],
  ])('refuses mismatched field parameters before the prearm command or proof (%j)', async (overrides, reason) => {
    const f = await launchFixture(overrides);
    const before = f.port.writes.length;
    await expect(f.service.checkMissionLaunch(f.aircraftId, f.planId, f.project)).rejects.toThrow(reason);
    expect(f.port.writes.slice(before)).toHaveLength(0);
    expect(f.service.flightRunStatus().state).toBe('idle');
    await f.service.dispose();
  });

  it('treats an interrupted on-disk flight journal as unknown and sends no new aircraft requests', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucidity-flight-restart-eval-'));
    const flightJournalPath = join(directory, 'active.json');
    await writeFile(flightJournalPath, JSON.stringify({ runId: 'interrupted' }));
    const port = new MissionPort();
    const service = new AircraftService({
      listPorts: async () => [{ path }],
      createPort: (_options: AircraftPortOptions) => port as unknown as AircraftSerialPort,
      flightJournalPath,
    });
    try {
      await service.connect(path);
      port.heartbeat();
      const aircraftId = service.snapshot().aircraft[0].id;
      expect(service.flightRunStatus().state).toBe('unknown');
      expect(() => service.prepareMission(aircraftId, storyboard())).toThrow(/current aircraft operation/i);
      await expect(service.requestTelemetry(aircraftId)).rejects.toThrow(/physical mission run/i);
      expect(port.writes).toHaveLength(0);
    } finally {
      await service.dispose();
      await unlink(flightJournalPath);
    }
  });

  it('requires the interrupted run’s stable FC UID before explicit props-off recovery', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucidity-flight-uid-eval-'));
    const flightJournalPath = join(directory, 'active.json');
    await writeFile(flightJournalPath, JSON.stringify({
      aircraftId: 'old-link:1:1', runId: 'interrupted', startedAt: Date.now(),
      systemId: 1, componentId: 1, uid: 'uid:123', state: 'outcome-unknown-until-landed',
    }));
    const port = new MissionPort();
    const service = new AircraftService({
      listPorts: async () => [{ path }],
      createPort: (_options: AircraftPortOptions) => port as unknown as AircraftSerialPort,
      flightJournalPath,
    });
    try {
      await service.connect(path);
      port.flightTelemetry(456n);
      const aircraftId = service.snapshot().aircraft[0].id;
      await expect(service.reconcileMissionRun(aircraftId, { propsRemoved: true, confirmed: true }))
        .rejects.toThrow(/UID does not match/i);
      expect(service.flightRunStatus().state).toBe('unknown');
      port.flightTelemetry(123n);
      expect(await service.reconcileMissionRun(aircraftId, { propsRemoved: true, confirmed: true }))
        .toMatchObject({ recovered: true, message: expect.stringMatching(/matching flight-controller UID/i) });
      expect(service.flightRunStatus().state).toBe('idle');
      expect(port.writes).toHaveLength(0);
    } finally {
      await service.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('surfaces unknown immediately when adapter construction fails after the journal is durable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucidity-flight-construction-eval-'));
    const flightJournalPath = join(directory, 'active.json');
    const f = await launchFixture({}, flightJournalPath);
    try {
      const checked = await f.service.checkMissionLaunch(f.aircraftId, f.planId, f.project);
      f.port.flightTelemetry();
      const internal = f.service as unknown as { physicalLaunchAdapter: () => unknown };
      vi.spyOn(internal, 'physicalLaunchAdapter').mockImplementation(() => {
        throw new Error('injected adapter failure');
      });
      await expect(f.service.launchMission(f.aircraftId, f.project, checked.verificationId,
        { propsInstalled: true, areaClear: true, pilotReady: true, modeSwitchReady: true }))
        .rejects.toThrow(/injected adapter failure/);
      expect(existsSync(flightJournalPath)).toBe(true);
      expect(f.service.flightRunStatus()).toMatchObject({ state: 'unknown', aircraftId: null });
      expect(() => f.service.prepareMission(f.aircraftId, f.project)).toThrow(/current aircraft operation/i);
      const commands = f.port.writes
        .filter(buffer => new MavLinkProtocolV2().header(buffer).msgid === common.CommandLong.MSG_ID)
        .map(buffer => new MavLinkProtocolV2().data(new MavLinkProtocolV2().payload(buffer), common.CommandLong).command);
      expect(commands).not.toContain(224);
      expect(commands).not.toContain(400);
      expect(commands).not.toContain(300);
    } finally {
      await f.service.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('mission service mock transport gates', () => {
  it('accepts a fresh source-bound HOME near the aircraft in disarmed readback', async () => {
    const { service, port, aircraftId, project, planId } = await verifiedHoverFixture();
    const before = port.writes.length;
    const proof = await service.verifyMissionForLaunch(aircraftId, planId, project);
    expect(proof.message).toMatch(/HOME is within 10 m.*no flight is authorized/i);
    expect(proof.missionCount).toBe(4);
    expect(port.writes.slice(before).map(buffer => new MavLinkProtocolV2().header(buffer).msgid))
      .toEqual([common.MissionRequestList.MSG_ID, ...Array(4).fill(common.MissionRequestInt.MSG_ID),
        common.MissionAck.MSG_ID]);
    await service.dispose();
  });

  it('rejects a zero HOME location even though the other mission items match', async () => {
    const { service, port, aircraftId, project, planId } = await verifiedHoverFixture();
    const home = port.uploaded.get(0)!;
    home.x = 0; home.y = 0;
    const before = port.writes.length;
    await expect(service.verifyMissionForLaunch(aircraftId, planId, project))
      .rejects.toThrow(/HOME is unset or more than 10 m/i);
    expect(service.snapshot().mission?.state).toBe('failed');
    expect(port.writes.slice(before).map(buffer => new MavLinkProtocolV2().header(buffer).msgid))
      .not.toContain(common.CommandLong.MSG_ID);
    await service.dispose();
  });

  it('rejects a HOME over 10 m away but allows ordinary small GPS displacement', async () => {
    const { service, port, aircraftId, project, planId } = await verifiedHoverFixture();
    const home = port.uploaded.get(0)!;
    home.x += 400; // about 4.4 m latitude separation at this test location
    const near = await service.verifyMissionForLaunch(aircraftId, planId, project);
    expect(near.missionCount).toBe(4);
    home.x += 2100; // now about 27.8 m away from the current global position
    await expect(service.verifyMissionForLaunch(aircraftId, planId, project))
      .rejects.toThrow(/HOME is unset or more than 10 m/i);
    expect(service.snapshot().mission?.state).toBe('failed');
    await service.dispose();
  });

  it('backs up and uploads from a count-zero mission only with fresh GPS and position', async () => {
    const { service, port, aircraftId, project } = await fixture();
    port.existingCount = 0;
    port.gpsAndPosition();
    const prepared = service.prepareMission(aircraftId, project);
    expect(prepared.eligible).toBe(true);
    if (!prepared.eligible) return;
    const result = await service.uploadMission(aircraftId, prepared.plan.planId, project,
      { propsRemoved: true, confirmed: true });
    expect(result).toMatchObject({ state: 'verified', missionCount: 4 });
    const backup = JSON.parse(await readFile(result.backupPath!, 'utf8'));
    expect(backup.items).toEqual([]);
    const readback = await service.readMission(aircraftId);
    expect(readback.items.map(item => item.command)).toEqual([16, 22, 19, 21]);
    expect(readback.items[0]).toMatchObject({ x: 473977420, y: 85455940 });
    expect(readback.items[0].z).toBeCloseTo(488.1, 2);
    await service.dispose();
  });

  it('refuses an empty mission without fresh GPS before sending COUNT', async () => {
    const { service, port, aircraftId, project } = await fixture();
    port.existingCount = 0;
    const prepared = service.prepareMission(aircraftId, project);
    expect(prepared.eligible).toBe(true);
    if (!prepared.eligible) return;
    await expect(service.uploadMission(aircraftId, prepared.plan.planId, project,
      { propsRemoved: true, confirmed: true })).rejects.toThrow(/fresh 3D GPS/i);
    expect(port.writes.map(buffer => new MavLinkProtocolV2().header(buffer).msgid))
      .not.toContain(common.MissionCount.MSG_ID);
    await service.dispose();
  });

  it('rejects a count-one entry that is not a home waypoint before sending COUNT', async () => {
    const { service, port, aircraftId, project } = await fixture();
    port.existingCount = 1;
    port.badHome = true;
    const prepared = service.prepareMission(aircraftId, project);
    expect(prepared.eligible).toBe(true);
    if (!prepared.eligible) return;
    await expect(service.uploadMission(aircraftId, prepared.plan.planId, project,
      { propsRemoved: true, confirmed: true })).rejects.toThrow(/home waypoint/i);
    expect(port.writes.map(buffer => new MavLinkProtocolV2().header(buffer).msgid))
      .not.toContain(common.MissionCount.MSG_ID);
    await service.dispose();
  });

  it('backs up home-only state, uploads, and verifies all four items by fresh readback', async () => {
    const { service, port, aircraftId, project } = await fixture();
    port.existingCount = 1;
    const prepared = service.prepareMission(aircraftId, project);
    expect(prepared.eligible).toBe(true);
    if (!prepared.eligible) return;
    const result = await service.uploadMission(aircraftId, prepared.plan.planId, project, { propsRemoved: true, confirmed: true });
    expect(result).toMatchObject({ state: 'verified', missionCount: 4 });
    expect(result.backupPath).toBeTruthy();
    const backup = JSON.parse(await readFile(result.backupPath!, 'utf8'));
    expect(backup.items).toHaveLength(1);
    expect(backup.items[0].seq).toBe(0);
    const readback = await service.readMission(aircraftId);
    expect(readback.items.map(item => item.command)).toEqual([16, 22, 19, 21]);
    expect(port.writes.map(buffer => new MavLinkProtocolV2().header(buffer).msgid))
      .not.toContain(common.CommandLong.MSG_ID);
    await service.dispose();
  });

  it('marks a materially different post-upload readback unknown and blocks blind retry', async () => {
    const { service, port, aircraftId, project } = await fixture();
    port.existingCount = 1;
    port.corruptReadback = true;
    const prepared = service.prepareMission(aircraftId, project);
    expect(prepared.eligible).toBe(true);
    if (!prepared.eligible) return;
    await expect(service.uploadMission(aircraftId, prepared.plan.planId, project, { propsRemoved: true, confirmed: true }))
      .rejects.toThrow(/unverified|partial|inspect/i);
    expect(service.snapshot().mission?.state).toBe('unknown');
    await expect(service.uploadMission(aircraftId, prepared.plan.planId, project, { propsRemoved: true, confirmed: true }))
      .rejects.toThrow(/recovery|read.?back|unknown|inspect/i);
    const readback = await service.readMission(aircraftId);
    expect(readback.count).toBe(4);
    expect(readback.items[2].param1).toBe(6);
    await service.dispose();
  });

  it('refuses to overwrite an existing mission without sending COUNT or ITEM_INT', async () => {
    const { service, port, aircraftId, project } = await fixture();
    const prepared = service.prepareMission(aircraftId, project);
    expect(prepared.eligible).toBe(true);
    if (!prepared.eligible) return;
    await expect(service.uploadMission(aircraftId, prepared.plan.planId, project, { propsRemoved: true, confirmed: true }))
      .rejects.toThrow(/existing mission|will not overwrite/i);
    expect(port.writes.map(buffer => new MavLinkProtocolV2().header(buffer).msgid))
      .not.toContain(common.MissionCount.MSG_ID);
    expect(service.snapshot().mission?.state).toBe('failed');
    await service.dispose();
  });

  it('rejects a storyboard edit after review before any mission exchange', async () => {
    const { service, port, aircraftId, project } = await fixture();
    const prepared = service.prepareMission(aircraftId, project);
    expect(prepared.eligible).toBe(true);
    if (!prepared.eligible) return;
    const changed = structuredClone(project);
    changed.revision++;
    changed.cues[0].droneEdits!['1'].keyframes![1].position![2] = 3;
    changed.cues[0].droneEdits!['1'].keyframes![2].position![2] = 3;
    await expect(service.uploadMission(aircraftId, prepared.plan.planId, changed, { propsRemoved: true, confirmed: true }))
      .rejects.toThrow(/stale|re-plan|changed/i);
    expect(port.writes).toHaveLength(0);
    await service.dispose();
  });

  it('invalidates a prepared plan across USB disconnect and reconnect', async () => {
    const { service, port, aircraftId, project } = await fixture();
    const prepared = service.prepareMission(aircraftId, project);
    expect(prepared.eligible).toBe(true);
    if (!prepared.eligible) return;
    await service.disconnect();
    expect(port.isOpen).toBe(false);
    await service.connect(path);
    port.heartbeat();
    const newId = service.snapshot().aircraft[0].id;
    await expect(service.uploadMission(newId, prepared.plan.planId, project, { propsRemoved: true, confirmed: true }))
      .rejects.toThrow(/stale|re-plan/i);
    expect(port.writes).toHaveLength(0);
    await service.dispose();
  });
});
