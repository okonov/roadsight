import { Pool } from "pg";

// Same rationale as lib/routes/repository.ts: keep one Pool across Fast Refresh.
const globalForDb = globalThis as unknown as {
  pgPool?: Pool;
};

let localPool: Pool | undefined;

export function getPool(): Pool {
  const existing = globalForDb.pgPool ?? localPool;
  if (existing) return existing;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  localPool = pool;
  if (process.env.NODE_ENV !== "production") {
    globalForDb.pgPool = pool;
  }
  return pool;
}
