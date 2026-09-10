import { Pool, type QueryResultRow } from "pg";
import { required } from "./config";
import { databaseUrl } from "./database-url";

const globalDb = globalThis as typeof globalThis & { studioPool?: Pool };
function pool() {
  return (globalDb.studioPool ??= new Pool({
    connectionString: databaseUrl(required("DATABASE_URL")),
    max: 5,
  }));
}
export async function query<T extends QueryResultRow>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  return (await pool().query<T>(sql, values)).rows;
}
export async function transaction<T>(
  fn: (q: typeof query) => Promise<T>,
): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(
      async (sql, values) => (await client.query(sql, values)).rows,
    );
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
