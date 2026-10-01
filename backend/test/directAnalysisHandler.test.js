const test = require("node:test");
const assert = require("node:assert/strict");
const { createDirectAnalysisHandler } = require("../src/routes/directAnalysisHandler");
const { redact } = require("../src/services/redactor");

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function harness({ initialStatus = "pending", llmFailure = false } = {}) {
  const state = {
    status: initialStatus,
    rawText: "ERROR user@example.com failed; token=supersecret123",
    redactedText: null,
    analysis: initialStatus === "completed" ? { root_cause: "existing" } : null,
    attempts: 0,
    failureReason: null,
  };
  const sentToProvider = [];
  let released = 0;
  const pool = {
    async query(sql, params) {
      if (sql.includes("RETURNING raw_text")) {
        if (!["pending", "queued", "retrying", "failed", "queue_failed"].includes(state.status)) {
          return { rowCount: 0, rows: [] };
        }
        state.status = "processing";
        state.attempts += 1;
        state.failureReason = null;
        return { rowCount: 1, rows: [{ raw_text: state.rawText }] };
      }
      if (sql.includes("AS has_analysis")) {
        return { rowCount: 1, rows: [{ status: state.status, has_analysis: !!state.analysis }] };
      }
      if (sql.includes("SET status = 'failed'")) {
        state.status = "failed";
        state.failureReason = params[1];
        return { rowCount: 1 };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, params) {
          const query = sql.replace(/\s+/g, " ").trim();
          if (["BEGIN", "COMMIT", "ROLLBACK"].includes(query)) return {};
          if (query.startsWith("SELECT status FROM errors")) {
            return { rowCount: 1, rows: [{ status: state.status }] };
          }
          if (query.startsWith("DELETE FROM analyses")) {
            state.analysis = null;
            return { rowCount: 1 };
          }
          if (query.startsWith("INSERT INTO analyses")) {
            state.analysis = params[3];
            return { rowCount: 1 };
          }
          if (query.startsWith("UPDATE errors SET redacted_text")) {
            state.redactedText = params[0];
            state.status = "completed";
            return { rowCount: 1 };
          }
          throw new Error(`Unexpected transaction query: ${sql}`);
        },
        release() { released += 1; },
      };
    },
  };
  const handler = createDirectAnalysisHandler({
    pool,
    redact,
    computeFingerprint: () => "fingerprint",
    callLLM: async (text) => {
      sentToProvider.push(text);
      if (llmFailure) throw new Error("provider unavailable");
      return { root_cause: "test", model: "test-model" };
    },
    logger: { error() {} },
  });
  return { handler, state, sentToProvider, getReleased: () => released };
}

test("direct analysis redacts stored raw text on the server before the provider call", async () => {
  const { handler, state, sentToProvider, getReleased } = harness();
  const res = response();

  await handler({ params: { id: "73" } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { errorId: 73, status: "completed" });
  assert.equal(state.status, "completed");
  assert.equal(state.attempts, 1);
  assert.equal(getReleased(), 1);
  assert.equal(sentToProvider.length, 1);
  assert.equal(sentToProvider[0], state.redactedText);
  assert.doesNotMatch(sentToProvider[0], /user@example\.com|supersecret123/);
  assert.match(sentToProvider[0], /REDACTED_EMAIL/);
  assert.match(sentToProvider[0], /REDACTED_SECRET/);
  assert.deepEqual(state.analysis, { root_cause: "test", model: "test-model" });
});

test("completed errors reuse their persisted analysis without another provider call", async () => {
  const { handler, sentToProvider } = harness({ initialStatus: "completed" });
  const res = response();

  await handler({ params: { id: "73" } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { errorId: 73, status: "completed", reusedExisting: true });
  assert.deepEqual(sentToProvider, []);
});

test("provider failure leaves the error retryable", async () => {
  const { handler, state } = harness({ llmFailure: true });
  const res = response();

  await handler({ params: { id: "73" } }, res);

  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, { error: "analysis_failed" });
  assert.equal(state.status, "failed");
  assert.equal(state.failureReason, "provider unavailable");
});
