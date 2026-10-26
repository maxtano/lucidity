/**
 * Exercise Lucidity's AircraftService against a local ArduCopter SITL TCP port.
 * The fake USB path is only an adapter for the service's normal port gate;
 * createPort always connects to 127.0.0.1:5760. This cannot select hardware.
 * Read-only by default. --write uploads a mission to disarmed SITL storage only.
 * Neither mode arms, selects AUTO, or starts flight.
 */
import { EventEmitter } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AircraftService, type AircraftSerialPort } from '../src/aircraft/service';
import { createFirstLiveHoverStoryboard } from '../src/core/first-live-show';

if (process.argv.some(arg => arg === '--help' || arg === '-h')) {
  process.stdout.write('Lucidity service-to-SITL check on 127.0.0.1:5760 only. Read-only by default. --write requires an empty/home-only mission and stores the saved 2.0 m First live hover template in SITL only. Never arms or launches.\n');
  process.exit(0);
}
if (process.argv.some(arg => arg !== '--write' && arg.startsWith('--')))
  throw new Error('Only --write or --help is supported.');
const write = process.argv.includes('--write');
const fakeUsbPath = '/dev/cu.usbmodemSITLONLY';

class SitlTcpPort extends EventEmitter {
  isOpen = false;
  private socket: Socket | null = null;

  open(callback: (error: Error | null) => void) {
    const socket = createConnection({ host: '127.0.0.1', port: 5760 });
    this.socket = socket;
    let settled = false;
    socket.on('data', data => this.emit('data', data));
    socket.on('close', () => { this.isOpen = false; this.emit('close'); });
    socket.on('error', error => {
      if (!settled) { settled = true; callback(error); }
      this.emit('error', error);
    });
    socket.once('connect', () => {
      if (!settled) { settled = true; this.isOpen = true; callback(null); }
    });
  }

  write(buffer: Buffer, callback: (error: Error | null) => void) {
    if (!this.socket || !this.isOpen) { callback(new Error('SITL TCP socket is closed.')); return false; }
    return this.socket.write(buffer, error => callback(error ?? null));
  }

  close(callback: (error: Error | null) => void) {
    if (!this.socket || !this.isOpen) { callback(null); return; }
    this.socket.once('close', () => callback(null));
    this.socket.end();
  }
}

const backupDirectory = await mkdtemp(join(tmpdir(), 'lucidity-sitl-service-mission-'));
const service = new AircraftService({
  listPorts: async () => [{ path: fakeUsbPath }],
  createPort: () => new SitlTcpPort() as unknown as AircraftSerialPort,
  missionBackupDirectory: backupDirectory,
});
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

try {
  await service.connect(fakeUsbPath);
  let aircraft = service.snapshot().aircraft.find(item => item.systemId === 1 && item.componentId === 1);
  for (let attempt = 0; attempt < 100 && !aircraft; attempt++) {
    await sleep(100);
    aircraft = service.snapshot().aircraft.find(item => item.systemId === 1 && item.componentId === 1);
  }
  if (!aircraft || aircraft.heartbeat.armed || aircraft.heartbeat.autopilot !== 3 || aircraft.heartbeat.vehicleType !== 2)
    throw new Error('Expected one disarmed ArduCopter SITL heartbeat.');
  const telemetry = await service.requestTelemetry(aircraft.id);
  const current = telemetry.aircraft.find(item => item.id === aircraft.id)!;
  process.stdout.write(JSON.stringify({ phase: 'telemetry', state: telemetry.request?.state,
    gpsFix: current.gps?.fixType, hdop: current.gps?.hdop, hasPosition: Boolean(current.position),
    firmware: current.version?.flightVersion ?? null,
    batteryVoltageV: current.battery?.voltageV ?? null,
    receiverChannels: current.receiver?.channels.slice(0, 6) ?? null,
    landedState: current.extendedState?.landedState ?? null }) + '\n');

  const project = createFirstLiveHoverStoryboard('sitl-service-evaluation');
  const prepared = service.prepareMission(aircraft.id, project);
  if (!prepared.eligible) throw new Error(`Plan ineligible: ${prepared.reason}`);
  process.stdout.write(JSON.stringify({ phase: 'prepared', commands: prepared.plan.items.map(item => item.command),
    heightM: prepared.plan.heightM, holdSeconds: prepared.plan.holdSeconds }) + '\n');
  const before = await service.readMission(aircraft.id);
  process.stdout.write(JSON.stringify({ phase: 'initial-readback', count: before.count, commands: before.items.map(item => item.command) }) + '\n');
  if (write) {
    if (before.count > 1) throw new Error('SITL mission is not empty or home-only; refusing overwrite.');
    const status = await service.uploadMission(aircraft.id, prepared.plan.planId, project,
      { propsRemoved: true, confirmed: true });
    process.stdout.write(JSON.stringify({ phase: 'service-upload', state: status.state,
      count: status.missionCount, backupPath: status.backupPath }) + '\n');
    const after = await service.readMission(aircraft.id);
    process.stdout.write(JSON.stringify({ phase: 'post-upload-readback', count: after.count,
      commands: after.items.map(item => item.command) }) + '\n');
    const verification = await service.verifyMissionForLaunch(aircraft.id, prepared.plan.planId, project);
    process.stdout.write(JSON.stringify({ phase: 'prelaunch-storage-check',
      missionCount: verification.missionCount, revision: verification.revision,
      connectionGeneration: verification.connectionGeneration,
      message: verification.message }) + '\n');
  }
} finally {
  await service.dispose();
}
