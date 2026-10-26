import { EventEmitter } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MavLinkProtocolV2, common, minimal } from 'node-mavlink';
import { createFirstLiveHoverStoryboard } from '../core/first-live-show';
import { AircraftService, type AircraftSerialPort } from './service';

const usbPath = '/dev/cu.usbmodemREADINESS';
const sender = new MavLinkProtocolV2(1, 1);
let replySequence = 0;
type Reply = InstanceType<typeof minimal.Heartbeat> | InstanceType<typeof common.GpsRawInt> |
  InstanceType<typeof common.GlobalPositionInt> | InstanceType<typeof common.MissionCount> |
  InstanceType<typeof common.MissionItemInt> | InstanceType<typeof common.MissionRequest> |
  InstanceType<typeof common.MissionAck>;

class ReadinessPort extends EventEmitter {
  isOpen = false;
  writes: Buffer[] = [];
  stored = new Map<number, InstanceType<typeof common.MissionItemInt>>();
  pendingCount = 0;

  constructor() {
    super();
    const home = new common.MissionItemInt();
    home.targetSystem = 254; home.targetComponent = 190; home.missionType = 0;
    home.seq = 0; home.frame = 0; home.command = 16;
    home.current = 1; home.autocontinue = 1;
    home.x = 473977420; home.y = 85455940; home.z = 488.1;
    home.param1 = home.param2 = home.param3 = home.param4 = 0;
    this.stored.set(0, home);
  }

  private emitReply(message: Reply) { this.emit('data', sender.serialize(message, replySequence++ % 256)); }
  open(callback: (error: Error | null) => void) { this.isOpen = true; callback(null); }
  close(callback: (error: Error | null) => void) { this.isOpen = false; this.emit('close'); callback(null); }
  write(buffer: Buffer, callback: (error: Error | null) => void) {
    this.writes.push(buffer);
    callback(null);
    const protocol = new MavLinkProtocolV2();
    const { msgid } = protocol.header(buffer);
    if (msgid === common.MissionRequestList.MSG_ID) {
      const count = new common.MissionCount();
      count.targetSystem = 254; count.targetComponent = 190;
      count.missionType = 0; count.count = this.stored.size;
      this.emitReply(count);
    } else if (msgid === common.MissionRequestInt.MSG_ID) {
      const request = protocol.data(protocol.payload(buffer), common.MissionRequestInt);
      const stored = this.stored.get(request.seq);
      if (stored) {
        const item = new common.MissionItemInt();
        Object.assign(item, stored);
        item.targetSystem = 254; item.targetComponent = 190;
        this.emitReply(item);
      }
    } else if (msgid === common.MissionCount.MSG_ID) {
      const count = protocol.data(protocol.payload(buffer), common.MissionCount);
      this.pendingCount = count.count;
      this.stored.clear();
      const request = new common.MissionRequest();
      request.targetSystem = 254; request.targetComponent = 190; request.missionType = 0; request.seq = 0;
      this.emitReply(request);
    } else if (msgid === common.MissionItemInt.MSG_ID) {
      const item = protocol.data(protocol.payload(buffer), common.MissionItemInt);
      this.stored.set(item.seq, item);
      if (this.stored.size < this.pendingCount) {
        const request = new common.MissionRequest();
        request.targetSystem = 254; request.targetComponent = 190;
        request.missionType = 0; request.seq = this.stored.size;
        this.emitReply(request);
      } else {
        const ack = new common.MissionAck();
        ack.targetSystem = 254; ack.targetComponent = 190; ack.missionType = 0; ack.type = 0;
        this.emitReply(ack);
      }
    }
    return true;
  }

  heartbeat(armed = false) {
    const message = new minimal.Heartbeat();
    message.type = 2; message.autopilot = 3;
    message.baseMode = (armed ? 0x81 : 1) as typeof message.baseMode;
    message.customMode = 0; message.systemStatus = 3; message.mavlinkVersion = 3;
    this.emitReply(message);
  }
  gpsAndPosition() {
    const gps = new common.GpsRawInt();
    gps.fixType = 6; gps.lat = 473977420; gps.lon = 85455940;
    gps.eph = 121; gps.satellitesVisible = 12;
    this.emitReply(gps);
    const position = new common.GlobalPositionInt();
    position.lat = 473977420; position.lon = 85455940;
    position.alt = 488100; position.relativeAlt = 0;
    this.emitReply(position);
  }
  writeIdsSince(index: number) {
    return this.writes.slice(index).map(buffer => new MavLinkProtocolV2().header(buffer).msgid);
  }
}

const services: AircraftService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.dispose()));
});

async function fixture() {
  let clock = 1_000_000;
  const port = new ReadinessPort();
  const service = new AircraftService({
    listPorts: async () => [{ path: usbPath }],
    createPort: () => port as unknown as AircraftSerialPort,
    now: () => clock,
    missionBackupDirectory: await mkdtemp(join(tmpdir(), 'lucidity-readiness-eval-')),
  });
  services.push(service);
  await service.connect(usbPath);
  port.heartbeat(); port.gpsAndPosition();
  const aircraftId = service.snapshot().aircraft[0].id;
  const storyboard = createFirstLiveHoverStoryboard('readiness-eval');
  const review = service.prepareMission(aircraftId, storyboard);
  if (!review.eligible) throw new Error(review.reason);
  await service.uploadMission(aircraftId, review.plan.planId, storyboard,
    { propsRemoved: true, confirmed: true });
  return { service, port, aircraftId, storyboard, planId: review.plan.planId,
    advance: (ms: number) => { clock += ms; } };
}

