/**
 * Optional isolated Copter SITL evaluation. Hardcoded loopback TCP; no serial
 * path or configurable destination. This is not a Lucidity flight launch path.
 * Run only after mission-sitl-service-smoke.ts --write has verified the mission.
 * `--execute-sitl-only` arms and changes modes INSIDE the simulator only.
 */
import { createConnection } from 'node:net';
import { MavLinkProtocolV1, MavLinkProtocolV2, common } from 'node-mavlink';
import { AircraftDecoder } from '../src/aircraft/decoder';
import { GROUND_COMPONENT_ID, GROUND_SYSTEM_ID, telemetryRequestFrames } from '../src/aircraft/read-requests';
import { missionFrame } from '../src/aircraft/mission-wire';
import { MissionProtocol, type MissionIo } from '../src/aircraft/mission-protocol';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write('Hardcoded localhost:5760 SITL only. --execute-sitl-only runs the already-uploaded mission in the simulator, then tests a LOITER mode takeover. No physical USB/radio support.\n');
  process.exit(0);
}
if (process.argv.length !== 3 || process.argv[2] !== '--execute-sitl-only')
  throw new Error('Explicit --execute-sitl-only flag required.');

const decoder = new AircraftDecoder('sitl-flight-eval');
const socket = createConnection({ host: '127.0.0.1', port: 5760 });
const abort = new AbortController();
const missionCurrentEvents: Array<{ seq: number; at: number }> = [];
const missionReachedEvents: Array<{ seq: number; at: number }> = [];
let progressPending = Buffer.alloc(0);
function observeMissionProgress(chunk: Buffer) {
  progressPending = Buffer.concat([progressPending, chunk]);
  while (progressPending.length >= 6) {
    const start = progressPending.findIndex(byte => byte === 0xfd || byte === 0xfe);
    if (start < 0) { progressPending = Buffer.alloc(0); return; }
    if (start > 0) progressPending = progressPending.subarray(start);
    const v2 = progressPending[0] === 0xfd;
    const headerLength = v2 ? 10 : 6;
    if (progressPending.length < headerLength) return;
    const signed = v2 && (progressPending[2] & 1) !== 0;
    const length = headerLength + progressPending[1] + 2 + (signed ? 13 : 0);
    if (progressPending.length < length) return;
    const frame = progressPending.subarray(0, length);
    progressPending = progressPending.subarray(length);
    const protocol = v2 ? new MavLinkProtocolV2() : new MavLinkProtocolV1();
    const header = protocol.header(frame);
    if (header.sysid !== 1 || header.compid !== 1) continue;
    const at = Date.now();
    if (header.msgid === common.MissionCurrent.MSG_ID) {
      const seq = protocol.data(protocol.payload(frame), common.MissionCurrent).seq;
      if (missionCurrentEvents.at(-1)?.seq !== seq) missionCurrentEvents.push({ seq, at });
    }
    if (header.msgid === common.MissionItemReached.MSG_ID) {
      const seq = protocol.data(protocol.payload(frame), common.MissionItemReached).seq;
      missionReachedEvents.push({ seq, at });
    }
  }
}
socket.on('data', chunk => { decoder.push(chunk, Date.now()); observeMissionProgress(chunk); });
socket.on('close', () => abort.abort(new Error('SITL TCP link closed')));
socket.on('error', error => abort.abort(error));
let sequence = 0;
const wire = new MavLinkProtocolV2(GROUND_SYSTEM_ID, GROUND_COMPONENT_ID);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const aircraft = () => decoder.snapshot().aircraft.find(item => item.systemId === 1 && item.componentId === 1);

async function send(buffer: Buffer) {
  abort.signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => socket.write(buffer, error => error ? reject(error) : resolve()));
}
function modeFrame(customMode: number) {
  const message = new common.SetMode();
  message.targetSystem = 1;
  message.baseMode = 1 as typeof message.baseMode;
  message.customMode = customMode;
  return wire.serialize(message, sequence++ % 256);
}
function armFrame(arm: boolean) {
  const message = new common.CommandLong();
  message.targetSystem = 1;
  message.targetComponent = 1;
  message.command = 400;
  message.confirmation = 0;
  message._param1 = arm ? 1 : 0;
  message._param2 = message._param3 = message._param4 = message._param5 = message._param6 = message._param7 = 0;
  return wire.serialize(message, sequence++ % 256);
}
function missionStartFrame() {
  const message = new common.CommandLong();
  message.targetSystem = 1;
  message.targetComponent = 1;
  message.command = 300; // MAV_CMD_MISSION_START; only the hardcoded localhost SITL.
  message.confirmation = 0;
  message._param1 = message._param2 = message._param3 = message._param4 =
    message._param5 = message._param6 = message._param7 = 0;
  return wire.serialize(message, sequence++ % 256);
}
function missionCurrentStreamFrame() {
  const message = new common.CommandLong();
  message.targetSystem = 1;
  message.targetComponent = 1;
  message.command = 511; // MAV_CMD_SET_MESSAGE_INTERVAL for MISSION_CURRENT
  message.confirmation = 0;
  message._param1 = common.MissionCurrent.MSG_ID;
  message._param2 = 500000;
  message._param3 = message._param4 = message._param5 = message._param6 = message._param7 = 0;
  return wire.serialize(message, sequence++ % 256);
}
async function until(label: string, predicate: () => boolean, timeoutMs: number) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    abort.signal.throwIfAborted();
    if (predicate()) return;
    await sleep(100);
  }
  throw new Error(`${label} timed out. Recent status: ${JSON.stringify(aircraft()?.messages.slice(-5))}`);
}
async function armAfterNormalPrearmChecks(label: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await send(armFrame(true));
    try {
      await until(label, () => Boolean(aircraft()?.heartbeat.armed), 5000);
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      await sleep(4000); // allow SITL EKF/GPS to settle; never force-arm
    }
  }
}

