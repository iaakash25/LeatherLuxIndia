import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";

/**
 * The API as a Vercel function: the same Express app that `npm run dev` / `npm start` run, answering /api/* inside the storefront's own
 * deployment (scripts/vercel-api.mjs bundles this file). The pieces of src/index.ts that belong to a long-running process (listening on a
 * port, hourly housekeeping, graceful shutdown) do not apply here.
 */
env(); // a bad setting fails loudly on the first request, with the reason in the function logs, instead of half-working
const app = createApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
