import { describe, expect, it } from 'vitest';
import {
  compareMissionReadback,
  MissionProtocol,
  MissionProtocolError,
  type MissionIo,
  type MissionItem,
  type MissionOutbound,
  type MissionPacket,
} from './mission-protocol';

/** Scripted protocol peer only; this is not ArduPilot SITL or aircraft validation. */
const target = { systemId: 1, componentId: 1, groundSystemId: 254, groundComponentId: 190 };
const signal = () => new AbortController().signal;

function item(seq: number, command: number, z = 0): MissionItem {
  return {
    seq, frame: 3, command, current: seq === 0 ? 1 : 0, autocontinue: 1,
    param1: 0, param2: 0, param3: 0, param4: 0, x: 0, y: 0, z,
  };
}
const mission = () => [item(0, 16), item(1, 22, 2.5), { ...item(2, 19, 2.5), param1: 5 }, item(3, 21)];

class ScriptedPeer implements MissionIo {
  sent: MissionOutbound[] = [];
  received: MissionPacket[] = [];
  private nextId = 1;
  private delivered = 0;
  onSend: (message: MissionOutbound, peer: ScriptedPeer) => void = () => {};

  cursor() { return this.delivered; }
  async send(message: MissionOutbound) {
    this.sent.push(message);
    this.onSend(message, this);
  }
  async receive(afterId: number, _timeoutMs: number, abort: AbortSignal) {
    abort.throwIfAborted();
    const index = this.received.findIndex(packet => packet.id > afterId);
    if (index < 0) return null;
    const [packet] = this.received.splice(index, 1);
    this.delivered = Math.max(this.delivered, packet.id);
    return packet;
  }
  emit(kind: MissionPacket['kind'], values: Partial<MissionPacket> = {}) {
    this.received.push({
      id: this.nextId++, kind, sourceSystem: target.systemId, sourceComponent: target.componentId,
      targetSystem: target.groundSystemId, targetComponent: target.groundComponentId,
      missionType: 0, ...values,
    });
  }
}

