export interface Note {
  midi: number | null;
  beats: number;
}
export interface Tune {
  name: string;
  bpm: number;
  notes: Note[];
}
export const motifs: Tune[] = [
  {
    name: 'First light',
    bpm: 144,
    notes: [
      { midi: 60, beats: 0.5 },
      { midi: 64, beats: 0.5 },
      { midi: 67, beats: 0.5 },
      { midi: 72, beats: 1 },
    ],
  },
  {
    name: 'All systems ready',
    bpm: 120,
    notes: [
      { midi: 67, beats: 0.5 },
      { midi: 67, beats: 0.5 },
      { midi: 72, beats: 1 },
      { midi: null, beats: 0.5 },
      { midi: 76, beats: 1 },
    ],
  },
  {
    name: 'Nightfall',
    bpm: 100,
    notes: [
      { midi: 76, beats: 1 },
      { midi: 72, beats: 0.5 },
      { midi: 67, beats: 0.5 },
      { midi: 60, beats: 2 },
    ],
  },
];
// Original short motifs; no third-party recordings or copyrighted song transcriptions.
const extraMotifs: [string, number, (number | null)[]][] = [
  ['Orbit', 132, [60, 67, 72, 79, 72, 67]],
  ['Pixel hello', 180, [72, 76, 79, null, 84]],
  ['Soft landing', 90, [74, 72, 69, 65]],
  ['Launchpad', 160, [60, 60, 64, 67, 72]],
  ['Aurora', 108, [69, 72, 76, 79, 76]],
  ['Radar', 144, [81, null, 81, null, 76, 81]],
  ['Copper bell', 120, [67, 74, 79, 74]],
  ['Starlight', 100, [72, 79, 76, 83, 84]],
  ['Arcade ready', 200, [60, 64, 67, 72, 76, 79]],
  ['Moonrise', 84, [57, 64, 69, 72]],
  ['Little robot', 150, [72, 67, 72, null, 74, 72]],
  ['Homecoming', 120, [67, 64, 65, 62, 60]],
];
motifs.push(...extraMotifs.map(([name, bpm, pitches]) => ({
  name, bpm, notes: pitches.map((midi, i) => ({ midi, beats: i === pitches.length - 1 ? 1 : 0.5 })),
})));
export const tuneSeconds = (t: Tune) => t.notes.reduce((sum, n) => sum + n.beats, 0) * 60 / t.bpm;
/** Bounded, single-play MML accepted by ArduPilot's tone alarm. */
export function tuneToMml(tune: Tune) {
  const t = validateTune(tune);
  if (tuneSeconds(t) > 15) throw new Error('Drone previews must be 15 seconds or shorter.');
  const mml = `MFT${t.bpm}L4` + t.notes.map(n => n.midi === null
    ? `P${4 / n.beats}`
    : `O${Math.floor(n.midi / 12) - 1}${pitches[n.midi % 12].toUpperCase()}${4 / n.beats}`).join('');
  if (mml.length > 99) throw new Error('This melody is too long for a drone preview. Remove some notes.');
  return mml;
}

export function validateTune(input: unknown): Tune {
  const t = input as Tune;
  if (
    !t ||
    typeof t.name !== 'string' ||
    t.name.length < 1 ||
    t.name.length > 60 ||
    !Number.isInteger(t.bpm) ||
    t.bpm < 60 ||
    t.bpm > 240 ||
    !Array.isArray(t.notes) ||
    !t.notes.length ||
    t.notes.length > 128
  )
    throw new Error('A tune needs a name, 60–240 BPM, and 1–128 notes.');
  for (const note of t.notes)
    if (
      !note ||
      (note.midi !== null && (!Number.isInteger(note.midi) || note.midi < 48 || note.midi > 95)) ||
      ![0.125, 0.25, 0.5, 1, 2, 4].includes(note.beats)
    )
      throw new Error('Use notes C3–B6 and supported note lengths.');
  if ((t.notes.reduce((sum, n) => sum + n.beats, 0) * 60) / t.bpm > 60)
    throw new Error('Keep the tune under one minute.');
  return structuredClone(t);
}
const pitches = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
export const noteName = (midi: number | null) =>
  midi === null ? 'Rest' : `${pitches[midi % 12].toUpperCase()}${Math.floor(midi / 12) - 1}`;
export function tuneToRtttl(tune: Tune) {
  const t = validateTune(tune);
  const name = t.name.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 10) || 'Lucidity';
  return `${name}:d=4,o=5,b=${t.bpm}:${t.notes.map((n) => `${4 / n.beats}${n.midi === null ? 'p' : pitches[n.midi % 12] + (Math.floor(n.midi / 12) - 1)}`).join(',')}`;
}
