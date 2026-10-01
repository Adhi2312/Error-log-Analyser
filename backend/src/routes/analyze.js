const express = require("express");
const router = express.Router();

const { callLLM } = require("../services/llmClient");
const { redact } = require("../services/redactor");

router.post("/", async (req, res) => {
  try {
    const { redacted_text } = req.body;

    if (!redacted_text) {
      return res.status(400).json({ error: "redacted_text_required" });
    }

    // Call LLM directly
    const analysis = await callLLM(redact(redacted_text));

    return res.json({
      source: "llm",
      analysis
    });

  } catch (err) {
    console.error(err);
    const message = typeof err.message === "string" && err.message.startsWith("NVIDIA ")
      ? err.message
      : undefined;
    return res.status(502).json({ error: "llm_error", ...(message && { message }) });
  }
});

module.exports = router;
