import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createEngine } from '../engine.mjs';
import { createLab } from '../server.mjs';

async function setup(t, options = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'lucidity-lab-test-'));
  const stateFile = join(folder, 'state.json');
  const { server, engine } = createLab({ stateFile, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(folder, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, body, extra = {}) => {
    const response = await fetch(`${base}/api/${path}`, { ...body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }, ...extra });
    return { status: response.status, data: await response.json() };
  };
  return { request, base, engine, stateFile };
}

test('check → review → apply saves one backup and receipt, surviving a new engine instance', async t => {
  const { request, stateFile } = await setup(t);
  assert.equal((await request('propose', {})).status, 400);
  await request('connect', { connected: true });
  const reply = await request('chat', { message: 'Check my drone', mode: 'demo' });
  const proposal = reply.data.proposal;
  assert.equal(reply.data.state.groundChannel, 1);
  assert.equal(proposal.after, 6);
  const applied = await request('apply', { id: proposal.id, revision: proposal.revision });
  assert.equal(applied.data.verified, true);
  assert.equal(applied.data.backup.groundChannel, 1);
  assert.equal((await request('apply', { id: proposal.id, revision: proposal.revision })).data.id, applied.data.id);
  const recovered = createEngine(stateFile).inspect();
  assert.equal(recovered.history.length, 1);
  assert.equal(recovered.groundChannel, 6);
  assert.equal(recovered.link, 'healthy');
});

test('disconnect and reset invalidate an earlier proposal', async t => {
  const { request } = await setup(t);
  await request('connect', { connected: true });
  const { proposal } = (await request('propose', {})).data;
  await request('connect', { connected: false });
  assert.equal((await request('apply', proposal)).status, 400);
  await request('connect', { connected: true });
  assert.equal((await request('apply', proposal)).status, 400);
  await request('reset', {});
  assert.equal((await request('state')).data.history.length, 0);
});

test('cross-origin writes and non-JSON requests are rejected', async t => {
  const { request } = await setup(t);
  assert.equal((await request('reset', {}, { headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' } })).status, 403);
  assert.equal((await request('reset', {}, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await request('connect', { connected: 'yes' })).status, 400);
});

test('a live response cannot prepare a change after the simulator has changed', async t => {
  let release;
  const reply = () => new Promise(resolve => { release = resolve; });
  const { request } = await setup(t, { reply });
  await request('connect', { connected: true });
  const pending = request('chat', { message: 'Check it', mode: 'live' });
  while (!release) await new Promise(resolve => setTimeout(resolve, 10));
  await request('reset', {});
  release({ message: 'Preparing a change.', action: 'propose' });
  assert.equal((await pending).status, 409);
  assert.equal((await request('state')).data.proposal, null);
});

test('real MCP transport lists tools and completes the same simulator workflow', async t => {
  const { base, request } = await setup(t);
  const client = new Client({ name: 'lucidity-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../plugins/lucidity-lab/mcp.mjs', import.meta.url))],
    env: { ...process.env, LUCIDITY_LAB_URL: base } });
  await client.connect(transport);
  try {
    assert.equal((await client.listTools()).tools.length, 4);
    assert.equal((await client.callTool({ name: 'inspect_drone', arguments: {} })).structuredContent.connected, false);
    assert.equal((await client.callTool({ name: 'prepare_change', arguments: {} })).isError, true);
    await request('connect', { connected: true });
    const p = (await client.callTool({ name: 'prepare_change', arguments: {} })).structuredContent.proposal;
    const result = await client.callTool({ name: 'apply_change', arguments: { id: p.id, revision: p.revision } });
    assert.equal(result.structuredContent.readback, 6);
    const history = await client.callTool({ name: 'read_history', arguments: {} });
    assert.equal(history.structuredContent.history.length, 1);
    assert.equal((await request('state')).data.link, 'healthy');
  } finally { await client.close(); }
});
