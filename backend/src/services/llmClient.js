const axios = require("axios");

// Default: mock deterministic LLM for development.
// If you want to enable real providers:
// - set process.env.LLAMA_URL to local endpoint (POST /generate {prompt})
// - or set process.env.HF_TOKEN and process.env.HF_MODEL to call HF inference

function buildPrompt(redactedText) {
  return `You are a log analyzer. Input is a single redacted error log. Respond ONLY with a JSON object with keys:
- issue_type (string)
- root_cause (string)
- suggested_fix (string)
- severity (Low|Medium|High)
- confidence (0.0-1.0)

Here is the redacted error:
"""${redactedText}"""
Respond ONLY with JSON.`;
}

function parseLLMResponse(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { issue_type: "unknown", root_cause: text.slice(0, 256), suggested_fix: "", severity: "Medium", confidence: 0.5, raw: text };
  try {
    return JSON.parse(m[0]);
  } catch (e) {
    return { issue_type: "parse_error", root_cause: text.slice(0, 256), suggested_fix: "", severity: "Medium", confidence: 0.5, raw: text };
  }
}

async function callLLM(redactedText) {
  // If LLAMA_URL provided, use local endpoint
  if (process.env.LLAMA_URL) {
    const prompt = buildPrompt(redactedText);
    const resp = await axios.post(process.env.LLAMA_URL + "/generate", { prompt, max_tokens: 512 });
    const out = resp.data.text || resp.data.output || JSON.stringify(resp.data);
    const parsed = parseLLMResponse(out);
    parsed.model = "local-llama";
    return parsed;
  }

  // If HF token & model provided, call HF
  if (process.env.HF_TOKEN && process.env.HF_MODEL) {
    const prompt = buildPrompt(redactedText);
    const resp = await axios.post(
      `https://api-inference.huggingface.co/models/${process.env.HF_MODEL}`,
      { inputs: prompt, options: { wait_for_model: true } },
      { headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` } }
    );
    const out = Array.isArray(resp.data) ? (resp.data[0].generated_text || JSON.stringify(resp.data)) : (resp.data.generated_text || JSON.stringify(resp.data));
    const parsed = parseLLMResponse(out);
    parsed.model = process.env.HF_MODEL;
    return parsed;
  }

  // Default mock (deterministic) for dev
  const stub = {
    issue_type: "RuntimeException",
    root_cause: "Exception thrown in module X due to null pointer or invalid input",
    suggested_fix: "Check null pointers, add input validation, add try/catch, add logging",
    severity: "High",
    confidence: 0.75
  };
  return stub;
}

module.exports = { callLLM };
