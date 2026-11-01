import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

let pg: EmbeddedPostgres | undefined;
let dir: string | undefined;

export async function setup() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "llx-pg-"));
  pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "test-only-password",
    port: Number(process.env["TEST_DB_PORT"] ?? 54329), // set TEST_DB_PORT when something else on the machine already uses 54329
    persistent: true,
    onLog: () => undefined,
    onError: () => undefined,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("llx_test");
}

export async function teardown() {
  await pg?.stop();
  // Windows may still hold file locks for a moment after shutdown; a leftover temp dir is harmless.
  try {
    if (dir) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch { /* the OS temp cleaner will get it */ }
}
