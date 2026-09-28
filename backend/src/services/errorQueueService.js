function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createErrorQueueService(queue, options = {}) {
  const attempts = positiveInteger(options.attempts, 3);
  const backoffMs = positiveInteger(options.backoffMs, 2000);

  function jobIdFor(errorId) {
    return `error-${errorId}`;
  }

  async function enqueueError(payload) {
    return queue.add("processError", payload, {
      jobId: jobIdFor(payload.errorId),
      attempts,
      backoff: {
        type: "exponential",
        delay: backoffMs,
      },
    });
  }

  async function ensureErrorQueued(payload) {
    const jobId = jobIdFor(payload.errorId);
    const existingJob = await queue.getJob(jobId);

    if (!existingJob) {
      await enqueueError(payload);
      return { action: "created", state: "waiting" };
    }

    const state = await existingJob.getState();

    if (state === "failed") {
      await existingJob.retry();
      return { action: "retried", state: "waiting" };
    }

    if (state === "completed") {
      await existingJob.retry("completed");
      return { action: "retried_completed", state: "waiting" };
    }

    if (state === "unknown") {
      await existingJob.remove();
      await enqueueError(payload);
      return { action: "recreated", state: "waiting" };
    }

    return { action: "existing", state };
  }

  return {
    enqueueError,
    ensureErrorQueued,
    jobIdFor,
  };
}

module.exports = { createErrorQueueService };
