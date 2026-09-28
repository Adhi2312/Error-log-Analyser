const axios = require("axios");

const DEFAULT_NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_NVIDIA_MODEL = "openai/gpt-oss-20b";

function buildPrompt(redactedText) {
  return `You are a log analyzer.

Analyze the following redacted error log.

Respond ONLY with a valid JSON object using exactly these keys:

{
  "issue_type": "string",
  "root_cause": "string",
  "suggested_fix": "string",
  "severity": "Low|Medium|High",
  "confidence": 0.0
}

Rules:
- issue_type: Identify the type of error.
- root_cause: Explain the most likely root cause.
- suggested_fix: Give a practical fix.
- severity: Must be exactly Low, Medium, or High.
- confidence: Number between 0.0 and 1.0.
- Do not include markdown.
- Do not include explanations outside the JSON.

Here is the redacted error log:

"""${redactedText}"""`;
}

function parseLLMResponse(text) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("NVIDIA NIM returned an empty response");
  }

  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("NVIDIA NIM returned invalid JSON");

    try {
      return JSON.parse(match[0]);
    } catch {
      throw new Error("NVIDIA NIM returned invalid JSON");
    }
  }
}

function getLLMIdentity(env = process.env) {
  const provider = (env.LLM_PROVIDER || "nvidia").toLowerCase();
  if (provider !== "nvidia") {
    throw new Error(`Unsupported LLM_PROVIDER: ${provider}`);
  }

  return {
    provider: "nvidia-nim",
    model: env.NVIDIA_NIM_MODEL || DEFAULT_NVIDIA_MODEL,
    baseURL: (env.NVIDIA_NIM_BASE_URL || DEFAULT_NVIDIA_BASE_URL).replace(/\/+$/, ""),
  };
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createLLMClient({
  httpClient = axios,
  env = process.env,
  logger = console,
} = {}) {
  return async function callNvidiaNim(redactedText) {
    if (!env.NVIDIA_API_KEY) {
      throw new Error("NVIDIA_API_KEY is not configured");
    }

    const identity = getLLMIdentity(env);
    const timeout = positiveInteger(env.NVIDIA_NIM_TIMEOUT_MS, 45000);

    try {
      const response = await httpClient.post(
        `${identity.baseURL}/chat/completions`,
        {
          model: identity.model,
          messages: [{ role: "user", content: buildPrompt(redactedText) }],
          temperature: 0.1,
          max_tokens: 800,
          reasoning_effort: "low",
          stream: false,
        },
        {
          headers: {
            Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout,
        }
      );

      const output = response.data?.choices?.[0]?.message?.content;
      const parsed = parseLLMResponse(output);
      parsed.provider = identity.provider;
      parsed.model = response.data?.model || identity.model;
      return parsed;
    } catch (error) {
      const status = error.response?.status;
      const providerMessage = error.response?.data?.detail
        || error.response?.data?.message
        || error.message;
      logger.error(
        "NVIDIA NIM API error:",
        status ? `HTTP ${status}` : "request_failed",
        providerMessage
      );
      throw new Error(
        status
          ? `NVIDIA NIM request failed with HTTP ${status}`
          : "NVIDIA NIM request failed"
      );
    }
  };
}

const callLLM = createLLMClient();

module.exports = {
  buildPrompt,
  callLLM,
  createLLMClient,
  getLLMIdentity,
  parseLLMResponse,
};
