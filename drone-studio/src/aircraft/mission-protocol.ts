/** A deliberately small MAVLink mission-protocol state machine; no arm or mode commands. */
export type MissionItem = {
  seq: number;
  frame: number;
  command: number;
  current: number;
  autocontinue: number;
  param1: number;
  param2: number;
  param3: number;
  param4: number;
  x: number;
  y: number;
  z: number;
};

export type MissionOutbound =
  | { kind: 'requestList' }
  | { kind: 'requestInt'; seq: number }
  | { kind: 'count'; count: number }
  | { kind: 'itemInt'; item: MissionItem }
  | { kind: 'ack'; result: number };

export type MissionPacket = {
  id: number;
  kind: 'count' | 'requestInt' | 'itemInt' | 'ack';
  sourceSystem: number;
  sourceComponent: number;
  targetSystem: number;
  targetComponent: number;
  missionType: number;
  count?: number;
  seq?: number;
  item?: MissionItem;
  result?: number;
};

export type MissionIo = {
  cursor(): number;
  send(message: MissionOutbound): Promise<void>;
  receive(afterId: number, timeoutMs: number, signal: AbortSignal): Promise<MissionPacket | null>;
};

export class MissionProtocolError extends Error {
  constructor(message: string, readonly missionMayHaveChanged = false) {
    super(message);
    this.name = 'MissionProtocolError';
  }
}

const TIMEOUT_MS = 1500;
const MAX_RETRIES = 3;
const MAX_MISSION_ITEMS = 100;

export class MissionProtocol {
  constructor(
    private readonly io: MissionIo,
    private readonly target: { systemId: number; componentId: number; groundSystemId: number; groundComponentId: number },
  ) {}

  private valid(packet: MissionPacket): boolean {
    return packet.sourceSystem === this.target.systemId &&
      packet.sourceComponent === this.target.componentId &&
      packet.missionType === 0 &&
      (packet.targetSystem === 0 || packet.targetSystem === this.target.groundSystemId) &&
      (packet.targetComponent === 0 || packet.targetComponent === this.target.groundComponentId);
  }

  private async receive(after: number, signal: AbortSignal): Promise<{ packet: MissionPacket | null; cursor: number }> {
    let cursor = after;
    const deadline = performance.now() + TIMEOUT_MS;
    // Both elapsed time and packet count bound unrelated responses. The clock is
    // monotonic so a wall-clock adjustment cannot prolong the exchange.
    for (let ignored = 0; ignored < 64; ignored++) {
      signal.throwIfAborted();
      const remaining = deadline - performance.now();
      if (remaining <= 0) return { packet: null, cursor };
      const packet = await this.io.receive(cursor, remaining, signal);
      if (!packet) return { packet: null, cursor };
      cursor = packet.id;
      if (this.valid(packet)) return { packet, cursor };
    }
    throw new MissionProtocolError('Too many unrelated mission responses.');
  }

  /** Full readback, including ArduPilot's seq-0 home entry. Does not mutate the mission. */
  async download(signal: AbortSignal, maxCount = MAX_MISSION_ITEMS): Promise<MissionItem[]> {
    let count: number | undefined;
    for (let attempt = 0; attempt < MAX_RETRIES && count === undefined; attempt++) {
      const cursor = this.io.cursor();
      await this.io.send({ kind: 'requestList' });
      const { packet } = await this.receive(cursor, signal);
      if (packet?.kind === 'ack' && packet.result !== 0)
        throw new MissionProtocolError(`Mission download rejected (${packet.result}).`);
      if (packet?.kind === 'count') count = packet.count;
    }
    if (!Number.isInteger(count) || count! < 0 || count! > MAX_MISSION_ITEMS)
      throw new MissionProtocolError('No valid mission count arrived; existing mission is unknown.');
    if (count! > maxCount)
      throw new MissionProtocolError(`An existing mission has ${count} items. Lucidity will not overwrite it.`);
    const items: MissionItem[] = [];
    for (let seq = 0; seq < count!; seq++) {
      let item: MissionItem | undefined;
      for (let attempt = 0; attempt < MAX_RETRIES && !item; attempt++) {
        const cursor = this.io.cursor();
        await this.io.send({ kind: 'requestInt', seq });
        const { packet } = await this.receive(cursor, signal);
        if (packet?.kind === 'ack' && packet.result !== 0)
          throw new MissionProtocolError(`Mission item ${seq} rejected (${packet.result}).`);
        if (packet?.kind === 'itemInt' && packet.seq === seq && packet.item?.seq === seq)
          item = packet.item;
      }
      if (!item) throw new MissionProtocolError(`Mission item ${seq} did not arrive. Existing mission is unknown.`);
      items.push(item);
    }
    if (count! > 0) await this.io.send({ kind: 'ack', result: 0 });
    return items;
  }

