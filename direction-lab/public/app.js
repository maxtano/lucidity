const $ = selector => document.querySelector(selector);
const views = {
  plugin: { title: 'Your assistant', subtitle: 'Lucidity tools inside a familiar conversation', reflection: 'Can the conversation do enough without a separate application?', name: 'Assistant' },
  standalone: { title: 'Lucidity', subtitle: 'A dedicated conversation for your aircraft', reflection: 'Does a dedicated drone chat earn a place as its own app?', name: 'Lucidity' },
  workbench: { title: 'Ask Lucidity', subtitle: 'The conversation and the aircraft, together', reflection: 'Does seeing the link and its evidence make you more confident?', name: 'Lucidity' }
};
let view = Object.hasOwn(views, location.hash.slice(1)) ? location.hash.slice(1) : 'plugin';
let state, busy = false, messages = { plugin: [], standalone: [], workbench: [] };
const api = async (path, body) => {
  const response = await fetch(`/api/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
};
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };
function error(message) { $('#error').textContent = message; $('#error').hidden = !message; }
function setBusy(value) {
  busy = value;
  document.querySelectorAll('button:not(#close-dialog), #engine').forEach(button => button.disabled = value);
  $('#send').textContent = value ? '…' : '↑';
}
async function act(task) {
  if (busy) return;
  setBusy(true); error('');
  try { await task(); state = await api('state'); renderState(); }
  catch (e) { error(e.message); try { state = await api('state'); renderState(); } catch {} }
  finally { setBusy(false); }
}
function renderMessages() {
  const box = $('#messages'); box.replaceChildren();
  const greeting = state?.connected
    ? state.link === 'healthy' ? 'Your simulated link is verified, and its result is saved. Ask what changed or start over to try this interface from the beginning.'
      : 'Your simulated drone is connected. Ask me to check it, and I’ll explain what needs attention.'
    : 'Let’s get your drone talking. Connect the simulated drone above, then ask me to check it.';
  const list = messages[view].length ? messages[view] : [{ role: 'assistant', text: greeting }];
  for (const item of list) {
    const bubble = el('div', `bubble ${item.role}`);
    if (item.role !== 'user') bubble.append(el('span', 'speaker', views[view].name));
    bubble.append(el('p', '', item.text));
    if (item.trace && view === 'plugin') bubble.append(el('div', 'tool-trace', `Lucidity · ${item.trace}`));
    box.append(bubble);
  }
  box.scrollTop = box.scrollHeight;
}
function proposalCard() {
  if (!state?.proposal) return null;
  const p = state.proposal;
  const card = el('div', 'proposal');
  card.append(el('h3', '', 'One change to review'));
  const change = el('div', 'change');
  change.append(el('span', '', p.parameter), el('strong', '', String(p.before)), el('span', '', '→'), el('strong', 'after', String(p.after)));
  const button = el('button', 'primary', 'Apply & verify'); button.disabled = busy;
  button.addEventListener('click', () => act(async () => {
    const result = await api('apply', { id: p.id, revision: p.revision });
    messages[view].push({ role: 'assistant', text: `Done. Ground channel ${result.before} → ${result.after}. The original settings are backed up, and simulated readback returned ${result.readback}. This result is saved with the drone.`, trace: 'apply_change → verified receipt' });
    renderMessages();
  }));
  card.append(change, el('small', '', 'Save original settings → change channel → read it back.'), button);
  return card;
}
function renderState() {
  if (!state) return;
  if (!messages[view].length) renderMessages();
  $('#connection-label').textContent = state.connected ? 'Lucidity One connected' : 'Demo drone disconnected';
  $('#connection-dot').classList.toggle('connected', state.connected);
  $('#connect').textContent = state.connected ? 'Disconnect demo drone' : 'Connect simulated drone';
  $('#link-badge').textContent = { healthy: 'Link verified', mismatch: 'Mismatch', disconnected: 'Disconnected' }[state.link];
  $('#link-badge').className = `badge ${state.link}`;
  $('#ground').textContent = state.connected ? `Channel ${state.groundChannel}` : 'Channel —';
  $('#aircraft').textContent = state.connected ? `Channel ${state.aircraftChannel}` : 'Channel —';
  $('#link-detail').textContent = { healthy: 'Simulated link OK', mismatch: 'Channels do not match', disconnected: 'Waiting for connection' }[state.link];
  $('#radio-connection').className = `radio-connection ${state.link}`;
  $('#inline-proposal').replaceChildren(); $('#bench-proposal').replaceChildren();
  const card = proposalCard();
  if (card) $(view === 'workbench' ? '#bench-proposal' : '#inline-proposal').append(card);
  const record = $('#bench-record'); record.replaceChildren();
  if (!state.history.length) record.textContent = 'No changes yet. Your result will appear here.';
  else {
    const receipt = state.history.at(-1), node = el('div', 'receipt', `Ground channel ${receipt.before} → ${receipt.after}`);
    node.append(el('small', '', `Simulated readback ${receipt.readback} · Backup saved · ${new Date(receipt.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)); record.append(node);
  }
  $('#export').hidden = !state.history.length;
}
function selectView(next) {
  view = next; location.hash = view;
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', button.dataset.view === view));
  $('#sample').className = `sample ${view === 'workbench' ? 'workbench-view' : view}`;
  $('#aircraft-nav').hidden = view !== 'standalone'; $('#workbench').hidden = view !== 'workbench';
  $('#chat-title').textContent = views[view].title; $('#chat-subtitle').textContent = views[view].subtitle;
  $('#real-plugin').hidden = view !== 'plugin';
  $('#flow-chat').replaceChildren(document.createTextNode(view === 'plugin' ? 'Your assistant ' : 'Lucidity chat '), el('small', '', 'interprets'));
  $('#reflection').replaceChildren(el('strong', '', 'Notice: '), document.createTextNode(views[view].reflection));
  renderMessages(); renderState();
}
async function send(text) {
  if (!text.trim() || busy) return;
  const history = messages[view].slice(-8);
  messages[view].push({ role: 'user', text }); $('#message').value = ''; renderMessages();
  await act(async () => {
    $('#engine-note').textContent = $('#engine').value === 'live' ? 'Codex is replying… this may take a moment.' : 'Checking the simulator…';
    const result = await api('chat', { message: text, history, mode: $('#engine').value });
    state = result.state;
    messages[view].push({ role: 'assistant', text: result.message, trace: result.proposal ? 'inspect_drone → prepare_change' : 'inspect_drone' });
    renderMessages();
  });
  engineNote(); $('#message').focus();
}
function engineNote() { $('#engine-note').textContent = $('#engine').value === 'live' ? 'Uses your Codex / ChatGPT allowance' : 'Scripted replies · no model usage'; }
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => selectView(b.dataset.view)));
document.querySelectorAll('[data-prompt]').forEach(b => b.addEventListener('click', () => send(b.dataset.prompt)));
$('#connect').addEventListener('click', () => act(async () => { state = await api('connect', { connected: !state.connected }); }));
$('#reset').addEventListener('click', () => act(async () => { state = await api('reset', {}); messages = { plugin: [], standalone: [], workbench: [] }; renderMessages(); }));
$('#composer').addEventListener('submit', event => { event.preventDefault(); send($('#message').value); });
$('#message').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send($('#message').value); } });
$('#engine').addEventListener('change', () => { engineNote(); error(''); });
$('#real-plugin').addEventListener('click', () => $('#plugin-dialog').showModal());
$('#close-dialog').addEventListener('click', () => $('#plugin-dialog').close());
window.addEventListener('hashchange', () => { const next = location.hash.slice(1); if (next !== view && Object.hasOwn(views, next)) selectView(next); });
selectView(view);
try { state = await api('state'); renderState(); } catch { error('The lab server is unavailable. Run npm start in direction-lab.'); }
api('live-status').then(status => { if (!status.available) $('#engine option[value=live]').textContent = 'Live Codex · sign-in required'; }).catch(() => {});
setInterval(async () => {
  if (busy) return;
  try { const next = await api('state'); if (JSON.stringify(next) !== JSON.stringify(state)) { state = next; renderState(); } } catch {}
}, 2500);
