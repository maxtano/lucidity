export type TrackInfo = { name: string; kind: 'demo' | 'file'; duration: number; peaks: number[] };

export class AudioEngine {
  private context: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private startedAt = 0;
  private offset = 0;
  private demo = true;
  private muted = false;
  private playbackGeneration = 0;
  private loadGeneration = 0;
  ensure() {
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.connect(this.context.destination);
      this.gain.gain.value = this.muted ? 0 : 0.65;
    }
    return this.context;
  }
  private waveform(buffer: AudioBuffer) {
    const data = buffer.getChannelData(0),
      peaks: number[] = [],
      bucket = Math.floor(data.length / 256);
    for (let i = 0; i < 256; i++) {
      let sum = 0;
      for (let j = 0; j < bucket; j += 16) sum += data[i * bucket + j] ** 2;
      peaks.push(Math.sqrt(sum / Math.max(1, Math.ceil(bucket / 16))));
    }
    const max = Math.max(...peaks, 0.001);
    return peaks.map((p) => p / max);
  }
  loadDemo(): TrackInfo {
    const context = this.ensure(),
      sampleRate = 22050,
      duration = 32;
    const buffer = context.createBuffer(1, sampleRate * duration, sampleRate),
      data = buffer.getChannelData(0);
    const chords = [
      [130.81, 164.81, 196],
      [110, 130.81, 164.81],
      [87.31, 110, 130.81],
      [98, 123.47, 146.83],
    ];
    for (let i = 0; i < data.length; i++) {
      const t = i / sampleRate,
        beat = t % 0.5,
        chord = chords[Math.floor(t / 8) % 4],
        phase = t % 8;
      const envelope = Math.min(1, phase / 0.25, (8 - phase) / 0.45);
      const pad =
        chord.reduce(
          (s, hz) =>
            s +
            Math.sin(2 * Math.PI * hz * t) * 0.032 +
            Math.sin(2 * Math.PI * hz * 2.002 * t) * 0.01,
          0
        ) * envelope;
      const kick =
        Math.sin(2 * Math.PI * (48 * beat + 5 * (1 - Math.exp(-25 * beat)))) *
        Math.exp(-beat * 20) *
        0.15;
      const note = chord[Math.floor(t * 4) % 3] * 4,
        bell = Math.sin(2 * Math.PI * note * (t % 0.25)) * Math.exp(-(t % 0.25) * 22) * 0.035;
      data[i] = (pad + kick + bell) * Math.min(1, t / 0.04, (duration - t) / 0.04);
    }
    this.buffer = buffer;
    this.demo = true;
    return { name: 'Drift', kind: 'demo', duration, peaks: this.waveform(buffer) };
  }
  /** Returns null when a newer load or disposal supersedes this file. */
  async loadFile(file: File): Promise<TrackInfo | null> {
    const generation = ++this.loadGeneration;
    if (file.size > 80_000_000) throw new Error('Choose an audio file smaller than 80 MB.');
    const context = this.ensure();
    const contents = await file.arrayBuffer();
    if (generation !== this.loadGeneration || context !== this.context) return null;
    const buffer = await context.decodeAudioData(contents);
    if (generation !== this.loadGeneration || context !== this.context) return null;
    if (buffer.duration > 1800) throw new Error('Choose a soundtrack shorter than 30 minutes.');
    const track: TrackInfo = {
      name: file.name.replace(/\.[^.]+$/, ''),
      kind: 'file',
      duration: buffer.duration,
      peaks: this.waveform(buffer),
    };
    this.pause();
    this.buffer = buffer;
    this.demo = false;
    return track;
  }
  /** Returns false if pause, disposal, or a newer playback request cancels the resume. */
  async play(time: number): Promise<boolean> {
    const context = this.ensure();
    const generation = ++this.playbackGeneration;
    await context.resume();
    if (generation !== this.playbackGeneration || context !== this.context) return false;
    this.stopSource();
    if (!this.buffer) this.loadDemo();
    this.offset = time;
    this.startedAt = context.currentTime;
    if (!this.demo && time >= this.buffer!.duration) return true;
    this.source = context.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.loop = this.demo;
    this.source.connect(this.gain!);
    this.source.start(0, this.demo ? time % this.buffer!.duration : time);
    return true;
  }
  time() {
    return this.offset + (this.context ? this.context.currentTime - this.startedAt : 0);
  }
  pause() {
    ++this.playbackGeneration;
    this.stopSource();
  }
  private stopSource() {
    if (this.source) {
      this.source.stop();
      this.source.disconnect();
      this.source = null;
    }
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.gain) this.gain.gain.value = muted ? 0 : 0.65;
  }
  dispose() {
    ++this.loadGeneration;
    this.pause();
    const context = this.context;
    this.context = null;
    this.gain = null;
    this.buffer = null;
    void context?.close().catch(() => {});
  }
}
