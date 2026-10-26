import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { encodeBluejayMelody } from '../platform/bluejay-melody';
import { motifs } from '../platform/music-model';
import { BLUEJAY, digest, loadBluejayImage, parseBluejayHex, startupImage, installEscImage } from './esc-startup';
import { decodeEscSettings, EscTransport } from './esc-protocol';
import { fourReply, settings } from './esc-test-fixtures';

function stock() {
  const image = Buffer.alloc(8192, 0xa5);
  settings().copy(image, 0x1a00);
  return image;
}
describe('Bluejay startup preparation', () => {
  it('matches the upstream converter for First light, including metadata and note quantization', () => {
    expect([...encodeBluejayMelody(motifs[0]).slice(0, 12)]).toEqual([0, 144, 5, 4, 55, 138, 69, 107, 82, 87, 218, 61]);
    for (const tune of motifs) expect(encodeBluejayMelody(tune)).toHaveLength(128);
  });
  it('rejects unsupported pitches, slot overflow and excessive duration without truncating melodies', () => {
    expect(() => encodeBluejayMelody({ name: 'low', bpm: 120, notes: [{ midi: 48, beats: 1 }] })).toThrow('tone range');
    expect(() => encodeBluejayMelody({ name: 'overflow', bpm: 240, notes: Array.from({ length: 128 }, () => ({ midi: 84, beats: 0.125 })) })).toThrow('62 tone slots');
    expect(() => encodeBluejayMelody({ name: 'long', bpm: 60, notes: [{ midi: 60, beats: 4 }, { midi: 60, beats: 4 }, { midi: 60, beats: 4 }] })).toThrow('10 seconds');
  });
  it('checks the pinned release hash, HEX record checksum, identity and complete EOF', async () => {
    const hex = await readFile(`firmware/bluejay/${BLUEJAY.file}`);
    expect(digest(hex)).toBe(BLUEJAY.sha256);
    expect(await loadBluejayImage()).toHaveLength(8192);
    expect(() => parseBluejayHex(hex.toString().replace(':06000000', ':06000001'))).toThrow();
    expect(() => parseBluejayHex(hex.toString().replace(':00000001FF', ''))).toThrow();
  });
  it('preserves direction, beep settings and original bootloader while using known Bluejay defaults', async () => {
    const before = stock(), firmware = await loadBluejayImage(), melody = encodeBluejayMelody(motifs[0]);
    const identity = decodeEscSettings(2, 0xe8b2, 1, before.subarray(0x1a00, 0x1aff));
    const { image, action } = startupImage(before, identity, firmware, melody);
    expect(action).toBe('upgrade'); expect(image[0x1a0b]).toBe(2);
    for (const offset of [0x1b, 0x1c, 0x1d]) expect(image[0x1a00 + offset]).toBe(before[0x1a00 + offset]);
    expect(image.subarray(0x1c00)).toEqual(before.subarray(0x1c00));
    expect(image.subarray(0x1a70, 0x1af0)).toEqual(Buffer.from(melody));
    expect(image[0x1a23]).toBe(0); expect(image[0x1a04]).toBe(firmware[0x1a04]);
    expect(() => startupImage(before, { ...identity, layout: 'J-H-30' }, firmware, melody)).toThrow('supports');
    before[0x1a0b] = 3; expect(() => startupImage(before, identity, firmware, melody)).toThrow('supports');
  });
  it('changes only the melody and enable flag on an existing matching Bluejay installation', async () => {
    const before = await loadBluejayImage(); before[0x1a0b] = 2; before[0x1a23] = 7;
    const { image, action } = startupImage(before, decodeEscSettings(1, 0xe8b2, 1, before.subarray(0x1a00, 0x1aff)), await loadBluejayImage(), encodeBluejayMelody(motifs[0]));
    expect(action).toBe('melody');
    const changed = [...image.keys()].filter(i => image[i] !== before[i]);
    expect(changed.every(i => i === 0x1a05 || i >= 0x1a70 && i < 0x1af0)).toBe(true);
  });
});

describe('bounded ESC flash writer', () => {
  it('requires a write capability and rejects bootloader/lock-byte erasure and writes', async () => {
    const readOnly = new EscTransport(async () => {});
    await expect(readOnly.erasePage(13)).rejects.toThrow('authorized');
    await expect(readOnly.writeMemory(0, Buffer.of(0))).rejects.toThrow('authorized');
    const writer = new EscTransport(async () => {}, 100, true);
    await expect(writer.erasePage(14)).rejects.toThrow('application');
    await expect(writer.writeMemory(0x1c00, Buffer.of(0))).rejects.toThrow('application');
    await expect(writer.writeMemory(511, Buffer.of(0, 0))).rejects.toThrow('application');
  });
  it('flashes through the real frame encoder, verifies the full image and never touches bootloader pages', async () => {
    const before = stock(), after = (await startupImage(before, decodeEscSettings(1, 0xe8b2, 1, before.subarray(0x1a00, 0x1aff)), await loadBluejayImage(), encodeBluejayMelody(motifs[0]))).image;
    const memory = Buffer.from(before), erased: number[] = [];
    const transport = new EscTransport(async frame => {
      const address = frame.readUInt16BE(2);
      let payload = Buffer.of(0);
      if (frame[1] === 0x39) { erased.push(frame[5]); memory.fill(255, frame[5] * 512, (frame[5] + 1) * 512); }
      if (frame[1] === 0x3b) {
        const bytes = frame.subarray(5, 5 + (frame[4] || 256));
        bytes.forEach((b, i) => { memory[address + i] &= b; });
      }
      if (frame[1] === 0x3a) payload = memory.subarray(address, address + (frame[5] || 256));
      transport.push(fourReply(frame[1], payload, address));
    }, 100, true);
    await installEscImage(transport, before, after, 'upgrade', () => {});
    expect(memory).toEqual(after); expect(erased.slice(0, 3)).toEqual([13, 1, 0]); expect(Math.max(...erased)).toBe(13);
  });
  it('stops on readback corruption before proceeding to the reset vector or next ESC', async () => {
    const firmware = await loadBluejayImage(); const commands: number[] = [];
    const transport = new EscTransport(async frame => {
      commands.push(frame[1]);
      transport.push(fourReply(frame[1], frame[1] === 0x3a ? Buffer.alloc(frame[5], 0) : [0], frame.readUInt16BE(2)));
    }, 100, true);
    const before = Buffer.from(firmware); before[0x1a70] ^= 1;
    await expect(installEscImage(transport, before, firmware, 'upgrade', () => {})).rejects.toThrow('readback mismatch');
    expect(commands).toEqual([0x39, 0x3b, 0x3a]);
  });
});
