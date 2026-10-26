import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createEngine, scriptedReply } from './engine.mjs';
import { liveStatus, liveReply } from './live.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
export function createLab({ stateFile = join(root, 'data', 'drone.json'), reply = liveReply } = {}) {
  const engine = createEngine(stateFile);
  let liveBusy = false;
  const server = createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      // Loopback only, no cross-origin requests, and exact static routes: this is a local lab.
      const allowed = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`];
      if (!allowed.includes(req.headers.host)) return send(403, { error: 'Local access only.' });
      if (req.headers.origin && !allowed.map(h => `http://${h}`).includes(req.headers.origin)) return send(403, { error: 'Origin rejected.' });
      const url = new URL(req.url, `http://${req.headers.host}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
      if (req.method === 'GET' && url.pathname === '/api/state') return send(200, engine.inspect());
      if (req.method === 'GET' && url.pathname === '/api/live-status') return send(200, await liveStatus());
      if (req.method === 'GET' && url.pathname === '/api/receipt') {
        res.setHeader('Content-Disposition', 'attachment; filename="lucidity-demo-receipts.json"');
        return send(200, { simulated: true, history: engine.inspect().history });
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'JSON required.' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 24000) return send(413, { error: 'Request too large.' }); }
        const input = JSON.parse(body || '{}');
        switch (url.pathname) {
          case '/api/connect': return send(200, engine.connect(input.connected));
          case '/api/reset': return send(200, engine.reset());
          case '/api/propose': return send(200, engine.propose());
          case '/api/apply': return send(200, engine.apply(input.id, input.revision));
          case '/api/chat': {
            if (typeof input.message !== 'string' || !input.message.trim() || input.message.length > 2000) throw new Error('Enter a message of 1–2,000 characters.');
            const snapshot = engine.inspect();
            let answer;
            if (input.mode === 'live') {
              if (liveBusy) return send(409, { error: 'A live reply is already running. Please wait.' });
              liveBusy = true;
              const history = Array.isArray(input.history) ? input.history.slice(-8).map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', text: String(h.text).slice(0, 1500) })) : [];
              try { answer = await reply(input.message, history, snapshot); } finally { liveBusy = false; }
              if (engine.inspect().revision !== snapshot.revision) return send(409, { error: 'The drone changed while the reply was running. Ask again to use its current state.' });
            } else answer = scriptedReply(input.message, snapshot);
            let proposal = null;
            if (answer.action === 'propose' && snapshot.connected) proposal = engine.propose().proposal;
            return send(200, { ...answer, proposal, state: engine.inspect() });
          }
          default: return send(404, { error: 'Unknown action.' });
        }
      }
      const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/research': ['research.html', 'text/html'] };
      if (req.method === 'GET' && assets[url.pathname]) {
        const [name, type] = assets[url.pathname];
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
        return res.end(readFileSync(join(root, 'public', name)));
      }
      send(404, { error: 'Not found.' });
    } catch (error) { send(400, { error: error.message }); }
  });
  return { server, engine };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server } = createLab();
  const port = Number(process.env.PORT || 4317);
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Try opening http://127.0.0.1:${port} or choose another PORT.` : error.message); process.exit(1); });
  server.listen(port, '127.0.0.1', () => console.log(`Lucidity direction lab → http://127.0.0.1:${port}\nSimulated drone only. Ctrl+C to stop.`));
}
