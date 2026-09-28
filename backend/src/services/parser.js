const LOG_LEVEL_LINE = /^\s*(?:\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\s+)?(?:TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\b/i;
const ERROR_LEVEL_LINE = /^\s*(?:\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\s+)?(?:ERROR|FATAL)\b/i;
const EXCEPTION_LINE = /\b(?:[A-Za-z_$][\w$]*\.)*(?:[A-Za-z_$][\w$]*(?:Exception|Error))(?::|\b)/;

function isLogEntryStart(line) {
  return LOG_LEVEL_LINE.test(line);
}

function isErrorStart(line) {
  return ERROR_LEVEL_LINE.test(line) || EXCEPTION_LINE.test(line);
}

function trimTrailingBlankLines(lines) {
  let end = lines.length;
  while (end > 1 && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(0, end);
}

function parseLogFile(content) {
  const lines = String(content || "").split(/\r?\n/);
  const results = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!isErrorStart(lines[index])) continue;

    const block = [lines[index]];
    let nextIndex = index + 1;

    while (nextIndex < lines.length && !isLogEntryStart(lines[nextIndex])) {
      block.push(lines[nextIndex]);
      nextIndex += 1;
    }

    results.push({
      line_number: index + 1,
      raw_text: trimTrailingBlankLines(block).join("\n"),
    });
    index = nextIndex - 1;
  }

  return results;
}

module.exports = {
  isErrorStart,
  isLogEntryStart,
  parseLogFile,
};