describe('one-drone mission protocol deterministic evaluation', () => {
  it('downloads the existing mission in order and acknowledges completion', async () => {
    const peer = new ScriptedPeer();
    const existing = mission();
    peer.onSend = (message, p) => {
      if (message.kind === 'requestList') p.emit('count', { count: existing.length });
      if (message.kind === 'requestInt') p.emit('itemInt', { seq: message.seq, item: existing[message.seq] });
    };
    expect(await new MissionProtocol(peer, target).download(signal())).toEqual(existing);
    expect(peer.sent).toEqual([
      { kind: 'requestList' },
      ...existing.map((_, seq) => ({ kind: 'requestInt', seq })),
      { kind: 'ack', result: 0 },
    ]);
  });

  it('uploads each requested item and accepts duplicate requests without changing sequence', async () => {
    const peer = new ScriptedPeer();
    const desired = mission();
    let duplicate = false;
    peer.onSend = (message, p) => {
      if (message.kind === 'count') p.emit('requestInt', { seq: 0 });
      if (message.kind === 'itemInt') {
        const seq = message.item.seq;
        if (seq === 0 && !duplicate) { duplicate = true; p.emit('requestInt', { seq: 0 }); }
        else if (seq < desired.length - 1) p.emit('requestInt', { seq: seq + 1 });
        else p.emit('ack', { result: 0 });
      }
    };
    await new MissionProtocol(peer, target).upload(desired, signal());
    expect(peer.sent[0]).toEqual({ kind: 'count', count: 4 });
    expect(peer.sent.filter(message => message.kind === 'itemInt').map(message => message.item.seq))
      .toEqual([0, 0, 1, 2, 3]);
    expect(peer.sent.every(message => message.kind === 'count' || message.kind === 'itemInt')).toBe(true);
  });

  it('ignores responses from a different component and retries a lost initial count', async () => {
    const peer = new ScriptedPeer();
    const desired = mission();
    let countSends = 0;
    peer.onSend = (message, p) => {
      if (message.kind === 'count') {
        countSends++;
        if (countSends === 1) return;
        p.emit('requestInt', { seq: 0, sourceComponent: 99 });
        p.emit('requestInt', { seq: 0 });
      }
      if (message.kind === 'itemInt') {
        if (message.item.seq === desired.length - 1) p.emit('ack', { result: 0 });
        else p.emit('requestInt', { seq: message.item.seq + 1 });
      }
    };
    await new MissionProtocol(peer, target).upload(desired, signal());
    expect(countSends).toBe(2);
    expect(peer.sent.filter(message => message.kind === 'itemInt')).toHaveLength(desired.length);
  });

  it('ignores interleaved ACKs and requests from another system, wrong target, and wrong mission type', async () => {
    const peer = new ScriptedPeer();
    const desired = mission();
    peer.onSend = (message, p) => {
      if (message.kind === 'count') {
        p.emit('ack', { result: 0, sourceSystem: 9 });
        p.emit('requestInt', { seq: 0, targetSystem: 42 });
        p.emit('requestInt', { seq: 0, missionType: 1 });
        p.emit('requestInt', { seq: 0 });
      }
      if (message.kind === 'itemInt') {
        if (message.item.seq === desired.length - 1) p.emit('ack', { result: 0 });
        else p.emit('requestInt', { seq: message.item.seq + 1 });
      }
    };
    await new MissionProtocol(peer, target).upload(desired, signal());
    expect(peer.sent.filter(message => message.kind === 'itemInt').map(message => message.item.seq))
      .toEqual([0, 1, 2, 3]);
  });

  it('spends one receive deadline across unrelated packets', async () => {
    const peer = new ScriptedPeer();
    const originalReceive = peer.receive.bind(peer);
    const timeouts: number[] = [];
    peer.receive = async (afterId, timeoutMs, abort) => {
      timeouts.push(timeoutMs);
      await new Promise(resolve => setTimeout(resolve, 6));
      return originalReceive(afterId, timeoutMs, abort);
    };
    peer.onSend = (message, p) => {
      if (message.kind === 'requestList') {
        p.emit('count', { count: 0, sourceSystem: 99 });
        p.emit('count', { count: 0, targetComponent: 99 });
        p.emit('count', { count: 0 });
      }
    };
    expect(await new MissionProtocol(peer, target).download(signal())).toEqual([]);
    expect(timeouts).toHaveLength(3);
    expect(timeouts[0]).toBeLessThanOrEqual(1500);
    expect(timeouts[1]).toBeLessThan(timeouts[0]);
    expect(timeouts[2]).toBeLessThan(timeouts[1]);
  });

  it('serves a bounded out-of-order request after the vehicle has requested it explicitly', async () => {
    const peer = new ScriptedPeer();
    const desired = mission();
    const order = [0, 2, 1, 3];
    let next = 0;
    peer.onSend = (message, p) => {
      if (message.kind === 'count') p.emit('requestInt', { seq: order[next++] });
      if (message.kind === 'itemInt') {
        if (next < order.length) p.emit('requestInt', { seq: order[next++] });
        else p.emit('ack', { result: 0 });
      }
    };
    await new MissionProtocol(peer, target).upload(desired, signal());
    expect(peer.sent.filter(message => message.kind === 'itemInt').map(message => message.item.seq))
      .toEqual(order);
  });

  it('reports timeout after bounded retries and marks the aircraft mission unknown', async () => {
    const peer = new ScriptedPeer();
    await expect(new MissionProtocol(peer, target).upload(mission(), signal()))
      .rejects.toMatchObject({ name: 'MissionProtocolError', missionMayHaveChanged: true });
    expect(peer.sent).toEqual(Array(3).fill({ kind: 'count', count: 4 }));
  });

  it('treats cancellation after COUNT as possibly partial and sends no later items', async () => {
    const peer = new ScriptedPeer();
    const abort = new AbortController();
    peer.onSend = message => { if (message.kind === 'count') abort.abort('operator cancelled'); };
    await expect(new MissionProtocol(peer, target).upload(mission(), abort.signal))
      .rejects.toMatchObject({ name: 'MissionProtocolError', missionMayHaveChanged: true });
    expect(peer.sent).toEqual([{ kind: 'count', count: 4 }]);
  });

  it('treats a port-close or reboot abort after one item as an unknown partial mission', async () => {
    const peer = new ScriptedPeer();
    const abort = new AbortController();
    peer.onSend = (message, p) => {
      if (message.kind === 'count') p.emit('requestInt', { seq: 0 });
      if (message.kind === 'itemInt' && message.item.seq === 0)
        abort.abort(new Error('USB port closed'));
    };
    await expect(new MissionProtocol(peer, target).upload(mission(), abort.signal))
      .rejects.toMatchObject({ name: 'MissionProtocolError', missionMayHaveChanged: true });
    expect(peer.sent.map(message => message.kind)).toEqual(['count', 'itemInt']);
  });

  it('does not accept early success, a rejected ACK, or an out-of-range request', async () => {
    for (const packet of [
      { kind: 'ack' as const, result: 0 },
      { kind: 'ack' as const, result: 1 },
      { kind: 'requestInt' as const, seq: 99 },
    ]) {
      const peer = new ScriptedPeer();
      peer.onSend = message => { if (message.kind === 'count') peer.emit(packet.kind, packet); };
      await expect(new MissionProtocol(peer, target).upload(mission(), signal()))
        .rejects.toMatchObject({ name: 'MissionProtocolError', missionMayHaveChanged: true });
      expect(peer.sent).toEqual([{ kind: 'count', count: 4 }]);
    }
  });

  it('fails closed on absent, wrong-type, or missing readback items', async () => {
    for (const response of ['none', 'wrong-type', 'missing-item'] as const) {
      const peer = new ScriptedPeer();
      peer.onSend = (message, p) => {
        if (message.kind === 'requestList' && response !== 'none')
          p.emit('count', { count: 2, ...(response === 'wrong-type' ? { missionType: 1 } : {}) });
        if (message.kind === 'requestInt' && message.seq === 0)
          p.emit('itemInt', { seq: 0, item: item(0, 16) });
      };
      await expect(new MissionProtocol(peer, target).download(signal())).rejects.toBeInstanceOf(MissionProtocolError);
      expect(peer.sent.some(message => message.kind === 'ack' && message.result === 0)).toBe(false);
    }
  });

  it('permits ArduPilot home replacement and small float rounding, but catches real readback changes', () => {
    const desired = mission();
    const readback = structuredClone(desired);
    readback[0] = { ...item(0, 16), x: 473977420, y: 85455940 };
    readback[2].param1 += 0.0001;
    expect(compareMissionReadback(desired, readback)).toBeNull();
    readback[2].param1 = 8;
    expect(compareMissionReadback(desired, readback)).toMatch(/item 2.*param1/i);
    expect(compareMissionReadback(desired, readback.slice(0, 3))).toMatch(/count differs/i);
    readback[2].param1 = desired[2].param1;
    readback[1].x = 100;
    expect(compareMissionReadback(desired, readback)).toMatch(/location differs/i);
  });

  it('rejects an invalid seq-0 home even when every flight command matches', () => {
    const desired = mission();
    const actual = structuredClone(desired);
    actual[0] = { ...actual[0], x: 473977420, y: 85455940, z: 488.1 };
    expect(compareMissionReadback(desired, actual)).toBeNull();
    for (const changed of [
      { seq: 1 },
      { command: 21 },
      { frame: 2 },
      { x: 900_000_001 },
      { y: -1_800_000_001 },
      { z: Number.NaN },
    ]) {
      expect(compareMissionReadback(desired, [{ ...actual[0], ...changed }, ...actual.slice(1)]))
        .toMatch(/home entry/i);
    }
  });
});
