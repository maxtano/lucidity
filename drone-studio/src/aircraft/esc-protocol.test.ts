import { afterEach, describe, expect, it, vi } from 'vitest';
import { crc16, decodeEscSettings, escSettingsAddress, EscTransport, fourWayReadFrame, mspReadFrame } from './esc-protocol';

import { mspReply, fourReply, settings } from './esc-test-fixtures';
afterEach(() => vi.useRealTimers());
describe('read-only ESC wire protocol', () => {
  it('uses the XMODEM check vector and the ArduPilot MSP passthrough ID', () => {
    expect(crc16(Buffer.from('123456789'))).toBe(0x31c3);
    expect(mspReadFrame(245).toString('hex')).toBe('244d3c00f5f5');
  });
  it('rejects write, erase, throttle, arbitrary addresses and channels', () => {
    for (const cmd of [0x38, 0x39, 0x3b, 0x3e, 0x3f]) expect(() => fourWayReadFrame(cmd)).toThrow();
    expect(() => mspReadFrame(214)).toThrow();
    expect(() => fourWayReadFrame(0x3a, 112, 0)).toThrow();
    expect(() => fourWayReadFrame(0x3a, 0, 0x1a00)).toThrow();
    expect(() => fourWayReadFrame(0x37, 8)).toThrow();
  });
  it('handles noise, fragmentation and unrelated MSP replies', async () => {
    const transport = new EscTransport(async () => {});
    const result = transport.msp(1);
    transport.push(Buffer.from([0xfd, 0x00, 0x20]));
    transport.push(mspReply(2, [65, 82, 68, 85]));
    const response = mspReply(1, [0, 1, 42]);
    for (const byte of response) transport.push(Buffer.from([byte]));
    expect(await result).toEqual(Buffer.from([0, 1, 42]));
  });
  it('checks CRC, address and command before accepting a four-way response', async () => {
    const transport = new EscTransport(async () => {});
    const promise = transport.four(0x3a, 112, 0x1a00);
    const bad = fourReply(0x3a, [1, 2, 3], 0x1a00); bad[bad.length - 1] ^= 1;
    transport.push(bad);
    transport.push(fourReply(0x3a, [8], 0x3000));
    transport.push(fourReply(0x37, [9], 0x1a00));
    const good = fourReply(0x3a, Buffer.alloc(256, 7), 0x1a00);
    transport.push(good.subarray(0, 20)); transport.push(good.subarray(20));
    expect(await promise).toEqual(Buffer.alloc(256, 7));
  });
  it('reports negative ACKs, timeout, write failure and cancellation', async () => {
    vi.useFakeTimers();
    const transport = new EscTransport(async () => {}, 10);
    let promise = transport.four(0x37, 0);
    transport.push(fourReply(0x37, [0], 0, 0x0f));
    await expect(promise).rejects.toThrow('ACK 0xf');
    promise = transport.msp(1);
    const rejected = expect(promise).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(10); await rejected;
    promise = transport.msp(1); transport.cancel();
    await expect(promise).rejects.toThrow('cancelled');
    await expect(transport.msp(1)).rejects.toThrow('closed');
    await expect(new EscTransport(async () => { throw new Error('unplugged'); }).msp(1)).rejects.toThrow('unplugged');
  });
});
describe('ESC identity decoding', () => {
  it('identifies stock BLHeli_S and preserves the reversed direction', () => {
    expect(decodeEscSettings(2, 0xe8b2, 1, settings())).toMatchObject({ firmware: 'BLHeli_S', version: '16.7', layout: 'J-H-40', direction: 'Reversed', startupMelody: 'unsupported' });
  });
  it('requires full Bluejay settings before claiming melody support', () => {
    const b = settings(true);
    expect(decodeEscSettings(1, 0xe8b2, 1, b.subarray(0, 112)).startupMelody).toBe('unknown');
    expect(decodeEscSettings(1, 0xe8b2, 1, b)).toMatchObject({ firmware: 'Bluejay', firmwareName: 'Bluejay (.1)', startupMelody: 'supported' });
  });
  it('does not guess from erased memory, unknown firmware, revisions or MCU modes', () => {
    expect(decodeEscSettings(1, 0xe8b2, 1, Buffer.alloc(112, 255)).firmware).toBe('Unknown');
    const b = settings(); b[1] = 9;
    expect(decodeEscSettings(1, 0xe8b2, 1, b).firmware).toBe('Unknown');
    const blue = settings(true); blue[2] = 250;
    expect(decodeEscSettings(1, 0xe8b2, 1, blue).startupMelody).toBe('unknown');
    expect(escSettingsAddress(0xe8b5, 1)).toBe(0x3000);
    expect(escSettingsAddress(0xe8b2, 4)).toBeNull();
    expect(escSettingsAddress(0x1234, 1)).toBeNull();
    expect(() => decodeEscSettings(1, 0xe8b2, 1, Buffer.alloc(80))).toThrow('Incomplete');
  });
});
