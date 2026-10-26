/** Read-only MAVLink DataFlash log transfer. No flight or log-erase commands. */
import { MavLinkProtocolV2, common } from 'node-mavlink';
import { GROUND_COMPONENT_ID, GROUND_SYSTEM_ID } from './read-requests';

export type LogEntry = {
  id: number;
  numLogs: number;
  lastLogNum: number;
  timeUtc: number;
  size: number;
};

export type LogOutbound =
  | { kind: 'list'; start: number; end: number }
  | { kind: 'data'; logId: number; offset: number; count: number }
  | { kind: 'end' };

export type LogPacket = {
  /** Monotonic receive cursor, distinct from an onboard log id. */
  id: number;
  kind: 'entry' | 'data';
  sourceSystem: number;
  sourceComponent: number;
  /** LOG_ENTRY and LOG_DATA do not actually carry target fields. */
  targetSystem?: number;
  targetComponent?: number;
  entry?: LogEntry;
  logId?: number;
  offset?: number;
  count?: number;
  data?: Uint8Array;
};

export type LogIo = {
  cursor(): number;
  send(message: LogOutbound): Promise<void>;
  receive(afterId: number, timeoutMs: number, signal: AbortSignal): Promise<LogPacket | null>;
};

export class LogProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LogProtocolError';
  }
}

const MAX_LOG_BYTES = 16 * 1024 * 1024;
const MAX_LOGS = 512;
const MAX_LIST_ATTEMPTS = 3;
const MAX_RANGE_ATTEMPTS = 6;
const LIST_IDLE_TIMEOUT_MS = 5_000;
const DATA_IDLE_TIMEOUT_MS = 3_000;
const DATA_RANGE_BYTES = 90 * 64;
const MAX_LIST_PACKETS = MAX_LOGS * 2;
const MAX_RANGE_PACKETS = 512;

