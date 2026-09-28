const test = require("node:test");
const assert = require("node:assert/strict");
const { parseLogFile } = require("../src/services/parser");

test("keeps detail, exception, and stack-trace lines with their error", () => {
  const log = [
    "2026-09-28 09:13:02 WARN  [pool] Connection usage reached 85%",
    "2026-09-28 09:13:15 ERROR [http-7] Failed to fetch user profile",
    "User details: name=Rahul Sharma",
    "java.sql.SQLException: Connection is closed",
    "    at com.example.UserRepository.findById(UserRepository.java:142)",
    "    at com.example.UserService.getProfile(UserService.java:87)",
    "",
    "2026-09-28 09:13:18 ERROR [http-8] Payment processing failed",
    "java.lang.NullPointerException: payment is null",
    "    at com.example.PaymentService.process(PaymentService.java:203)",
    "",
    "2026-09-28 09:13:20 INFO  [http-8] Request finished",
  ].join("\n");

  const errors = parseLogFile(log);

  assert.equal(errors.length, 2);
  assert.equal(errors[0].line_number, 2);
  assert.match(errors[0].raw_text, /User details: name=Rahul Sharma/);
  assert.match(errors[0].raw_text, /SQLException: Connection is closed/);
  assert.match(errors[0].raw_text, /UserService\.getProfile/);
  assert.doesNotMatch(errors[0].raw_text, /Payment processing failed/);
  assert.equal(errors[1].line_number, 8);
  assert.match(errors[1].raw_text, /NullPointerException: payment is null/);
  assert.doesNotMatch(errors[1].raw_text, /Request finished/);
});

test("still captures a standalone exception and its stack frames", () => {
  const errors = parseLogFile([
    "java.io.IOException: Disk quota exceeded",
    "    at java.io.FileOutputStream.writeBytes(Native Method)",
  ].join("\n"));

  assert.equal(errors.length, 1);
  assert.equal(errors[0].line_number, 1);
  assert.match(errors[0].raw_text, /FileOutputStream\.writeBytes/);
});
