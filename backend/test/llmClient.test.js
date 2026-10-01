const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createLLMClient,
  getLLMIdentity,
  parseLLMResponse,
} = require("../src/services/llmClient");

test("parses JSON returned inside a markdown fence", () => {
  const result = parseLLMResponse('```json\n{"severity":"High"}\n```');
  assert.deepEqual(result, { severity: "High" });
});

test("uses the configured NVIDIA NIM endpoint and model", async () => {
  const calls = [];
  const httpClient = {
    async post(...args) {
      calls.push(args);
      return {
        data: {
          model: "meta/test-model",
          choices: [{
            message: {
              content: JSON.stringify({
                issue_type: "database_error",
                root_cause: "Connection is closed",
                suggested_fix: "Repair connection lifecycle",
                severity: "High",
                confidence: 0.9,
              }),
            },
          }],
        },
      };
    },
  };
  const env = {
    LLM_PROVIDER: "nvidia",
    NVIDIA_API_KEY: "test-api-key",
    NVIDIA_NIM_BASE_URL: "https://nim.example/v1/",
    NVIDIA_NIM_MODEL: "meta/test-model",
  };

  const callLLM = createLLMClient({ httpClient, env, logger: { error() {} } });
  const result = await callLLM("ERROR Connection is closed");

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "https://nim.example/v1/chat/completions");
  assert.equal(calls[0][1].model, "meta/test-model");
  assert.equal(calls[0][1].reasoning_effort, "low");
  assert.equal(calls[0][2].headers.Authorization, "Bearer test-api-key");
  assert.equal(result.provider, "nvidia-nim");
  assert.equal(result.model, "meta/test-model");
  assert.equal(result.root_cause, "Connection is closed");
});

test("rejects a missing NVIDIA API key without making a request", async () => {
  let called = false;
  const callLLM = createLLMClient({
    httpClient: { post: async () => { called = true; } },
    env: {},
    logger: { error() {} },
  });

  await assert.rejects(callLLM("ERROR failed"), /NVIDIA_API_KEY is not configured/);
  assert.equal(called, false);
});

test("explains NVIDIA HTTP 410 as an access issue to check", async () => {
  const callLLM = createLLMClient({
    httpClient: {
      post: async () => {
        const error = new Error("Gone");
        error.response = { status: 410 };
        throw error;
      },
    },
    env: { NVIDIA_API_KEY: "test-api-key" },
    logger: { error() {} },
  });

  await assert.rejects(
    callLLM("ERROR failed"),
    /HTTP 410.*Public API Endpoints access/
  );
});

test("uses a provider and model identity suitable for cache namespacing", () => {
  assert.deepEqual(
    getLLMIdentity({ NVIDIA_NIM_MODEL: "meta/custom-model" }),
    {
      provider: "nvidia-nim",
      model: "meta/custom-model",
      baseURL: "https://integrate.api.nvidia.com/v1",
    }
  );
});
