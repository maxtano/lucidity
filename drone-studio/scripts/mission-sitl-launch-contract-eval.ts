/**
 * Isolated Copter SITL launch-contract evaluation. Hardcoded loopback TCP;
 * no serial path or configurable destination. Never use for physical flight.
 * Run after mission-sitl-service-smoke.ts --write has verified the mission.
 * Explicit flag arms and starts the mission INSIDE the simulator only.
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

const decoder = new AircraftDecoder('sitl-launch-contract-eval');
const abort = new AbortController();
const missionCurrentEvents: Array<{ seq: number; at: number }> = [];
const missionReachedEvents: Array<{ seq: number; at: number }> = [];
const commandAckEvents: Array<{ command: number; result: number; at: number }> = [];
const parameters = new Map<string, number>();
const changes = (values: number[]) => values.filter((value, index) => index === 0 || value !== values[index - 1]);
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
      missionCurrentEvents.push({ seq, at });
    }
    if (header.msgid === common.MissionItemReached.MSG_ID) {
      const seq = protocol.data(protocol.payload(frame), common.MissionItemReached).seq;
      missionReachedEvents.push({ seq, at });
    }
    if (header.msgid === common.CommandAck.MSG_ID) {
      const ack = protocol.data(protocol.payload(frame), common.CommandAck);
      commandAckEvents.push({ command: ack.command, result: ack.result, at });
    }
    if (header.msgid === common.ParamValue.MSG_ID) {
      const value = protocol.data(protocol.payload(frame), common.ParamValue);
      parameters.set(value.paramId.replace(/\0/g, ''), value.paramValue);
    }
  }
}
let intentionalClose = false;
function connectSocket() {
  const connected = createConnection({ host: '127.0.0.1', port: 5760 });
  connected.on('data', chunk => { decoder.push(chunk, Date.now()); observeMissionProgress(chunk); });
  connected.on('close', () => {
    if (!intentionalClose) abort.abort(new Error('Unexpected SITL TCP link close'));
  });
  connected.on('error', error => {
    if (!intentionalClose) abort.abort(error);
  });
  return connected;
}
let socket = connectSocket();
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
function setMissionCurrentFrame(seq: number, reset: boolean) {
  const message = new common.CommandLong();
  message.targetSystem = 1;
  message.targetComponent = 1;
  message.command = 224; // MAV_CMD_DO_SET_MISSION_CURRENT; localhost SITL only.
  message.confirmation = 0;
  message._param1 = seq;
  message._param2 = reset ? 1 : 0;
  message._param3 = message._param4 = message._param5 = message._param6 = message._param7 = 0;
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
function parameterReadFrame(name: string) {
  const message = new common.ParamRequestRead();
  message.targetSystem = 1;
  message.targetComponent = 1;
  message.paramIndex = -1;
  message.paramId = name;
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
async function sendAndAwaitAck(command: number, frame: Buffer) {
  const after = commandAckEvents.length;
  await send(frame);
  await until(`COMMAND_ACK ${command}`, () => commandAckEvents.slice(after).some(item => item.command === command), 5000);
  const ack = commandAckEvents.slice(after).find(item => item.command === command)!;
  if (ack.result !== 0) throw new Error(`COMMAND_ACK ${command} returned ${ack.result}`);
  return ack;
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

  for (const name of ['FS_GCS_ENABLE', 'FS_THR_ENABLE', 'FS_OPTIONS', 'FS_GCS_TIMEOUT']) {
    await send(parameterReadFrame(name));
    await until(`parameter ${name}`, () => parameters.has(name), 3000);
  }
  process.stdout.write(JSON.stringify({ phase: 'failsafe-parameters', values: Object.fromEntries(parameters) }) + '\n');

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
  const firstStartAck = await sendAndAwaitAck(300, missionStartFrame()); // Copter sets AUTO and enables automatic takeoff.
  await until('AUTO mode', () => aircraft()?.heartbeat.mode === 'Auto', 7000);
  await until('simulated climb above 1.5 m', () => (aircraft()?.position?.relativeAltitudeM ?? 0) > 1.5, 30000);
  await until('simulated landing and auto-disarm', () => !aircraft()?.heartbeat.armed, 90000);
  armedInSimulator = false;
  const first = [...samples];
  process.stdout.write(JSON.stringify({ phase: 'auto-complete', missionStartAckResult: firstStartAck.result,
    peakAltitudeM: Math.max(...first.map(s => s.altitudeM ?? 0)),
    lastAltitudeM: first.at(-1)?.altitudeM,
    durationS: first.at(-1)?.t,
    modes: [...new Set(first.map(s => s.mode))],
    disarmed: !aircraft()?.heartbeat.armed,
    missionCurrent: changes(missionCurrentEvents.map(event => event.seq)),
    missionReached: missionReachedEvents.map(event => event.seq) }) + '\n');

  const resetCursor = missionCurrentEvents.length;
  const resetAck = await sendAndAwaitAck(224, setMissionCurrentFrame(1, false));
  await until('fresh mission current seq 1', () => missionCurrentEvents.slice(resetCursor).some(event => event.seq === 1), 5000);
  if (aircraft()?.heartbeat.armed) throw new Error('Set-current unexpectedly armed simulator.');
  process.stdout.write(JSON.stringify({ phase: 'set-current-disarmed', seq: 1, resetMission: false,
    ackResult: resetAck.result, observedCurrent: missionCurrentEvents.slice(resetCursor).map(event => event.seq).at(-1),
    armed: aircraft()?.heartbeat.armed }) + '\n');

  await send(modeFrame(0));
  await until('Stabilize reset', () => aircraft()?.heartbeat.mode === 'Stabilize', 7000);
  const secondStart = samples.length;
  await armAfterNormalPrearmChecks('second simulated arming');
  armedInSimulator = true;
  const repeatAck = await sendAndAwaitAck(300, missionStartFrame());
  await until('second AUTO mode', () => aircraft()?.heartbeat.mode === 'Auto', 7000);
  await until('repeat simulated climb above 1.5 m', () => (aircraft()?.position?.relativeAltitudeM ?? 0) > 1.5, 30000);
  await until('repeat simulated landing and auto-disarm', () => !aircraft()?.heartbeat.armed, 90000);
  armedInSimulator = false;
  const second = samples.slice(secondStart);
  process.stdout.write(JSON.stringify({ phase: 'repeat-complete', missionStartAckResult: repeatAck.result,
    peakAltitudeM: Math.max(...second.map(s => s.altitudeM ?? 0)),
    durationS: second.length ? Math.round((second.at(-1)!.t - second[0].t) * 10) / 10 : null,
    modes: [...new Set(second.map(s => s.mode))],
    disarmed: !aircraft()?.heartbeat.armed,
    missionCurrent: changes(missionCurrentEvents.map(event => event.seq)),
    missionReached: missionReachedEvents.map(event => event.seq) }) + '\n');

  await sendAndAwaitAck(224, setMissionCurrentFrame(1, false));
  await send(modeFrame(0));
  await until('Stabilize for link-loss test', () => aircraft()?.heartbeat.mode === 'Stabilize', 7000);
  await armAfterNormalPrearmChecks('third simulated arming');
  armedInSimulator = true;
  const linkLossStartAck = await sendAndAwaitAck(300, missionStartFrame());
  await until('AUTO for link-loss test', () => aircraft()?.heartbeat.mode === 'Auto', 7000);
  await until('link-loss test climbed above 0.7 m', () => (aircraft()?.position?.relativeAltitudeM ?? 0) > 0.7, 30000);
  const beforeDisconnect = { mode: aircraft()?.heartbeat.mode, armed: aircraft()?.heartbeat.armed,
    altitudeM: aircraft()?.position?.relativeAltitudeM ?? null };
  const disconnectedAt = Date.now();
  intentionalClose = true;
  socket.end();
  socket.destroy();
  await sleep(8000); // no GCS MAVLink stream while ArduCopter continues in SITL
  progressPending = Buffer.alloc(0);
  socket = connectSocket();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SITL reconnect timed out')), 5000);
    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
  intentionalClose = false;
  const reconnectedAt = Date.now();
  await until('fresh heartbeat after reconnect', () => (aircraft()?.heartbeat.receivedAt ?? 0) > disconnectedAt, 6000);
  const afterReconnect = { mode: aircraft()?.heartbeat.mode, armed: aircraft()?.heartbeat.armed,
    altitudeM: aircraft()?.position?.relativeAltitudeM ?? null,
    heartbeatAgeMs: Date.now() - (aircraft()?.heartbeat.receivedAt ?? 0) };
  await until('link-loss simulated landing and auto-disarm', () => !aircraft()?.heartbeat.armed, 60000);
  armedInSimulator = false;
  process.stdout.write(JSON.stringify({ phase: 'telemetry-tcp-loss', missionStartAckResult: linkLossStartAck.result,
    outageMs: reconnectedAt - disconnectedAt, beforeDisconnect, afterReconnect,
    finalMode: aircraft()?.heartbeat.mode, finalArmed: aircraft()?.heartbeat.armed,
    missionCurrent: changes(missionCurrentEvents.map(event => event.seq)),
    missionReached: missionReachedEvents.map(event => event.seq) }) + '\n');
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
