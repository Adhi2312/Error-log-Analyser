// This file starts the worker; run separately or import from server to start alongside API.
const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const { redact } = require("./services/redactor");
const { computeFingerprint } = require("./services/fingerprint");
const { getCachedAnalysis, setCachedAnalysis } = require("./services/cache");
const { callLLM } = require("./services/llmClient");
const { pool } = require("./db");

const connection = new IORedis(process.env.REDIS_URL || "redis://redis:6379");

console.log("Starting worker...");
const worker = new Worker(
  "errorQueue",
  async (job) => {
    const { errorId, raw_text } = job.data;
    const redacted = redact(raw_text);
    const fingerprint = computeFingerprint(redacted);

    const client = await pool.connect();
    try {
      // try cache
      const cached = await getCachedAnalysis(fingerprint);
      if (cached) {
        await client.query("UPDATE errors SET redacted_text=$1, fingerprint=$2, processed_at=now() WHERE id=$3", [redacted, fingerprint, errorId]);
        await client.query("INSERT INTO analyses (error_id, source, model, analysis_json) VALUES ($1,$2,$3,$4)", [errorId, "cache", cached.model || "cache", cached]);
        console.log(`Cache hit for error ${errorId}`);
        return;
      }

      // cache miss -> call LLM
      const llmResp = await callLLM(redacted);
      await client.query("UPDATE errors SET redacted_text=$1, fingerprint=$2, processed_at=now() WHERE id=$3", [redacted, fingerprint, errorId]);
      await client.query("INSERT INTO analyses (error_id, source, model, analysis_json) VALUES ($1,$2,$3,$4)", [errorId, "llm", llmResp.model || "llm", llmResp]);
      await setCachedAnalysis(fingerprint, { ...llmResp, model: llmResp.model || "llm" });
      console.log(`Processed error ${errorId} via LLM`);
    } catch (err) {
      console.error("Worker error:", err);
    } finally {
      client.release();
    }
  },
  { connection }
);

worker.on("failed", (job, err) => {
  console.error("Job failed", job.id, err);
});
