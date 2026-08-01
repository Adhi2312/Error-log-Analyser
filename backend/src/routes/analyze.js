const express = require("express");
const router = express.Router();

const { callLLM } = require("../services/llmClient");

router.post("/", async (req, res) => {
  try {
    const { redacted_text } = req.body;

    if (!redacted_text) {
      return res.status(400).json({ error: "redacted_text_required" });
    }

    // Call LLM directly
    const analysis = await callLLM(redacted_text);

    return res.json({
      source: "llm",
      analysis
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "llm_error" });
  }
});

module.exports = router;
