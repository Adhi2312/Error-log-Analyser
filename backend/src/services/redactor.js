// deterministic regex redactions
function redact(text) {
  let t = text;
  t = t.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "<REDACTED_EMAIL>");
  t = t.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "<REDACTED_IP>");
  t = t.replace(/[A-Za-z]:\\[^\s]*/g, "<REDACTED_PATH>");
  t = t.replace(/\/[^\s]*/g, "<REDACTED_PATH>");
  t = t.replace(/(?<=\b(api_key|token|secret|password)\b[:=]\s*)([A-Za-z0-9\-_\.]{8,})/gi, "<REDACTED_SECRET>");
  t = t.replace(/\b(?:\d[ -]*?){13,19}\b/g, "<REDACTED_CC>");
  t = t.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "<REDACTED_SSN>");
  t = t.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, "<REDACTED_TIMESTAMP>");
  return t;
}

module.exports = { redact };
