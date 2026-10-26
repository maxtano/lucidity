/** Exact authored times win; a rounded timestamp may match only one nearby key. */
export function keyframeAt<T extends { time: number }>(frames: T[], time: number): T | undefined {
  const exact = frames.find((key) => key.time === time);
  if (exact) return exact;
  const nearby = frames.filter((key) => Math.abs(key.time - time) < 1e-6);
  if (nearby.length > 1)
    throw new Error('Keyframe time is ambiguous. Use the exact authored timestamp.');
  return nearby[0];
}
