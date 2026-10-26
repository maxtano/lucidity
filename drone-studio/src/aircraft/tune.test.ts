import { describe, expect, it } from 'vitest';
import { common, MavLinkProtocolV2 } from 'node-mavlink';
import { motifs, tuneToMml, tuneSeconds } from '../platform/music-model';
import { tuneFrame } from './tune';
describe('drone melodies', () => {
  it('provides fifteen distinct, short playable originals', () => {
    expect(motifs).toHaveLength(15);
    expect(new Set(motifs.map(t => JSON.stringify(t.notes))).size).toBe(15);
    for (const tune of motifs) { expect(tuneSeconds(tune)).toBeLessThan(15); expect(tuneToMml(tune)).toMatch(/^MFT\d+L4/); }
  });
  it('serializes targeted PLAY_TUNE and preserves the extension across byte 30', () => {
    const wire = new MavLinkProtocolV2(255, 190);
    for (const tune of motifs) {
      const frame = tuneFrame(7, 1, 11, tune);
      expect(wire.header(frame).msgid).toBe(common.PlayTune.MSG_ID);
      const message = wire.data(wire.payload(frame), common.PlayTune);
      expect(message.targetSystem).toBe(7);
      expect(message.targetComponent).toBe(1);
      expect(message.tune + message.tune2).toBe(tuneToMml(tune));
    }
  });
  it('rejects oversized tunes and untrusted pitches', () => {
    expect(() => tuneToMml({ ...motifs[0], notes: Array(30).fill({ midi: 60, beats: 4 }) })).toThrow();
    expect(() => tuneToMml({ ...motifs[0], notes: [{ midi: 200, beats: 1 }] })).toThrow();
    expect(() => tuneToMml({ ...motifs[0], bpm: 240, notes: Array(24).fill({ midi: 61, beats: 0.125 }) })).toThrow('too long');
  });
});
