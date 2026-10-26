import { selectAudienceDrones, type AudienceSelectionRequest } from './audience-selection';
import type { Project } from './model';

/** One UI job per worker. Cancellation terminates this isolated calculation. */
self.onmessage = async (
  event: MessageEvent<{ id: number; project: Project; request: AudienceSelectionRequest }>
) => {
  const { id, project, request } = event.data;
  try {
    const report = await selectAudienceDrones(project, request, {
      onProgress: (completed, total) =>
        self.postMessage({ id, type: 'progress', completed, total }),
    });
    self.postMessage({ id, type: 'result', report });
  } catch (error) {
    self.postMessage({
      id,
      type: 'error',
      message: error instanceof Error ? error.message : 'Audience selection failed.',
    });
  }
};
