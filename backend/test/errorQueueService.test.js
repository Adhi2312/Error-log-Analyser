const test = require("node:test");
const assert = require("node:assert/strict");
const { createErrorQueueService } = require("../src/services/errorQueueService");

function createQueueHarness(existingState = null) {
  const addedJobs = [];
  let retryCount = 0;
  let removeCount = 0;
  const retriedStates = [];

  const existingJob = existingState
    ? {
        getState: async () => existingState,
        retry: async (state) => {
          retryCount += 1;
          retriedStates.push(state || "failed");
        },
        remove: async () => {
          removeCount += 1;
        },
      }
    : null;

  const queue = {
    getJob: async () => existingJob,
    add: async (name, payload, options) => {
      addedJobs.push({ name, payload, options });
    },
  };

  return {
    service: createErrorQueueService(queue, { attempts: 4, backoffMs: 1500 }),
    addedJobs,
    getRetryCount: () => retryCount,
    getRemoveCount: () => removeCount,
    retriedStates,
  };
}

const payload = { uploadId: 41, errorId: 73 };

test("creates a missing job with deterministic retry options", async () => {
  const harness = createQueueHarness();

  const result = await harness.service.ensureErrorQueued(payload);

  assert.deepEqual(result, { action: "created", state: "waiting" });
  assert.deepEqual(harness.addedJobs, [{
    name: "processError",
    payload,
    options: {
      jobId: "error-73",
      attempts: 4,
      backoff: { type: "exponential", delay: 1500 },
    },
  }]);
});

test("retries an existing failed job instead of creating a duplicate", async () => {
  const harness = createQueueHarness("failed");

  const result = await harness.service.ensureErrorQueued(payload);

  assert.deepEqual(result, { action: "retried", state: "waiting" });
  assert.equal(harness.getRetryCount(), 1);
  assert.equal(harness.addedJobs.length, 0);
});

test("retries a completed job when PostgreSQL says it is recoverable", async () => {
  const harness = createQueueHarness("completed");

  const result = await harness.service.ensureErrorQueued(payload);

  assert.deepEqual(result, { action: "retried_completed", state: "waiting" });
  assert.equal(harness.getRetryCount(), 1);
  assert.deepEqual(harness.retriedStates, ["completed"]);
  assert.equal(harness.getRemoveCount(), 0);
  assert.equal(harness.addedJobs.length, 0);
});

test("reports an active job without creating a duplicate", async () => {
  const harness = createQueueHarness("active");

  const result = await harness.service.ensureErrorQueued(payload);

  assert.deepEqual(result, { action: "existing", state: "active" });
  assert.equal(harness.getRetryCount(), 0);
  assert.equal(harness.getRemoveCount(), 0);
  assert.equal(harness.addedJobs.length, 0);
});
