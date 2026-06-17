import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { serverEnv } from "@/env";
import * as schema from "./schema";

/**
 * postgres.js + Drizzle. postgres.js gives us real interactive transactions and
 * `SELECT ... FOR UPDATE` row locks, which the money ledger requires (the Neon
 * HTTP driver can't do interactive transactions). Runs on the Node.js runtime.
 */
type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | null = null;
let _sql: ReturnType<typeof postgres> | null = null;

export function getDb(): Db {
  if (!_db) {
    _sql = postgres(serverEnv().DATABASE_URL, { max: 10, prepare: false });
    _db = drizzle(_sql, { schema });
  }
  return _db;
}

export { schema };
export type { Db };
