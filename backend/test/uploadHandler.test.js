const test = require("node:test");
const assert = require("node:assert/strict");
const { createUploadHandler } = require("../src/routes/uploadHandler");

const uploadedFile = {
  path: "temporary-upload-path",
  originalname: "application.log",
  size: 128,
};

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

function statementName(sql) {
  const normalized = sql.replace(/\s+/g, " ").trim();

  if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) {
    return normalized;
  }
  if (normalized.startsWith("INSERT INTO uploads")) return "INSERT_UPLOAD";
  if (normalized.startsWith("INSERT INTO errors")) return "INSERT_ERROR";
  return "OTHER";
}

function createHarness(overrides = {}) {
  const { failTransactionAt, ...dependencyOverrides } = overrides;
  let releaseCount = 0;
  const transactionStatements = [];
  const statusUpdates = [];
  const deletedPaths = [];
  const enqueuedJobs = [];
  const releaseCountsAtEnqueue = [];
  const loggedErrors = [];

  const client = {
    async query(sql) {
      const statement = statementName(sql);
      transactionStatements.push(statement);

      if (statement === failTransactionAt) {
        throw new Error(`${statement} failed`);
      }
      if (statement === "INSERT_UPLOAD") {
        return { rows: [{ id: 41 }] };
      }
      if (statement === "INSERT_ERROR") {
        return {
          rows: [{ id: 73, line_number: 7, status: "pending" }],
        };
      }

      return { rows: [], rowCount: 0 };
    },
    release() {
      releaseCount += 1;
    },
  };

  const dependencies = {
    readFile: async () => "ERROR database connection failed",
    unlink: async (filePath) => {
      deletedPaths.push(filePath);
    },
    pool: {
      connect: async () => client,
      query: async (sql, params) => {
        statusUpdates.push({
          sql: sql.replace(/\s+/g, " ").trim(),
          params,
        });
        return { rowCount: 1 };
      },
    },
    parseLogFile: () => [
      { line_number: 7, raw_text: "ERROR database connection failed" },
    ],
    computeFileHash: () => "file-hash",
    enqueueError: async (job) => {
      releaseCountsAtEnqueue.push(releaseCount);
      enqueuedJobs.push(job);
    },
    logger: {
      error: (...args) => loggedErrors.push(args),
    },
    ...dependencyOverrides,
  };

  return {
    handler: createUploadHandler(dependencies),
    client,
    transactionStatements,
    statusUpdates,
    deletedPaths,
    enqueuedJobs,
    releaseCountsAtEnqueue,
    loggedErrors,
    getReleaseCount: () => releaseCount,
  };
}

test("commits all database rows before queueing compact jobs", async () => {
  const harness = createHarness();
  const response = createResponse();

  await harness.handler({ file: uploadedFile }, response);

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.body, {
    uploadId: 41,
    totalErrors: 1,
    queueSummary: { queued: 1, failed: 0 },
    errors: [{ id: 73, line_number: 7, status: "queued" }],
  });
  assert.deepEqual(harness.transactionStatements, [
    "BEGIN",
    "INSERT_UPLOAD",
    "INSERT_ERROR",
    "COMMIT",
  ]);
  assert.deepEqual(harness.enqueuedJobs, [{ uploadId: 41, errorId: 73 }]);
  assert.deepEqual(harness.releaseCountsAtEnqueue, [1]);
  assert.equal(harness.getReleaseCount(), 1);
  assert.equal(harness.statusUpdates.length, 1);
  assert.match(harness.statusUpdates[0].sql, /status = 'queued'/);
  assert.deepEqual(harness.statusUpdates[0].params, [73]);
  assert.deepEqual(harness.deletedPaths, [uploadedFile.path]);
});

