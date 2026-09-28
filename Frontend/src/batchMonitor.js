export const TERMINAL_BATCH_STATUSES = new Set([
  'completed',
  'completed_with_failures',
  'no_errors',
]);

export function isTerminalBatchStatus(status) {
  return TERMINAL_BATCH_STATUSES.has(status);
}

function wait(ms, signal) {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

export async function monitorBatch({
  uploadId,
  getSnapshot,
  onSnapshot,
  signal,
  intervalMs = 2000,
  maxDurationMs = 10 * 60 * 1000,
  maxConsecutiveFailures = 3,
  sleep = wait,
  now = Date.now,
}) {
  const startedAt = now();
  let consecutiveFailures = 0;

  while (!signal?.aborted) {
    try {
      const snapshot = await getSnapshot(uploadId);
      if (signal?.aborted) return { reason: 'aborted' };
      consecutiveFailures = 0;
      onSnapshot(snapshot);
      if (isTerminalBatchStatus(snapshot.summary.status)) {
        return { reason: 'terminal', snapshot };
      }
    } catch (error) {
      if (signal?.aborted) return { reason: 'aborted' };
      consecutiveFailures += 1;
      if (consecutiveFailures >= maxConsecutiveFailures) throw error;
    }

    if (now() - startedAt >= maxDurationMs) return { reason: 'timeout' };
    await sleep(intervalMs, signal);
  }

  return { reason: 'aborted' };
}
