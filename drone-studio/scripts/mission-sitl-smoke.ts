/**
 * Copter SITL-only mission wire smoke check. Never connects to USB, arms,
 * changes mode, or starts a mission. --write is required to alter SITL storage.
 * Run with: node --import tsx scripts/mission-sitl-smoke.ts --write
 */
import { createConnection } from 'node:net';
import { AircraftDecoder } from '../src/aircraft/decoder';
import { compareMissionReadback, MissionProtocol, type MissionIo, type MissionItem } from '../src/aircraft/mission-protocol';
import { missionFrame } from '../src/aircraft/mission-wire';
import { GROUND_COMPONENT_ID, GROUND_SYSTEM_ID, telemetryRequestFrames } from '../src/aircraft/read-requests';
import { compileHoverMission } from '../src/aircraft/mission-plan';
import { createOneFootHoverStoryboard } from '../src/components/first-flight-preview';

if (process.argv.some(arg => arg === '--help' || arg === '-h')) {
  process.stdout.write('Connects only to ArduCopter SITL on 127.0.0.1:5760. Read-only by default; --clear-sitl empties only the simulator mission; --write accepts only an empty or home-only mission, uploads a 2.5 m hover plan, and verifies readback. Never arms or starts AUTO.\n');
  process.exit(0);
}
if (process.argv.some(arg => arg !== '--write' && arg !== '--clear-sitl' && arg.startsWith('--')) ||
    (process.argv.includes('--write') && process.argv.includes('--clear-sitl')))
  throw new Error('Use only --write, --clear-sitl, or --help.');
const write = process.argv.includes('--write');
const clear = process.argv.includes('--clear-sitl');
const decoder = new AircraftDecoder('sitl-smoke');
const abort = new AbortController();
const socket = createConnection({ host: '127.0.0.1', port: 5760 });
socket.on('data', chunk => decoder.push(chunk, Date.now()));
socket.on('close', () => abort.abort(new Error('SITL TCP connection closed')));
socket.on('error', error => abort.abort(error));

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

