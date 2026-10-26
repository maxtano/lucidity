import { describe, expect, it } from 'vitest';
import { MavLinkProtocolV2, common } from 'node-mavlink';
import {
  decodeLogPacket,
  logFrame,
  LogProtocol,
  LogProtocolError,
  type LogEntry,
  type LogIo,
  type LogOutbound,
  type LogPacket,
} from './log-protocol';

/** Injected protocol peer; these are deterministic fixtures, not a real aircraft. */
const target = { systemId: 1, componentId: 1 };
const entry = (id = 3, size = 220): LogEntry =>
  ({ id, numLogs: 1, lastLogNum: id, timeUtc: 1_700_000_000, size });
const signal = () => new AbortController().signal;

class Peer implements LogIo {
  sent: LogOutbound[] = [];
  queued: LogPacket[] = [];
  delivered = 0;
  nextId = 1;
  onSend: (message: LogOutbound, peer: Peer) => void = () => {};

  // The transport cursor is the newest packet observed, including queued packets.
  // A new transfer must not consume stale packets left by a cancelled transfer.
  cursor() { return this.nextId - 1; }
  async send(message: LogOutbound) {
    this.sent.push(message);
    this.onSend(message, this);
  }
  async receive(afterId: number, _timeoutMs: number, abort: AbortSignal) {
    abort.throwIfAborted();
    const index = this.queued.findIndex(packet => packet.id > afterId);
    if (index < 0) return null;
    const [packet] = this.queued.splice(index, 1);
    this.delivered = Math.max(this.delivered, packet.id);
    return packet;
  }
  emitEntry(value: LogEntry, fields: Partial<LogPacket> = {}) {
    this.queued.push({
      id: this.nextId++, kind: 'entry', sourceSystem: 1, sourceComponent: 1,
      entry: value, ...fields,
    });
  }
  emitData(logId: number, offset: number, data: number[], fields: Partial<LogPacket> = {}) {
    this.queued.push({
      id: this.nextId++, kind: 'data', sourceSystem: 1, sourceComponent: 1,
      logId, offset, count: data.length, data: Uint8Array.from(data), ...fields,
    });
  }
}

