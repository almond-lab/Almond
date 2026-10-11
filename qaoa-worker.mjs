import { optimizeLocal } from './portfolio-model.mjs';
// Module worker owns CPU simulation only. It never submits a provider job.
if (typeof self !== 'undefined') self.onmessage = event => {
  const { snapshot, previousAngles = null, seed = 1 } = event.data ?? {};
  try {
    const result = optimizeLocal(snapshot, previousAngles, seed, { onProgress: progress => self.postMessage({type: 'progress', snapshotId: snapshot.id, progress}) });
    self.postMessage({ type: 'result', snapshotId: result.snapshotId, result });
  } catch (error) {
    self.postMessage({ type: 'error', snapshotId: snapshot?.id ?? null, error: error instanceof Error ? error.message : String(error), message: error instanceof Error ? error.message : String(error) });
  }
};
