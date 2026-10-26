import type { Project } from '../core/model';
import type { AircraftSnapshot } from './types';
import type { ZorroStopChecks } from './zorro-stop';

type Dependencies = {
  fetch?: typeof fetch;
  isVisible?: () => boolean;
  onSnapshot?: (snapshot: AircraftSnapshot) => void;
  onError?: (message: string) => void;
};

/** Browser ownership lease. Hiding or closing this view requests disarm. */
export class IdleShowClient {
  private runId?: string;
  private timer?: ReturnType<typeof setInterval>;
  private renewing = false;
  private disposed = false;
  private readonly fetcher: typeof fetch;
  private readonly visible: () => boolean;
  constructor(private readonly deps: Dependencies = {}) {
    this.fetcher = deps.fetch ?? globalThis.fetch.bind(globalThis);
    this.visible = deps.isVisible ?? (() => document.visibilityState === 'visible');
  }
  private async post(action: 'start' | 'renew' | 'stop', body: unknown): Promise<AircraftSnapshot> {
    const response = await this.fetcher(`/api/aircraft/idle-show/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lucidity-Aircraft': '1' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(1800), keepalive: action === 'stop',
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Idle show request failed.');
    return result as AircraftSnapshot;
  }
  async start(aircraftId: string, storyboard: Project, checks: ZorroStopChecks) {
    if (this.disposed || !this.visible() || this.runId) throw new Error('Keep one idle-show view open.');
    const runId = crypto.randomUUID();
    this.runId = runId;
    try {
      const result = await this.post('start', { aircraftId, runId, storyboard: structuredClone(storyboard), ...checks });
      if (this.disposed || !this.visible() || this.runId !== runId) {
        void this.post('stop', { runId }).catch(() => {});
        throw new Error('Run view closed while starting; disarm requested.');
      }
      if (result.zorroStop?.runId !== runId || !['arming', 'running'].includes(result.zorroStop.state))
        throw new Error('Arm request was not confirmed by the local service.');
      this.timer = setInterval(() => void this.renew(runId), 500);
      return result;
    } catch (error) {
      if (this.runId === runId) void this.stop().catch(() => {});
      throw error;
    }
  }
  private async renew(runId: string) {
    if (this.runId !== runId || this.renewing) return;
    if (!this.visible()) { void this.stop().catch(() => {}); return; }
    this.renewing = true;
    try {
      const result = await this.post('renew', { runId });
      if (this.runId === runId) {
        this.observe(result);
        this.deps.onSnapshot?.(result);
      }
    } catch {
      if (this.runId === runId) {
        void this.stop().catch(() => {});
        this.deps.onError?.('Run connection lost. Disarm requested; check the aircraft.');
      }
    } finally { this.renewing = false; }
  }
  observe(snapshot: AircraftSnapshot) {
    if (this.runId && snapshot.zorroStop?.runId === this.runId &&
        ['completed', 'cancelled', 'failed'].includes(snapshot.zorroStop.state)) this.clear();
  }
  private clear() { this.runId = undefined; clearInterval(this.timer); this.timer = undefined; }
  async stop() {
    const runId = this.runId;
    this.clear();
    if (runId) return this.post('stop', { runId });
  }
  dispose() { this.disposed = true; void this.stop().catch(() => {}); }
}
