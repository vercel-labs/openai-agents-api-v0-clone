import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { databaseUrl } from "../lib/database-url";
async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error("Set DATABASE_URL in .env.local first.");
  const pool = new Pool({
    connectionString: databaseUrl(process.env.DATABASE_URL),
  });
  try {
    await pool.query(
      await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"),
    );
    console.log("Database schema ready.");
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
