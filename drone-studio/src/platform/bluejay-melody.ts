import { noteName, tuneSeconds, validateTune, type Tune } from './music-model';

/** Bluejay v0.21: 4 metadata bytes followed by 62 (pulse count, period) pairs.
 * Timing formula documented by bird-sanctuary/bluejay-rtttl-parse. */
export function encodeBluejayMelody(input: Tune): Uint8Array {
  const tune = validateTune(input);
  if (tuneSeconds(tune) > 10) throw new Error('Keep motor startup melodies at 10 seconds or less.');
  const result = new Uint8Array(128);
  result.set([tune.bpm >> 8, tune.bpm & 255, 5, 4]);
  let offset = 4;
  for (const note of tune.notes) {
    const frequency = note.midi === null ? 0 : Math.round(440 * 2 ** ((note.midi - 69) / 12) * 10) / 10;
    const period = frequency ? Math.round(1_000_000 / (frequency * 24.72) - 399.3 / 24.72) : 0;
    if (frequency && (period < 1 || period > 255))
      throw new Error(`${noteName(note.midi)} is outside Bluejay’s motor tone range. Choose a different pitch.`);
    let count = Math.round(note.beats * 60_000 / tune.bpm * (frequency ? frequency / 1000 : 1));
    while (count > 0) {
      if (offset >= result.length) throw new Error('This melody exceeds Bluejay’s 62 tone slots. Shorten it or lower the pitches.');
      const part = Math.min(count, 255);
      result[offset++] = part; result[offset++] = period; count -= part;
    }
  }
  return result;
}
