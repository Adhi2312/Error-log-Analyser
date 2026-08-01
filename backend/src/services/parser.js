// Minimal parser: capture lines with "ERROR" or "Exception" and following stack frames starting with whitespace+at
function parseLogFile(content) {
  const lines = content.split(/\r?\n/);
  const results = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/\bERROR\b/i.test(l) || /\bException\b/.test(l)) {
      let raw = l;
      let j = i + 1;
      while (j < lines.length && /^\s+at\s+/.test(lines[j])) {
        raw += "\n" + lines[j];
        j++;
      }
      results.push({ line_number: i + 1, raw_text: raw });
      i = j - 1;
    }
  }
  return results;
}

module.exports = { parseLogFile };
