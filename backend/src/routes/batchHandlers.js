const RECOVERABLE_STATUSES = new Set(["pending", "queue_failed", "failed"]);

function parsePositiveId(value) {
  if (!/^[1-9]\d*$/.test(String(value))) return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function deriveUploadStatus(totalErrors, counts) {
  if (totalErrors === 0) return "no_errors";

  const active = counts.pending
    + counts.queued
    + counts.processing
    + counts.retrying;

  if (active > 0) return "processing";
  if (counts.queueFailed > 0 || counts.failed > 0) {
    return "completed_with_failures";
  }
  return "completed";
}

function errorMessage(error) {
  return String(error?.message || error).slice(0, 500);
}

function createBatchHandlers({ pool, ensureErrorQueued, logger = console }) {
  async function queueRecoverableError(errorRecord) {
    let queueResult;

    try {
      queueResult = await ensureErrorQueued({
        uploadId: errorRecord.upload_id,
        errorId: errorRecord.id,
      });
    } catch (error) {
      try {
        await pool.query(
          `UPDATE errors
           SET status = 'queue_failed',
               failure_reason = $2,
               completed_at = now()
           WHERE id = $1 AND status <> 'completed'`,
          [errorRecord.id, errorMessage(error)]
        );
      } catch (statusError) {
        logger.error(
          `Failed to record queue failure for error ${errorRecord.id}:`,
          statusError
        );
      }

      return {
        kind: "failed",
        errorId: errorRecord.id,
        reason: errorMessage(error),
      };
    }

    const synchronizedStatus = queueResult.state === "active"
      ? "processing"
      : queueResult.state === "delayed"
        ? "retrying"
        : "queued";

    try {
      await pool.query(
        `UPDATE errors
         SET status = $2,
             failure_reason = NULL,
             queued_at = CASE WHEN $2 = 'queued' THEN now() ELSE queued_at END,
             started_at = CASE WHEN $2 = 'queued' THEN NULL ELSE started_at END,
             completed_at = NULL
         WHERE id = $1 AND status <> 'completed'`,
        [errorRecord.id, synchronizedStatus]
      );
    } catch (statusError) {
      logger.error(
        `Failed to synchronize queue status for error ${errorRecord.id}:`,
        statusError
      );
    }

    return {
      kind: queueResult.action === "existing" ? "existing" : "queued",
      errorId: errorRecord.id,
      status: synchronizedStatus,
      queueAction: queueResult.action,
      queueState: queueResult.state,
    };
  }

  async function getUploadStatus(req, res) {
    const uploadId = parsePositiveId(req.params.id);
    if (!uploadId) {
      return res.status(400).json({ error: "invalid_upload_id" });
    }

    try {
      const result = await pool.query(
        `SELECT u.id, u.filename, u.filesize, u.uploaded_at,
                COUNT(e.id)::int AS total_errors,
                COUNT(e.id) FILTER (WHERE e.status = 'pending')::int AS pending_count,
                COUNT(e.id) FILTER (WHERE e.status = 'queued')::int AS queued_count,
                COUNT(e.id) FILTER (WHERE e.status = 'processing')::int AS processing_count,
                COUNT(e.id) FILTER (WHERE e.status = 'retrying')::int AS retrying_count,
                COUNT(e.id) FILTER (WHERE e.status = 'completed')::int AS completed_count,
                COUNT(e.id) FILTER (WHERE e.status = 'queue_failed')::int AS queue_failed_count,
                COUNT(e.id) FILTER (WHERE e.status = 'failed')::int AS failed_count
         FROM uploads u
         LEFT JOIN errors e ON e.upload_id = u.id
         WHERE u.id = $1
         GROUP BY u.id, u.filename, u.filesize, u.uploaded_at`,
        [uploadId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "upload_not_found" });
      }

      const row = result.rows[0];
      const totalErrors = Number(row.total_errors);
      const counts = {
        pending: Number(row.pending_count),
        queued: Number(row.queued_count),
        processing: Number(row.processing_count),
        retrying: Number(row.retrying_count),
        completed: Number(row.completed_count),
        queueFailed: Number(row.queue_failed_count),
        failed: Number(row.failed_count),
      };
      const finished = counts.completed + counts.queueFailed + counts.failed;

      return res.json({
        uploadId: row.id,
        filename: row.filename,
        filesize: row.filesize,
        uploadedAt: row.uploaded_at,
        status: deriveUploadStatus(totalErrors, counts),
        totalErrors,
        counts,
        progress: {
          finished,
          percent: totalErrors === 0
            ? 100
            : Math.round((finished / totalErrors) * 100),
        },
        recoverableCount: counts.pending + counts.queueFailed + counts.failed,
      });
    } catch (error) {
      logger.error("Failed to load upload status:", error);
      return res.status(500).json({ error: "db_error" });
    }
  }

  async function listUploadErrors(req, res) {
    const uploadId = parsePositiveId(req.params.id);
    if (!uploadId) {
      return res.status(400).json({ error: "invalid_upload_id" });
    }

    try {
      const uploadResult = await pool.query(
        "SELECT id FROM uploads WHERE id = $1",
        [uploadId]
      );
      if (uploadResult.rowCount === 0) {
        return res.status(404).json({ error: "upload_not_found" });
      }

      const result = await pool.query(
        `SELECT e.id, e.line_number, e.status, e.failure_reason,
                e.attempt_count, e.queued_at, e.started_at,
                e.completed_at, e.processed_at, e.fingerprint,
                EXISTS (
                  SELECT 1 FROM analyses a WHERE a.error_id = e.id
                ) AS has_analysis
         FROM errors e
         WHERE e.upload_id = $1
         ORDER BY e.id`,
        [uploadId]
      );

      return res.json(result.rows.map((row) => ({
        id: row.id,
        lineNumber: row.line_number,
        status: row.status,
        failureReason: row.failure_reason,
        attemptCount: row.attempt_count,
        queuedAt: row.queued_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        processedAt: row.processed_at,
        fingerprint: row.fingerprint,
        hasAnalysis: row.has_analysis,
      })));
    } catch (error) {
      logger.error("Failed to list upload errors:", error);
      return res.status(500).json({ error: "db_error" });
    }
  }

  async function retryError(req, res) {
    const errorId = parsePositiveId(req.params.id);
    if (!errorId) {
      return res.status(400).json({ error: "invalid_error_id" });
    }

    try {
      const result = await pool.query(
        "SELECT id, upload_id, status FROM errors WHERE id = $1",
        [errorId]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ error: "error_not_found" });
      }

      const errorRecord = result.rows[0];
      if (!RECOVERABLE_STATUSES.has(errorRecord.status)) {
        return res.status(409).json({
          error: "error_not_retryable",
          status: errorRecord.status,
        });
      }

      const outcome = await queueRecoverableError(errorRecord);
      if (outcome.kind === "failed") {
        return res.status(503).json({
          error: "queue_unavailable",
          errorId,
          status: "queue_failed",
        });
      }
      if (outcome.kind === "existing") {
        return res.status(409).json({
          error: "job_already_active",
          errorId,
          status: outcome.status,
          queueState: outcome.queueState,
        });
      }

      return res.status(202).json({
        errorId,
        status: "queued",
        queueAction: outcome.queueAction,
      });
    } catch (error) {
      logger.error("Failed to retry error:", error);
      return res.status(500).json({ error: "server_error" });
    }
  }

  async function retryUpload(req, res) {
    const uploadId = parsePositiveId(req.params.id);
    if (!uploadId) {
      return res.status(400).json({ error: "invalid_upload_id" });
    }

    try {
      const uploadResult = await pool.query(
        "SELECT id FROM uploads WHERE id = $1",
        [uploadId]
      );
      if (uploadResult.rowCount === 0) {
        return res.status(404).json({ error: "upload_not_found" });
      }

      const recoverableResult = await pool.query(
        `SELECT id, upload_id, status
         FROM errors
         WHERE upload_id = $1
           AND status IN ('pending', 'queue_failed', 'failed')
         ORDER BY id`,
        [uploadId]
      );

      if (recoverableResult.rowCount === 0) {
        return res.status(409).json({ error: "no_recoverable_errors" });
      }

      const outcomes = [];
      for (const errorRecord of recoverableResult.rows) {
        outcomes.push(await queueRecoverableError(errorRecord));
      }

      const summary = {
        requested: outcomes.length,
        queued: outcomes.filter((outcome) => outcome.kind === "queued").length,
        alreadyActive: outcomes.filter((outcome) => outcome.kind === "existing").length,
        failed: outcomes.filter((outcome) => outcome.kind === "failed").length,
      };

      const statusCode = summary.failed === summary.requested
        ? 503
        : summary.queued === 0 && summary.alreadyActive > 0
          ? 409
          : 202;

      return res.status(statusCode).json({
        uploadId,
        summary,
        errors: outcomes,
      });
    } catch (error) {
      logger.error("Failed to retry upload:", error);
      return res.status(500).json({ error: "server_error" });
    }
  }

  return {
    getUploadStatus,
    listUploadErrors,
    retryError,
    retryUpload,
  };
}

module.exports = {
  createBatchHandlers,
  deriveUploadStatus,
  parsePositiveId,
};
