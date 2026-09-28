const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { ensureErrorQueued } = require("../queue");
const { createBatchHandlers } = require("./batchHandlers");

const batchHandlers = createBatchHandlers({ pool, ensureErrorQueued });

// List uploads
router.get("/uploads", async (req, res) => {
  try {
    const q = await pool.query("SELECT id, filename, filesize, uploaded_at FROM uploads ORDER BY uploaded_at DESC");
    res.json(q.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "db_error" });
  }
});

router.get("/uploads/:id/status", batchHandlers.getUploadStatus);
router.get("/uploads/:id/errors", batchHandlers.listUploadErrors);
router.post("/uploads/:id/retry", batchHandlers.retryUpload);
router.post("/errors/:id/retry", batchHandlers.retryError);

// Get analysis for one error
router.get("/errors/:id/analysis", async (req, res) => {
  console.log("Fetching analysis for error ID:", req.params.id);
  const errorId = parseInt(req.params.id, 10);
  if (Number.isNaN(errorId)) return res.status(400).json({ error: "invalid_error_id" });
  try {
    const q = await pool.query(
      `SELECT a.id, a.source, a.model, a.created_at, a.analysis_json
       FROM analyses a
       WHERE a.error_id = $1
       ORDER BY a.id DESC
       LIMIT 1`,
      [errorId]
    );
    if (q.rowCount === 0) return res.status(404).json({ error: "not_found" });
    res.json(q.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "db_error" });
  }
});

module.exports = router;