describe('read-only mission prelaunch verification', () => {
  it('freshly downloads four matching items and produces a generation/revision-bound proof without control writes', async () => {
    const f = await fixture();
    const before = f.port.writes.length;
    const proof = await f.service.verifyMissionForLaunch(f.aircraftId, f.planId, f.storyboard);
    expect(proof).toMatchObject({ aircraftId: f.aircraftId, storyboardId: f.storyboard.id,
      revision: f.storyboard.revision, missionCount: 4, heightM: 2, holdSeconds: 5 });
    expect(f.service.currentMissionVerification(proof.verificationId, f.aircraftId, f.storyboard)).toEqual(proof);
    expect(f.port.writeIdsSince(before)).toEqual([
      common.MissionRequestList.MSG_ID,
      common.MissionRequestInt.MSG_ID, common.MissionRequestInt.MSG_ID,
      common.MissionRequestInt.MSG_ID, common.MissionRequestInt.MSG_ID,
      common.MissionAck.MSG_ID,
    ]);
  });

  it('fails closed when another controller replaces a stored item or seq-0 home', async () => {
    const f = await fixture();
    f.port.stored.get(2)!.param1 = 9;
    await expect(f.service.verifyMissionForLaunch(f.aircraftId, f.planId, f.storyboard))
      .rejects.toThrow(/differs/i);
    expect(f.service.snapshot().mission?.state).toBe('failed');
    f.port.stored.get(2)!.param1 = 5;
    f.port.stored.get(0)!.command = 21;
    await expect(f.service.verifyMissionForLaunch(f.aircraftId, f.planId, f.storyboard))
      .rejects.toThrow(/home waypoint/i);
  });

  it('rejects a changed storyboard revision before sending a mission request', async () => {
    const f = await fixture();
    const before = f.port.writes.length;
    const edited = structuredClone(f.storyboard);
    edited.revision++;
    await expect(f.service.verifyMissionForLaunch(f.aircraftId, f.planId, edited))
      .rejects.toThrow(/changed/i);
    expect(f.port.writes).toHaveLength(before);
  });

  it('rejects stale heartbeat or GPS/position before readback', async () => {
    const f = await fixture();
    f.advance(10_000);
    const before = f.port.writes.length;
    await expect(f.service.verifyMissionForLaunch(f.aircraftId, f.planId, f.storyboard))
      .rejects.toThrow(/fresh aircraft heartbeat/i);
    f.port.heartbeat();
    await expect(f.service.verifyMissionForLaunch(f.aircraftId, f.planId, f.storyboard))
      .rejects.toThrow(/fresh 3D GPS/i);
    expect(f.port.writes).toHaveLength(before);
  });

  it('rejects an armed aircraft before any read-only mission request', async () => {
    const f = await fixture();
    f.port.heartbeat(true);
    const before = f.port.writes.length;
    await expect(f.service.verifyMissionForLaunch(f.aircraftId, f.planId, f.storyboard))
      .rejects.toThrow(/disarmed/i);
    expect(f.port.writes).toHaveLength(before);
  });

  it('invalidates an issued proof after a revision change, stale telemetry, or its short deadline', async () => {
    const f = await fixture();
    const proof = await f.service.verifyMissionForLaunch(f.aircraftId, f.planId, f.storyboard);
    const edited = structuredClone(f.storyboard);
    edited.revision++;
    expect(() => f.service.currentMissionVerification(proof.verificationId, f.aircraftId, edited))
      .toThrow(/changed/i);
    f.advance(10_000);
    expect(() => f.service.currentMissionVerification(proof.verificationId, f.aircraftId, f.storyboard))
      .toThrow(/fresh aircraft heartbeat/i);
    f.port.heartbeat(); f.port.gpsAndPosition();
    f.advance(5_001);
    f.port.heartbeat(); f.port.gpsAndPosition();
    expect(() => f.service.currentMissionVerification(proof.verificationId, f.aircraftId, f.storyboard))
      .toThrow(/stale/i);
  });

  it('invalidates the old review/proof on reconnect, then accepts a fresh review and readback', async () => {
    const f = await fixture();
    const proof = await f.service.verifyMissionForLaunch(f.aircraftId, f.planId, f.storyboard);
    await f.service.disconnect();
    await f.service.connect(usbPath);
    f.port.heartbeat(); f.port.gpsAndPosition();
    const nextId = f.service.snapshot().aircraft[0].id;
    await expect(f.service.verifyMissionForLaunch(nextId, f.planId, f.storyboard))
      .rejects.toThrow(/earlier connection/i);
    expect(() => f.service.currentMissionVerification(proof.verificationId, nextId, f.storyboard))
      .toThrow(/stale/i);
    const next = f.service.prepareMission(nextId, f.storyboard);
    if (!next.eligible) throw new Error(next.reason);
    const verified = await f.service.verifyMissionForLaunch(nextId, next.plan.planId, f.storyboard);
    expect(verified.connectionGeneration).toBeGreaterThan(proof.connectionGeneration);
  });

  it('marks earlier verification stale if a later raw readback finds replacement', async () => {
    const f = await fixture();
    const proof = await f.service.verifyMissionForLaunch(f.aircraftId, f.planId, f.storyboard);
    f.port.stored.get(3)!.command = 22;
    await f.service.readMission(f.aircraftId);
    expect(f.service.snapshot().mission?.state).toBe('failed');
    expect(() => f.service.currentMissionVerification(proof.verificationId, f.aircraftId, f.storyboard))
      .toThrow(/stale/i);
  });
});
