const PROCESSABLE_STATUSES = new Set(['pending', 'queued', 'retrying', 'queue_failed']);

function wait(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
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

export async function processDirectBatch({
  uploadId,
  getSnapshot,
  analyzeError,
  onSnapshot,
  signal,
  retryFailed = false,
  intervalMs = 2000,
  maxDurationMs = 10 * 60 * 1000,
  sleep = wait,
  now = Date.now,
}) {
  const startedAt = now();
  const attempted = new Set();

  while (!signal?.aborted) {
    const snapshot = await getSnapshot(uploadId);
    if (signal?.aborted) return { reason: 'aborted' };
    onSnapshot(snapshot);

    const next = snapshot.errors.find((item) =>
      !attempted.has(item.id)
      && (PROCESSABLE_STATUSES.has(item.status)
        || item.status === 'processing'
        || (retryFailed && item.status === 'failed'))
    );

    if (next) {
      attempted.add(next.id);
      try {
        await analyzeError(next.id);
      } catch (error) {
        if (error?.response?.status === 409 || !error?.response) {
          attempted.delete(next.id);
          await sleep(intervalMs, signal);
        }
      }
      if (now() - startedAt >= maxDurationMs) return { reason: 'timeout' };
      continue;
    }

    const hasProcessing = snapshot.errors.some((item) => item.status === 'processing');
    if (!hasProcessing) return { reason: 'settled', snapshot };
    if (now() - startedAt >= maxDurationMs) return { reason: 'timeout' };
    await sleep(intervalMs, signal);
  }

  return { reason: 'aborted' };
}