const samples: Array<{ t: number; mode: string; armed: boolean; altitudeM: number | null }> = [];
let sampling: ReturnType<typeof setInterval> | undefined;
let armedInSimulator = false;
try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SITL TCP connection timed out')), 5000);
    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
  await until('ArduCopter heartbeat', () => Boolean(aircraft()), 10000);
  const initial = aircraft()!;
  if (initial.heartbeat.armed || initial.heartbeat.autopilot !== 3 || initial.heartbeat.vehicleType !== 2)
    throw new Error('Expected disarmed ArduCopter SITL, refusing mode or arm command.');

  const io: MissionIo = {
    cursor: () => decoder.missionCursor(),
    send: outbound => send(missionFrame(1, 1, sequence++ % 256, outbound)),
    receive: async (afterId, timeoutMs, signal) => {
      const deadline = performance.now() + timeoutMs;
      while (performance.now() < deadline) {
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
  const mission = await protocol.download(abort.signal);
  if (mission.length !== 4 || mission.map(item => item.command).join(',') !== '16,22,19,21' ||
      mission[1].z !== 2 || mission[2].param1 !== 5 || mission[2].z !== 2)
    throw new Error('SITL mission does not match the saved First live hover 2.0 m/5 s plan.');
  process.stdout.write(JSON.stringify({ phase: 'mission-verified', commands: mission.map(item => item.command) }) + '\n');

  const telemetryFrames = telemetryRequestFrames(1, 1, sequence);
  for (const frame of telemetryFrames) await send(frame);
  sequence += telemetryFrames.length;
  await send(missionCurrentStreamFrame());
  await until('fresh simulated position', () => Boolean(aircraft()?.position && Date.now() - aircraft()!.position!.receivedAt < 3000), 10000);
  const start = performance.now();
  sampling = setInterval(() => {
    const now = aircraft();
    if (now) samples.push({ t: Math.round((performance.now() - start) / 100) / 10,
      mode: now.heartbeat.mode, armed: now.heartbeat.armed,
      altitudeM: now.position?.relativeAltitudeM ?? null });
  }, 500);

  await send(modeFrame(0)); // Arm in Stabilize; Copter normally blocks arming in AUTO.
  await until('Stabilize mode', () => aircraft()?.heartbeat.mode === 'Stabilize', 7000);
  await armAfterNormalPrearmChecks('simulated arming');
  armedInSimulator = true;
  await send(missionStartFrame()); // Copter sets AUTO and enables automatic takeoff.
  await until('AUTO mode', () => aircraft()?.heartbeat.mode === 'Auto', 7000);
  await until('simulated climb above 1.5 m', () => (aircraft()?.position?.relativeAltitudeM ?? 0) > 1.5, 30000);
  await until('simulated landing and auto-disarm', () => !aircraft()?.heartbeat.armed, 90000);
  armedInSimulator = false;
  const first = [...samples];
  process.stdout.write(JSON.stringify({ phase: 'auto-complete',
    peakAltitudeM: Math.max(...first.map(s => s.altitudeM ?? 0)),
    lastAltitudeM: first.at(-1)?.altitudeM,
    durationS: first.at(-1)?.t,
    modes: [...new Set(first.map(s => s.mode))],
    disarmed: !aircraft()?.heartbeat.armed,
    missionCurrent: missionCurrentEvents.map(event => event.seq),
    missionReached: missionReachedEvents.map(event => event.seq) }) + '\n');

  // Simulates a pilot's mode-switch takeover; no RC stick or real Zorro input.
  await send(modeFrame(0));
  await until('Stabilize reset', () => aircraft()?.heartbeat.mode === 'Stabilize', 7000);
  const secondStart = samples.length;
  await armAfterNormalPrearmChecks('second simulated arming');
  armedInSimulator = true;
  await send(missionStartFrame());
  await until('second AUTO mode', () => aircraft()?.heartbeat.mode === 'Auto', 7000);
  await until('second simulated climb above 1 m', () => (aircraft()?.position?.relativeAltitudeM ?? 0) > 1, 30000);
  await send(modeFrame(5)); // LOITER takeover, then deliberate simulated LAND.
  await until('LOITER takeover', () => aircraft()?.heartbeat.mode === 'Loiter', 7000);
  const takeoverAltitude = aircraft()?.position?.relativeAltitudeM ?? null;
  await sleep(2000);
  await send(modeFrame(9));
  await until('LAND mode', () => aircraft()?.heartbeat.mode === 'Land', 7000);
  await until('simulated disarm after takeover', () => !aircraft()?.heartbeat.armed, 60000);
  armedInSimulator = false;
  const second = samples.slice(secondStart);
  process.stdout.write(JSON.stringify({ phase: 'mode-takeover', takeoverMode: 'Loiter',
    takeoverAltitudeM: takeoverAltitude, modes: [...new Set(second.map(s => s.mode))],
    disarmed: !aircraft()?.heartbeat.armed,
    missionCurrent: missionCurrentEvents.map(event => event.seq),
    missionReached: missionReachedEvents.map(event => event.seq) }) + '\n');
  process.stdout.write(JSON.stringify({ phase: 'sample-summary', samples: samples.filter((_, i) => i % 4 === 0) }) + '\n');
} catch (error) {
  if (armedInSimulator && !abort.signal.aborted) {
    await send(modeFrame(9)).catch(() => {}); // simulator-only fallback to LAND
    await sleep(5000);
  }
  throw error;
} finally {
  if (sampling) clearInterval(sampling);
  socket.end();
  socket.destroy();
}
