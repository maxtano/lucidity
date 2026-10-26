import { spawnSync } from 'node:child_process';
import { renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.demo.config.ts'], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
renameSync(new URL('../dist-demo/demo.html', import.meta.url), new URL('../dist-demo/index.html', import.meta.url));
