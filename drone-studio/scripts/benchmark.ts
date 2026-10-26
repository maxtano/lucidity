import { performance } from 'node:perf_hooks';
import { formation, colors } from '../src/core/formations';
import { defaultProject, shapes } from '../src/core/model';

const rows = [1, 1000, 10000, 100000].map((count) => {
  const start = performance.now();
  let bytes = 0;
  for (const shape of shapes) {
    bytes += formation({ ...defaultProject.cues[1], shape }, count).byteLength;
    bytes += colors('aurora', count).byteLength;
  }
  return {
    drones: count,
    formations: shapes.length,
    generationMs: Number((performance.now() - start).toFixed(2)),
    totalGeneratedMiB: Number((bytes / 1024 ** 2).toFixed(2)),
    activeGpuAttributeMiB: Number(((count * 3 * 4 * 4) / 1024 ** 2).toFixed(2)),
  };
});
console.log(
  JSON.stringify(
    {
      scope:
        'CPU formation generation only; this does not measure browser frame rate, planning, validation or flight operations.',
      runtime: process.version,
      platform: process.platform,
      rows,
    },
    null,
    2
  )
);