test("rolls back every database row when an error insert fails", async () => {
  const harness = createHarness({ failTransactionAt: "INSERT_ERROR" });
  const response = createResponse();

  await harness.handler({ file: uploadedFile }, response);

  assert.equal(response.statusCode, 500);
  assert.deepEqual(harness.transactionStatements, [
    "BEGIN",
    "INSERT_UPLOAD",
    "INSERT_ERROR",
    "ROLLBACK",
  ]);
  assert.deepEqual(harness.enqueuedJobs, []);
  assert.deepEqual(harness.statusUpdates, []);
  assert.equal(harness.getReleaseCount(), 1);
  assert.deepEqual(harness.deletedPaths, [uploadedFile.path]);
});

test("does not queue jobs when committing the transaction fails", async () => {
  const harness = createHarness({ failTransactionAt: "COMMIT" });
  const response = createResponse();

  await harness.handler({ file: uploadedFile }, response);

  assert.equal(response.statusCode, 500);
  assert.deepEqual(harness.transactionStatements, [
    "BEGIN",
    "INSERT_UPLOAD",
    "INSERT_ERROR",
    "COMMIT",
    "ROLLBACK",
  ]);
  assert.deepEqual(harness.enqueuedJobs, []);
  assert.equal(harness.getReleaseCount(), 1);
  assert.deepEqual(harness.deletedPaths, [uploadedFile.path]);
});

test("records a recoverable queue failure after the database commit", async () => {
  const statusUpdates = [];
  const harness = createHarness({
    enqueueError: async () => {
      throw new Error("queue unavailable");
    },
    pool: {
      connect: async () => harness.client,
      query: async (sql, params) => {
        statusUpdates.push({
          sql: sql.replace(/\s+/g, " ").trim(),
          params,
        });
        return { rowCount: 1 };
      },
    },
  });
  const response = createResponse();

  await harness.handler({ file: uploadedFile }, response);

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.body.queueSummary, { queued: 0, failed: 1 });
  assert.equal(response.body.errors[0].status, "queue_failed");
  assert.ok(harness.transactionStatements.includes("COMMIT"));
  assert.ok(!harness.transactionStatements.includes("ROLLBACK"));
  assert.equal(harness.getReleaseCount(), 1);
  assert.equal(statusUpdates.length, 1);
  assert.match(statusUpdates[0].sql, /status = 'queue_failed'/);
  assert.deepEqual(statusUpdates[0].params, [73, "queue unavailable"]);
  assert.deepEqual(harness.deletedPaths, [uploadedFile.path]);
});

test("deletes the temporary file when reading it fails", async () => {
  let connectCount = 0;
  const harness = createHarness({
    readFile: async () => {
      throw new Error("file read failed");
    },
    pool: {
      connect: async () => {
        connectCount += 1;
      },
    },
  });
  const response = createResponse();

  await harness.handler({ file: uploadedFile }, response);

  assert.equal(response.statusCode, 500);
  assert.equal(connectCount, 0);
  assert.equal(harness.getReleaseCount(), 0);
  assert.deepEqual(harness.deletedPaths, [uploadedFile.path]);
});

test("deletes the temporary file when acquiring a database client fails", async () => {
  const harness = createHarness({
    pool: {
      connect: async () => {
        throw new Error("database unavailable");
      },
    },
  });
  const response = createResponse();

  await harness.handler({ file: uploadedFile }, response);

  assert.equal(response.statusCode, 500);
  assert.equal(harness.getReleaseCount(), 0);
  assert.deepEqual(harness.deletedPaths, [uploadedFile.path]);
});

test("does not replace an accepted response when temporary-file deletion fails", async () => {
  const harness = createHarness({
    unlink: async () => {
      const error = new Error("file is locked");
      error.code = "EBUSY";
      throw error;
    },
  });
  const response = createResponse();

  await harness.handler({ file: uploadedFile }, response);

  assert.equal(response.statusCode, 202);
  assert.equal(harness.getReleaseCount(), 1);
  assert.equal(harness.loggedErrors.length, 1);
  assert.match(harness.loggedErrors[0][0], /temporary upload/i);
});