function uint(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

function entryValid(entry: LogEntry): boolean {
  return uint(entry.id, 0xffff) && uint(entry.numLogs, 0xffff) &&
    uint(entry.lastLogNum, 0xffff) && uint(entry.timeUtc, 0xffffffff) &&
    uint(entry.size, 0xffffffff);
}

/** Encode only the list, data-read and transfer-end messages. LOG_ERASE is absent. */
export function logFrame(
  targetSystem: number,
  targetComponent: number,
  sequence: number,
  outbound: LogOutbound,
): Buffer {
  if (!uint(targetSystem, 253) || targetSystem === 0 ||
      !uint(targetComponent, 255) || targetComponent === 0 || !uint(sequence, 0xffffffff))
    throw new LogProtocolError('Invalid log request target or sequence.');
  const protocol = new MavLinkProtocolV2(GROUND_SYSTEM_ID, GROUND_COMPONENT_ID);
  let message: InstanceType<typeof common.LogRequestList> |
    InstanceType<typeof common.LogRequestData> | InstanceType<typeof common.LogRequestEnd>;
  switch (outbound.kind) {
    case 'list': {
      if (!uint(outbound.start, 0xffff) || !uint(outbound.end, 0xffff) || outbound.start > outbound.end)
        throw new LogProtocolError('Invalid log list range.');
      const value = new common.LogRequestList();
      value.start = outbound.start;
      value.end = outbound.end;
      message = value;
      break;
    }
    case 'data': {
      if (!uint(outbound.logId, 0xffff) || !uint(outbound.offset, 0xffffffff) ||
          !uint(outbound.count, 0xffffffff) || outbound.count === 0 ||
          outbound.offset + outbound.count > 0x1_0000_0000)
        throw new LogProtocolError('Invalid log data range.');
      const value = new common.LogRequestData();
      value.id = outbound.logId;
      value.ofs = outbound.offset;
      value.count = outbound.count;
      message = value;
      break;
    }
    case 'end':
      message = new common.LogRequestEnd();
      break;
  }
  message.targetSystem = targetSystem;
  message.targetComponent = targetComponent;
  return protocol.serialize(message, sequence % 256);
}

/** Decode LOG_ENTRY/LOG_DATA from node-mavlink's typed payloads. */
export function decodeLogPacket(
  messageId: number,
  data: unknown,
  sourceSystem: number,
  sourceComponent: number,
  id: number,
): LogPacket | null {
  if (!data || typeof data !== 'object' || !uint(sourceSystem, 255) ||
      !uint(sourceComponent, 255) || !uint(id, Number.MAX_SAFE_INTEGER)) return null;
  const value = data as Record<string, unknown>;
  const base = { id, sourceSystem, sourceComponent };
  if (messageId === common.LogEntry.MSG_ID) {
    const entry: LogEntry = {
      id: value.id as number,
      numLogs: value.numLogs as number,
      lastLogNum: value.lastLogNum as number,
      timeUtc: value.timeUtc as number,
      size: value.size as number,
    };
    return entryValid(entry) ? { ...base, kind: 'entry', entry } : null;
  }
  if (messageId === common.LogData.MSG_ID) {
    const logId = value.id;
    const offset = value.ofs;
    const count = value.count;
    const bytes = value.data;
    if (!uint(logId, 0xffff) || !uint(offset, 0xffffffff) || !uint(count, 90) ||
        !(Array.isArray(bytes) || bytes instanceof Uint8Array) || bytes.length < count || bytes.length > 90)
      return null;
    for (let i = 0; i < count; i++) if (!uint(bytes[i], 255)) return null;
    const chunk = Uint8Array.from(bytes as ArrayLike<number>);
    return { ...base, kind: 'data', logId, offset, count, data: chunk.subarray(0, count) };
  }
  return null;
}

export class LogProtocol {
  private active = false;

  constructor(
    private readonly io: LogIo,
    private readonly target: { systemId: number; componentId: number },
  ) {
    if (!uint(target.systemId, 253) || target.systemId === 0 ||
        !uint(target.componentId, 255) || target.componentId === 0)
      throw new LogProtocolError('Invalid log target.');
  }

  private validSource(packet: LogPacket): boolean {
    return packet.sourceSystem === this.target.systemId &&
      packet.sourceComponent === this.target.componentId &&
      (packet.targetSystem === undefined || packet.targetSystem === 0 || packet.targetSystem === GROUND_SYSTEM_ID) &&
      (packet.targetComponent === undefined || packet.targetComponent === 0 || packet.targetComponent === GROUND_COMPONENT_ID);
  }

  private async operation<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    if (this.active) throw new LogProtocolError('Another log transfer is already active.');
    this.active = true;
    let failed = false;
    try {
      return await run();
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      // MAVLink requires END to resume ordinary logging on some autopilots. It also
      // terminates any partially sent range before the next operation/reconnect.
      try {
        await this.io.send({ kind: 'end' });
      } catch (error) {
        if (!failed) throw new LogProtocolError(`Could not end log transfer: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        this.active = false;
      }
    }
  }

  /** Collect a complete list; no partial list is presented as authoritative. */
  async list(signal: AbortSignal): Promise<LogEntry[]> {
    return this.operation(signal, async () => {
      const entries = new Map<number, LogEntry>();
      let expected: number | null = null;
      for (let attempt = 0; attempt < MAX_LIST_ATTEMPTS; attempt++) {
        signal.throwIfAborted();
        if (attempt > 0) await this.io.send({ kind: 'end' });
        let cursor = this.io.cursor();
        await this.io.send({ kind: 'list', start: 0, end: 0xffff });
        let deadline = performance.now() + LIST_IDLE_TIMEOUT_MS;
        for (let packets = 0; packets < MAX_LIST_PACKETS; packets++) {
          signal.throwIfAborted();
          const remaining = deadline - performance.now();
          if (remaining <= 0) break;
          const packet = await this.io.receive(cursor, remaining, signal);
          if (!packet) break;
          cursor = packet.id;
          if (!this.validSource(packet) || packet.kind !== 'entry' || !packet.entry) continue;
          const entry = packet.entry;
          if (!entryValid(entry)) continue;
          if (entry.numLogs === 0 && entry.id === 0) return [];
          if (entry.numLogs < 1 || entry.numLogs > MAX_LOGS)
            throw new LogProtocolError('Aircraft reported an unsupported log count.');
          if (expected !== null && entry.numLogs !== expected)
            throw new LogProtocolError('Aircraft log list changed during transfer; refresh and retry.');
          expected = entry.numLogs;
          const previous = entries.get(entry.id);
          if (previous && (previous.size !== entry.size || previous.timeUtc !== entry.timeUtc))
            throw new LogProtocolError('Aircraft log entry changed during transfer; refresh and retry.');
          entries.set(entry.id, entry);
          deadline = performance.now() + LIST_IDLE_TIMEOUT_MS;
          if (entries.size === expected) return [...entries.values()].sort((a, b) => a.id - b.id);
        }
      }
      throw new LogProtocolError('A complete onboard log list did not arrive. Check the link or logging storage.');
    });
  }

  /** Download one completed log into a bounded buffer; return bytes only after exact coverage. */
  async download(
    entry: LogEntry,
    signal: AbortSignal,
    onProgress?: (received: number, total: number) => void,
  ): Promise<Uint8Array> {
    if (!entryValid(entry) || entry.size > MAX_LOG_BYTES)
      throw new LogProtocolError(`Invalid or oversized onboard log (limit ${MAX_LOG_BYTES} bytes).`);
    return this.operation(signal, async () => {
      const output = new Uint8Array(entry.size);
      let complete = 0;
      onProgress?.(0, entry.size);
      if (entry.size === 0) return output;
      for (let start = 0; start < entry.size; start += DATA_RANGE_BYTES) {
        const end = Math.min(entry.size, start + DATA_RANGE_BYTES);
        const covered = new Uint8Array(end - start);
        let missing = end - start;
        for (let attempt = 0; attempt < MAX_RANGE_ATTEMPTS && missing > 0; attempt++) {
          signal.throwIfAborted();
          if (attempt > 0) await this.io.send({ kind: 'end' });
          const firstMissing = covered.indexOf(0);
          const lastMissing = covered.lastIndexOf(0);
          const requestStart = start + firstMissing;
          const requestEnd = start + lastMissing + 1;
          let cursor = this.io.cursor();
          await this.io.send({ kind: 'data', logId: entry.id, offset: requestStart, count: requestEnd - requestStart });
          let deadline = performance.now() + DATA_IDLE_TIMEOUT_MS;
          for (let packets = 0; packets < MAX_RANGE_PACKETS && missing > 0; packets++) {
            signal.throwIfAborted();
            const remaining = deadline - performance.now();
            if (remaining <= 0) break;
            const packet = await this.io.receive(cursor, remaining, signal);
            if (!packet) break;
            cursor = packet.id;
            if (!this.validSource(packet) || packet.kind !== 'data' || packet.logId !== entry.id ||
                !uint(packet.offset, 0xffffffff) || !uint(packet.count, 90) || !packet.data) continue;
            const offset = packet.offset;
            const count = packet.count;
            if (offset < requestStart || offset + count > requestEnd || packet.data.length < count) continue;
            if (count === 0) throw new LogProtocolError('Aircraft ended log data before the advertised size.');
            for (let i = 0; i < count; i++) {
              const position = offset + i;
              const index = position - start;
              if (covered[index]) {
                if (output[position] !== packet.data[i])
                  throw new LogProtocolError('Onboard log bytes changed during transfer.');
              } else {
                output[position] = packet.data[i];
                covered[index] = 1;
                missing--;
                complete++;
              }
            }
            deadline = performance.now() + DATA_IDLE_TIMEOUT_MS;
            onProgress?.(complete, entry.size);
          }
        }
        if (missing !== 0) throw new LogProtocolError('Onboard log download remained incomplete after bounded retries.');
      }
      if (complete !== entry.size) throw new LogProtocolError('Onboard log byte coverage is incomplete.');
      return output;
    });
  }
}
