import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { aircraftApiPlugin } from './src/aircraft/middleware';
import { AircraftService } from './src/aircraft/service';
import { workbenchApiPlugin } from './src/platform/middleware';
const aircraftService = new AircraftService();

export default defineConfig({
  plugins: [
    react(),
    aircraftApiPlugin(aircraftService),
    workbenchApiPlugin(aircraftService),
    {
      name: 'bundle-project-docs',
      generateBundle() {
        const directory = new URL('./docs/', import.meta.url);
        // Explicit public documentation only. Git ignores do not protect build output.
        // Device receipts, private notes and future documents must not be auto-published.
        for (const name of ['PRODUCT.md', 'TECHNICAL.md']) {
          this.emitFile({
            type: 'asset',
            fileName: `docs/${name}`,
            source: readFileSync(fileURLToPath(new URL(name, directory)), 'utf8'),
          });
        }
      },
    },
  ],
  resolve: { dedupe: ['three'] },
  server: { port: 5173, strictPort: true },
  build: { rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
});
