const { Pool } = require("pg");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@postgres:5432/dev"
});
module.exports = { pool };
