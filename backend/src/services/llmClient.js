
const { GoogleGenAI } = require("@google/genai");


const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

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
  // Remove markdown code fences if Gemini happens to return them
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    // Fallback: try to extract JSON from the response
    const match = cleaned.match(/\{[\s\S]*\}/);

    if (!match) {
      return {
        issue_type: "unknown",
        root_cause: cleaned.slice(0, 256),
        suggested_fix: "",
        severity: "Medium",
        confidence: 0.5,
        raw: cleaned,
      };
    }

    try {
      return JSON.parse(match[0]);
    } catch (error) {
      return {
        issue_type: "parse_error",
        root_cause: cleaned.slice(0, 256),
        suggested_fix: "",
        severity: "Medium",
        confidence: 0.5,
        raw: cleaned,
      };
    }
  }
}

async function callLLM(redactedText) {
  console.log("Calling LLM with redacted text:", redactedText);

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const prompt = buildPrompt(redactedText);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const output = response.text;

    const parsed = parseLLMResponse(output);

    parsed.model = "gemini-2.5-flash";
    console.log("LLM analysis result:", parsed);
    return parsed;
  } catch (error) {
    console.error("Gemini API error:", error.message);

    throw new Error("Failed to analyze log using Gemini");
  }
}

module.exports = { callLLM };
