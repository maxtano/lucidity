/** Synthetic PNG fixtures for local review-file checks. Never reads or changes saved shows. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { parseFrameArtifact, serializeFrameArtifact } from '../src/core/frame-artifact';
import { buildCaptureMetadata } from '../src/core/frame-capture';
import { defaultProject } from '../src/core/model';
import { DEFAULT_VENUE_PLACEMENT, DEFAULT_VIEWER_POSE } from '../src/core/viewer';

const width = 256,
  height = 128;
function chunk(type: string, data: Buffer) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  payload.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
const pixels = Buffer.alloc(height * (width * 4 + 1));
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const offset = y * (width * 4 + 1) + 1 + x * 4;
    const dot = x % 24 < 3 && y % 20 < 3;
    const stage = y >= 106 && x >= 108 && x <= 148;
    pixels[offset] = dot ? 200 : stage ? 60 : 8;
    pixels[offset + 1] = dot ? 150 : stage ? 110 : 13;
    pixels[offset + 2] = dot ? 255 : stage ? 150 : 24;
    pixels[offset + 3] = 255;
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8;
ihdr[9] = 6;
function png(imageData: Buffer) {
  return new Blob(
    [
      Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr),
        chunk('IDAT', imageData),
        chunk('IEND', Buffer.alloc(0)),
      ]),
    ],
    { type: 'image/png' }
  );
}
const project = structuredClone(defaultProject);
project.id = 'synthetic-review-fixture';
project.name = 'Synthetic review fixture';
const metadata = buildCaptureMetadata({
  project,
  version: 'base',
  sharedTime: 12,
  sampledTime: 12,
  viewer: { pose: { ...DEFAULT_VIEWER_POSE }, venue: { ...DEFAULT_VENUE_PLACEMENT } },
  aspect: width / height,
  framing: 'viewport',
  raster: { width, height },
  appearance: { glow: 0.85, exposure: 1.15 },
  createdAt: '2026-09-27T10:40:00.000Z',
});
const valid = await serializeFrameArtifact({ metadata, blob: png(deflateSync(pixels)) });
const tampered = new Uint8Array(await valid.arrayBuffer());
tampered[tampered.length - 1] ^= 1;
// Build this negative fixture without the serializer: its PNG CRC and container digest
// are correct, but its compressed pixel data is invalid. Some browser Image decoders
// accept it as a blank image, which is why core validation must check inflation too.
const validBytes = new Uint8Array(await valid.arrayBuffer());
const metadataLength = new DataView(validBytes.buffer).getUint32(12, false);
const badPng = new Uint8Array(await png(Buffer.from([0, 1, 2, 3])).arrayBuffer());
const invalidBody = new Uint8Array(20 + metadataLength + badPng.length);
invalidBody.set(validBytes.subarray(0, 20 + metadataLength));
new DataView(invalidBody.buffer).setUint32(16, badPng.length, false);
invalidBody.set(badPng, 20 + metadataLength);
const undecodable = new Blob([invalidBody, await crypto.subtle.digest('SHA-256', invalidBody)]);
const parsed = await parseFrameArtifact(valid);
if (JSON.stringify(parsed.metadata) !== JSON.stringify(metadata))
  throw new Error('Fixture round trip failed.');
try {
  await parseFrameArtifact(new Blob([tampered]));
  throw new Error('Tampered fixture unexpectedly accepted.');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('checksum mismatch')) throw error;
}
try {
  await parseFrameArtifact(undecodable);
  throw new Error('Invalid compressed pixels unexpectedly accepted.');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('compressed image data')) throw error;
}
const destination = resolve(process.argv[2] ?? 'artifacts/frame-fixtures');
await mkdir(destination, { recursive: true });
for (const [name, bytes] of [
  ['synthetic-valid.lucid-frame', new Uint8Array(await valid.arrayBuffer())],
  ['synthetic-tampered.lucid-frame', tampered],
  ['synthetic-undecodable.lucid-frame', new Uint8Array(await undecodable.arrayBuffer())],
] as const)
  await writeFile(resolve(destination, name), bytes, { flag: 'wx' });
console.log(
  `Wrote three synthetic review fixtures to ${destination}. Valid round trip, checksum rejection, and compressed-data rejection passed.`
);
