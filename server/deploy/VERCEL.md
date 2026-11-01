# Running the whole shop on Vercel (storefront and API in one deployment)

The API is the same Express app as in `server/`, built into the storefront's own Vercel deployment. The site and the API share one domain, so a request to
`https://leatherluxindia.com/api/...` is answered by the API and everything else by the site. There is no separate API server to run, patch or secure.

**How it fits together**

- `npm run build` (what Vercel runs) builds the site, then `scripts/vercel-api.mjs` bundles `server/src/vercel.ts` into a function and routes `/api/*` to it.
- The database stays where it is (your EC2 Postgres). The function connects to it over TLS, and verifies the server's certificate (step 1).
- Product photos are plain static files in `public/media/`, served by Vercel's CDN.
- Sign-in cookies are tied to the exact domain, so sign-in works on `.com` and `.in` alike, and there is no CORS setup between the site and its API.

If you ever need the API on its own server instead, that setup is in `README.md` in this folder.

## 1. The database connection (do this first)

Vercel's functions connect from addresses that change, so Postgres must accept connections from the internet. That is the one real cost of this setup, so the connection is
made as hard to abuse as possible.

**a. Make the connection authenticated, not just encrypted.** Your database presents a self-signed certificate, so `DB_SSL_MODE=require` encrypts the traffic but cannot tell a
real database from an impostor in the middle. Pinning the certificate fixes that without touching the server. On your computer, in `server/`:

```bash
npm run db:ca
```

It prints three lines (`DB_SSL_MODE`, `DB_SSL_SERVERNAME`, `DB_SSL_CA`) to paste into Vercel in step 2. With them the API accepts **only that exact certificate**; I tested that a wrong name, a different
certificate and a malformed value are all refused. The certificate is public information, not a secret. It is valid until March 2034. For the strongest assurance, run `npm run db:ca` on the
database server itself, or compare the fingerprint it prints with `openssl x509 -noout -fingerprint -sha256 -in <ssl_cert_file>` there.

**b. Lock the database role down** (on the EC2 server, as the postgres user, `sudo -u postgres psql`):

```sql
-- the API's role must be a plain role, not a superuser:
SELECT rolname, rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'llx_app';   -- all three must be f
-- cap its connections, so a flood of serverless instances can never use them all up:
ALTER ROLE llx_app CONNECTION LIMIT 40;
```

In `pg_hba.conf` the only line that lets `llx_app` in from outside should be `hostssl LLI llx_app 0.0.0.0/0 scram-sha-256`: no plain `host` lines and nothing with `trust`.
Then `sudo systemctl reload postgresql`.

**c. The AWS security group** must allow port 5432 from anywhere (`0.0.0.0/0`), because Vercel has no fixed addresses. Everything else stays closed. If you want 5432 limited to known addresses,
the options are Vercel's paid *Static IPs* (then allow only those), moving the database to a managed Postgres that Vercel integrates with (Neon, for example), or going back to
an API on your own server (`README.md` here).

**d. Use a strong database password** (30+ random characters) and change it now: it will live in Vercel. Change it in Postgres (`ALTER ROLE llx_app PASSWORD '...'`), in your own `server/.env`, and in Vercel.

## 2. Environment variables in Vercel

Settings -> Environment Variables. Add every line of **`vercel.env.example`** (in this folder) for both *Production* and *Preview*, replacing each `REPLACE_ME`:

- `DB_HOST`, `DB_PASSWORD`: from your `server/.env`. `DB_SSL_SERVERNAME` and `DB_SSL_CA`: from `npm run db:ca`.
- `JWT_ACCESS_SECRET` and `PASSWORD_PEPPER`: **copy them from your current `server/.env`, do not generate new ones.** Every stored password (your admin's included) depends on the pepper.
- Mark the secrets *Sensitive* so Vercel hides them after saving.

## 3. Function region

Settings -> Functions -> Function Region: choose the one closest to the database. Your EC2 database appears to be in Mumbai (`ap-south-1`), so choose **Mumbai (bom1)**. Every API request
makes several database calls, and a function on the other side of the world turns each into a slow round trip.

## 4. Deploy

Push to GitHub and Vercel builds it. The build log should end with a line like `vercel-api: added the API function (2516 KB ...) and routed /api/* to it`. Then run, from any computer with `curl`:

```bash
bash server/deploy/check-security.sh
```

and open `https://leatherluxindia.com`: it should show the photographed products, and sign-in, the bag and the admin Inventory page should work. If `/api/health/ready` answers
`503`, the database connection is wrong: open Vercel -> Logs, where the reason is logged (a certificate or password problem usually).

## 5. Day-to-day

- **Logs:** Vercel -> Logs (the API logs there, in JSON). There are no log files.
- **Database changes** (migrations, adding an admin, imports): run them from your computer against the same database, exactly as before: `npm run db:migrate`, `npm run admin:add`, `npm run products:import`.
- **New or changed product photos:** `npm run products:import` writes the processed photos into `public/media/` and updates the database. Then commit the new files and push, so the deployment contains them
  (add `--prune` to remove the files no product uses any more). Photos must be pushed before, or together with, the import, so no product points at a photo that is not deployed yet.
- **Launch day:** set `ORDERS_OPEN=true` in Vercel's Environment Variables and redeploy, then set `enabled: false` in `src/lib/launch.ts` and push.
- **Backups:** the data is in Postgres on EC2, so use `backup-db.sh` from `README.md` there (it needs a small settings file with the `DB_*` lines: set `LLX_ENV_FILE` to it).
  Take a backup before anything risky, and copy backups off the server.

## What to know about this setup

- **Hobby plan:** Vercel's Hobby plan is for non-commercial use. Use Pro before taking orders.
- **Caches and counters are per instance.** The catalogue cache and the "global" per-address limit live in each function instance's memory, so an admin's price change shows on other instances after the cache time
  (60 seconds). The strict limits on sign-in, registration, newsletter and visits are shared through the database, and hold across all instances.
- **Cold starts:** the first request after a quiet period takes longer while the function starts and connects to the database.
- **Function limits:** each request must finish within the plan's function time limit. Nothing in the shop is close to it.
- **Preview deployments** (the `*.vercel.app` address of a branch) run the same API against the same database, with Vercel's login in front. Treat them as production data.
