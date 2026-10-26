import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeEscSettings, EscTransport } from './esc-protocol';
import type { EscIdentity } from './esc-types';

export const BLUEJAY = {
  name: 'Bluejay 0.21.0 · J-H-40 · 24 kHz',
  file: 'J_H_40_24_v0.21.0.hex',
  url: 'https://github.com/bird-sanctuary/bluejay/releases/download/v0.21.0/J_H_40_24_v0.21.0.hex',
  sha256: 'fb8a2cae07f283882a65bc90ac228456a74c5c3eaaef59e85f0df5957f98c1ae',
} as const;
export const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

/** Strict Intel HEX parser, with no overlap, extended addressing or bootloader writes. */
export function parseBluejayHex(text: string): Buffer {
  const image = Buffer.alloc(0x2000, 255), seen = new Set<number>();
  let ended = false;
  for (const line of text.trim().split(/\r?\n/)) {
    if (ended || !/^:(?:[\da-fA-F]{2})+$/.test(line)) throw new Error('Invalid firmware HEX record.');
    const record = Buffer.from(line.slice(1), 'hex');
    if (record.length !== record[0] + 5 || record.reduce((sum, x) => sum + x, 0) % 256)
      throw new Error('Firmware HEX checksum failed.');
    const address = record.readUInt16BE(1), type = record[3];
    if (type === 1 && record[0] === 0 && address === 0) { ended = true; continue; }
    if (type !== 0 || address + record[0] > image.length) throw new Error('Unsupported firmware memory range.');
    for (let i = 0; i < record[0]; i++) {
      if (seen.has(address + i)) throw new Error('Overlapping firmware HEX records.');
      seen.add(address + i); image[address + i] = record[4 + i];
    }
  }
  const esc = decodeEscSettings(1, 0xe8b2, 1, image.subarray(0x1a00, 0x1aff));
  if (!ended || image[0] !== 2 || image.readUInt16BE(1) >= 0x1a00 ||
      esc.firmware !== 'Bluejay' || esc.version !== '0.21' || esc.layoutRevision !== 208 ||
      esc.firmwareName !== 'Bluejay (.0)' || esc.layout !== 'J-H-40' || esc.mcu !== '#BLHELI$EFM8B21#' || image[0x1a0a] !== 24)
    throw new Error('Firmware identity does not match the pinned J-H-40 release.');
  return image;
}
export async function loadBluejayImage() {
  const hex = await readFile(resolve('firmware', 'bluejay', BLUEJAY.file));
  if (digest(hex) !== BLUEJAY.sha256) throw new Error('Official Bluejay firmware checksum does not match.');
  return parseBluejayHex(hex.toString('utf8'));
}

export function startupImage(current: Buffer, identity: EscIdentity, firmware: Buffer, melody: Uint8Array) {
  const stock = identity.firmware === 'BLHeli_S' && identity.version === '16.7' && identity.layoutRevision === 33;
  const bluejay = identity.firmware === 'Bluejay' && identity.version === '0.21' && identity.layoutRevision === 208 && identity.firmwareName === 'Bluejay (.0)';
  if (current.length !== 0x2000 || firmware.length !== 0x2000 || melody.length !== 128 ||
      identity.signature !== '0xE8B2' || identity.interfaceMode !== 1 || identity.layout !== 'J-H-40' ||
      identity.mcu !== '#BLHELI$EFM8B21#' || !(stock || bluejay) || ![1, 2].includes(current[0x1a0b]))
    throw new Error('Startup installation supports J-H-40 / EFM8BB2 with BLHeli_S 16.7 or Bluejay 0.21.0, normal/reversed direction only.');
  // Require the physical target bytes, including padding, to match the release.
  if (!current.subarray(0x1a40, 0x1a60).equals(firmware.subarray(0x1a40, 0x1a60)))
    throw new Error('ESC target or MCU bytes do not match the official firmware.');
  const image = Buffer.from(current);
  if (stock) {
    firmware.copy(image, 0, 0, 0x1c00); // Never copy the release's bootloader over the device's bootloader.
    // Same encoding across both firmwares. Other control settings use Bluejay defaults.
    for (const offset of [0x0b, 0x1b, 0x1c, 0x1d]) image[0x1a00 + offset] = current[0x1a00 + offset];
  }
  image[0x1a05] = 1; // Play custom melody at startup.
  image.set(melody, 0x1a70);
  return { image, action: stock ? 'upgrade' as const : 'melody' as const };
}

export async function readEscImage(transport: EscTransport) {
  const image = Buffer.alloc(0x2000);
  for (let address = 0; address < image.length; address += 128)
    (await transport.readMemory(address, 128)).copy(image, address);
  return image;
}
async function verify(transport: EscTransport, address: number, expected: Buffer) {
  for (let offset = 0; offset < expected.length; offset += 128) {
    const part = expected.subarray(offset, offset + 128);
    if (!(await transport.readMemory(address + offset, part.length)).equals(part))
      throw new Error(`ESC readback mismatch at 0x${(address + offset).toString(16)}. Stop and recover this ESC before use.`);
  }
}
async function writePage(transport: EscTransport, page: number, image: Buffer) {
  const address = page * 512;
  await transport.erasePage(page);
  for (let offset = 0; offset < 512; offset += 256)
    await transport.writeMemory(address + offset, image.subarray(address + offset, address + offset + 256));
  await verify(transport, address, image.subarray(address, address + 512));
}

/** BB2 sequence follows the upstream ESC Configurator's EEPROM marker + bootloader
 * failsafe order. No retries on ambiguous timeouts and no chip/bootloader erase. */
export async function installEscImage(transport: EscTransport, before: Buffer, after: Buffer, action: 'upgrade' | 'melody', progress: (text: string) => void) {
  if (before.length !== 0x2000 || after.length !== 0x2000 || !before.subarray(0x1c00).equals(after.subarray(0x1c00)))
    throw new Error('The bootloader must remain unchanged.');
  if (before.equals(after)) return;
  if (action === 'upgrade') {
    progress('Writing recovery marker');
    const marker = Buffer.from(before.subarray(0x1a00, 0x1a70));
    marker.fill(32, 0x60); marker.write('**FLASH*FAILED**', 0x60);
    await transport.erasePage(13);
    await transport.writeMemory(0x1a00, marker);
    await verify(transport, 0x1a00, marker);
    progress('Preparing bootloader recovery path');
    await transport.erasePage(1);
    const jump = Buffer.from([0x02, 0x1c, 0x00]);
    await transport.writeMemory(512, jump);
    await verify(transport, 512, jump);
    await transport.erasePage(0);
    await verify(transport, 0, Buffer.alloc(512, 255));
    for (let page = 2; page < 13; page++) {
      progress(`Writing and verifying firmware page ${page} of 13`);
      await writePage(transport, page, after);
    }
    // Restore the reset vector only after the application body has verified.
    for (const page of [0, 1]) await writePage(transport, page, after);
  } else {
    if (!before.subarray(0, 0x1a00).equals(after.subarray(0, 0x1a00)))
      throw new Error('A melody installation cannot change firmware.');
    for (let i = 0x1a00; i < 0x1c00; i++)
      if (i !== 0x1a05 && !(i >= 0x1a70 && i < 0x1af0) && before[i] !== after[i])
        throw new Error('A melody installation cannot change motor settings.');
  }
  progress('Writing startup melody and verifying complete image');
  await writePage(transport, 13, after);
  await verify(transport, 0, after); // Includes unchanged bootloader.
}
