const { parsePositiveId } = require("./batchHandlers");
const { saveAnalysis } = require("../services/processErrorJob");

function createDirectAnalysisHandler({
  pool,
  redact,
  computeFingerprint,
  callLLM,
  logger = console,
}) {
  return async function analyzeError(req, res) {
    const errorId = parsePositiveId(req.params.id);
    if (!errorId) {
      return res.status(400).json({ error: "invalid_error_id" });
    }

    let claimed;
    try {
      claimed = await pool.query(
        `UPDATE errors
         SET status = 'processing',
             failure_reason = NULL,
             attempt_count = attempt_count + 1,
             started_at = now(),
             completed_at = NULL
         WHERE id = $1
           AND (
             status IN ('pending', 'queued', 'retrying', 'failed', 'queue_failed')
             OR (status = 'processing' AND started_at < now() - interval '2 minutes')
           )
         RETURNING raw_text`,
        [errorId]
      );

      if (claimed.rowCount === 0) {
        const existing = await pool.query(
          `SELECT e.status,
                  EXISTS (SELECT 1 FROM analyses a WHERE a.error_id = e.id) AS has_analysis
           FROM errors e WHERE e.id = $1`,
          [errorId]
        );
        if (existing.rowCount === 0) {
          return res.status(404).json({ error: "error_not_found" });
        }
        if (existing.rows[0].status === "completed" && existing.rows[0].has_analysis) {
          return res.json({ errorId, status: "completed", reusedExisting: true });
        }
        return res.status(409).json({
          error: "error_not_ready",
          status: existing.rows[0].status,
        });
      }
    } catch (error) {
      logger.error(`Failed to claim error ${errorId}:`, error);
      return res.status(500).json({ error: "db_error" });
    }

    try {
      const rawText = claimed.rows[0].raw_text;
      if (typeof rawText !== "string") {
        throw new Error("Error has no processable text");
      }

      const redactedText = redact(rawText);
      const fingerprint = computeFingerprint(redactedText);
      const analysis = await callLLM(redactedText);
      await saveAnalysis({
        pool,
        errorId,
        redactedText,
        fingerprint,
        source: analysis.provider || "llm",
        analysis,
      });

      return res.json({ errorId, status: "completed" });
    } catch (error) {
      logger.error(`Direct analysis failed for error ${errorId}:`, error);
      try {
        await pool.query(
          `UPDATE errors
           SET status = 'failed', failure_reason = $2, completed_at = now()
           WHERE id = $1 AND status = 'processing'`,
          [errorId, String(error.message || error).slice(0, 500)]
        );
      } catch (statusError) {
        logger.error(`Failed to record analysis failure for error ${errorId}:`, statusError);
      }
      return res.status(502).json({ error: "analysis_failed" });
    }
  };
}

module.exports = { createDirectAnalysisHandler };
