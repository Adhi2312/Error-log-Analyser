const { pool } = require("../db");
const { migrateDatabase } = require("./migrationRunner");

async function main() {
  try {
    const result = await migrateDatabase({ pool });
    console.log(
      result.applied === 0
        ? `Database is current (${result.total} migrations)`
        : `Database migration complete (${result.applied} applied)`
    );
  } catch (error) {
    console.error(error.message);
    if (error.cause) console.error(error.cause);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
