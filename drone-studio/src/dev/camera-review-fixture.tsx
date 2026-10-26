import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { cameraEvaluation, createCameraEvaluationProvider } from '../agent/evaluation-camera';
import { runAgent } from '../agent/harness';
import { createDraftPreview, type DraftPreviewDocument } from '../agent/draft-preview';
import { buildAgentReviewMoments } from '../agent/review-moments';
import { AgentDraftPreview } from '../components/AgentDraftPreview';
import { Modal } from '../components/Modal';
import '../styles.css';

const controller = new AbortController();
let root: Root | undefined;
// Release the old renderer and ignore late fixture work when Vite replaces this module.
import.meta.hot?.dispose(() => {
  controller.abort();
  root?.unmount();
});

/** Development-only browser fixture. Does not mount the editor or its project persistence. */
function Fixture({ comparison }: { comparison: DraftPreviewDocument }) {
  const [open, setOpen] = useState(false);
  return (
    <main style={{ margin: '40px auto', padding: 24, maxWidth: 800, lineHeight: 1.7 }}>
      <p style={{ color: '#b7cc9f' }}>DEVELOPMENT FIXTURE · SCRIPTED PROVIDER</p>
      <h1>Camera evidence review</h1>
      <p>
        This synthetic seven-drone show uses the real agent tool loop, exact proposal preview, and
        validated measured moments. No model calls or saved-project changes occur.
      </p>
      <p>
        Camera elapsed 0 / 4 / 8 seconds maps to show time 1 / 2 / 3 seconds. Selected dark lights
        are brightened while the unrelated and dormant work stays intact.
      </p>
      <button className="primary-button" onClick={() => setOpen(true)}>
        Open fixture preview · {comparison.reviewMoments?.length ?? 0} measured moments
      </button>
      {open && (
        <Modal title="Synthetic camera evidence preview" onClose={() => setOpen(false)}>
          <AgentDraftPreview comparison={comparison} />
        </Modal>
      )}
    </main>
  );
}

async function start() {
  if (!import.meta.env.DEV)
    throw new Error('This fixture is available only in the local dev server.');
  const { request } = cameraEvaluation.fixture();
  const result = await runAgent(request, {
    provider: createCameraEvaluationProvider(request),
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
  comparison.reviewMoments = buildAgentReviewMoments(comparison.base, comparison.draft, result);
  if (!comparison.reviewMoments.length)
    throw new Error('Fixture produced no validated camera evidence.');
  root = createRoot(document.getElementById('root')!);
  root.render(<Fixture comparison={comparison} />);
}

void start().catch((error: unknown) => {
  if (controller.signal.aborted) return;
  document.getElementById('root')!.textContent =
    error instanceof Error ? error.message : 'Fixture could not start.';
});
