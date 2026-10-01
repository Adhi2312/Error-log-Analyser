const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");

// Keep local configuration independent of the shell's working directory.
// Hosting platforms can continue to provide environment variables directly.
const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  const fileEnv = parseEnv(fs.readFileSync(envPath, "utf8"));
  const overrides = ["NVIDIA_API_KEY", "NVIDIA_NIM_BASE_URL", "NVIDIA_NIM_MODEL"]
    .filter((name) => process.env[name] && fileEnv[name] && process.env[name] !== fileEnv[name]);
  if (overrides.length > 0) {
    console.warn(`Process environment overrides backend/.env for: ${overrides.join(", ")}`);
  }
  process.loadEnvFile(envPath);
}
