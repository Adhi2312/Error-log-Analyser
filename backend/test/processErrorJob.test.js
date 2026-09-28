const test = require("node:test");
const assert = require("node:assert/strict");
const { createProcessErrorJob } = require("../src/services/processErrorJob");

function normalize(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

function createHarness(options = {}) {
  const state = {
    error: {
      id: 73,
      status: options.initialStatus || "queued",
      raw_text: "ERROR user@example.com failed",
      redacted_text: null,
      fingerprint: null,
      attempt_count: 0,
      failure_reason: null,
    },
    analyses: options.initialAnalyses ? [...options.initialAnalyses] : [],
  };
  const transactionEvents = [];
  const cachedWrites = [];
  const loggedErrors = [];
  const activeConnectionsDuringLLM = [];
  let activeConnections = 0;
  let releasedConnections = 0;
  let llmCalls = 0;

  const client = {
    async query(sql, params = []) {
      const query = normalize(sql);

      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(query)) {
        transactionEvents.push(query);
        return { rows: [], rowCount: 0 };
      }
      if (query.startsWith("SELECT status FROM errors")) {
        transactionEvents.push("LOCK_ERROR");
        return state.error
          ? { rows: [{ status: state.error.status }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (query.startsWith("DELETE FROM analyses")) {
        transactionEvents.push("DELETE_ANALYSIS");
        state.analyses = state.analyses.filter((analysis) => analysis.error_id !== params[0]);
        return { rows: [], rowCount: 1 };
      }
      if (query.startsWith("INSERT INTO analyses")) {
        transactionEvents.push("INSERT_ANALYSIS");
        if (options.failSaveAt === "INSERT_ANALYSIS") {
          throw new Error("analysis insert failed");
        }
        state.analyses.push({
          error_id: params[0],
          source: params[1],
          model: params[2],
          analysis_json: params[3],
        });
        return { rows: [], rowCount: 1 };
      }
      if (query.startsWith("UPDATE errors SET redacted_text")) {
        transactionEvents.push("COMPLETE_ERROR");
        state.error.redacted_text = params[0];
        state.error.fingerprint = params[1];
        state.error.status = "completed";
        state.error.failure_reason = null;
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected transaction query: ${query}`);
    },
    release() {
      activeConnections -= 1;
      releasedConnections += 1;
    },
  };

  const pool = {
    async query(sql, params = []) {
      const query = normalize(sql);

      if (query.startsWith("UPDATE errors SET status = 'processing'")) {
        if (!state.error || state.error.status === "completed") {
          return { rows: [], rowCount: 0 };
        }
        state.error.status = "processing";
        state.error.failure_reason = null;
        state.error.attempt_count = params[1];
        return {
          rows: [{
            raw_text: state.error.raw_text,
            redacted_text: state.error.redacted_text,
            fingerprint: state.error.fingerprint,
          }],
          rowCount: 1,
        };
      }
      if (query.startsWith("SELECT e.status")) {
        return state.error
          ? {
              rows: [{
                status: state.error.status,
                has_analysis: state.analyses.some(
                  (analysis) => analysis.error_id === state.error.id
                ),
              }],
              rowCount: 1,
            }
          : { rows: [], rowCount: 0 };
      }
      if (query.startsWith("UPDATE errors SET status = $2")) {
        if (state.error && state.error.status !== "completed") {
          state.error.status = params[1];
          state.error.failure_reason = params[2];
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      throw new Error(`Unexpected pool query: ${query}`);
    },
    async connect() {
      activeConnections += 1;
      return client;
    },
  };

  const processJob = createProcessErrorJob({
    pool,
    redact: (text) => text.replace("user@example.com", "<REDACTED_EMAIL>"),
    computeFingerprint: () => "fingerprint-73",
    getCachedAnalysis: async () => {
      if (options.cacheReadError) throw options.cacheReadError;
      return options.cachedAnalysis || null;
    },
    setCachedAnalysis: async (fingerprint, analysis) => {
      if (options.cacheWriteError) throw options.cacheWriteError;
      cachedWrites.push({ fingerprint, analysis });
    },
    callLLM: async (redactedText) => {
      llmCalls += 1;
      activeConnectionsDuringLLM.push(activeConnections);
      if (options.llmError) throw options.llmError;
      return {
        issue_type: "database_error",
        root_cause: redactedText,
        suggested_fix: "Check the connection configuration.",
        severity: "High",
        confidence: 0.9,
        model: "test-model",
      };
    },
    logger: {
      error: (...args) => loggedErrors.push(args),
    },
  });

  return {
    processJob,
    state,
    transactionEvents,
    cachedWrites,
    loggedErrors,
    activeConnectionsDuringLLM,
    getLlmCalls: () => llmCalls,
    getReleasedConnections: () => releasedConnections,
  };
}

function job({ attemptsMade = 1, attempts = 3 } = {}) {
  return {
    data: { uploadId: 41, errorId: 73 },
    attemptsMade,
    opts: { attempts },
  };
}

test("processes a cache miss without holding a database connection during the LLM call", async () => {
  const harness = createHarness();

  const result = await harness.processJob(job());

  assert.deepEqual(result, {
    status: "completed",
    source: "llm",
    reusedExisting: false,
  });
  assert.equal(harness.state.error.status, "completed");
  assert.equal(harness.state.error.attempt_count, 1);
  assert.equal(harness.state.analyses.length, 1);
  assert.equal(harness.state.analyses[0].source, "llm");
  assert.deepEqual(harness.activeConnectionsDuringLLM, [0]);
  assert.equal(harness.getReleasedConnections(), 1);
  assert.equal(harness.cachedWrites.length, 1);
  assert.deepEqual(harness.transactionEvents, [
    "BEGIN",
    "LOCK_ERROR",
    "DELETE_ANALYSIS",
    "INSERT_ANALYSIS",
    "COMPLETE_ERROR",
    "COMMIT",
  ]);
});

test("uses a cached analysis without calling the LLM", async () => {
  const harness = createHarness({
    cachedAnalysis: {
      issue_type: "cached_error",
      model: "cached-model",
    },
  });

  const result = await harness.processJob(job());

  assert.equal(result.source, "cache");
  assert.equal(harness.getLlmCalls(), 0);
  assert.equal(harness.state.error.status, "completed");
  assert.equal(harness.state.analyses[0].source, "cache");
  assert.equal(harness.cachedWrites.length, 0);
});

test("does not process an error that already has a completed analysis", async () => {
  const harness = createHarness({
    initialStatus: "completed",
    initialAnalyses: [{ error_id: 73, source: "llm" }],
  });

  const result = await harness.processJob(job());

  assert.deepEqual(result, { status: "completed", reusedExisting: true });
  assert.equal(harness.getLlmCalls(), 0);
  assert.equal(harness.getReleasedConnections(), 0);
  assert.equal(harness.state.analyses.length, 1);
});

test("marks a temporary failure as retrying and rethrows it", async () => {
  const harness = createHarness({ llmError: new Error("provider timeout") });

  await assert.rejects(harness.processJob(job({ attemptsMade: 1 })), /provider timeout/);

  assert.equal(harness.state.error.status, "retrying");
  assert.equal(harness.state.error.failure_reason, "provider timeout");
});

test("marks the final failed attempt as failed and rethrows it", async () => {
  const harness = createHarness({ llmError: new Error("provider unavailable") });

  await assert.rejects(harness.processJob(job({ attemptsMade: 3 })), /provider unavailable/);

  assert.equal(harness.state.error.status, "failed");
  assert.equal(harness.state.error.failure_reason, "provider unavailable");
});

test("rolls back a failed result save and lets BullMQ retry", async () => {
  const harness = createHarness({ failSaveAt: "INSERT_ANALYSIS" });

  await assert.rejects(harness.processJob(job()), /analysis insert failed/);

  assert.equal(harness.state.error.status, "retrying");
  assert.equal(harness.state.analyses.length, 0);
  assert.equal(harness.getReleasedConnections(), 1);
  assert.equal(harness.transactionEvents.at(-1), "ROLLBACK");
});

test("a repeated delivery reuses the completed result", async () => {
  const harness = createHarness();

  await harness.processJob(job());
  const secondResult = await harness.processJob(job({ attemptsMade: 2 }));

  assert.equal(harness.getLlmCalls(), 1);
  assert.equal(harness.state.analyses.length, 1);
  assert.deepEqual(secondResult, { status: "completed", reusedExisting: true });
});

test("cache failures do not discard a successfully stored analysis", async () => {
  const harness = createHarness({
    cacheReadError: new Error("cache read failed"),
    cacheWriteError: new Error("cache write failed"),
  });

  const result = await harness.processJob(job());

  assert.equal(result.status, "completed");
  assert.equal(harness.state.error.status, "completed");
  assert.equal(harness.state.analyses.length, 1);
  assert.equal(harness.loggedErrors.length, 2);
});
