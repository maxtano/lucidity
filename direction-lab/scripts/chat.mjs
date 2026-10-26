import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { liveStatus } from '../live.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const mcp = fileURLToPath(new URL('../plugins/lucidity-lab/mcp.mjs', import.meta.url));
const base = process.env.LUCIDITY_LAB_URL || 'http://127.0.0.1:4317';
try { const r = await fetch(`${base}/api/state`); if (!r.ok) throw new Error(); }
catch { console.error('Start the lab first: npm start. Then run npm run chat in another Terminal.'); process.exit(1); }
if (!(await liveStatus()).available) { console.error('Sign in with ChatGPT through codex login, then retry. No API key is needed.'); process.exit(1); }
const args = ['--no-daemon', '--no-alt-screen', '-C', root, '-s', 'read-only',
  '-c', `mcp_servers.lucidity_lab.command=${JSON.stringify(process.execPath)}`,
  '-c', `mcp_servers.lucidity_lab.args=${JSON.stringify([mcp])}`,
  '-c', `mcp_servers.lucidity_lab.env.LUCIDITY_LAB_URL=${JSON.stringify(base)}`,
  '-c', 'mcp_servers.lucidity_lab.required=true',
  'We are trying the Lucidity direction lab. Only use lucidity_lab tools to inspect the simulated drone. If disconnected, ask me to click Connect simulated drone in the browser. Explain the mismatch and prepare one change. Show its before/after and wait for my approval before apply_change. Report simulated readback and backup afterward. Do not use shell or hardware tools, change code, or delegate. Keep it conversational and concise.'];
console.log('Opening a local Codex chat with temporary Lucidity tools. Your global configuration is unchanged.');
const env = { ...process.env }; delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY;
const child = spawn(process.env.LUCIDITY_CODEX_BIN || 'codex', args, { cwd: root, env, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
