import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const base = new URL(process.env.LUCIDITY_LAB_URL || 'http://127.0.0.1:4317');
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('The demo only connects to a loopback lab server.');
const server = new McpServer({ name: 'lucidity-lab', version: '0.1.0' });
async function call(path, body) {
  try {
    const response = await fetch(new URL(`/api/${path}`, base), { ...(body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }), signal: AbortSignal.timeout(5000) });
    const data = await response.json();
    if (!response.ok) return { isError: true, content: [{ type: 'text', text: data.error }] };
    return { structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] };
  } catch { return { isError: true, content: [{ type: 'text', text: 'The local Lucidity lab is unavailable. Ask the user to run npm start in direction-lab.' }] }; }
}
server.registerTool('inspect_drone', {
  description: 'Read the SIMULATED Lucidity One drone and its radio channels. If disconnected, ask the user to click Connect simulated drone in the lab browser. No real hardware is accessed.',
  inputSchema: {}, annotations: { readOnlyHint: true, openWorldHint: false }
}, () => call('state'));
server.registerTool('prepare_change', {
  description: 'Prepare the only supported demo repair: match the ground radio channel to the simulated aircraft channel. Returns a proposal ID and revision; does not apply it. Present the before/after to the user.',
  inputSchema: {}, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true }
}, () => call('propose', {}));
server.registerTool('apply_change', {
  description: 'Apply a previously reviewed simulated change only after the user approves it. Saves original settings and returns simulated readback plus a durable receipt. Never implies real flight readiness.',
  inputSchema: { id: z.string().uuid(), revision: z.number().int().nonnegative() },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true }
}, input => call('apply', input));
server.registerTool('read_history', {
  description: 'Read saved simulated change receipts. The record belongs to the drone and is shared across all lab interfaces.',
  inputSchema: {}, annotations: { readOnlyHint: true, openWorldHint: false }
}, () => call('receipt'));
await server.connect(new StdioServerTransport());
