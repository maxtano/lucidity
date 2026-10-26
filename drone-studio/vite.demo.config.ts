import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// A separate static entry: no aircraft API, terminal service, credentials or private documents.
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5178, strictPort: true },
  build: {
    outDir: 'dist-demo',
    rollupOptions: { input: 'demo.html', output: { manualChunks: { three: ['three'] } } },
  },
});
