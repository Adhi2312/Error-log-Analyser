const crypto = require("crypto");

function normalizeForFingerprint(s) {
  return s
    .toLowerCase()
    .replace(/\d+/g, "<NUM>")
    .replace(/\s+/g, " ")
    .trim();
}

function computeFingerprint(redacted) {
  const norm = normalizeForFingerprint(redacted);
  return crypto.createHash("sha256").update(norm).digest("hex");
}

function computeFileHash(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

module.exports = { computeFingerprint, computeFileHash, normalizeForFingerprint };
