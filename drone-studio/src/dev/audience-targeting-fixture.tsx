import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  targetingEvaluation,
  createTargetingEvaluationProvider,
} from '../agent/evaluation-targeting';
import { runAgent } from '../agent/harness';
import { createDraftPreview, type DraftPreviewDocument } from '../agent/draft-preview';
import type { AgentResult } from '../agent/types';
import { AgentDraftPreview } from '../components/AgentDraftPreview';
import { AudienceTargetActivity } from '../components/AudienceTargetActivity';
import { Modal } from '../components/Modal';
import '../styles.css';

const controller = new AbortController();
let root: Root | undefined;
import.meta.hot?.dispose(() => {
  controller.abort();
  root?.unmount();
});

/** Isolated real-harness preview: never mounts saved-project persistence or a live provider. */
function Fixture({
  comparison,
  result,
}: {
  comparison: DraftPreviewDocument;
  result: AgentResult;
}) {
  const [open, setOpen] = useState(false);
  return (
    <main style={{ margin: '32px auto', padding: 24, maxWidth: 850, lineHeight: 1.7 }}>
      <p style={{ color: '#b7cc9f' }}>DEVELOPMENT FIXTURE · SCRIPTED PROVIDER</p>
      <h1>Complete audience targeting</h1>
      <p>
        A 600-drone synthetic show. One audience query finds 200 dark lights in front of the viewer,
        returning only a 128-ID page. One operation brightens all 200 matches using the temporary
        target. Already-lit lights, the dark lights behind you, the original selection, and dormant
        authored work stay intact.
      </p>
      <p>No model calls or saved-project changes occur. The proposal below remains unapplied.</p>
      <button className="primary-button" onClick={() => setOpen(true)}>
        Preview Before / Draft · 200 affected drones
      </button>
      <section aria-label="Audience targeting activity" style={{ marginTop: 24 }}>
        {result.events
          .filter(
            (event) =>
              event.type === 'tool_result' &&
              ['inspect_audience_selection', 'stage_audience_operation'].includes(event.tool ?? '')
          )
          .map((event) => (
            <article key={event.id} style={{ marginBottom: 16 }}>
              <code>{event.tool}</code>
              <AudienceTargetActivity event={event} events={result.events} running={false} />
            </article>
          ))}
      </section>
      <details style={{ marginTop: 20 }}>
        <summary>Exact proposal operations · full affected ID list</summary>
        <pre style={{ maxHeight: 300, overflow: 'auto', fontSize: 12 }}>
          {JSON.stringify(result.proposal?.operations, null, 2)}
        </pre>
      </details>
      {open && (
        <Modal title="Synthetic audience targeting preview" onClose={() => setOpen(false)}>
          <AgentDraftPreview comparison={comparison} />
        </Modal>
      )}
    </main>
  );
}

async function start() {
  if (!import.meta.env.DEV)
    throw new Error('This fixture is available only in the local dev server.');
  const { request } = targetingEvaluation.fixture();
  const result = await runAgent(request, {
    provider: createTargetingEvaluationProvider(request),
    signal: controller.signal,
  });
  controller.signal.throwIfAborted();
  if (result.status !== 'completed' || !result.proposal)
    throw new Error(`Fixture failed: ${result.message}`);
  const comparison = createDraftPreview(
    request.project,
    result.proposal,
    request.time,
    request.viewer?.current.snapshot
  );
  root = createRoot(document.getElementById('root')!);
  root.render(<Fixture comparison={comparison} result={result} />);
}

void start().catch((error: unknown) => {
  if (controller.signal.aborted) return;
  document.getElementById('root')!.textContent =
    error instanceof Error ? error.message : 'Fixture could not start.';
});
