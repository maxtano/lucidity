import type { EscIdentity } from './esc-types';

// Wire formats: ArduPilot AP_BLHeli + AP_MSP/msp_protocol.h; ESC Configurator
// FourWayConstants, Hardware/Silabs and Blheli/Bluejay EEPROM layouts. See docs/ESC_READER.md.
export function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  return crc;
}
export function mspReadFrame(command: number): Buffer {
  if (![1, 2, 245].includes(command)) throw new Error('Unsupported ESC discovery command.');
  return Buffer.from([0x24, 0x4d, 0x3c, 0, command, command]);
}
export function fourWayReadFrame(command: number, parameter = 0, address = 0): Buffer {
  if (![0x34, 0x35, 0x37, 0x3a].includes(command)) throw new Error('ESC write commands are not supported.');
  if (!Number.isInteger(parameter) || parameter < 0 || parameter > 255) throw new Error('Invalid ESC parameter.');
  if (command === 0x3a) {
    if (![0x1a00, 0x3000].includes(address) || ![0x70, 0xff].includes(parameter))
      throw new Error('Only known ESC settings blocks can be read.');
  } else if (address !== 0 || (command === 0x34 ? parameter !== 0 : parameter > 7)) {
    throw new Error('Invalid ESC channel.');
  }
  const frame = Buffer.from([0x2f, command, address >> 8, address & 255, 1, parameter, 0, 0]);
  frame.writeUInt16BE(crc16(frame.subarray(0, -2)), frame.length - 2);
  return frame;
}
export class EscAckError extends Error {}
/** Maintenance operations are bounded to BB2 flash. Bootloader/lock bytes are never writable. */
function maintenanceFrame(command: number, address: number, payload: Uint8Array): Buffer {
  const frame = Buffer.from([0x2f, command, address >> 8, address & 255, payload.length & 255, ...payload, 0, 0]);
  frame.writeUInt16BE(crc16(frame.subarray(0, -2)), frame.length - 2);
  return frame;
}
type Pending = {
  protocol: 'msp' | 'four'; command: number; address: number;
  finish: (error?: Error, payload?: Buffer) => void;
};
/** One outstanding exchange; bounded stream buffer, CRC and response matching. */
export class EscTransport {
  private buffer: Buffer = Buffer.alloc(0);
  private pending?: Pending;
  private closed = false;
  constructor(private write: (frame: Buffer) => Promise<void>, private timeoutMs = 4000, private allowWrites = false) {}
  push(chunk: Buffer) {
    if (this.closed || !this.pending) return;
    this.buffer = Buffer.concat([this.buffer, chunk]).subarray(-8192);
    const p = this.pending;
    while (this.buffer.length && this.pending === p) {
      const b = this.buffer;
      if (p.protocol === 'msp') {
        if (b[0] !== 0x24) { this.buffer = b.subarray(1); continue; }
        if (b.length < 3) return;
        if (b[1] !== 0x4d || ![0x3e, 0x21].includes(b[2])) { this.buffer = b.subarray(1); continue; }
        if (b.length < 6) return;
        const size = b[3], total = size + 6;
        if (b.length < total) return;
        let checksum = 0;
        for (let i = 3; i < total - 1; i++) checksum ^= b[i];
        if (checksum !== b[total - 1]) { this.buffer = b.subarray(1); continue; }
        this.buffer = b.subarray(total);
        if (b[4] !== p.command) continue;
        p.finish(b[2] === 0x21 ? new Error('Controller rejected ESC passthrough discovery.') : undefined, b.subarray(5, total - 1));
      } else {
        if (b[0] !== 0x2e) { this.buffer = b.subarray(1); continue; }
        if (b.length < 5) return;
        const size = b[4] || 256, total = size + 8;
        if (b.length < total) return;
        if (crc16(b.subarray(0, total - 2)) !== b.readUInt16BE(total - 2)) { this.buffer = b.subarray(1); continue; }
        this.buffer = b.subarray(total);
        if (b[1] !== p.command || b.readUInt16BE(2) !== p.address) continue;
        const ack = b[5 + size];
        p.finish(ack ? new EscAckError(`ESC command 0x${p.command.toString(16)} rejected (ACK 0x${ack.toString(16)}). Check ESC power and wiring.`) : undefined, b.subarray(5, 5 + size));
      }
    }
  }
  cancel(reason = 'ESC read cancelled; reconnect and power-cycle before retrying.') {
    this.closed = true;
    this.pending?.finish(new Error(reason));
  }
  private exchange(protocol: Pending['protocol'], command: number, address: number, frame: Buffer): Promise<Buffer> {
    if (this.closed || this.pending) return Promise.reject(new Error('ESC transport is closed or busy.'));
    this.buffer = Buffer.alloc(0);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('ESC response timed out. Check direct USB, passthrough settings and flight battery.')), this.timeoutMs);
      const finish = (error?: Error, payload?: Buffer) => {
        if (this.pending?.finish !== finish) return;
        clearTimeout(timer);
        this.pending = undefined;
        if (error) reject(error); else resolve(Buffer.from(payload!));
      };
      this.pending = { protocol, command, address, finish };
      void this.write(frame).catch(error => finish(error instanceof Error ? error : new Error('ESC serial write failed.')));
    });
  }
  msp(command: 1 | 2 | 245) { return this.exchange('msp', command, 0, mspReadFrame(command)); }
  four(command: number, parameter = 0, address = 0) {
    return this.exchange('four', command, address, fourWayReadFrame(command, parameter, address));
  }
  async readMemory(address: number, length: number): Promise<Buffer> {
    if (!Number.isInteger(address) || !Number.isInteger(length) || length < 1 || length > 256 ||
        !(address >= 0 && address + length <= 0x2000 || address === 0xfbff && length === 1))
      throw new Error('ESC memory read is outside the supported BB2 range.');
    const data = await this.exchange('four', 0x3a, address, maintenanceFrame(0x3a, address, Uint8Array.of(length & 255)));
    if (data.length !== length) throw new Error('Incomplete ESC memory read.');
    return data;
  }
  async erasePage(page: number) {
    if (!this.allowWrites || !Number.isInteger(page) || page < 0 || page > 13)
      throw new Error('ESC page erase is not authorized or outside the application area.');
    await this.exchange('four', 0x39, 0, maintenanceFrame(0x39, 0, Uint8Array.of(page)));
  }
  async writeMemory(address: number, data: Uint8Array) {
    if (!this.allowWrites || !Number.isInteger(address) || address < 0 || data.length < 1 || data.length > 256 ||
        address + data.length > 0x1c00 || Math.floor(address / 512) !== Math.floor((address + data.length - 1) / 512))
      throw new Error('ESC write is not authorized or outside the application area.');
    await this.exchange('four', 0x3b, address, maintenanceFrame(0x3b, address, data));
  }
}
export function escSettingsAddress(signature: number, mode: number): number | null {
  if (mode !== 1) return null;
  if ([0xe8b1, 0xe8b2].includes(signature)) return 0x1a00;
  if (signature === 0xe8b5) return 0x3000;
  return null;
}
const ascii = (bytes: Buffer) => bytes.toString('ascii').replace(/\0.*$/s, '').trim();
export function decodeEscSettings(index: number, signature: number, interfaceMode: number, data: Buffer): EscIdentity {
  if (data.length !== 0x70 && data.length !== 0xff) throw new Error('Incomplete ESC settings block.');
  const firmwareName = ascii(data.subarray(0x60, 0x70));
  const layout = ascii(data.subarray(0x40, 0x50));
  const mcu = ascii(data.subarray(0x50, 0x60));
  const valid = data[0x0d] === 0x55 && data[0x0e] === 0xaa && /^#[A-Z0-9_]+#$/.test(layout) && mcu.includes('BLHELI');
  const bluejay = valid && /^Bluejay(?:\s|$)/.test(firmwareName);
  // Blank names on other revisions can be third-party firmware. Do not guess.
  const blheli = valid && firmwareName === '' && data[0] === 16 && data[1] <= 7 && [32, 33].includes(data[2]);
  const firmware = bluejay ? 'Bluejay' : blheli ? 'BLHeli_S' : 'Unknown';
  const knownLayout = bluejay ? data[2] >= 200 && data[2] <= 208 : blheli;
  const directions: Record<number, string> = { 1: 'Normal', 2: 'Reversed', 3: 'Bidirectional', 4: 'Bidirectional reversed' };
  return {
    index, signature: `0x${signature.toString(16).toUpperCase()}`, interfaceMode,
    firmware, firmwareName, version: `${data[0]}.${data[1]}`, layout: layout.replaceAll('#', '').replaceAll('_', '-'),
    layoutRevision: data[2], mcu, settingsHex: data.toString('hex'),
    ...(knownLayout ? { direction: directions[data[0x0b]] ?? 'Unknown', beepStrength: data[0x1b], beaconStrength: data[0x1c] } : {}),
    startupMelody: bluejay && knownLayout && data.length === 0xff ? 'supported' : blheli ? 'unsupported' : 'unknown',
  };
}
