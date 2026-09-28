function createUploadHandler({
  readFile,
  unlink,
  pool,
  parseLogFile,
  computeFileHash,
  enqueueError,
  logger = console,
}) {
  return async function handleUpload(req, res) {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "no_file" });
    }

    let client;
    let transactionStarted = false;

    function releaseClient() {
      if (!client) return;

      const clientToRelease = client;
      client = undefined;

      try {
        clientToRelease.release();
      } catch (error) {
        logger.error("Failed to release database client:", error);
      }
    }

    try {
      const content = await readFile(file.path, "utf-8");
      const fileHash = computeFileHash(content);
      const errorEntries = parseLogFile(content);

      client = await pool.connect();
      await client.query("BEGIN");
      transactionStarted = true;

      const insertUpload = await client.query(
        "INSERT INTO uploads (filename, filesize, file_hash) VALUES ($1,$2,$3) RETURNING id",
        [file.originalname, file.size, fileHash]
      );
      const uploadId = insertUpload.rows[0].id;
      const createdErrors = [];

      for (const errorEntry of errorEntries) {
        const insertError = await client.query(
          `INSERT INTO errors
           (upload_id, line_number, raw_text, status)
           VALUES ($1, $2, $3, 'pending')
           RETURNING id, line_number, status`,
          [uploadId, errorEntry.line_number, errorEntry.raw_text]
        );

        const createdError = insertError.rows[0];

        createdErrors.push({
          id: createdError.id,
          line_number: createdError.line_number,
          status: createdError.status || "pending",
        });
      }

      await client.query("COMMIT");
      transactionStarted = false;
      releaseClient();

      let queuedCount = 0;
      let queueFailedCount = 0;

      for (const createdError of createdErrors) {
        try {
          await enqueueError({
            uploadId,
            errorId: createdError.id,
          });

          queuedCount += 1;
          createdError.status = "queued";

          try {
            await pool.query(
              `UPDATE errors
               SET status = 'queued', failure_reason = NULL, queued_at = now()
               WHERE id = $1 AND status = 'pending'`,
              [createdError.id]
            );
          } catch (error) {
            logger.error(
              `Failed to record queued status for error ${createdError.id}:`,
              error
            );
          }
        } catch (error) {
          queueFailedCount += 1;
          createdError.status = "queue_failed";
          logger.error(`Failed to enqueue error ${createdError.id}:`, error);

          const failureReason = String(error.message || error).slice(0, 500);

          try {
            await pool.query(
              `UPDATE errors
               SET status = 'queue_failed',
                   failure_reason = $2,
                   completed_at = now()
               WHERE id = $1 AND status = 'pending'`,
              [createdError.id, failureReason]
            );
          } catch (statusError) {
            logger.error(
              `Failed to record queue failure for error ${createdError.id}:`,
              statusError
            );
          }
        }
      }

      return res.status(202).json({
        uploadId,
        totalErrors: createdErrors.length,
        queueSummary: {
          queued: queuedCount,
          failed: queueFailedCount,
        },
        errors: createdErrors,
      });
    } catch (error) {
      if (client && transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          logger.error("Failed to roll back upload transaction:", rollbackError);
        }
      }

      logger.error("Upload route error:", error);
      return res.status(500).json({ error: "server_error" });
    } finally {
      releaseClient();

      try {
        await unlink(file.path);
      } catch (error) {
        if (error.code !== "ENOENT") {
          logger.error("Failed to delete temporary upload:", error);
        }
      }
    }
  };
}

module.exports = { createUploadHandler };
