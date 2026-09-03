// VGWorker orchestrator registry + crash recovery.
//
// Keeps one active VGWorker per story job in memory and re-attaches orphaned
// (non-terminal) runs on backend restart (process doc assumption A6).
import { VGWorker } from './vgWorker.js';
import { videoGenerationJobService } from '../services/videoGenerationJob.js';

const activeWorkers = new Map<string, VGWorker>();

/** Look up the in-memory worker for a running story job (for direct control calls). */
export function getWorker(storyJobId: string): VGWorker | undefined {
  return activeWorkers.get(storyJobId);
}

/** Start (or re-attach to) the worker for a story job. Returns null if already running. */
export async function startWorker(storyJobId: string): Promise<VGWorker | null> {
  const existing = activeWorkers.get(storyJobId);
  if (existing) return existing;
  const worker = new VGWorker(storyJobId);
  activeWorkers.set(storyJobId, worker);
  // fire-and-forget — the run() method dispatches on persisted status.
  void (async () => {
    try {
      await worker.run();
    } catch (err) {
      console.error(`[VGWorker:${storyJobId}] crashed:`, err);
    } finally {
      activeWorkers.delete(storyJobId);
    }
  })();
  worker.run().catch((err) => {
    console.error(`[VGWorker:${storyJobId}] crashed:`, err);
    activeWorkers.delete(storyJobId);
  });
  return worker;
}

/**
 * Crash-recovery entry point. Called once at backend startup: re-attach a worker
 * to every story job that was left in a non-terminal status.
 */
export async function recoverWorkers(): Promise<void> {
  const jobs = await videoGenerationJobService.getActiveStoryJobs();
  for (const job of jobs) {
    try {
      await startWorker(job.id);
    } catch (err) {
      console.error(`[VGWorker] failed to recover story job ${job.id}:`, err);
    }
  }
}

export { VGWorker };
