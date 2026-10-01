const SUPPORTED_MODES = new Set(["queue", "direct"]);

function getAnalysisMode(env = process.env.ANALYSIS_MODE) {
  console.log("Fetching analysis mode from environment variable ANALYSIS_MODE:", env);
  const mode = (env || "queue").toLowerCase();
  console.log("Analysis mode:", mode);
  if (!SUPPORTED_MODES.has(mode)) {
    throw new Error(`Unsupported ANALYSIS_MODE: ${mode}`);
  }
  return mode;
}

module.exports = { getAnalysisMode };
