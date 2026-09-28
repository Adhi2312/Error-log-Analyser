const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const MIGRATION_FILE_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/;
const MIGRATION_LOCK_NAME = "error-log-analyser:migrations";

function checksum(sql) {
  return crypto.createHash("sha256").update(sql).digest("hex");
}

async function loadMigrations(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile() && MIGRATION_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (filenames.length === 0) {
    throw new Error(`No migration files found in ${directory}`);
  }

  return Promise.all(filenames.map(async (filename) => {
    const sql = await fs.readFile(path.join(directory, filename), "utf8");
    return { filename, sql, checksum: checksum(sql) };
  }));
}

async function runMigrations({ client, migrations, logger = console }) {
  await client.query("SELECT pg_advisory_lock(hashtext($1))", [MIGRATION_LOCK_NAME]);

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const appliedResult = await client.query(
      "SELECT filename, checksum FROM schema_migrations ORDER BY filename"
    );
    const applied = new Map(
      appliedResult.rows.map((row) => [row.filename, row.checksum])
    );

    for (const migration of migrations) {
      const previousChecksum = applied.get(migration.filename);
      if (previousChecksum) {
        if (previousChecksum !== migration.checksum) {
          throw new Error(
            `Migration ${migration.filename} changed after it was applied`
          );
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO schema_migrations (filename, checksum)
           VALUES ($1, $2)`,
          [migration.filename, migration.checksum]
        );
        await client.query("COMMIT");
        logger.log(`Applied migration ${migration.filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${migration.filename} failed`, { cause: error });
      }
    }

    return {
      total: migrations.length,
      applied: migrations.filter((migration) => !applied.has(migration.filename)).length,
    };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [MIGRATION_LOCK_NAME]);
  }
}

async function migrateDatabase({
  pool,
  migrationsDirectory = path.join(__dirname, "migrations"),
  logger = console,
}) {
  const migrations = await loadMigrations(migrationsDirectory);
  const client = await pool.connect();

  try {
    return await runMigrations({ client, migrations, logger });
  } finally {
    client.release();
  }
}

module.exports = {
  checksum,
  loadMigrations,
  migrateDatabase,
  runMigrations,
};
