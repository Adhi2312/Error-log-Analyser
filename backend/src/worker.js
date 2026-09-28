const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const { redact } = require("./services/redactor");
const { computeFingerprint } = require("./services/fingerprint");
const { getCachedAnalysis, setCachedAnalysis } = require("./services/cache");
const { callLLM } = require("./services/llmClient");
const { createProcessErrorJob } = require("./services/processErrorJob");
const { pool } = require("./db");

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const concurrency = positiveInteger(process.env.WORKER_CONCURRENCY, 2);
const connection = new IORedis(
  process.env.REDIS_URL || "redis://redis:6379",
  { maxRetriesPerRequest: null }
);

const processErrorJob = createProcessErrorJob({
  pool,
  redact,
  computeFingerprint,
  getCachedAnalysis,
  setCachedAnalysis,
  callLLM,
});

const worker = new Worker("errorQueue", processErrorJob, {
  connection,
  concurrency,
});

worker.on("completed", (job) => {
  console.log(`Completed error job ${job.id}`);
});

worker.on("failed", (job, error) => {
  console.error(`Failed error job ${job?.id || "unknown"}:`, error.message);
});

worker.on("error", (error) => {
  console.error("Worker connection error:", error);
});

console.log(`Error worker started with concurrency ${concurrency}`);

module.exports = { worker };
