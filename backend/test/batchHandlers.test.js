const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createBatchHandlers,
  deriveUploadStatus,
  parsePositiveId,
} = require("../src/routes/batchHandlers");

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

const emptyCounts = {
  pending: 0,
  queued: 0,
  processing: 0,
  retrying: 0,
  completed: 0,
  queueFailed: 0,
  failed: 0,
};

test("derives terminal and active upload statuses", () => {
  assert.equal(deriveUploadStatus(0, emptyCounts), "no_errors");
  assert.equal(
    deriveUploadStatus(2, { ...emptyCounts, queued: 1, completed: 1 }),
    "processing"
  );
  assert.equal(
    deriveUploadStatus(2, { ...emptyCounts, completed: 2 }),
    "completed"
  );
  assert.equal(
    deriveUploadStatus(2, { ...emptyCounts, completed: 1, failed: 1 }),
    "completed_with_failures"
  );
});

test("accepts only complete positive integer identifiers", () => {
  assert.equal(parsePositiveId("42"), 42);
  assert.equal(parsePositiveId("12abc"), null);
  assert.equal(parsePositiveId("0"), null);
  assert.equal(parsePositiveId("-3"), null);
  assert.equal(parsePositiveId("01"), null);
});

test("returns aggregate batch progress for an upload", async () => {
  const pool = {
    query: async () => ({
      rowCount: 1,
      rows: [{
        id: 42,
        filename: "application.log",
        filesize: 2048,
        uploaded_at: "2026-09-28T10:00:00.000Z",
        total_errors: 10,
        pending_count: 0,
        queued_count: 2,
        processing_count: 1,
        retrying_count: 1,
        completed_count: 5,
        queue_failed_count: 0,
        failed_count: 1,
      }],
    }),
  };
  const handlers = createBatchHandlers({
    pool,
    ensureErrorQueued: async () => {
      throw new Error("not used");
    },
  });
  const response = createResponse();

  await handlers.getUploadStatus({ params: { id: "42" } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "processing");
  assert.equal(response.body.totalErrors, 10);
  assert.deepEqual(response.body.progress, { finished: 6, percent: 60 });
  assert.equal(response.body.recoverableCount, 1);
});

test("queues a recoverable individual error", async () => {
  const updates = [];
  const queuedPayloads = [];
  const pool = {
    query: async (sql, params) => {
      if (sql.startsWith("SELECT id, upload_id")) {
        return {
          rowCount: 1,
          rows: [{ id: 73, upload_id: 42, status: "failed" }],
        };
      }
      updates.push({ sql, params });
      return { rowCount: 1, rows: [] };
    },
  };
  const handlers = createBatchHandlers({
    pool,
    ensureErrorQueued: async (payload) => {
      queuedPayloads.push(payload);
      return { action: "retried", state: "waiting" };
    },
  });
  const response = createResponse();

  await handlers.retryError({ params: { id: "73" } }, response);

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.body, {
    errorId: 73,
    status: "queued",
    queueAction: "retried",
  });
  assert.deepEqual(queuedPayloads, [{ uploadId: 42, errorId: 73 }]);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].params, [73, "queued"]);
});

test("rejects retrying an error that is already completed", async () => {
  let queueCalls = 0;
  const handlers = createBatchHandlers({
    pool: {
      query: async () => ({
        rowCount: 1,
        rows: [{ id: 73, upload_id: 42, status: "completed" }],
      }),
    },
    ensureErrorQueued: async () => {
      queueCalls += 1;
    },
  });
  const response = createResponse();

  await handlers.retryError({ params: { id: "73" } }, response);

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.error, "error_not_retryable");
  assert.equal(queueCalls, 0);
});

test("records queue failure and returns service unavailable", async () => {
  const updates = [];
  const handlers = createBatchHandlers({
    pool: {
      query: async (sql, params) => {
        if (sql.startsWith("SELECT id, upload_id")) {
          return {
            rowCount: 1,
            rows: [{ id: 73, upload_id: 42, status: "queue_failed" }],
          };
        }
        updates.push({ sql, params });
        return { rowCount: 1, rows: [] };
      },
    },
    ensureErrorQueued: async () => {
      throw new Error("redis unavailable");
    },
    logger: { error: () => {} },
  });
  const response = createResponse();

  await handlers.retryError({ params: { id: "73" } }, response);

  assert.equal(response.statusCode, 503);
  assert.equal(response.body.status, "queue_failed");
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].params, [73, "redis unavailable"]);
});

test("retries every recoverable error in an upload and reports partial failure", async () => {
  let queryNumber = 0;
  const handlers = createBatchHandlers({
    pool: {
      query: async () => {
        queryNumber += 1;
        if (queryNumber === 1) {
          return { rowCount: 1, rows: [{ id: 42 }] };
        }
        if (queryNumber === 2) {
          return {
            rowCount: 2,
            rows: [
              { id: 73, upload_id: 42, status: "failed" },
              { id: 74, upload_id: 42, status: "pending" },
            ],
          };
        }
        return { rowCount: 1, rows: [] };
      },
    },
    ensureErrorQueued: async (payload) => {
      if (payload.errorId === 74) throw new Error("redis unavailable");
      return { action: "created", state: "waiting" };
    },
    logger: { error: () => {} },
  });
  const response = createResponse();

  await handlers.retryUpload({ params: { id: "42" } }, response);

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.body.summary, {
    requested: 2,
    queued: 1,
    alreadyActive: 0,
    failed: 1,
  });
});

test("returns a clear error when an upload does not exist", async () => {
  const handlers = createBatchHandlers({
    pool: {
      query: async () => ({ rowCount: 0, rows: [] }),
    },
    ensureErrorQueued: async () => {},
  });
  const response = createResponse();

  await handlers.getUploadStatus({ params: { id: "999" } }, response);

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error, "upload_not_found");
});
