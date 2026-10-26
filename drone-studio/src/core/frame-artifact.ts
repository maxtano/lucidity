import {
  MAX_CAPTURE_PIXELS,
  MAX_CAPTURE_PNG_BYTES,
  parseCaptureMetadata,
  type CapturedAudienceFrame,
  type CaptureMetadata,
} from './frame-capture';

const MAGIC = new Uint8Array([76, 85, 67, 68, 70, 82, 77, 0]); // LUCDFRM\0
const HEADER_BYTES = 20;
const DIGEST_BYTES = 32;
const MAX_METADATA_BYTES = 16 * 1024;
export const MAX_FRAME_ARTIFACT_BYTES =
  HEADER_BYTES + MAX_METADATA_BYTES + MAX_CAPTURE_PNG_BYTES + DIGEST_BYTES;
const MIME = 'application/vnd.lucidity.audience-frame';
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException('Audience frame bundle operation cancelled.', 'AbortError');
}
async function cancellable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  checkAbort(signal);
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(new DOMException('Audience frame bundle operation cancelled.', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      }
    );
  });
}
function canonicalJson(value: unknown): string {
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
function assertJsonDepth(text: string) {
  let depth = 0,
    quoted = false,
    escaped = false;
  for (const character of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{' || character === '[') {
      if (++depth > 8) throw new Error('Frame bundle metadata exceeds the nesting limit.');
    } else if (character === '}' || character === ']') depth--;
  }
}
function crc32(bytes: Uint8Array, start: number, end: number) {
  let crc = 0xffffffff;
  for (let index = start; index < end; index++)
    crc = crcTable[(crc ^ bytes[index]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Validate filtered bytes without retaining inflated pixels or reconstructing the image. */
async function validatePngPixels(
  parts: Uint8Array<ArrayBuffer>[],
  width: number,
  height: number,
  color: number,
  depth: number,
  interlace: number,
  signal?: AbortSignal
) {
  checkAbort(signal);
  let decoder: DecompressionStream;
  try {
    if (typeof DecompressionStream !== 'function') throw new Error('Unavailable');
    decoder = new DecompressionStream('deflate');
  } catch {
    throw new Error(
      'This browser cannot validate PNG compressed data. Use a browser with DecompressionStream deflate support.'
    );
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
  // PNG Adam7 passes: start x/y and x/y step. Empty passes have no filter bytes.
  // https://www.w3.org/TR/png-3/#8Interlace
  const grid =
    interlace === 0
      ? [[0, 0, 1, 1]]
      : [
          [0, 0, 8, 8],
          [4, 0, 8, 8],
          [0, 4, 4, 8],
          [2, 0, 4, 4],
          [0, 2, 2, 4],
          [1, 0, 2, 2],
          [0, 1, 1, 2],
        ];
  const passes = grid
    .map(([x, y, dx, dy]) => ({
      width: Math.max(0, Math.ceil((width - x) / dx)),
      height: Math.max(0, Math.ceil((height - y) / dy)),
    }))
    .filter((pass) => pass.width > 0 && pass.height > 0)
    .map((pass) => ({
      rows: pass.height,
      rowBytes: Math.ceil((pass.width * channels * depth) / 8),
    }));
  const expected = passes.reduce((sum, pass) => sum + pass.rows * (pass.rowBytes + 1), 0);
  if (!Number.isSafeInteger(expected) || expected <= 0 || expected > MAX_CAPTURE_PIXELS * 9)
    throw new Error('Frame bundle PNG inflated image exceeds its scanline budget.');
  let part = 0,
    partOffset = 0;
  const compressed = new ReadableStream<BufferSource>(
    {
      pull(controller) {
        while (part < parts.length && partOffset === parts[part].length) {
          part++;
          partOffset = 0;
        }
        if (part === parts.length) {
          controller.close();
          return;
        }
        // Bound each native decompression write; a single giant IDAT must not become
        // one giant native expansion before the consumer can enforce its byte budget.
        const end = Math.min(parts[part].length, partOffset + 4096);
        controller.enqueue(parts[part].subarray(partOffset, end));
        partOffset = end;
      },
    },
    { highWaterMark: 0 }
  );
  const reader = compressed.pipeThrough(decoder).getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  let total = 0,
    passIndex = 0,
    rows = 0,
    rowRemaining = 0,
    needsFilter = true,
    reads = 0,
    bytesSinceYield = 0;
  try {
    while (true) {
      checkAbort(signal);
      const { done, value } = await cancellable(reader.read(), signal);
      checkAbort(signal);
      if (done) break;
      total += value.byteLength;
      if (total > expected)
        throw new Error('Frame bundle PNG expands beyond its declared scanline length.');
      let offset = 0;
      while (offset < value.byteLength) {
        if (needsFilter) {
          if (rows === passes[passIndex].rows) {
            passIndex++;
            rows = 0;
          }
          if (!passes[passIndex] || value[offset++] > 4)
            throw new Error('Frame bundle PNG has an invalid scanline filter.');
          rowRemaining = passes[passIndex].rowBytes;
          needsFilter = false;
          bytesSinceYield++;
        }
        const consumed = Math.min(rowRemaining, value.byteLength - offset);
        offset += consumed;
        rowRemaining -= consumed;
        bytesSinceYield += consumed;
        if (rowRemaining === 0) {
          rows++;
          needsFilter = true;
        }
        if (bytesSinceYield >= 1_048_576) {
          bytesSinceYield = 0;
          await cancellable(new Promise<void>((resolve) => setTimeout(resolve, 0)), signal);
          checkAbort(signal);
        }
      }
      if (++reads % 64 === 0)
        await cancellable(new Promise<void>((resolve) => setTimeout(resolve, 0)), signal);
    }
    // Consume through EOF even after the expected bytes: the native codec checks
    // its zlib trailer on close. WHATWG requires checksum/truncation/trailing errors,
    // but some native implementations ignore extra compressed input; this is not
    // a claim of canonical compressed-stream encoding.
    // https://compression.spec.whatwg.org/#supported-formats
    if (total !== expected) throw new Error('Frame bundle PNG has a truncated scanline stream.');
  } catch (error) {
    checkAbort(signal);
    if (error instanceof Error && error.message.startsWith('Frame bundle PNG ')) throw error;
    throw new Error('Frame bundle PNG compressed image data is invalid or truncated.', {
      cause: error,
    });
  } finally {
    signal?.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

/** Structure, checksums and bounded scanlines; consumers still browser-decode before publishing. */
async function validatePng(
  bytes: Uint8Array<ArrayBuffer>,
  metadata: CaptureMetadata,
  signal?: AbortSignal
) {
  checkAbort(signal);
  if (
    bytes.length < 45 ||
    bytes.length > MAX_CAPTURE_PNG_BYTES ||
    PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)
  )
    throw new Error('Frame bundle does not contain a bounded PNG image.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8,
    chunks = 0,
    color = -1,
    depth = 0,
    interlace = 0,
    palette = false,
    idat = 0,
    idatBytes = 0;
  const imageParts: Uint8Array<ArrayBuffer>[] = [];
  while (offset < bytes.length) {
    checkAbort(signal);
    if (++chunks > 4096) throw new Error('Frame bundle PNG exceeds the chunk-count limit.');
    if (offset + 12 > bytes.length) throw new Error('Frame bundle PNG is truncated.');
    const length = view.getUint32(offset, false),
      end = offset + 12 + length;
    if (end > bytes.length) throw new Error('Frame bundle PNG chunk is truncated.');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2].toUpperCase())
      throw new Error('Frame bundle PNG chunk type is invalid.');
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT')
      throw new Error(
        'Frame bundles contain one still image; animated PNG chunks are unsupported.'
      );
    if (view.getUint32(end - 4, false) !== crc32(bytes, offset + 4, end - 4))
      throw new Error('Frame bundle PNG chunk checksum is invalid.');
    if (chunks === 1 && type !== 'IHDR') throw new Error('Frame bundle PNG must begin with IHDR.');
    if (type === 'IHDR') {
      if (chunks !== 1 || length !== 13) throw new Error('Frame bundle PNG IHDR is invalid.');
      const width = view.getUint32(offset + 8, false),
        height = view.getUint32(offset + 12, false);
      if (
        !width ||
        !height ||
        width > MAX_CAPTURE_PIXELS ||
        height > MAX_CAPTURE_PIXELS ||
        width * height > MAX_CAPTURE_PIXELS ||
        width !== metadata.raster.width ||
        height !== metadata.raster.height
      )
        throw new Error('Frame bundle PNG dimensions do not match bounded capture metadata.');
      depth = bytes[offset + 16];
      color = bytes[offset + 17];
      interlace = bytes[offset + 20];
      const validDepths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        !validDepths[color]?.includes(depth) ||
        bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 ||
        bytes[offset + 20] > 1
      )
        throw new Error('Frame bundle PNG uses an invalid pixel format.');
    } else if (type === 'PLTE') {
      if (
        palette ||
        idat !== 0 ||
        !length ||
        length > 768 ||
        length % 3 ||
        color === 0 ||
        color === 4 ||
        (color === 3 && length / 3 > 2 ** depth)
      )
        throw new Error('Frame bundle PNG palette is invalid.');
      palette = true;
    } else if (type === 'IDAT') {
      if (idat === 2 || (color === 3 && !palette))
        throw new Error('Frame bundle PNG image chunks are out of order.');
      idat = 1;
      idatBytes += length;
      imageParts.push(bytes.subarray(offset + 8, end - 4));
    } else if (type === 'IEND') {
      if (length !== 0 || !idatBytes || end !== bytes.length)
        throw new Error('Frame bundle PNG ending is invalid.');
      checkAbort(signal);
      await validatePngPixels(
        imageParts,
        metadata.raster.width,
        metadata.raster.height,
        color,
        depth,
        interlace,
        signal
      );
      return;
    } else {
      if (type[0] === type[0].toUpperCase())
        throw new Error('Frame bundle PNG has an unsupported critical chunk.');
      if (idat === 1) idat = 2;
    }
    offset = end;
    if (chunks % 64 === 0)
      await cancellable(new Promise<void>((resolve) => setTimeout(resolve, 0)), signal);
  }
  throw new Error('Frame bundle PNG is missing its ending.');
}

async function readBlob(blob: Blob, maximum: number, signal?: AbortSignal) {
  checkAbort(signal);
  if (!(blob instanceof Blob) || !blob.size || blob.size > maximum)
    throw new Error('Frame bundle input is empty or exceeds its size limit.');
  const bytes = new Uint8Array(await cancellable(blob.arrayBuffer(), signal));
  checkAbort(signal);
  if (bytes.length !== blob.size)
    throw new Error('Frame bundle input length changed while reading.');
  return bytes;
}

/** A checksum protects byte integrity only; it does not authenticate a model, author, or project. */
export async function serializeFrameArtifact(
  frame: CapturedAudienceFrame,
  signal?: AbortSignal
): Promise<Blob> {
  checkAbort(signal);
  // Capture all caller-owned metadata and the immutable Blob reference before yielding.
  const metadata = parseCaptureMetadata(frame.metadata),
    image = frame.blob;
  if (!(image instanceof Blob) || image.type !== 'image/png')
    throw new Error('Frame bundle requires a PNG image.');
  const encoded = new TextEncoder().encode(canonicalJson(metadata));
  if (encoded.length > MAX_METADATA_BYTES) throw new Error('Frame bundle metadata exceeds 16 KiB.');
  const png = await readBlob(image, MAX_CAPTURE_PNG_BYTES, signal);
  await validatePng(png, metadata, signal);
  checkAbort(signal);
  const body = new Uint8Array(HEADER_BYTES + encoded.length + png.length);
  body.set(MAGIC);
  const header = new DataView(body.buffer);
  header.setUint32(8, 1, false);
  header.setUint32(12, encoded.length, false);
  header.setUint32(16, png.length, false);
  body.set(encoded, HEADER_BYTES);
  body.set(png, HEADER_BYTES + encoded.length);
  const digest = await cancellable(crypto.subtle.digest('SHA-256', body), signal);
  checkAbort(signal);
  return new Blob([body, digest], { type: MIME });
}

/** Bounded image-data import. The UI must decode the returned PNG before replacing its still. */
export async function parseFrameArtifact(
  file: Blob,
  signal?: AbortSignal
): Promise<CapturedAudienceFrame> {
  const bytes = await readBlob(file, MAX_FRAME_ARTIFACT_BYTES, signal);
  if (
    bytes.length < HEADER_BYTES + 1 + 45 + DIGEST_BYTES ||
    MAGIC.some((byte, index) => bytes[index] !== byte)
  )
    throw new Error('This file is not a Lucidity audience frame bundle.');
  const header = new DataView(bytes.buffer);
  if (header.getUint32(8, false) !== 1) throw new Error('Unsupported frame bundle version.');
  const metadataLength = header.getUint32(12, false),
    pngLength = header.getUint32(16, false);
  if (
    !metadataLength ||
    metadataLength > MAX_METADATA_BYTES ||
    pngLength < 45 ||
    pngLength > MAX_CAPTURE_PNG_BYTES ||
    HEADER_BYTES + metadataLength + pngLength + DIGEST_BYTES !== bytes.length
  )
    throw new Error('Frame bundle lengths are invalid or the file is truncated.');
  const bodyLength = bytes.length - DIGEST_BYTES;
  const digest = new Uint8Array(
    await cancellable(crypto.subtle.digest('SHA-256', bytes.subarray(0, bodyLength)), signal)
  );
  checkAbort(signal);
  if (digest.some((byte, index) => byte !== bytes[bodyLength + index]))
    throw new Error('Frame bundle checksum mismatch; the file was changed or damaged.');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
    bytes.subarray(HEADER_BYTES, HEADER_BYTES + metadataLength)
  );
  assertJsonDepth(text);
  const metadata = parseCaptureMetadata(JSON.parse(text));
  if (canonicalJson(metadata) !== text)
    throw new Error('Frame bundle metadata is not canonical JSON.');
  const png = bytes.subarray(HEADER_BYTES + metadataLength, bodyLength);
  await validatePng(png, metadata, signal);
  checkAbort(signal);
  return { metadata, blob: new Blob([png], { type: 'image/png' }) };
}