  /** Upload may be non-atomic on ArduPilot. Any failure after COUNT means unknown mission state. */
  async upload(items: MissionItem[], signal: AbortSignal): Promise<void> {
    if (items.length < 2 || items.length > MAX_MISSION_ITEMS || items.some((item, i) => item.seq !== i))
      throw new MissionProtocolError('Invalid sequential mission upload.');
    let countSent = false;
    let cursor = this.io.cursor();
    const requested = new Set<number>();
    let lastRequested = -1;
    let retries = 0;
    let requests = 0;
    const deadline = performance.now() + 30_000;
    try {
      await this.io.send({ kind: 'count', count: items.length });
      countSent = true;
      while (true) {
        signal.throwIfAborted();
        if (performance.now() > deadline || requests > items.length * 8)
          throw new MissionProtocolError('Mission upload exceeded its bounded exchange limit.');
        const incoming = await this.receive(cursor, signal);
        const packet = incoming.packet;
        cursor = incoming.cursor;
        if (!packet) {
          if (++retries >= MAX_RETRIES) throw new MissionProtocolError('Mission upload timed out.');
          // A duplicate item is idempotent in the request-driven protocol. Before the
          // first request, resend COUNT to recover a lost initial packet.
          if (lastRequested < 0) await this.io.send({ kind: 'count', count: items.length });
          else await this.io.send({ kind: 'itemInt', item: items[lastRequested] });
          continue;
        }
        if (packet.kind === 'ack') {
          if (packet.result !== 0) throw new MissionProtocolError(`Mission upload rejected (${packet.result}).`);
          if (requested.size !== items.length)
            throw new MissionProtocolError('Mission accepted before every item was requested.');
          return;
        }
        if (packet.kind !== 'requestInt') continue;
        const seq = packet.seq;
        if (!Number.isInteger(seq) || seq! < 0 || seq! >= items.length)
          throw new MissionProtocolError('Aircraft requested an out-of-range mission item.');
        requested.add(seq!);
        requests++;
        lastRequested = seq!;
        retries = 0;
        await this.io.send({ kind: 'itemInt', item: items[seq!] });
      }
    } catch (error) {
      if (countSent) throw new MissionProtocolError(
        `${error instanceof Error ? error.message : 'Mission upload failed.'} Aircraft mission may be partial; download and inspect before retrying.`, true,
      );
      throw error;
    }
  }
}

/** ArduPilot may replace seq 0 with its current home and round float fields. */
export function compareMissionReadback(expected: MissionItem[], actual: MissionItem[]): string | null {
  if (actual.length !== expected.length) return `Mission count differs: expected ${expected.length}, read ${actual.length}.`;
  // ArduPilot may replace seq 0 with its current home coordinates, so compare
  // its role and valid global location rather than its bytes. A malformed or
  // different command at seq 0 must never make an upload look verified.
  if (expected.length > 0) {
    const home = actual[0];
    if (home.seq !== 0 || home.command !== 16 || ![0, 3, 6].includes(home.frame) ||
        !Number.isInteger(home.x) || Math.abs(home.x) > 900_000_000 ||
        !Number.isInteger(home.y) || Math.abs(home.y) > 1_800_000_000 ||
        !Number.isFinite(home.z))
      return 'Mission home entry differs or has an invalid global position.';
  }
  for (let i = 1; i < expected.length; i++) {
    const a = actual[i];
    const e = expected[i];
    if (a.seq !== e.seq || a.command !== e.command || a.frame !== e.frame ||
        a.current !== e.current || a.autocontinue !== e.autocontinue || a.x !== e.x || a.y !== e.y)
      return `Mission item ${i} command, frame, current flag, continuation flag, or location differs.`;
    for (const key of ['param1', 'param2', 'param3', 'param4', 'z'] as const)
      if (!Number.isFinite(a[key]) || Math.abs(a[key] - e[key]) > 0.01)
        return `Mission item ${i} ${key} differs.`;
  }
  return null;
}
