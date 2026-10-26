/** Centered CSS-pixel frame plus the exact aspect to use for camera projection. */
export type AudienceFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  aspect: number;
};

/** Renderable subset of the captured audience-context boundary; never normalize a capture. */
export function isAudienceFrameAspect(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100)
    return false;
  // Follow PerspectiveCamera's arithmetic at the supported narrowest FOV (45°)
  // and near plane (0.1 m), where the horizontal projection coefficient is largest.
  const width = value * (2 * (0.1 * Math.tan(Math.PI / 8)));
  const left = -0.5 * width;
  // WebGL uploads this matrix as Float32; finite JavaScript doubles are insufficient.
  return Number.isFinite(Math.fround(0.2 / (left + width - left)));
}

/**
 * Contain a captured audience projection without cropping or changing its field of view.
 * Captured aspect uses the renderable subset of the audience-context boundary.
 * A missing/unsupported aspect uses the whole viewport. Empty, nonfinite, or
 * numerically unrepresentable dimensions return null so callers can skip rendering.
 * Keep these CSS dimensions fractional; raster rounding must not replace `aspect`.
 */
export function audienceFrame(
  width: number,
  height: number,
  aspect?: number | null
): AudienceFrame | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (!isAudienceFrameAspect(aspect)) {
    const viewportAspect = width / height;
    return Number.isFinite(viewportAspect) && viewportAspect > 0
      ? { x: 0, y: 0, width, height, aspect: viewportAspect }
      : null;
  }

  // Division selects the constrained axis without overflowing width * height.
  const heightAtFullWidth = width / aspect;
  const frameHeight = Math.min(height, heightAtFullWidth);
  const frameWidth = heightAtFullWidth <= height ? width : Math.min(width, height * aspect);
  if (
    !Number.isFinite(frameWidth) ||
    !Number.isFinite(frameHeight) ||
    frameWidth <= 0 ||
    frameHeight <= 0
  )
    return null;
  return {
    x: (width - frameWidth) / 2,
    y: (height - frameHeight) / 2,
    width: frameWidth,
    height: frameHeight,
    aspect,
  };
}
