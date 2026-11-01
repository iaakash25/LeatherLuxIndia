import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, getPool } from "./pool.js";
import { logger } from "../lib/logger.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const LOCK_ID = 727_001; // arbitrary app-wide advisory lock so two deploys can't migrate at once

export async function migrate(): Promise<string[]> {
  const client = await getPool().connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query<{ id: string }>("SELECT id FROM schema_migrations")).rows.map((r) => r.id));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      applied.push(file);
      logger.info({ migration: file }, "migration applied");
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => undefined);
    client.release();
  }
  return applied;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate()
    .then((a) => { logger.info({ applied: a.length }, a.length ? "migrations complete" : "database already up to date"); })
    .catch((err) => { logger.error({ err: err.message }, "migration failed"); process.exitCode = 1; })
    .finally(closePool);
}
