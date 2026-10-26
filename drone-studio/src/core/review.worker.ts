import { validateProject } from './validation';
import { trajectoryCsv } from './export';
import { projectSchema } from './model';

self.onmessage = (event: MessageEvent) => {
  const { requestId, type, project } = event.data;
  try {
    const parsed = projectSchema.parse(project);
    const result = type === 'csv' ? trajectoryCsv(parsed) : validateProject(parsed);
    self.postMessage({ requestId, result });
  } catch (error) {
    self.postMessage({
      requestId,
      error: error instanceof Error ? error.message : 'Could not process the show.',
    });
  }
};
