import { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { targetingEvaluation } from '../agent/evaluation-targeting';
import { runAgent } from '../agent/harness';
import { createDraftPreview, type DraftPreviewDocument } from '../agent/draft-preview';
import type { AgentProvider, AgentResult } from '../agent/types';
import type { Operation } from '../core/commands';
import { AgentDraftPreview } from '../components/AgentDraftPreview';
import { Modal } from '../components/Modal';
import '../styles.css';

type Variant = 'growth' | 'shrink';
type Prepared = { comparison: DraftPreviewDocument; result: AgentResult };
type RendererLifecycle = {
  uniqueMounts: number;
  removals: number;
  active: number;
  contextLosses: number;
  contextRestorations: number;
};
const controller = new AbortController();
let root: Root | undefined;
const diagnosticEntries: string[] = [];
let diagnosticSection: HTMLElement | undefined;
let diagnosticOutput: HTMLPreElement | undefined;
const errorDetail = (error: unknown) =>
  error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
const diagnostic = (phase: string, detail: string) => {
  diagnosticEntries.push(`${performance.now().toFixed(1)} ms · ${phase}\n${detail.slice(0, 4000)}`);
  if (diagnosticEntries.length > 12) diagnosticEntries.shift();
  if (diagnosticOutput) diagnosticOutput.textContent = diagnosticEntries.join('\n\n');
};
const windowError = (event: ErrorEvent) => {
  diagnostic(
    'Window error',
    `${event.message}\n${event.filename}:${event.lineno}:${event.colno}\n${errorDetail(event.error)}`
  );
};
const rejection = (event: PromiseRejectionEvent) =>
  diagnostic('Unhandled rejection', errorDetail(event.reason));
if (import.meta.env.DEV) {
  diagnosticSection = document.createElement('section');
  diagnosticSection.setAttribute('aria-label', 'Fixture diagnostics');
  diagnosticSection.style.cssText =
    'margin:20px auto;max-width:920px;padding:12px 24px;border:1px solid #38434d';
  const heading = document.createElement('strong');
  heading.textContent = 'Fixture diagnostics · last 12 entries';
  diagnosticOutput = document.createElement('pre');
  diagnosticOutput.style.cssText =
    'white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 monospace';
  diagnosticSection.append(heading, diagnosticOutput);
  document.body.append(diagnosticSection);
  window.addEventListener('error', windowError);
  window.addEventListener('unhandledrejection', rejection);
  diagnostic(
    'Diagnostic listeners installed',
    `Child module executing; document.readyState=${document.readyState}. Earlier bootstrap errors may predate these listeners. Errors are not suppressed.`
  );
}
import.meta.hot?.dispose(() => {
  controller.abort();
  root?.unmount();
  window.removeEventListener('error', windowError);
  window.removeEventListener('unhandledrejection', rejection);
  diagnosticSection?.remove();
});

/** Observe this fixture's real renderer nodes without asking for or changing a WebGL context. */
function useRendererLifecycle(): RendererLifecycle {
  const [lifecycle, setLifecycle] = useState<RendererLifecycle>({
    uniqueMounts: 0,
    removals: 0,
    active: 0,
    contextLosses: 0,
    contextRestorations: 0,
  });
  useEffect(() => {
    const seen = new WeakSet<HTMLCanvasElement>();
    const attached = new Map<HTMLCanvasElement, () => void>();
    let disposed = false;
    let uniqueMounts = 0;
    let removals = 0;
    const update = () => {
      if (disposed) return;
      const current = new Set(
        document.querySelectorAll<HTMLCanvasElement>('.agent-draft-preview .stage-canvas canvas')
      );
      for (const [canvas, detach] of attached) {
        if (current.has(canvas)) continue;
        detach();
        attached.delete(canvas);
        removals++;
      }
      for (const canvas of current) {
        if (attached.has(canvas)) continue;
        if (!seen.has(canvas)) {
          seen.add(canvas);
          uniqueMounts++;
        }
        const lost = () => {
          if (!disposed)
            setLifecycle((previous) => ({
              ...previous,
              contextLosses: previous.contextLosses + 1,
            }));
        };
        const restored = () => {
          if (!disposed)
            setLifecycle((previous) => ({
              ...previous,
              contextRestorations: previous.contextRestorations + 1,
            }));
        };
        canvas.addEventListener('webglcontextlost', lost);
        canvas.addEventListener('webglcontextrestored', restored);
        attached.set(canvas, () => {
          canvas.removeEventListener('webglcontextlost', lost);
          canvas.removeEventListener('webglcontextrestored', restored);
        });
      }
      setLifecycle((previous) =>
        previous.uniqueMounts === uniqueMounts &&
        previous.removals === removals &&
        previous.active === attached.size
          ? previous
          : { ...previous, uniqueMounts, removals, active: attached.size }
      );
    };
    const observer = new MutationObserver(update);
    const observed = document.body;
    diagnostic(
      'Lifecycle observe attempt',
      `target=${observed?.nodeName ?? 'null'}; local Node=${observed instanceof Node}; ownerDocument=current=${observed?.ownerDocument === document}; readyState=${document.readyState}`
    );
    try {
      observer.observe(observed, { childList: true, subtree: true });
      diagnostic(
        'Lifecycle observe succeeded',
        'observe() returned normally. Tracking canvas mounts/removals from this point.'
      );
    } catch (error) {
      diagnostic('Lifecycle observe failed', errorDetail(error));
      throw error;
    }
    update();
    return () => {
      disposed = true;
      observer.disconnect();
      for (const detach of attached.values()) detach();
      attached.clear();
    };
  }, []);
  return lifecycle;
}

/** Injected local calls exercise the real transaction and review; no model or stored project. */
async function prepare(variant: Variant): Promise<Prepared> {
  const { request } = targetingEvaluation.fixture();
  request.project.id = `proposal-targets-${variant}-fixture`;
  request.project.name = `Proposal targets · fleet ${variant}`;
  request.prompt =
    'Prepare the synthetic mixed-operation proposal for private target-ring review. Do not apply it.';
  const ids = Array.from({ length: 200 }, (_, index) => 1 + index * 3);
  const operations: Operation[] = [
    { type: 'edit_drones', cueId: 'opening', ids, patch: { brightness: 1 } },
    {
      type: 'transform_drones',
      cueId: 'opening',
      ids: [4, 900],
      translation: [8, 0, 0],
      scope: 'base_and_keys',
    },
    { type: 'set_keyframe', cueId: 'opening', ids: [4], keyframe: { time: 1, brightness: 0.5 } },
    { type: 'remove_keyframe', cueId: 'opening', ids: [133], time: 6 },
    { type: 'move_keyframe', cueId: 'opening', droneId: 1, from: 2, to: 3 },
    { type: 'reset_drones', cueId: 'opening', ids: [7] },
    { type: 'set_fleet', count: variant === 'growth' ? 900 : 300 },
    {
      type: 'update_cue',
      id: 'opening',
      patch: { metadata: { note: `Synthetic ${variant} target-ring review.` } },
    },
  ];
  let step = 0;
  const provider: AgentProvider = {
    async complete({ input }) {
      if (step > 0) {
        const previous = [...input]
          .reverse()
          .find(
            (item) =>
              item &&
              typeof item === 'object' &&
              (item as { type?: string }).type === 'function_call_output'
          ) as { output?: string } | undefined;
        if (!previous?.output || !JSON.parse(previous.output).ok)
          throw new Error('The synthetic tool loop did not complete its previous step.');
      }
      const index = step++;
      const next =
        index === 0
          ? {
              name: 'stage_operations',
              args: {
                operationsJson: JSON.stringify(operations),
                explanation:
                  'Six explicit per-drone operation families, a fleet change, and scene metadata.',
              },
            }
          : index === 1
            ? { name: 'review_draft', args: {} }
            : {
                name: 'finish_proposal',
                args: {
                  title: `Synthetic ${variant} target review`,
                  description:
                    'An unapplied deterministic fixture for operation-target rings. Explicit targets include dormant IDs, reset work, and edits to keys outside the current scene duration; rings do not claim a current visual change or flight readiness.',
                  changes: [
                    'Six granular operation families target 201 unique IDs',
                    'Fleet and scene metadata operations have no inferred target rings',
                  ],
                },
              };
      const call = {
        id: `proposal-targets-${variant}-${index}`,
        name: next.name,
        arguments: JSON.stringify(next.args),
      };
      return {
        calls: [call],
        output: [
          { type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments },
        ],
        text: '',
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
  const result = await runAgent(request, { provider, signal: controller.signal });
  controller.signal.throwIfAborted();
  if (result.status !== 'completed' || !result.proposal)
    throw new Error(`Synthetic ${variant} proposal failed: ${result.message}`);
  return {
    result,
    comparison: createDraftPreview(
      request.project,
      result.proposal,
      request.time,
      request.viewer?.current.snapshot
    ),
  };
}

function Fixture({ prepared }: { prepared: Record<Variant, Prepared> }) {
  const [variant, setVariant] = useState<Variant>('growth');
  const [open, setOpen] = useState(false);
  const lifecycle = useRendererLifecycle();
  const chosen = prepared[variant];
  return (
    <main style={{ margin: '30px auto', padding: 24, maxWidth: 920, lineHeight: 1.65 }}>
      <p style={{ color: '#b7cc9f', fontSize: 12 }}>
        DEVELOPMENT FIXTURE · INJECTED LOCAL PROVIDER
      </p>
      <h1>Proposal target rings</h1>
      <p>
        Two completed synthetic proposals use the real tool loop and private Before/Draft preview.
        They target the full 200 front IDs (1, 4, …, 598), plus dormant ID 900. Already-lit front
        controls remain outside that union. No model calls, saved-show changes, or proposal
        application occur.
      </p>
      <p>
        Six granular operations cover editing, transforming, setting/removing/moving keys, and
        reset. Two other operations change the fleet and scene metadata. Rings identify explicit
        operation targets across the proposal; they do not promise that every marked drone visibly
        changes at the current time, or identify every drone affected by a broad operation.
      </p>
      <div
        style={{
          display: 'flex',
          gap: 14,
          alignItems: 'center',
          flexWrap: 'wrap',
          margin: '18px 0',
        }}
      >
        <label>
          Synthetic variant{' '}
          <select
            value={variant}
            disabled={open}
            onChange={(event) => setVariant(event.currentTarget.value as Variant)}
          >
            <option value="growth">Grow fleet · 600 → 900</option>
            <option value="shrink">Shrink fleet · 600 → 300</option>
          </select>
        </label>
        <button className="primary-button" onClick={() => setOpen(true)}>
          Open {variant} Before / Draft
        </button>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: '190px 1fr', gap: '4px 14px' }}>
        <dt>Expected full union</dt>
        <dd>201 unique IDs</dd>
        <dt>Before active targets</dt>
        <dd>200 of 600 active drones · ID 900 dormant</dd>
        <dt>Draft active targets</dt>
        <dd>
          {variant === 'growth'
            ? '201 of 900 active drones · none dormant'
            : '100 of 300 active drones · 101 targets dormant'}
        </dd>
        <dt>Operation counts</dt>
        <dd>6 granular · 2 other · 8 total</dd>
        <dt>Initial display</dt>
        <dd>Show time 1 s · same captured North-facing camera on both sides</dd>
        <dt>Run status</dt>
        <dd>{chosen.result.status} · proposal remains unapplied</dd>
      </dl>
      <section
        aria-label="Renderer lifecycle"
        style={{
          marginTop: 16,
          padding: '10px 12px',
          border: '1px solid #38434d',
          borderRadius: 'var(--radius-panel)',
          fontSize: 12,
        }}
      >
        <strong>Renderer lifecycle</strong>
        <p style={{ margin: '4px 0' }}>
          Unique canvas mounts: {lifecycle.uniqueMounts} · removals: {lifecycle.removals} · active
          canvases: {lifecycle.active}
          <br />
          WebGL context loss events: {lifecycle.contextLosses} · restoration events:{' '}
          {lifecycle.contextRestorations}
        </p>
        <p style={{ margin: 0, color: '#95a7b6' }}>
          Cumulative for this fixture mount; reload resets the counters. Opening a preview adds one
          canvas and closing it removes one. Expanding, restoring, switching Before/Draft, opening
          trays, and capturing should keep that same canvas. DOM reparenting without disconnection
          at the observer checkpoint does not count as removal. Context counters record browser
          events; this observer does not create or modify a graphics context.
        </p>
      </section>
      <details style={{ marginTop: 20 }}>
        <summary>Exact synthetic proposal operations</summary>
        <pre style={{ maxHeight: 300, overflow: 'auto', fontSize: 12 }}>
          {JSON.stringify(chosen.result.proposal?.operations, null, 2)}
        </pre>
      </details>
      {open && (
        <Modal title={`Synthetic ${variant} proposal targets`} onClose={() => setOpen(false)}>
          <AgentDraftPreview comparison={chosen.comparison} />
        </Modal>
      )}
    </main>
  );
}

async function start() {
  if (!import.meta.env.DEV)
    throw new Error('This synthetic fixture is available only in the local dev server.');
  const growth = await prepare('growth');
  const shrink = await prepare('shrink');
  controller.signal.throwIfAborted();
  root = createRoot(document.getElementById('root')!);
  root.render(<Fixture prepared={{ growth, shrink }} />);
}
void start().catch((error: unknown) => {
  if (controller.signal.aborted) return;
  document.getElementById('root')!.textContent =
    error instanceof Error ? error.message : 'The synthetic proposal fixture could not start.';
});
