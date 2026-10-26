import type { StoryboardBenchPlan } from '../core/bench-storyboard';

export const BENCH_SHOW_LEASE_MS = 2500;

export type BenchShowCue = {
  sceneId: string;
  sceneName: string;
  motor: number;
  atMs: number;
  state: 'waiting' | 'pending' | 'accepted' | 'confirmed' | 'failed';
  message?: string;
};

export type BenchShowStatus = {
  runId: string;
  aircraftId: string;
  source: StoryboardBenchPlan['source'];
  state: 'running' | 'stopping' | 'completed' | 'cancelled' | 'failed';
  startedAt: number;
  elapsedMs: number;
  durationMs: number;
  message: string;
  cues: BenchShowCue[];
};
