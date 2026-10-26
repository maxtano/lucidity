import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const initial = () => ({ version: 1, drone: 'Lucidity One', simulated: true, connected: false,
  revision: 0, groundChannel: 1, aircraftChannel: 6, proposal: null, history: [], backup: null });

export function createEngine(file) {
  let state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : initial();
  const save = next => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    state = next;
  };
  const inspect = () => ({ ...structuredClone(state), link: !state.connected ? 'disconnected'
    : state.groundChannel === state.aircraftChannel ? 'healthy' : 'mismatch' });
  const requireConnected = () => {
    if (!state.connected) throw new Error('Connect the simulated drone first.');
  };
  return {
    inspect,
    connect(connected) {
      if (typeof connected !== 'boolean') throw new Error('connected must be a boolean.');
      if (connected !== state.connected) save({ ...state, connected, proposal: null, revision: state.revision + 1 });
      return inspect();
    },
    reset() {
      save({ ...initial(), revision: state.revision + 1 });
      return inspect();
    },
    propose() {
      requireConnected();
      if (state.groundChannel === state.aircraftChannel) return { proposal: null, message: 'The simulated link already matches.' };
      if (!state.proposal) save({ ...state, proposal: { id: randomUUID(), revision: state.revision,
        parameter: 'Ground radio channel', before: state.groundChannel, after: state.aircraftChannel } });
      return { proposal: structuredClone(state.proposal) };
    },
    apply(id, revision) {
      requireConnected();
      const prior = state.history.find(item => item.proposalId === id);
      if (prior) return structuredClone(prior); // Retrying a completed request never writes twice.
      const p = state.proposal;
      if (!p || p.id !== id || p.revision !== revision || state.revision !== revision)
        throw new Error('This proposal is no longer current. Inspect and prepare a new change.');
      const backup = { groundChannel: state.groundChannel, aircraftChannel: state.aircraftChannel,
        revision: state.revision, savedAt: new Date().toISOString() };
      // A real hardware adapter must replace BOTH this write and the independent readback.
      const next = { ...state, groundChannel: p.after, revision: state.revision + 1, backup, proposal: null };
      const receipt = { id: randomUUID(), proposalId: p.id, at: new Date().toISOString(),
        parameter: p.parameter, before: p.before, after: p.after, readback: next.groundChannel,
        verified: next.groundChannel === next.aircraftChannel, simulated: true, backup };
      next.history = [...state.history, receipt];
      save(next);
      return structuredClone(receipt);
    }
  };
}

export function scriptedReply(message, state) {
  const text = message.toLowerCase();
  if (/\b(fly|arm|take.?off|motor)\b/.test(text)) return {
    message: 'This sample only checks a simulated radio link. It cannot arm motors, fly, or establish flight readiness.', action: 'none' };
  if (/\b(history|changed|receipt|saved)\b/.test(text)) return { action: 'none', message: state.history.length
    ? `The saved result shows ground channel ${state.history.at(-1).before} → ${state.history.at(-1).after}. Simulated readback matched; the original settings were backed up.`
    : 'There are no saved changes yet. The result will stay with this drone when you switch interfaces.' };
  if (/\b(why|explain|channel)\b/.test(text)) return { action: 'none', message: !state.connected
    ? 'Click “Connect simulated drone” first. That stands in for plugging in your hardware.'
    : state.link === 'healthy' ? 'Both simulated radios use channel 6. This checks the demo link only; it says nothing about flight readiness.'
    : 'The ground radio is on channel 1 and the aircraft radio is on channel 6. In this simplified scenario, they need the same channel. I can prepare that one change.' };
  if (/\b(check|inspect|fix|prepare|setup|set up|yes|apply|repair|help)\b/.test(text)) {
    if (!state.connected) return { message: 'First, connect the simulated drone using the button above. That is your physical step. Then ask me to check the link.', action: 'none' };
    if (state.link === 'healthy') return { message: 'The simulated link checks out: both radios are on channel 6. Your verified result is saved. Try another interface to see the same drone state.', action: 'none' };
    return { message: 'I found one mismatch: ground channel 1, aircraft channel 6. I’ve prepared a change to the ground radio. Review it below; applying it will save a backup and check the simulated readback.', action: 'propose' };
  }
  return { message: 'This instant demo has a few scripted responses. Try “Check my drone,” “Why is the link broken?” or “What changed?” Switch to Live Codex for open-ended conversation.', action: 'none' };
}
