// src/routes/preview.js
const express = require("express");
const router = express.Router();

const { parseLogFile } = require("../services/parser");
const { redact } = require("../services/redactor");

// POST /preview
// body: { filename?: string, text: string }
router.post("/", async (req, res) => {
  try {
    const { text, filename } = req.body || {};

    if (!text) {
      return res.status(400).json({ error: "no_text_provided" });
    }

    // Parse log lines into errors
    const errors = parseLogFile(text); // [{ line_number, raw_text }]

    // Redact sensitive info
    const redactedErrors = errors.map((err) => ({
      line_number: err.line_number,
      raw_text: err.raw_text,
      redacted_text: redact(err.raw_text),
    }));

    return res.json({
      filename: filename || null,
      totalErrors: redactedErrors.length,
      errors: redactedErrors,
    });
  } catch (err) {
    console.error("Preview route error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

module.exports = router;