try {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('SITL TCP connection timed out')), 5000);
    socket.once('connect', () => { clearTimeout(timeout); resolve(); });
    socket.once('error', error => { clearTimeout(timeout); reject(error); });
  });
  let aircraft = decoder.snapshot().aircraft.find(item => item.systemId === 1 && item.componentId === 1);
  for (let attempt = 0; attempt < 200 && !aircraft; attempt++) {
    abort.signal.throwIfAborted();
    await sleep(50);
    aircraft = decoder.snapshot().aircraft.find(item => item.systemId === 1 && item.componentId === 1);
  }
  if (!aircraft) throw new Error('No ArduCopter heartbeat from SITL.');
  if (aircraft.heartbeat.armed) throw new Error('SITL reports armed; refusing mission exchange.');
  if (aircraft.heartbeat.autopilot !== 3 || aircraft.heartbeat.vehicleType !== 2)
    throw new Error('Connected process is not an ArduCopter quadrotor.');
  let sequence = 0;
  const io: MissionIo = {
    cursor: () => decoder.missionCursor(),
    send: async outbound => {
      abort.signal.throwIfAborted();
      const frame = missionFrame(1, 1, sequence++ % 256, outbound);
      await new Promise<void>((resolve, reject) => socket.write(frame, error => error ? reject(error) : resolve()));
    },
    receive: async (afterId, timeoutMs, signal) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        const packet = decoder.missionPackets(afterId)[0];
        if (packet) return packet;
        await sleep(20);
      }
      return null;
    },
  };
  const protocol = new MissionProtocol(io, {
    systemId: 1, componentId: 1, groundSystemId: GROUND_SYSTEM_ID, groundComponentId: GROUND_COMPONENT_ID,
  });
  if (clear) {
    const cursor = io.cursor();
    await io.send({ kind: 'count', count: 0 });
    let accepted = false;
    const deadline = Date.now() + 5000;
    let after = cursor;
    while (Date.now() < deadline) {
      const response = await io.receive(after, 500, abort.signal);
      if (!response) continue;
      after = response.id;
      if (response.sourceSystem === 1 && response.sourceComponent === 1 &&
          response.targetSystem === GROUND_SYSTEM_ID && response.targetComponent === GROUND_COMPONENT_ID &&
          response.missionType === 0 && response.kind === 'ack') {
        if (response.result !== 0) throw new Error(`SITL mission clear rejected (${response.result}).`);
        accepted = true;
        break;
      }
    }
    if (!accepted) throw new Error('SITL mission clear had no matching ACK.');
    process.stdout.write(JSON.stringify({ phase: 'sitl-clear-ack', result: 'accepted' }) + '\n');
  }
  const before = await protocol.download(abort.signal);
  process.stdout.write(JSON.stringify({ phase: 'initial-readback', missionCount: before.length, items: before }) + '\n');
  if (!write) process.exitCode = 0;
  else {
    if (before.length > 1 || (before.length === 1 && before[0]?.seq !== 0))
      throw new Error('SITL mission is not empty or home-only; refusing overwrite. Reset isolated SITL state first.');
    let home = before[0];
    if (!home) {
      // A wiped SITL may have no stored mission. ArduPilot still reserves seq 0
      // for home, and replaces this supplied placeholder with its own AHRS home.
      // Require fresh simulated GPS/position rather than hardcoding a coordinate.
      const requests = telemetryRequestFrames(1, 1, sequence);
      sequence += requests.length;
      for (const frame of requests) {
        await new Promise<void>((resolve, reject) => socket.write(frame, error => error ? reject(error) : resolve()));
      }
      for (let attempt = 0; attempt < 200; attempt++) {
        const current = decoder.snapshot().aircraft.find(item => item.systemId === 1 && item.componentId === 1);
        if (current?.gps?.fixType && current.gps.fixType >= 3 && current.position &&
            Date.now() - current.gps.receivedAt < 3000 && Date.now() - current.position.receivedAt < 3000) {
          home = {
            seq: 0, frame: 5, command: 16, current: 0, autocontinue: 1,
            param1: 0, param2: 0, param3: 0, param4: 0,
            x: Math.round(current.position.latitude * 1e7),
            y: Math.round(current.position.longitude * 1e7), z: current.position.altitudeMslM,
          };
          break;
        }
        await sleep(100);
      }
      if (!home) throw new Error('SITL never produced fresh 3D GPS and global position; refusing upload.');
    }
    const project = createOneFootHoverStoryboard('sitl-protocol-evaluation');
    project.limits.maxAltitude = 3;
    project.cues[0].duration = 11;
    project.cues[0].droneEdits!['1'].keyframes = [
      { time: 0, position: [0, 0, 0] },
      { time: 3, position: [0, 0, 2.5] },
      { time: 8, position: [0, 0, 2.5] },
      { time: 11, position: [0, 0, 0] },
    ];
    const draft = compileHoverMission(project);
    const base = { frame: 3, current: 0, autocontinue: 1, param1: 0, param2: 0, param3: 0, param4: 0, x: 0, y: 0 };
    const expected: MissionItem[] = [
      { ...home, seq: 0 },
      { ...base, seq: 1, command: draft.items[0].command, z: draft.heightM },
      { ...base, seq: 2, command: draft.items[1].command, param1: draft.holdSeconds, param3: 1, z: draft.heightM },
      { ...base, seq: 3, command: draft.items[2].command, param4: 1, z: 0 },
    ];
    await protocol.upload(expected, abort.signal);
    process.stdout.write(JSON.stringify({ phase: 'upload-ack', result: 'accepted', sentItems: expected.length }) + '\n');
    const after = await protocol.download(abort.signal);
    const mismatch = compareMissionReadback(expected, after);
    process.stdout.write(JSON.stringify({
      phase: 'post-upload-readback', missionCount: after.length,
      items: after, mismatch,
    }) + '\n');
    if (mismatch) throw new Error(`SITL mission readback mismatch: ${mismatch}`);
  }
} finally {
  socket.end();
  socket.destroy();
}
