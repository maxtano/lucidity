import { useMemo } from 'react';
import { formation } from '../core/formations';
import { paletteColors, type Cue } from '../core/model';

export function FormationThumb({ cue, large = false }: { cue: Cue; large?: boolean }) {
  const dots = useMemo(() => {
    const points = formation(cue, 110);
    const explicit = Object.values(cue.droneEdits || {}).filter((edit) => edit.position);
    const swatches: string[] = [];
    if (cue.shape === 'custom' && explicit.length) {
      for (let i = 0; i < 110; i++) {
        const edit =
          explicit[Math.min(explicit.length - 1, Math.floor((i / 110) * explicit.length))];
        points.set(edit.position!, i * 3);
        swatches.push(edit.color || paletteColors[cue.palette][i % 3]);
      }
    }
    const projected = Array.from({ length: 110 }, (_, i) => ({
      x: points[i * 3] * 0.82 + points[i * 3 + 1] * 0.28,
      y: -(points[i * 3 + 2] * 0.72 - points[i * 3 + 1] * 0.5),
    }));
    const xs = projected.map((p) => p.x),
      ys = projected.map((p) => p.y);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys);
    const scale = Math.min(85 / Math.max(1, maxX - minX), 57 / Math.max(1, maxY - minY));
    return projected.map((p, i) => ({
      x: 50 + (p.x - (minX + maxX) / 2) * scale,
      y: 36 + (p.y - (minY + maxY) / 2) * scale,
      color: swatches[i] || paletteColors[cue.palette][i % 3],
    }));
  }, [cue]);
  return (
    <svg
      className={`formation-thumb ${large ? 'large' : ''}`}
      viewBox="0 0 100 72"
      aria-hidden="true"
    >
      {dots.map((point, i) => (
        <circle
          key={i}
          cx={point.x}
          cy={point.y}
          r={large ? 0.8 : 1.05}
          fill={point.color}
          opacity={0.65 + (i % 3) * 0.15}
        />
      ))}
    </svg>
  );
}
