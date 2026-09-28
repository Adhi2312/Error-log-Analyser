function getAttemptDetails(job) {
  const configuredAttempts = Number(job.opts?.attempts);
  const maxAttempts = Number.isInteger(configuredAttempts) && configuredAttempts > 0
    ? configuredAttempts
    : 1;
  const attemptsMade = Number.isInteger(job.attemptsMade) && job.attemptsMade > 0
    ? job.attemptsMade
    : 1;

  return {
    currentAttempt: attemptsMade,
    maxAttempts,
  };
}

function failureMessage(error) {
  return String(error?.message || error).slice(0, 500);
}

async function markFailure(pool, errorId, error, job, logger) {
  const { currentAttempt, maxAttempts } = getAttemptDetails(job);
  const status = currentAttempt < maxAttempts ? "retrying" : "failed";

  try {
    await pool.query(
      `UPDATE errors
       SET status = $2,
           failure_reason = $3,
           completed_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END
       WHERE id = $1 AND status <> 'completed'`,
      [errorId, status, failureMessage(error)]
    );
  } catch (statusError) {
    logger.error(`Failed to record ${status} status for error ${errorId}:`, statusError);
  }
}

async function saveAnalysis({
  pool,
  errorId,
  redactedText,
  fingerprint,
  source,
  analysis,
}) {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const lockedError = await client.query(
      "SELECT status FROM errors WHERE id = $1 FOR UPDATE",
      [errorId]
    );

    if (lockedError.rowCount === 0) {
      throw new Error(`Error ${errorId} does not exist`);
    }

    if (lockedError.rows[0].status === "completed") {
      await client.query("COMMIT");
      transactionStarted = false;
      return false;
    }

    await client.query("DELETE FROM analyses WHERE error_id = $1", [errorId]);
    await client.query(
      `INSERT INTO analyses (error_id, source, model, analysis_json)
       VALUES ($1, $2, $3, $4)`,
      [errorId, source, analysis.model || source, analysis]
    );
    await client.query(
      `UPDATE errors
       SET redacted_text = $1,
           fingerprint = $2,
           processed_at = now(),
           completed_at = now(),
           status = 'completed',
           failure_reason = NULL
       WHERE id = $3`,
      [redactedText, fingerprint, errorId]
    );

    await client.query("COMMIT");
    transactionStarted = false;
    return true;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the processing error; the caller records the job failure.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

function createProcessErrorJob({
  pool,
  redact,
  computeFingerprint,
  getCachedAnalysis,
  setCachedAnalysis,
  callLLM,
  logger = console,
}) {
  return async function processErrorJob(job) {
    const errorId = Number(job.data?.errorId);

    if (!Number.isInteger(errorId) || errorId <= 0) {
      throw new Error("Job is missing a valid errorId");
    }

    const { currentAttempt } = getAttemptDetails(job);

    try {
      const errorResult = await pool.query(
        `UPDATE errors
         SET status = 'processing',
             failure_reason = NULL,
             attempt_count = $2,
             started_at = now(),
             completed_at = NULL
         WHERE id = $1 AND status <> 'completed'
         RETURNING raw_text, redacted_text, fingerprint`,
        [errorId, currentAttempt]
      );

      if (errorResult.rowCount === 0) {
        const existingResult = await pool.query(
          `SELECT e.status,
                  EXISTS (
                    SELECT 1 FROM analyses a WHERE a.error_id = e.id
                  ) AS has_analysis
           FROM errors e
           WHERE e.id = $1`,
          [errorId]
        );

        if (existingResult.rowCount === 0) {
          throw new Error(`Error ${errorId} does not exist`);
        }

        const existing = existingResult.rows[0];
        if (existing.status === "completed" && existing.has_analysis) {
          return { status: "completed", reusedExisting: true };
        }

        throw new Error(`Error ${errorId} has an inconsistent completed state`);
      }

      const errorRecord = errorResult.rows[0];
      if (typeof errorRecord.raw_text !== "string") {
        throw new Error(`Error ${errorId} has no processable text`);
      }

      const redactedText = typeof errorRecord.redacted_text === "string"
        ? errorRecord.redacted_text
        : redact(errorRecord.raw_text);
      const fingerprint = errorRecord.fingerprint
        || computeFingerprint(redactedText);

      let cachedAnalysis = null;
      try {
        cachedAnalysis = await getCachedAnalysis(fingerprint);
      } catch (error) {
        logger.error(`Cache lookup failed for error ${errorId}:`, error);
      }

      const analysis = cachedAnalysis || await callLLM(redactedText);
      const source = cachedAnalysis ? "cache" : analysis.provider || "llm";
      const saved = await saveAnalysis({
        pool,
        errorId,
        redactedText,
        fingerprint,
        source,
        analysis,
      });

      if (!cachedAnalysis && saved) {
        try {
          await setCachedAnalysis(fingerprint, {
            ...analysis,
            model: analysis.model || "llm",
          });
        } catch (error) {
          logger.error(`Cache write failed for error ${errorId}:`, error);
        }
      }

      return {
        status: "completed",
        source,
        reusedExisting: !saved,
      };
    } catch (error) {
      await markFailure(pool, errorId, error, job, logger);
      throw error;
    }
  };
}

module.exports = {
  createProcessErrorJob,
  getAttemptDetails,
};
