const test = require("node:test");
const assert = require("node:assert/strict");
const { checksum, runMigrations } = require("../src/db/migrationRunner");

function createClient(appliedRows = [], failSql = null) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const normalized = sql.trim();
      calls.push({ sql: normalized, params });
      if (normalized.startsWith("SELECT filename, checksum")) {
        return { rows: appliedRows };
      }
      if (failSql && normalized === failSql) throw new Error("broken SQL");
      return { rows: [] };
    },
  };
}

const migrations = [
  { filename: "001_initial.sql", sql: "SELECT 1", checksum: checksum("SELECT 1") },
  { filename: "002_status.sql", sql: "SELECT 2", checksum: checksum("SELECT 2") },
];

test("applies only pending migrations and records their checksums", async () => {
  const client = createClient([{
    filename: migrations[0].filename,
    checksum: migrations[0].checksum,
  }]);
  const logged = [];

  const result = await runMigrations({
    client,
    migrations,
    logger: { log: (message) => logged.push(message) },
  });

  assert.deepEqual(result, { total: 2, applied: 1 });
  assert.equal(client.calls.some((call) => call.sql === "SELECT 1"), false);
  assert.equal(client.calls.some((call) => call.sql === "SELECT 2"), true);
  assert.deepEqual(logged, ["Applied migration 002_status.sql"]);
});

test("rejects a previously applied migration whose contents changed", async () => {
  const client = createClient([{
    filename: migrations[0].filename,
    checksum: "different-checksum",
  }]);

  await assert.rejects(
    runMigrations({ client, migrations, logger: { log() {} } }),
    /changed after it was applied/
  );
  assert.equal(
    client.calls.some((call) => call.sql.includes("pg_advisory_unlock")),
    true
  );
});

test("rolls back a failed migration and does not record it", async () => {
  const client = createClient([], "SELECT 1");

  await assert.rejects(
    runMigrations({ client, migrations, logger: { log() {} } }),
    /Migration 001_initial.sql failed/
  );

  const statements = client.calls.map((call) => call.sql);
  assert.equal(statements.includes("ROLLBACK"), true);
  assert.equal(statements.some((sql) => sql.startsWith("INSERT INTO schema_migrations")), false);
  assert.equal(statements.some((sql) => sql.includes("pg_advisory_unlock")), true);
});
