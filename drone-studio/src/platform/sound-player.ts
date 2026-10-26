import { useEffect, useState } from 'react';
import { tuneSeconds, validateTune, type Tune } from './music-model';
let audio: AudioContext | null = null;
let epoch = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<(name: string) => void>();
function announce(name: string) { for (const listener of listeners) listener(name); }
export function stopSound() {
  epoch++;
  clearTimeout(timer);
  if (audio && audio.state !== 'closed') void audio.close();
  audio = null;
  announce('');
}
export async function playSound(tune: Tune) {
  const t = validateTune(tune);
  stopSound();
  const token = epoch;
  const ctx = new AudioContext();
  audio = ctx;
  try {
    await ctx.resume();
    if (token !== epoch) return;
    let at = ctx.currentTime + 0.04;
    for (const n of t.notes) {
      const duration = n.beats * 60 / t.bpm;
      if (n.midi !== null) {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = 'triangle';
        oscillator.frequency.value = 440 * 2 ** ((n.midi - 69) / 12);
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.1, at + 0.008);
        gain.gain.linearRampToValueAtTime(0, at + duration * 0.9);
        oscillator.connect(gain).connect(ctx.destination);
        oscillator.start(at);
        oscillator.stop(at + duration);
      }
      at += duration;
    }
    announce(t.name);
    timer = setTimeout(stopSound, tuneSeconds(t) * 1000 + 100);
  } catch (error) { if (token === epoch) stopSound(); throw error; }
}
export function useSoundPlayer(active = true) {
  const [playing, setPlaying] = useState('');
  useEffect(() => { listeners.add(setPlaying); return () => { listeners.delete(setPlaying); stopSound(); }; }, []);
  useEffect(() => { if (!active) stopSound(); }, [active]);
  return { playing, play: playSound, stop: stopSound };
}
