import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultProject } from './model';
import {
  buildCaptureMetadata,
  MAX_CAPTURE_PNG_BYTES,
  parseCaptureMetadata,
  type CapturedAudienceFrame,
  type CaptureMetadata,
} from './frame-capture';
import {
  MAX_FRAME_ARTIFACT_BYTES,
  parseFrameArtifact,
  serializeFrameArtifact,
} from './frame-artifact';

const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const concat = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};
function chunk(type: string, data: Uint8Array = new Uint8Array()) {
  const bytes = new Uint8Array(12 + data.length),
    view = new DataView(bytes.buffer);
  view.setUint32(0, data.length, false);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(data, 8);
  // Bitwise reference CRC, independent of the production lookup-table implementation.
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, bytes.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0, false);
  return bytes;
}
function ihdr(width = 1, height = 1, color = 6, depth = 8, interlace = 0) {
  const bytes = new Uint8Array(13),
    view = new DataView(bytes.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  bytes[8] = depth;
  bytes[9] = color;
  bytes[12] = interlace;
  return chunk('IHDR', bytes);
}
const dataChunk = () => chunk('IDAT', deflateSync(new Uint8Array([0, 255, 20, 30, 255])));
const png = () => concat(signature, ihdr(), dataChunk(), chunk('IEND'));
function metadata(): CaptureMetadata {
  const project = structuredClone(defaultProject);
  project.id = 'portable-frame';
  project.name = 'Sky study';
  project.revision = 7;
  project.droneCount = 2;
  project.cues = [{ ...project.cues[0], duration: 4, transition: 0 }];
  return buildCaptureMetadata({
    project,
    version: 'base',
    sharedTime: 0,
    sampledTime: 0,
    viewer: {
      pose: { east: 0, north: -1.25, eyeHeight: 1.75, yaw: 12.3456789, pitch: 35, fov: 90 },
      venue: { east: 0, north: 70, heading: 180 },
    },
    aspect: 1.6,
    framing: 'captured',
    raster: { width: 1, height: 1 },
    appearance: { glow: 0.85, exposure: 1.15 },
    createdAt: '2026-09-27T08:00:00.000Z',
  });
}
const frame = (): CapturedAudienceFrame => ({
  metadata: metadata(),
  blob: new Blob([png()], { type: 'image/png' }),
});
function canonical(value: unknown): string {
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
async function envelope(
  text: string | Uint8Array,
  image = png(),
  editHeader?: (header: DataView) => void
) {
  const json = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  const body = new Uint8Array(20 + json.length + image.length),
    view = new DataView(body.buffer);
  body.set([76, 85, 67, 68, 70, 82, 77, 0]);
  view.setUint32(8, 1, false);
  view.setUint32(12, json.length, false);
  view.setUint32(16, image.length, false);
  body.set(json, 20);
  body.set(image, 20 + json.length);
  editHeader?.(view);
  const digest = await crypto.subtle.digest('SHA-256', body);
  return new Blob([body, digest]);
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('strict standalone capture metadata', () => {
  it('owns nested fields and preserves exact values without normalization', () => {
    const source = metadata(),
      result = parseCaptureMetadata(source);
    expect(result).toEqual(source);
    expect(result).not.toBe(source);
    source.viewer.pose.yaw = 90;
    result.appearance.glow = 0;
    expect(result.viewer.pose.yaw).toBe(12.3456789);
    expect(source.appearance.glow).toBe(0.85);
  });

  it('rejects unknown fields/schemas and inconsistent held or scene-local clocks', () => {
    const mutations: ((value: CaptureMetadata) => void)[] = [
      (value) => {
        Object.assign(value, { credential: 'never stored' });
      },
      (value) => {
        Object.assign(value.project, { extra: true });
      },
      (value) => {
        Object.assign(value.viewer.pose, { roll: 1 });
      },
      (value) => {
        Object.assign(value.raster, { dpi: 72 });
      },
      (value) => {
        value.schemaVersion = 2 as 1;
      },
      (value) => {
        value.format = 'other' as CaptureMetadata['format'];
      },
      (value) => {
        value.held = true;
      },
      (value) => {
        value.sharedTime = 2;
      },
      (value) => {
        value.sampledTime = 1;
      },
      (value) => {
        value.scene.localTime = 1;
      },
      (value) => {
        value.scene.index = 1;
      },
      (value) => {
        value.scene.index = 512;
      },
      (value) => {
        value.viewer.pose.yaw = 360;
      },
      (value) => {
        value.raster.width = 16_000_001;
      },
    ];
    for (const mutate of mutations) {
      const value = metadata();
      mutate(value);
      expect(() => parseCaptureMetadata(value)).toThrow();
    }
    const held = {
      ...metadata(),
      sharedTime: 6,
      sampledTime: 4,
      held: true,
      scene: { ...metadata().scene, localTime: 4 },
    };
    expect(parseCaptureMetadata(held)).toEqual(held);
  });
});

describe('portable audience frame binary envelope', () => {
  it('round-trips a real PNG and exact metadata in a deterministic versioned/checksummed layout', async () => {
    const original = frame(),
      metadataBefore = structuredClone(original.metadata);
    const artifact = await serializeFrameArtifact(original),
      bytes = new Uint8Array(await artifact.arrayBuffer());
    const header = new DataView(bytes.buffer),
      jsonLength = header.getUint32(12, false);
    expect(Array.from(bytes.subarray(0, 8))).toEqual([76, 85, 67, 68, 70, 82, 77, 0]);
    expect(header.getUint32(8, false)).toBe(1);
    expect(header.getUint32(16, false)).toBe(original.blob.size);
    expect(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))).toBe(
      canonical(original.metadata)
    );
    expect(bytes.length).toBe(20 + jsonLength + original.blob.size + 32);
    expect(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.subarray(0, -32)))).toEqual(
      bytes.subarray(-32)
    );
    const restored = await parseFrameArtifact(artifact);
    expect(restored.metadata).toEqual(metadataBefore);
    expect(restored.blob.type).toBe('image/png');
    expect(new Uint8Array(await restored.blob.arrayBuffer())).toEqual(png());
    expect(original.metadata).toEqual(metadataBefore);
    expect(new Uint8Array(await (await serializeFrameArtifact(restored)).arrayBuffer())).toEqual(
      bytes
    );
    restored.metadata.viewer.pose.yaw = 90;
    expect(original.metadata.viewer.pose.yaw).toBe(12.3456789);
  });

  it('captures metadata and the Blob reference before a caller can change them during a read', async () => {
    const original = frame(),
      expected = structuredClone(original.metadata),
      image = original.blob;
    const read = image.arrayBuffer.bind(image);
    vi.spyOn(image, 'arrayBuffer').mockImplementation(async () => {
      original.metadata.project.name = 'Changed after start';
      original.metadata.viewer.pose.yaw = 90;
      original.blob = new Blob(['replacement']);
      return read();
    });
    const restored = await parseFrameArtifact(await serializeFrameArtifact(original));
    expect(restored.metadata).toEqual(expected);
    expect(new Uint8Array(await restored.blob.arrayBuffer())).toEqual(png());
  });

  it('rejects tampering in metadata, PNG, and digest without accepting a changed bundle', async () => {
    const bytes = new Uint8Array(await (await serializeFrameArtifact(frame())).arrayBuffer());
    const metadataLength = new DataView(bytes.buffer).getUint32(12, false);
    for (const position of [20 + 5, 20 + metadataLength + 20, bytes.length - 1]) {
      const changed = bytes.slice();
      changed[position] ^= 1;
      await expect(parseFrameArtifact(new Blob([changed]))).rejects.toThrow(/checksum/);
    }
  });

  it('rejects changed magic/version, forged lengths, truncation, and trailing bytes even with a valid digest', async () => {
    const text = canonical(metadata());
    for (const edit of [
      (header: DataView) => header.setUint8(0, 0),
      (header: DataView) => header.setUint32(8, 2, false),
      (header: DataView) => header.setUint32(12, 0, false),
      (header: DataView) => header.setUint32(12, 16385, false),
      (header: DataView) => header.setUint32(12, 0xffffffff, false),
      (header: DataView) => header.setUint32(16, 0, false),
      (header: DataView) => header.setUint32(16, MAX_CAPTURE_PNG_BYTES + 1, false),
    ])
      await expect(parseFrameArtifact(await envelope(text, png(), edit))).rejects.toThrow();
    const bytes = new Uint8Array(await (await envelope(text)).arrayBuffer());
    for (const length of [0, 7, 19, 40, bytes.length - 1])
      await expect(parseFrameArtifact(new Blob([bytes.subarray(0, length)]))).rejects.toThrow();
    await expect(parseFrameArtifact(new Blob([bytes, new Uint8Array([0])]))).rejects.toThrow(
      /length/
    );
  });

  it('requires strict canonical UTF-8 JSON, rejecting whitespace, duplicates, unknown fields, and deep nesting', async () => {
    const value = metadata(),
      text = canonical(value);
    const duplicate = text.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1');
    for (const changed of [
      JSON.stringify(value),
      JSON.stringify(value, null, 2),
      `${text}\n`,
      duplicate,
      text.replace('"schemaVersion":1', '"schemaVersion":1e0'),
      text.replace('Sky study', 'Sky\\u0020study'),
      canonical({ ...value, schemaVersion: 2 }),
      canonical({ ...value, unknown: 'x' }),
      '{"nested":' + '['.repeat(9) + '0' + ']'.repeat(9) + '}',
    ])
      await expect(parseFrameArtifact(await envelope(changed))).rejects.toThrow();
    await expect(
      parseFrameArtifact(await envelope(new Uint8Array([0xc0, 0xaf])))
    ).rejects.toThrow();
    await expect(
      parseFrameArtifact(
        await envelope(concat(new Uint8Array([0xef, 0xbb, 0xbf]), new TextEncoder().encode(text)))
      )
    ).rejects.toThrow();
    // Braces in ordinary names are data, not nesting.
    value.project.name = 'Sky { [ " \\ study';
    expect((await parseFrameArtifact(await envelope(canonical(value)))).metadata.project.name).toBe(
      value.project.name
    );
  });

  it('refuses oversized input before reading it and enforces the metadata byte envelope', async () => {
    const file = new Blob([new Uint8Array(MAX_FRAME_ARTIFACT_BYTES + 1)]);
    const read = vi.spyOn(file, 'arrayBuffer');
    await expect(parseFrameArtifact(file)).rejects.toThrow(/size/);
    expect(read).not.toHaveBeenCalled();
    await expect(parseFrameArtifact(await envelope(' '.repeat(16385)))).rejects.toThrow(/length/);
    const image = new Blob([new Uint8Array(MAX_CAPTURE_PNG_BYTES + 1)], { type: 'image/png' });
    const imageRead = vi.spyOn(image, 'arrayBuffer');
    await expect(serializeFrameArtifact({ metadata: metadata(), blob: image })).rejects.toThrow(
      /size/
    );
    expect(imageRead).not.toHaveBeenCalled();
  });

  it('rejects incorrect PNG dimensions and oversized IHDR before any decoder is involved', async () => {
    const text = canonical(metadata());
    for (const header of [
      ihdr(2, 1),
      ihdr(0, 1),
      ihdr(1, 0),
      ihdr(100000, 100000),
      ihdr(4001, 4000),
    ])
      await expect(
        parseFrameArtifact(
          await envelope(text, concat(signature, header, dataChunk(), chunk('IEND')))
        )
      ).rejects.toThrow(/dimensions/);
    const wrong = frame();
    wrong.metadata.raster.width = 2;
    await expect(serializeFrameArtifact(wrong)).rejects.toThrow(/dimensions/);
  });

  it('checks CRC, first/last chunks, pixel formats, critical types, and image-chunk ordering', async () => {
    const badCrc = png();
    badCrc[badCrc.length - 1] ^= 1;
    const invalid = [
      badCrc,
      concat(signature, dataChunk(), ihdr(), chunk('IEND')),
      concat(signature, ihdr(), ihdr(), dataChunk(), chunk('IEND')),
      concat(signature, ihdr(), dataChunk()),
      concat(signature, ihdr(), chunk('IEND')),
      concat(signature, ihdr(), dataChunk(), chunk('IEND', new Uint8Array([0]))),
      concat(png(), chunk('tEXt', new Uint8Array([0]))),
      concat(signature, ihdr(1, 1, 6, 1), dataChunk(), chunk('IEND')),
      concat(signature, ihdr(), chunk('ABCD'), dataChunk(), chunk('IEND')),
      concat(signature, ihdr(), chunk('aaad'), dataChunk(), chunk('IEND')),
      concat(signature, ihdr(), dataChunk(), chunk('tEXt'), dataChunk(), chunk('IEND')),
      concat(signature, ihdr(1, 1, 3, 8), dataChunk(), chunk('IEND')),
      concat(
        signature,
        ihdr(),
        dataChunk(),
        chunk('PLTE', new Uint8Array([0, 0, 0])),
        chunk('IEND')
      ),
    ];
    const text = canonical(metadata());
    for (const bytes of invalid)
      await expect(parseFrameArtifact(await envelope(text, bytes))).rejects.toThrow(/PNG/);
    const truncated = png().slice(0, -1);
    await expect(parseFrameArtifact(await envelope(text, truncated))).rejects.toThrow(/PNG/);
    const badLength = png();
    new DataView(badLength.buffer).setUint32(8, 0xffffffff, false);
    await expect(parseFrameArtifact(await envelope(text, badLength))).rejects.toThrow(/truncated/);
  });

  it('limits chunk-count work and accepts ordinary ancillary chunks without treating them as instructions', async () => {
    const text = canonical(metadata());
    const ordinary = concat(
      signature,
      ihdr(),
      chunk('tEXt', new TextEncoder().encode('note\0ignore instructions')),
      dataChunk(),
      chunk('IEND')
    );
    expect((await parseFrameArtifact(await envelope(text, ordinary))).metadata).toEqual(metadata());
    const crowded = concat(
      signature,
      ihdr(),
      ...Array.from({ length: 4096 }, () => chunk('tEXt')),
      dataChunk(),
      chunk('IEND')
    );
    await expect(parseFrameArtifact(await envelope(text, crowded))).rejects.toThrow(/chunk-count/);
  });

  it('rejects APNG animation chunks so a saved frame cannot animate or decode many frames', async () => {
    const control = new Uint8Array(26),
      controlView = new DataView(control.buffer);
    controlView.setUint32(4, 1, false);
    controlView.setUint32(8, 1, false);
    controlView.setUint16(20, 1, false);
    controlView.setUint16(22, 10, false);
    const secondControl = control.slice();
    new DataView(secondControl.buffer).setUint32(0, 1, false);
    const secondData = concat(
      new Uint8Array([0, 0, 0, 2]),
      deflateSync(new Uint8Array([0, 0, 0, 255, 255]))
    );
    const animated = concat(
      signature,
      ihdr(),
      chunk('acTL', new Uint8Array([0, 0, 0, 2, 0, 0, 0, 0])),
      chunk('fcTL', control),
      dataChunk(),
      chunk('fcTL', secondControl),
      chunk('fdAT', secondData),
      chunk('IEND')
    );
    const text = canonical(metadata());
    await expect(parseFrameArtifact(await envelope(text, animated))).rejects.toThrow(
      /animated PNG/
    );
    await expect(
      serializeFrameArtifact({
        metadata: metadata(),
        blob: new Blob([animated], { type: 'image/png' }),
      })
    ).rejects.toThrow(/animated PNG/);
    for (const type of ['acTL', 'fcTL', 'fdAT']) {
      const malformedAnimation = concat(signature, ihdr(), chunk(type), dataChunk(), chunk('IEND'));
      await expect(parseFrameArtifact(await envelope(text, malformedAnimation))).rejects.toThrow(
        /animated PNG/
      );
    }
  });

  it('rejects invalid compressed pixel data even when PNG chunks and bundle checksums are valid', async () => {
    const invalidPixels = concat(
      signature,
      ihdr(),
      chunk('IDAT', new Uint8Array([1, 2, 3])),
      chunk('IEND')
    );
    await expect(
      parseFrameArtifact(await envelope(canonical(metadata()), invalidPixels))
    ).rejects.toThrow(/compressed image data/);
  });

  it('rejects non-PNG images and invalid metadata before encoding', async () => {
    await expect(
      serializeFrameArtifact({ ...frame(), blob: new Blob([png()], { type: 'image/jpeg' }) })
    ).rejects.toThrow(/PNG/);
    const value = frame();
    Object.assign(value.metadata, { extra: true });
    const read = vi.spyOn(value.blob, 'arrayBuffer');
    await expect(serializeFrameArtifact(value)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it('honors pre-aborted imports and exports without reading bytes', async () => {
    const controller = new AbortController(),
      value = frame(),
      file = await envelope(canonical(metadata()));
    const inputRead = vi.spyOn(file, 'arrayBuffer'),
      imageRead = vi.spyOn(value.blob, 'arrayBuffer');
    controller.abort();
    await expect(parseFrameArtifact(file, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(serializeFrameArtifact(value, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(inputRead).not.toHaveBeenCalled();
    expect(imageRead).not.toHaveBeenCalled();
  });

  it('cancels a pending file read and ignores its late result', async () => {
    const controller = new AbortController(),
      file = await envelope(canonical(metadata()));
    const bytes = await file.arrayBuffer();
    let release: ((value: ArrayBuffer) => void) | undefined;
    vi.spyOn(file, 'arrayBuffer').mockImplementation(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          release = resolve;
        })
    );
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = parseFrameArtifact(file, controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
    release!(bytes);
    await Promise.resolve();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it.each(['serialize', 'parse'] as const)(
    'cancels %s during hashing without publishing a late artifact',
    async (operation) => {
      const value = frame(),
        file = await envelope(canonical(value.metadata));
      const controller = new AbortController();
      let release: ((value: ArrayBuffer) => void) | undefined, entered: (() => void) | undefined;
      const hashing = new Promise<void>((resolve) => {
        entered = resolve;
      });
      vi.spyOn(crypto.subtle, 'digest').mockImplementation(() => {
        entered!();
        return new Promise<ArrayBuffer>((resolve) => {
          release = resolve;
        });
      });
      const pending =
        operation === 'serialize'
          ? serializeFrameArtifact(value, controller.signal)
          : parseFrameArtifact(file, controller.signal);
      const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      await hashing;
      controller.abort();
      await rejection;
      release!(new ArrayBuffer(32));
      await Promise.resolve();
    }
  );
});

/** Reference Adam7 pixel membership from the PNG specification's 8×8 pattern. */
const adam7 = [
  [1, 6, 4, 6, 2, 6, 4, 6],
  [7, 7, 7, 7, 7, 7, 7, 7],
  [5, 6, 5, 6, 5, 6, 5, 6],
  [7, 7, 7, 7, 7, 7, 7, 7],
  [3, 6, 4, 6, 3, 6, 4, 6],
  [7, 7, 7, 7, 7, 7, 7, 7],
  [5, 6, 5, 6, 5, 6, 5, 6],
  [7, 7, 7, 7, 7, 7, 7, 7],
];
function referenceRows(width: number, height: number, bitsPerPixel: number, interlace = 0) {
  const rows: Uint8Array[] = [];
  for (let pass = 1; pass <= (interlace ? 7 : 1); pass++) {
    for (let y = 0; y < height; y++) {
      let pixels = 0;
      for (let x = 0; x < width; x++) if (!interlace || adam7[y % 8][x % 8] === pass) pixels++;
      if (pixels) rows.push(new Uint8Array(1 + Math.ceil((pixels * bitsPerPixel) / 8)));
    }
  }
  return rows;
}
function pixelPng(
  width: number,
  height: number,
  data: Uint8Array,
  color = 6,
  depth = 8,
  interlace = 0
) {
  return concat(
    signature,
    ihdr(width, height, color, depth, interlace),
    ...(color === 3 ? [chunk('PLTE', new Uint8Array([0, 0, 0]))] : []),
    chunk('IDAT', data),
    chunk('IEND')
  );
}
function sizedMetadata(width: number, height: number) {
  return { ...metadata(), raster: { width, height } };
}

describe('bounded PNG zlib and scanline validation', () => {
  it('rejects the browser-accepted blank256×128 fixture while preserving legitimate opaque black pixels', async () => {
    const record = sizedMetadata(256, 128);
    const invalid = pixelPng(256, 128, new Uint8Array([0, 1, 2, 3]));
    await expect(parseFrameArtifact(await envelope(canonical(record), invalid))).rejects.toThrow(
      /compressed image data/
    );
    await expect(
      serializeFrameArtifact({ metadata: record, blob: new Blob([invalid], { type: 'image/png' }) })
    ).rejects.toThrow(/compressed image data/);
    const black = new Uint8Array(128 * (1 + 256 * 4));
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 256; x++) black[y * 1025 + 1 + x * 4 + 3] = 255;
    const valid = pixelPng(256, 128, deflateSync(black));
    const serialized = await serializeFrameArtifact({
      metadata: record,
      blob: new Blob([valid], { type: 'image/png' }),
    });
    const parsed = await parseFrameArtifact(serialized);
    expect(parsed.metadata.raster).toEqual({ width: 256, height: 128 });
    expect(new Uint8Array(await parsed.blob.arrayBuffer())).toEqual(valid);
  });

  it('combines consecutive IDAT fragments even across zlib headers and Adler checksum bytes', async () => {
    const compressed = deflateSync(new Uint8Array([0, 10, 20, 30, 255]));
    const split = concat(
      signature,
      ihdr(),
      chunk('IDAT'),
      ...Array.from(compressed, (byte) => chunk('IDAT', new Uint8Array([byte]))),
      chunk('IEND')
    );
    expect((await parseFrameArtifact(await envelope(canonical(metadata()), split))).blob.size).toBe(
      split.length
    );
  });

  it('rejects zlib header/Adler corruption, dictionary requirements, and truncation before accepting EOF', async () => {
    const valid = new Uint8Array(deflateSync(new Uint8Array([0, 0, 0, 0, 255])));
    const badHeader = valid.slice();
    badHeader[0] ^= 1;
    const badChecksum = valid.slice();
    badChecksum[badChecksum.length - 1] ^= 1;
    const dictionary = deflateSync(new Uint8Array([0, 0, 0, 0, 255]), {
      dictionary: new Uint8Array([1, 2, 3]),
    });
    for (const compressed of [
      badHeader,
      badChecksum,
      valid.slice(0, -1),
      valid.slice(0, -4),
      dictionary,
    ]) {
      const image = pixelPng(1, 1, compressed);
      await expect(
        parseFrameArtifact(await envelope(canonical(metadata()), image))
      ).rejects.toThrow(/compressed image data/);
    }
  });

  it('rejects underlength/overexpanded scanlines and every unsupported filter byte', async () => {
    const text = canonical(metadata());
    for (const raw of [new Uint8Array(4), new Uint8Array(6), new Uint8Array(100_000)]) {
      const image = pixelPng(1, 1, deflateSync(raw));
      await expect(parseFrameArtifact(await envelope(text, image))).rejects.toThrow(/scanline/);
    }
    for (const filter of [5, 6, 127, 255]) {
      const image = pixelPng(1, 1, deflateSync(new Uint8Array([filter, 0, 0, 0, 255])));
      await expect(parseFrameArtifact(await envelope(text, image))).rejects.toThrow(/filter/);
    }
    for (const filter of [0, 1, 2, 3, 4]) {
      const image = pixelPng(1, 1, deflateSync(new Uint8Array([filter, 0, 0, 0, 0])));
      expect((await parseFrameArtifact(await envelope(text, image))).blob.size).toBe(image.length);
    }
  });

  it('checks later row filters even when their position crosses native output chunk boundaries', async () => {
    const width = 4096,
      height = 3,
      rowBytes = 1 + width * 4;
    const raw = new Uint8Array(rowBytes * height);
    raw[rowBytes * 2] = 5;
    await expect(
      parseFrameArtifact(
        await envelope(
          canonical(sizedMetadata(width, height)),
          pixelPng(width, height, deflateSync(raw))
        )
      )
    ).rejects.toThrow(/filter/);
    raw[rowBytes * 2] = 4;
    expect(
      (
        await parseFrameArtifact(
          await envelope(
            canonical(sizedMetadata(width, height)),
            pixelPng(width, height, deflateSync(raw))
          )
        )
      ).metadata.raster
    ).toEqual({ width, height });
  });

  it('supports every declared PNG channel/bit depth and per-row packed-bit padding', async () => {
    const formats = [
      [0, 1, 1],
      [0, 2, 1],
      [0, 4, 1],
      [0, 8, 1],
      [0, 16, 1],
      [2, 8, 3],
      [2, 16, 3],
      [3, 1, 1],
      [3, 2, 1],
      [3, 4, 1],
      [3, 8, 1],
      [4, 8, 2],
      [4, 16, 2],
      [6, 8, 4],
      [6, 16, 4],
    ];
    for (const [color, depth, channels] of formats) {
      const width = 9,
        height = 3;
      const rows = referenceRows(width, height, depth * channels);
      const image = pixelPng(width, height, deflateSync(concat(...rows)), color, depth);
      const parsed = await parseFrameArtifact(
        await envelope(canonical(sizedMetadata(width, height)), image)
      );
      expect(parsed.metadata.raster).toEqual({ width, height });
    }
    // Nine 1-bit pixels need two bytes in each row, not a continuous27-bit payload.
    const missingRowPadding = new Uint8Array(7);
    await expect(
      parseFrameArtifact(
        await envelope(
          canonical(sizedMetadata(9, 3)),
          pixelPng(9, 3, deflateSync(missingRowPadding), 0, 1)
        )
      )
    ).rejects.toThrow(/scanline/);
  });

  it('validates Adam7 passes against an independent pixel-membership oracle, including empty passes', async () => {
    for (const [width, height] of [
      [1, 1],
      [1, 8],
      [8, 1],
      [2, 2],
      [3, 5],
      [5, 3],
      [8, 8],
      [9, 11],
      [17, 15],
    ]) {
      for (const [color, depth, channels] of [
        [0, 1, 1],
        [6, 16, 4],
      ]) {
        const rows = referenceRows(width, height, depth * channels, 1);
        rows.forEach((row, index) => {
          row[0] = index % 5;
        });
        const image = pixelPng(width, height, deflateSync(concat(...rows)), color, depth, 1);
        expect(
          (await parseFrameArtifact(await envelope(canonical(sizedMetadata(width, height)), image)))
            .blob.size
        ).toBe(image.length);
      }
    }
    const extraEmptyPassFilter = new Uint8Array(6);
    await expect(
      parseFrameArtifact(
        await envelope(
          canonical(metadata()),
          pixelPng(1, 1, deflateSync(extraEmptyPassFilter), 6, 8, 1)
        )
      )
    ).rejects.toThrow(/scanline/);
    const rows = referenceRows(9, 11, 1, 1);
    rows.at(-1)![0] = 5;
    await expect(
      parseFrameArtifact(
        await envelope(
          canonical(sizedMetadata(9, 11)),
          pixelPng(9, 11, deflateSync(concat(...rows)), 0, 1, 1)
        )
      )
    ).rejects.toThrow(/filter/);
  });

  it('fails with a useful support error instead of silently delegating validation to image.decode', async () => {
    const artifact = await envelope(canonical(metadata()));
    vi.stubGlobal('DecompressionStream', undefined);
    await expect(parseFrameArtifact(artifact)).rejects.toThrow(
      /browser.*DecompressionStream deflate support/
    );
    await expect(serializeFrameArtifact(frame())).rejects.toThrow(
      /browser.*DecompressionStream deflate support/
    );
    vi.stubGlobal(
      'DecompressionStream',
      class {
        constructor() {
          throw new TypeError('Unsupported format.');
        }
      }
    );
    await expect(parseFrameArtifact(artifact)).rejects.toThrow(
      /browser.*DecompressionStream deflate support/
    );
  });

  it('cancels a pending native stream read and releases the reader without waiting for later pixels', async () => {
    const artifact = await envelope(canonical(metadata())),
      controller = new AbortController();
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const cancel = vi.fn();
    vi.stubGlobal(
      'DecompressionStream',
      class {
        readable = new ReadableStream<Uint8Array>({ cancel });
        writable = new WritableStream<Uint8Array>({
          write() {
            entered!();
          },
        });
      }
    );
    const pending = parseFrameArtifact(artifact, controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await started;
    controller.abort();
    await rejection;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('continues reading through native close so late codec errors cannot be mistaken for a valid pixel count', async () => {
    const artifact = await envelope(canonical(metadata()));
    let reads = 0;
    const cancel = vi.fn();
    vi.stubGlobal(
      'DecompressionStream',
      class {
        readable = new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              if (++reads === 1) controller.enqueue(new Uint8Array([0, 0, 0, 0, 255]));
              else controller.error(new Error('Invalid trailing compressed bytes.'));
            },
            cancel,
          },
          { highWaterMark: 0 }
        );
        writable = new WritableStream<Uint8Array>();
      }
    );
    await expect(parseFrameArtifact(artifact)).rejects.toThrow(/compressed image data/);
    expect(reads).toBe(2);
  });

  it('services cancellation within one large native output chunk using the consumed-byte budget', async () => {
    const width = 1,
      height = 600000,
      controller = new AbortController();
    const artifact = await envelope(
      canonical(sizedMetadata(width, height)),
      pixelPng(width, height, deflateSync(new Uint8Array([0])), 0, 8)
    );
    vi.stubGlobal(
      'DecompressionStream',
      class {
        readable = new ReadableStream<Uint8Array>({
          start(stream) {
            setTimeout(() => controller.abort(), 0);
            stream.enqueue(new Uint8Array(height * 2));
            stream.close();
          },
        });
        writable = new WritableStream<Uint8Array>();
      }
    );
    await expect(parseFrameArtifact(artifact, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
