const test = require("node:test");
const assert = require("node:assert/strict");
const { redact } = require("../src/services/redactor");

test("redacts sensitive values from a multiline error block", () => {
  const input = [
    "User details: email=rahul.sharma@gmail.com, phone=+91-9876543210",
    "Client IP: 192.168.1.45",
    "Authorization: Bearer sk_test_51H8x9ExampleSecretKey123456",
    "Database password: MySecretPassword123!",
  ].join("\n");

  const result = redact(input);

  assert.doesNotMatch(result, /rahul\.sharma@gmail\.com/);
  assert.doesNotMatch(result, /9876543210/);
  assert.doesNotMatch(result, /192\.168\.1\.45/);
  assert.doesNotMatch(result, /sk_test_51H8x9ExampleSecretKey123456/);
  assert.doesNotMatch(result, /MySecretPassword123/);
  assert.match(result, /<REDACTED_EMAIL>/);
  assert.match(result, /<REDACTED_PHONE>/);
  assert.match(result, /<REDACTED_IP>/);
  assert.match(result, /<REDACTED_TOKEN>/);
  assert.match(result, /<REDACTED_SECRET>/);
});
