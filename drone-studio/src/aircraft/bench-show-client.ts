import { compileStoryboardBenchPlan } from '../core/bench-storyboard';
import type { Project } from '../core/model';
import type { AircraftSnapshot } from './types';
import type { MotorTestChecks } from './motor-test';

type Dependencies = {
  fetch?: typeof fetch;
  isVisible?: () => boolean;
  onError?: (message: string) => void;
  onSnapshot?: (snapshot: AircraftSnapshot) => void;
};

/** Owns only a run started in this view. Polling status never grants or renews ownership. */
export class BenchShowClient {
  private run?: { id: string; ready: boolean; planKey: string };
  private timer?: ReturnType<typeof setInterval>;
  private renewal?: AbortController;
  private disposed = false;
  private readonly fetcher;
  private readonly visible;

  constructor(private readonly dependencies: Dependencies = {}) {
    // Native browser fetch rejects this client as its receiver when called as a member.
    this.fetcher = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
    this.visible = dependencies.isVisible ?? (() => document.visibilityState === 'visible');
  }

  private async post(action: string, body: unknown, controller = new AbortController()) {
    const deadline = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await this.fetcher(`/api/aircraft/bench-show/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lucidity-Aircraft': '1' },
        body: JSON.stringify(body), signal: controller.signal, keepalive: action === 'stop',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Bench show request failed.');
      return result as AircraftSnapshot;
    } finally { clearTimeout(deadline); }
  }

  async start(aircraftId: string, checks: MotorTestChecks, storyboard: Project, reviewedPlanKey: string): Promise<AircraftSnapshot> {
    if (this.disposed || !this.visible()) throw new Error('Keep the bench show screen visible.');
    if (this.run) throw new Error('A bench show is already starting or running.');
    const ownedStoryboard = structuredClone(storyboard);
    const plan = compileStoryboardBenchPlan(ownedStoryboard);
    if (plan.source.planKey !== reviewedPlanKey)
      throw new Error('The storyboard changed after review. Review it again before starting.');
    const run = { id: crypto.randomUUID(), ready: false, planKey: reviewedPlanKey };
    this.run = run;
    try {
      const result = await this.post('start', { aircraftId, runId: run.id, ...checks, storyboard: ownedStoryboard, reviewedPlanKey });
      if (this.disposed || this.run !== run || !this.visible()) {
        void this.post('stop', { runId: run.id }).catch(() => {});
        throw new Error('Bench show start cancelled. No continuation was scheduled by this view.');
      }
      if (result.benchShow?.runId !== run.id || result.benchShow.state !== 'running' ||
        result.benchShow.source?.planKey !== run.planKey)
        throw new Error('Bench show start was not confirmed.');
      run.ready = true;
      this.timer = setInterval(() => void this.renew(run), 500);
      return result;
    } catch (error) {
      if (this.run === run) void this.stop().catch(() => {});
      throw error;
    }
  }

  private async renew(run: { id: string; ready: boolean; planKey: string }) {
    if (this.run !== run || !run.ready || this.renewal) return;
    if (!this.visible()) { void this.stop().catch(() => {}); return; }
    const controller = new AbortController();
    this.renewal = controller;
    try {
      const result = await this.post('renew', { runId: run.id }, controller);
      if (this.run === run) {
        if (result.benchShow?.runId !== run.id || result.benchShow.source?.planKey !== run.planKey) throw new Error('The running show identity changed.');
        this.observe(result);
        this.dependencies.onSnapshot?.(result);
      }
    } catch {
      if (this.run === run && !controller.signal.aborted) {
        void this.stop().catch(() => {});
        this.dependencies.onError?.('Bench show cancelled: the screen could not maintain its connection. Check the motors have stopped.');
      } else if (this.run === run) {
        void this.stop().catch(() => {});
        this.dependencies.onError?.('Bench show connection timed out. Remaining cues cancelled; check the motors have stopped.');
      }
    } finally {
      if (this.renewal === controller) this.renewal = undefined;
    }
  }

  observe(snapshot: AircraftSnapshot) {
    const show = snapshot.benchShow;
    if (show && this.run && show.runId === this.run.id &&
      ['completed', 'cancelled', 'failed'].includes(show.state)) this.clear();
  }

  private clear() {
    this.run = undefined;
    clearInterval(this.timer);
    this.timer = undefined;
    this.renewal?.abort();
    this.renewal = undefined;
  }

  async stop(): Promise<AircraftSnapshot | undefined> {
    const run = this.run;
    this.clear(); // Stop leasing synchronously, even when the network is unavailable.
    if (run) return this.post('stop', { runId: run.id });
  }

  dispose() {
    this.disposed = true;
    void this.stop().catch(() => {});
  }
}