describe('MAVLink onboard log protocol: injected fixtures only', () => {
  it.each([
    [{ kind: 'list', start: 0, end: 0xffff }, common.LogRequestList.MSG_ID, common.LogRequestList],
    [{ kind: 'data', logId: 3, offset: 90, count: 180 }, common.LogRequestData.MSG_ID, common.LogRequestData],
    [{ kind: 'end' }, common.LogRequestEnd.MSG_ID, common.LogRequestEnd],
  ] as const)('serializes %s as targeted MAVLink2 traffic', (outbound, messageId, messageClass) => {
    const frame = logFrame(1, 1, 42, outbound as LogOutbound);
    const protocol = new MavLinkProtocolV2();
    const header = protocol.header(frame);
    expect(header).toMatchObject({ msgid: messageId, sysid: 254, compid: 190, seq: 42 });
    const decoded = protocol.data(protocol.payload(frame), messageClass);
    expect(decoded).toMatchObject({ targetSystem: 1, targetComponent: 1 });
    if (outbound.kind === 'list') expect(decoded).toMatchObject({ start: 0, end: 0xffff });
    if (outbound.kind === 'data') expect(decoded).toMatchObject({ id: 3, ofs: 90, count: 180 });
  });

  it('decodes log entry/data with a separate receive cursor and validates payload', () => {
    expect(decodeLogPacket(common.LogEntry.MSG_ID, {
      id: 3, numLogs: 1, lastLogNum: 3, timeUtc: 1_700_000_000, size: 220,
    }, 1, 1, 44)).toMatchObject({ id: 44, kind: 'entry', entry: { id: 3, size: 220 } });
    expect(decodeLogPacket(common.LogData.MSG_ID, {
      id: 3, ofs: 90, count: 2, data: [42, 43, ...Array(88).fill(0)],
    }, 1, 1, 45)).toMatchObject({ id: 45, kind: 'data', logId: 3, offset: 90, count: 2 });
    expect(decodeLogPacket(common.LogData.MSG_ID, {
      id: 3, ofs: 90, count: 91, data: Array(91).fill(0),
    }, 1, 1, 45)).toBeNull();
    expect(decodeLogPacket(common.LogData.MSG_ID, {
      id: 3, ofs: 90, count: 3, data: [42, 43],
    }, 1, 1, 45)).toBeNull();
  });

  it('lists both zero-based and one-based log IDs and detects an empty list', async () => {
    for (const first of [0, 1]) {
      const peer = new Peer();
      peer.onSend = message => {
        if (message.kind === 'list') {
          peer.emitEntry({ id: first + 1, numLogs: 2, lastLogNum: first + 1, timeUtc: 11, size: 90 });
          peer.emitEntry({ id: first, numLogs: 2, lastLogNum: first + 1, timeUtc: 10, size: 80 });
        }
      };
      expect((await new LogProtocol(peer, target).list(signal())).map(log => log.id)).toEqual([first, first + 1]);
      expect(peer.sent.at(-1)).toEqual({ kind: 'end' });
    }
    const peer = new Peer();
    peer.onSend = message => { if (message.kind === 'list') peer.emitEntry({ id: 0, numLogs: 0, lastLogNum: 0, timeUtc: 0, size: 0 }); };
    expect(await new LogProtocol(peer, target).list(signal())).toEqual([]);
  });

  it('retries an incomplete list and ignores another system, component, or target', async () => {
    const peer = new Peer();
    let requests = 0;
    peer.onSend = message => {
      if (message.kind !== 'list') return;
      requests++;
      peer.emitEntry({ id: 1, numLogs: 2, lastLogNum: 2, timeUtc: 10, size: 80 });
      peer.emitEntry({ id: 2, numLogs: 2, lastLogNum: 2, timeUtc: 11, size: 90 }, { sourceSystem: 99 });
      if (requests === 2)
        peer.emitEntry({ id: 2, numLogs: 2, lastLogNum: 2, timeUtc: 11, size: 90 });
    };
    expect((await new LogProtocol(peer, target).list(signal())).map(log => log.id)).toEqual([1, 2]);
    expect(peer.sent.map(message => message.kind)).toEqual(['list', 'end', 'list', 'end']);
  });

  it('downloads exact byte coverage, then re-requests a missing offset range only', async () => {
    const peer = new Peer();
    const content = Array.from({ length: 220 }, (_, i) => i % 251);
    const progress: number[] = [];
    peer.onSend = message => {
      if (message.kind !== 'data') return;
      if (message.offset === 0) {
        peer.emitData(3, 0, content.slice(0, 90));
        peer.emitData(3, 180, content.slice(180));
      } else if (message.offset === 90) {
        peer.emitData(3, 90, content.slice(90, 180));
      }
    };
    const result = await new LogProtocol(peer, target).download(entry(), signal(), received => progress.push(received));
    expect([...result]).toEqual(content);
    expect(peer.sent).toEqual([
      { kind: 'data', logId: 3, offset: 0, count: 220 },
      { kind: 'end' },
      { kind: 'data', logId: 3, offset: 90, count: 90 },
      { kind: 'end' },
    ]);
    expect(progress).toEqual([0, 90, 130, 220]);
  });

  it('ignores wrong source, log ID, and offset instead of accepting false coverage', async () => {
    const peer = new Peer();
    peer.onSend = message => {
      if (message.kind !== 'data') return;
      peer.emitData(3, 0, [88], { sourceSystem: 99 });
      peer.emitData(4, 0, [77]);
      peer.emitData(3, 91, [66]);
      peer.emitData(3, 0, [7, 8, 9]);
    };
    expect([...await new LogProtocol(peer, target).download(entry(3, 3), signal())]).toEqual([7, 8, 9]);
  });

  it('does not call a short or zero-count response a successful download', async () => {
    const peer = new Peer();
    peer.onSend = message => { if (message.kind === 'data') peer.emitData(3, 0, []); };
    await expect(new LogProtocol(peer, target).download(entry(3, 90), signal()))
      .rejects.toThrow(/ended.*before/i);
    expect(peer.sent.at(-1)).toEqual({ kind: 'end' });
  });

  it('rejects conflicting duplicate bytes from the same log and leaves no verified result', async () => {
    const peer = new Peer();
    peer.onSend = message => {
      if (message.kind !== 'data') return;
      peer.emitData(3, 0, [1]);
      peer.emitData(3, 0, [2]);
    };
    await expect(new LogProtocol(peer, target).download(entry(3, 2), signal()))
      .rejects.toThrow(/bytes changed/i);
    expect(peer.sent.at(-1)).toEqual({ kind: 'end' });
  });

  it('bounds retries and refuses oversized or inconsistent onboard logs', async () => {
    const peer = new Peer();
    await expect(new LogProtocol(peer, target).download(entry(3, 90), signal()))
      .rejects.toBeInstanceOf(LogProtocolError);
    expect(peer.sent.filter(message => message.kind === 'data')).toHaveLength(6);
    expect(peer.sent.at(-1)).toEqual({ kind: 'end' });
    await expect(new LogProtocol(peer, target).download(entry(3, 16 * 1024 * 1024 + 1), signal()))
      .rejects.toThrow(/oversized/i);
  });

  it('ends transfer on cancellation and can start cleanly on a new connection', async () => {
    const peer = new Peer();
    const cancel = new AbortController();
    peer.onSend = message => {
      if (message.kind === 'data') {
        peer.emitData(3, 0, [4]);
        cancel.abort('operator cancelled');
      }
    };
    const protocol = new LogProtocol(peer, target);
    await expect(protocol.download(entry(3, 1), cancel.signal)).rejects.toBeDefined();
    expect(peer.sent.at(-1)).toEqual({ kind: 'end' });
    peer.onSend = message => { if (message.kind === 'data') peer.emitData(3, 0, [5]); };
    expect([...await protocol.download(entry(3, 1), signal())]).toEqual([5]);
  });

  it('rejects concurrent use of one link and avoids a data request for a zero-byte log', async () => {
    const peer = new Peer();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    peer.send = async message => { peer.sent.push(message); if (message.kind === 'list') await gate; };
    const protocol = new LogProtocol(peer, target);
    const inFlight = protocol.list(signal());
    await expect(protocol.download(entry(3, 0), signal())).rejects.toThrow(/already active/i);
    release();
    await expect(inFlight).rejects.toThrow(/complete onboard log list/i);
    expect([...await protocol.download(entry(3, 0), signal())]).toEqual([]);
    expect(peer.sent.filter(message => message.kind === 'data')).toEqual([]);
  });
});
