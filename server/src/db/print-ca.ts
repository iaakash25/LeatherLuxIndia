import { env } from "../config/env.js";
import pg from "pg";

/**
 * Prints the certificate the database presents, in the form the API's settings take it (DB_SSL_CA), plus the name to put in
 * DB_SSL_SERVERNAME. With both set and DB_SSL_MODE=verify-full the API accepts only THAT certificate, so nobody sitting between
 * Vercel and the database can pretend to be it.
 *
 *   npm run db:ca
 *
 * This takes the certificate on trust at this moment, as ssh does the first time you connect. For the strongest assurance run it
 * on the database server itself, or compare the fingerprint it prints with `openssl x509 -noout -fingerprint -sha256 -in <ssl_cert_file>` there.
 */
const e = env();
const client = new pg.Client({
  host: e.DB_HOST, port: e.DB_PORT, database: e.DB_NAME, user: e.DB_USER, password: e.DB_PASSWORD,
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000,
});
try {
  await client.connect();
  const socket = (client as unknown as { connection: { stream: { getPeerCertificate: (detailed: boolean) => { raw: Buffer; subject: { CN?: string }; fingerprint256: string; valid_to: string } } } }).connection.stream;
  const cert = socket.getPeerCertificate(true);
  const pem = `-----BEGIN CERTIFICATE-----\n${cert.raw.toString("base64").replace(/(.{64})/g, "$1\n").trim()}\n-----END CERTIFICATE-----`;
  console.log(`Certificate presented by the database (valid until ${cert.valid_to}):`);
  console.log(`  name (CN)    : ${cert.subject.CN ?? "(none)"}`);
  console.log(`  fingerprint  : ${cert.fingerprint256}\n`);
  console.log("Settings for the API (in Vercel's Environment Variables, or server/.env):\n");
  console.log("DB_SSL_MODE=verify-full");
  console.log(`DB_SSL_SERVERNAME=${cert.subject.CN ?? ""}`);
  console.log("DB_SSL_CA=" + pem.replace(/\n/g, "\\n"));
  console.log("\n(The DB_SSL_CA value is one line with \\n for the line breaks. It is a public certificate, not a secret.)");
} catch (err) {
  console.error(`Could not connect: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
