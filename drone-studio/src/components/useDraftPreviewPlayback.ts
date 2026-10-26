import { useEffect, useRef, useState } from 'react';
import {
  advanceDraftPlayback,
  draftPlaybackStart,
  DRAFT_PREVIEW_SPEEDS,
  validateDraftAuditionRange,
  type DraftAuditionRange,
} from '../agent/draft-preview-playback';

type Clock = {
  time: number;
  playing: boolean;
  speed: number;
  range: DraftAuditionRange;
  loopEnabled: boolean;
  duration: number;
  anchorTime: number;
  anchorWall: number;
  generation: number;
  animation: number;
};

/** Private transport for an immutable preview document; all commands settle/cancel synchronously. */
export function useDraftPreviewPlayback(initialTime: number, duration: number) {
  const clock = useRef<Clock | null>(null);
  if (!clock.current) {
    const range = validateDraftAuditionRange({ start: 0, end: duration }, duration);
    if (!Number.isFinite(initialTime)) throw new Error('Preview time must be finite.');
    const time = Math.max(0, Math.min(duration, initialTime));
    clock.current = {
      time,
      playing: false,
      speed: 1,
      range,
      loopEnabled: false,
      duration,
      anchorTime: time,
      anchorWall: 0,
      generation: 0,
      animation: 0,
    };
  }
  const [time, setTime] = useState(clock.current.time);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [range, setRangeState] = useState(clock.current.range);
  const [loopEnabled, setLoopState] = useState(false);

  const invalidate = () => {
    const state = clock.current!;
    state.generation++;
    if (state.animation) cancelAnimationFrame(state.animation);
    state.animation = 0;
  };
  const publish = (next: number) => {
    clock.current!.time = next;
    setTime(next);
  };
  const sampleClock = (now: number) => {
    const state = clock.current!;
    return advanceDraftPlayback({
      startTime: state.anchorTime,
      elapsedSeconds: Math.max(0, (now - state.anchorWall) / 1000),
      speed: state.speed,
      duration: state.duration,
      range: state.loopEnabled ? state.range : undefined,
    });
  };
  const schedule = () => {
    const generation = clock.current!.generation;
    const tick = () => {
      const state = clock.current!;
      if (!state.playing || state.generation !== generation) return;
      const next = sampleClock(performance.now());
      publish(next.time);
      if (next.ended) {
        invalidate();
        state.playing = false;
        setPlaying(false);
      } else state.animation = requestAnimationFrame(tick);
    };
    clock.current!.animation = requestAnimationFrame(tick);
  };

  const pause = () => {
    const state = clock.current!;
    if (state.playing) publish(sampleClock(performance.now()).time);
    invalidate();
    state.playing = false;
    setPlaying(false);
    return state.time;
  };
  const togglePlaying = () => {
    const state = clock.current!;
    if (state.playing) {
      pause();
      return;
    }
    invalidate();
    const next = draftPlaybackStart(
      state.time,
      state.duration,
      state.loopEnabled ? state.range : undefined
    );
    publish(next);
    state.anchorTime = next;
    state.anchorWall = performance.now();
    state.playing = true;
    setPlaying(true);
    schedule();
  };
  const seek = (next: number) => {
    if (!Number.isFinite(next)) throw new Error('Preview time must be finite.');
    const state = clock.current!;
    invalidate();
    state.playing = false;
    setPlaying(false);
    publish(Math.max(0, Math.min(state.duration, next)));
  };
  const setSpeed = (next: number) => {
    if (!(DRAFT_PREVIEW_SPEEDS as readonly number[]).includes(next))
      throw new Error('Choose a supported preview playback speed.');
    const state = clock.current!;
    if (next === state.speed) return;
    const now = performance.now();
    const settled = state.playing ? sampleClock(now) : { time: state.time, ended: false };
    const resume = state.playing && !settled.ended;
    invalidate();
    publish(settled.time);
    state.speed = next;
    state.anchorTime = settled.time;
    state.anchorWall = now;
    state.playing = resume;
    setSpeedState(next);
    setPlaying(resume);
    if (resume) schedule();
  };
  const setRange = (next: DraftAuditionRange) => {
    // Validate before pausing or touching any committed transport state.
    const validated = validateDraftAuditionRange(next, clock.current!.duration);
    pause();
    clock.current!.range = validated;
    setRangeState(validated);
  };
  const setLoopEnabled = (enabled: boolean) => {
    pause();
    clock.current!.loopEnabled = enabled;
    setLoopState(enabled);
  };
  const toggleLoop = () => setLoopEnabled(!clock.current!.loopEnabled);
  const restart = () => seek(clock.current!.loopEnabled ? clock.current!.range.start : 0);

  useEffect(
    () => () => {
      const state = clock.current!;
      state.generation++;
      state.playing = false;
      if (state.animation) cancelAnimationFrame(state.animation);
      state.animation = 0;
    },
    []
  );

  return {
    time,
    playing,
    speed,
    range,
    loopEnabled,
    pause,
    seek,
    restart,
    togglePlaying,
    setSpeed,
    setRange,
    setLoopEnabled,
    toggleLoop,
  };
}
