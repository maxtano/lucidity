import { paletteColors, type Cue, type Palette } from './model';

const TAU = Math.PI * 2;
/** Canonical coordinates: local ENU meters, x east, y north, z up. Stable array index = drone identity. */
export function formation(cue: Cue, count: number): Float32Array {
  if (!Number.isInteger(count) || count < 1 || count > 100_000)
    throw new Error('Fleet size must be 1–100,000.');
  const result = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) / count,
      theta = i * Math.PI * (3 - Math.sqrt(5));
    let x = 0,
      y = 0,
      z = 0;
    switch (cue.shape) {
      case 'sphere': {
        const h = 1 - 2 * u,
          r = Math.sqrt(1 - h * h);
        x = 0.48 * r * Math.cos(theta);
        y = 0.48 * r * Math.sin(theta);
        z = 0.48 * h;
        break;
      }
      case 'orbit': {
        const ring = i % 5,
          angle = (Math.floor(i / 5) / Math.ceil(count / 5)) * TAU;
        const r = 0.37 + ring * 0.023,
          tilt = (ring - 2) * 0.42;
        x = r * Math.cos(angle);
        y = r * Math.sin(angle) * Math.cos(tilt);
        z = r * Math.sin(angle) * Math.sin(tilt);
        break;
      }
      case 'helix': {
        const turn = u * TAU * 3 + (i % 2) * Math.PI;
        x = 0.27 * Math.cos(turn);
        y = 0.27 * Math.sin(turn);
        z = (u - 0.5) * 0.9;
        break;
      }
      case 'heart': {
        const layer = i % 5;
        const angle = (Math.floor(i / 5) / Math.ceil(count / 5)) * TAU;
        const f = 0.023 + layer * 0.0016;
        x = 16 * Math.sin(angle) ** 3 * f;
        z =
          (13 * Math.cos(angle) -
            5 * Math.cos(2 * angle) -
            2 * Math.cos(3 * angle) -
            Math.cos(4 * angle)) *
          f;
        y = (layer - 2) * 0.026;
        break;
      }
      case 'bloom': {
        const r = Math.sqrt(u) * 0.47;
        x = r * Math.cos(theta);
        y = r * Math.sin(theta);
        z = 0.24 * Math.sin(r * 9) + 0.09 * Math.sin(theta * 5) * (r / 0.47);
        break;
      }
      case 'wave':
      case 'custom':
      case 'grid': {
        const cols = Math.ceil(Math.sqrt(count));
        x = (i % cols) / Math.max(1, cols - 1) - 0.5;
        y = Math.floor(i / cols) / Math.max(1, Math.ceil(count / cols) - 1) - 0.5;
        if (count === 1) {
          x = 0;
          y = 0;
        }
        z = cue.shape === 'wave' ? 0.15 * Math.sin(x * 7 + y * 4) + 0.07 * Math.cos(y * 9) : 0;
        break;
      }
    }
    result[i * 3] = x * cue.scale;
    result[i * 3 + 1] = y * cue.scale;
    result[i * 3 + 2] = z * cue.scale + cue.altitude;
    const edited = cue.droneEdits?.[String(i + 1)]?.position;
    if (edited) result.set(edited, i * 3);
  }
  return result;
}

export function colors(palette: Palette, count: number): Float32Array {
  const stops = paletteColors[palette].map((hex) =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  );
  const result = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const p = (0.5 + Math.sin(i * 2.39996) * 0.5) * (stops.length - 1),
      lo = Math.min(stops.length - 2, Math.floor(p)),
      f = p - lo;
    for (let j = 0; j < 3; j++) result[i * 3 + j] = stops[lo][j] * (1 - f) + stops[lo + 1][j] * f;
  }
  return result;
}
export function interpolate(a: Float32Array, b: Float32Array, t: number): Float32Array {
  const result = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) result[i] = a[i] + (b[i] - a[i]) * t;
  return result;
}
