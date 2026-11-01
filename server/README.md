# LLX API

Node 20+ / Express 5 / PostgreSQL (your EC2 instance). Auth, catalogue, bag, wishlist, orders, newsletter and
a small admin surface for the LLX storefront in the parent folder.

## 1. Point it at your EC2 Postgres

Everything is configured in **`server/.env`** (already created for you; template in `.env.example`).
Fill in the `# ── EC2 PostgreSQL instance` block:

```ini
DB_HOST=10.0.1.23            # EC2 private IP / private DNS (preferred) or public DNS
DB_PORT=5432
DB_NAME=llx
DB_USER=llx_app
DB_PASSWORD=...
DB_SSL_MODE=verify-full      # disable | require | verify-full
DB_SSL_CA_PATH=C:/certs/llx-pg-ca.pem
```

`JWT_ACCESS_SECRET` and `PASSWORD_PEPPER` were generated for you in `.env`. Generate new ones with `npm run gen:secret`.
Back up the pepper: if it is lost, every user password stops working.

Then:

```bash
cd server
npm install
npm run db:check      # connects to EC2, prints role + whether TLS is on
npm run db:migrate    # creates the schema
npm run db:seed       # loads the 22 products from src/lib/catalog.ts
npm run dev           # http://localhost:4000
```

Create the first admin (the password is read from the environment of that one command, not from a file):

```bash
# bash
ADMIN_EMAIL=you@example.com ADMIN_USERNAME=your_username ADMIN_PASSWORD='a-long-passphrase' npm run admin:create   # ADMIN_USERNAME is optional
```
```powershell
# PowerShell
$env:ADMIN_EMAIL='you@example.com'; $env:ADMIN_USERNAME='your_username'; $env:ADMIN_PASSWORD='a-long-passphrase'; npm run admin:create; Remove-Item Env:ADMIN_PASSWORD
```

### Preparing Postgres on the EC2 box (one-time)

1. **Least-privilege role.** The API needs ordinary DML/DDL on one database, not a superuser:
   ```sql
   CREATE ROLE llx_app LOGIN PASSWORD '...';
   CREATE DATABASE llx OWNER llx_app;
   ```
   (`gen_random_uuid()` is built in from Postgres 13; no extensions are required.)
2. **TLS.** In `postgresql.conf` set `ssl = on` with a certificate/key, and in `pg_hba.conf` use `hostssl llx llx_app <api-ip>/32 scram-sha-256` (not `host … trust`). Copy the CA certificate (or the self-signed certificate itself) to the API host and set `DB_SSL_CA_PATH`.
   With a self-signed certificate whose CN/SAN is not the host you connect to, set `DB_SSL_SERVERNAME` to the certificate name.
3. **Network.** `listen_addresses` must include the interface the API reaches. In the EC2 security group allow TCP 5432 **only from the API server's security group / IP** — never `0.0.0.0/0`. Prefer the private IP inside one VPC.
4. Use `password_encryption = scram-sha-256` (the default on Postgres 14+).

## 2. API overview

All routes are under `/api`. Errors are `{ "error": { "code", "message", "details?" }, "requestId" }`.
Money is whole INR rupees. A product's `images` entries are either **keys** of the frontend's `images` map (`handbag`, `hero`, … — the 22 starter products) or **paths under `/media/`** (the photographed products, see "Inventory and product photos"). `thumbs` holds the small version of each.

| Area | Endpoints |
| --- | --- |
| Health | `GET /health`, `GET /health/ready` (checks DB) |
| Auth | `POST /auth/register` · `/auth/login` (body `identifier` = email **or username**, plus `password`) · `/auth/refresh` · `/auth/logout` · `/auth/logout-all` · `/auth/change-password`, `GET /auth/me` |
| Branding (public) | `GET /branding` (store name, subtitle, logo URL), `GET /branding/logo` (the image) |
| Catalogue | `GET /products` (`q,type,colour,min,max,inStock,sort,limit,offset`), `GET /products/:slug`, `GET /collections`, `GET /collections/:slug` (same filters) |
| Bag (auth) | `GET /cart`, `POST /cart/items`, `PATCH /cart/items/:id`, `DELETE /cart/items/:id`, `DELETE /cart`, `POST /cart/merge` (guest → account) |
| Wishlist (auth) | `GET /wishlist`, `PUT /wishlist/:slug`, `DELETE /wishlist/:slug`, `POST /wishlist/merge` |
| Orders (auth) | `POST /orders` (from the server-side bag; optional `Idempotency-Key` header), `GET /orders`, `GET /orders/:id`, `POST /orders/:id/cancel` |
| Photos | `GET /media/products/<slug>/<n>-<hash>.webp` (and `…-sm.webp`): public, immutable, served from `MEDIA_DIR` |
| Admin | `GET /admin/orders`, `PATCH /admin/orders/:id` (status / paymentStatus), `PATCH /admin/products/:slug` (stock, price, active) |
| Admin inventory | `GET /admin/inventory` (`q,type,gender,status,sort,limit,offset`; also returns totals and category counts) · `GET /admin/inventory/:slug` (product + last 50 stock movements) · `PATCH /admin/inventory/:slug` (price, cost, details, visibility, review flag) · `POST /admin/inventory/:slug/stock` (`mode: add|set`, `qty`, `reason`, `note`) · `GET /admin/media-library` · `POST /admin/inventory/:slug/images` · `DELETE /admin/inventory/:slug/images/:index` · `POST /admin/inventory/:slug/images/:index/cover` |
| Admin console | `GET /admin/roles` · `GET/PUT /admin/branding`, `PUT/DELETE /admin/branding/logo` (raw PNG/JPEG/WebP, 1 MB) · `GET/POST /admin/offers`, `GET/PUT/PATCH/DELETE /admin/offers/:id` · `GET/PUT /admin/loyalty`, `POST /admin/loyalty/tiers`, `PUT/DELETE /admin/loyalty/tiers/:id` · `GET/PUT /admin/discounts` |
| Other | `POST /newsletter`, `GET /delivery/estimate?pincode=`, `GET /store-status` (`{ "ordersOpen": true|false }`; the storefront follows it) |

### How the storefront uses it

The storefront (`src/lib/api.ts`, `src/lib/store.tsx`) is wired to this API:

- **Accounts:** the header's user icon opens a sign-in / create-account drawer. Auth uses **httpOnly cookies** (no tokens in JavaScript); every request is sent with `credentials: "include"`, and an expired 15-minute access token is renewed silently once via `/auth/refresh`.
- **Bag and wishlist:** guests keep them in `localStorage` as before. On sign-in or sign-up the guest items are merged into the account (`/cart/merge`, `/wishlist/merge`) and the local copy is cleared; signed-in shoppers read and write the server copy, so it follows them across devices.
- **Newsletter and pincode check** call `POST /newsletter` and `GET /delivery/estimate`.
- **Checkout** (`/checkout`) collects a delivery address and calls `POST /orders` with a fresh `Idempotency-Key`; the bag drawer's Checkout button and product pages' Buy now lead there (guests are asked to sign in first and then continue to checkout). The order summary shows the server's own subtotal, shipping and total. `/orders` lists past orders and lets a shopper cancel until it ships. No payment is collected yet.
- **Catalogue:** the home page, collections, product pages, search and the bag/wishlist read the product list from `GET /products` (`src/lib/catalog-live.ts`). Prices, stock status, visibility, descriptions and photos therefore come from the database (the starter products keep their bundled images, stored as keys such as `handbag`, `hero`; photographed products use `/media/` paths served by this API). Filtering, sorting and search run in the browser over that list. The list is cached for 30 s (the API's `Cache-Control` plus the app's query cache), so an edit can take up to about a minute to show. If the API isn't configured or can't be reached, the site falls back to the built-in `src/lib/catalog.ts`.
- **Managing products:** `npm run db:seed` upserts the 22 starter products and **resets their name, price and details to the seed values** (it never touches stock). Run it once; afterwards use the **Inventory** tab of the admin console (below) or SQL. A product inserted into `products` appears on the site automatically; its `images` must be keys from the frontend's `images` map (`src/lib/catalog.ts`) or `/media/…` paths, otherwise it shows the hero image.

To connect it:

1. **API base URL.** Local dev needs nothing (defaults to `http://localhost:4000`). A production build with `VITE_API_URL` unset uses `https://api.leatherluxindia.com` (the default in `src/lib/api.ts`); set `VITE_API_URL` to use another API, or to an **empty** value for a build with no server (guest mode). To put the API on that address, follow `deploy/README.md`.
2. **CORS.** Add the frontend's exact origin to `CORS_ORIGINS` in `server/.env`. Vite moves to the next free port if 8080 is busy, so add that port too (e.g. `http://localhost:8081`).
3. **Cookies.** Same *site* (`shop.example.com` + `api.example.com`): keep `COOKIE_SAMESITE=lax` and set `COOKIE_DOMAIN=.example.com`. Different sites (e.g. `*.lovable.app` + your own API domain): set `COOKIE_SAMESITE=none`, which requires HTTPS on both.

## 3. Security model

| Concern | What is done |
| --- | --- |
| Passwords | scrypt (N=2¹⁵), per-user salt, **HMAC-peppered** with a server secret; constant-time compare; min 10 chars + common-password block; unknown-email logins burn equal CPU |
| Sessions | 15-min JWT (HS256, `iss`/`aud`/`alg` pinned) in an httpOnly cookie + 256-bit opaque refresh token (only its SHA-256 is stored), **rotated on every use**; replay of a rotated token revokes the whole family; the user row is re-read per request so password change / `logout-all` / role change apply instantly |
| Brute force | per-IP rate limits (global + strict on `/auth`), account soft-lock after 10 failures (15 min), identical error for unknown user / bad password / locked |
| CSRF | strict CORS allow-list, `Origin` must be allow-listed on every write and is **required** whenever auth cookies are present, SameSite cookies, JSON-only bodies |
| Injection | every query parameterised; inputs validated with zod (unknown keys stripped); search wildcards escaped; sort keys are an enum |
| Pricing integrity | prices, totals and shipping are computed from the DB at checkout — the client sends none; stock decremented atomically (`stock_qty >= n` guard) so orders can't oversell; idempotency keys stop double-submits |
| Authorisation | every cart/wishlist/order query is scoped by `user_id`; admin routes check the role from the DB, not the token |
| Transport/headers | helmet (CSP `default-src 'none'`, HSTS, nosniff, no-referrer), `Cache-Control: no-store` on API data, no `X-Powered-By`, 20 KB body cap, request/headers timeouts |
| Database | TLS enforced (`disable` is refused in production), statement/idle-in-transaction timeouts, pool limits, advisory-locked migrations, `CHECK` constraints on money/qty/status |
| Config | env validated at boot with fail-fast, readable errors; production refuses `http://` origins, placeholder DB password, identical secrets |
| Logging | structured JSON (pino), cookies/auth headers/passwords redacted, query strings dropped, request id on every response, security events in `audit_log` |
| Errors | no stack traces or SQL in responses; Postgres errors are mapped to generic 4xx/5xx |

### Roles, usernames and the admin console

- **Roles** live in a `roles` table (`admin`, `user`); `users.role` references it, so an account can only hold a role that exists. Shoppers register as `user`. There is no endpoint to make someone an admin: use `npm run admin:create` (or SQL).
- **Usernames** are optional, lowercase (`a-z 0-9 _`, 3-32 chars) and unique. Admins sign in with a username or their email; shoppers keep using email.
- **Admin console** (`/admin` in the storefront, admin accounts only) manages: **branding** (store name, subtitle and logo, shown in the header, footer, page titles and favicon), **offers** (automatic offers and coupon codes: percentage, fixed amount or free shipping; scope, minimum order, dates, usage limits, priority), **loyalty** (earn and redeem rates, expiry, sign-up bonus, spend tiers) and **discount rules** (best-discount-only vs. stacking, a maximum total discount, and which kinds of discount may combine).
- **Offers, loyalty and discount rules are configuration only for now.** They are stored and editable, but checkout does not apply them to orders yet.
- **Logo upload** accepts PNG, JPEG and WebP only (checked by the file's real bytes, not just its type), up to 1 MB. SVG is refused because it can carry scripts. The image is stored in the database and served with a versioned URL.

### Adding admins by hand

Admin accounts can't be created from the website (registration always makes a shopper, and the admin console shows only "Sign in"). To add one:

```bash
cd server
npm run admin:add -- jane@example.com                          # email only
npm run admin:add -- jane@example.com jane_admin "Jane Doe"    # email, username, name
npm run admin:add -- jane@example.com jane_admin "Jane Doe" --print-sql   # print the INSERT instead of running it
npm run admin:add -- sam@example.com sam_admin --promote       # turn an existing shopper into an admin
```

The new admin gets the default password **`Admin@2026`** and `must_change_password = true`: they can sign in, but every admin endpoint answers `403 password_change_required` (and the console shows a "choose a new password" screen) until they set their own (10+ characters, different from the default). Existing accounts are never touched unless you pass `--promote`. `--print-sql` prints a complete `INSERT` (with the hash already computed) that you can paste into `psql`. To set a specific password instead, use `npm run admin:create`.

### Logs

The API writes a new pair of files every day into `server/logs/`, named by date:

```
logs/app-2026-11-01.log     everything: requests, warnings, errors
logs/error-2026-11-01.log   errors only (level error and above), for quick triage
```

Lines are JSON with a local timestamp (`"time":"2026-11-01T16:45:26.732+05:30"`); cookies, tokens and passwords are redacted. A day starts at midnight in `LOG_TIMEZONE` (default `Asia/Kolkata`), files older than `LOG_RETENTION_DAYS` (default 30; `0` keeps everything) are deleted automatically, and `LOG_DIR` / `LOG_TO_FILES` are in `.env`. Logs also still go to the console. Follow one live with `Get-Content logs\error-2026-11-01.log -Wait -Tail 20` (PowerShell). Browser-side errors are not collected.

### Caching

Public pages are served from memory instead of Postgres, in three layers:

1. **API memory cache** (`src/lib/caches.ts`). The catalogue (lists, filters, collections, product pages), the store name and logo, the visitor total and "who is signed in" are each loaded from the database once and then answered from memory for `CACHE_TTL_SECONDS` (60). Many visitors arriving at once share a single load, and for `CACHE_STALE_SECONDS` (300) after expiry an old copy is still served instantly while a fresh one loads in the background (if that refresh fails, the old copy keeps being served). Signed-in lookups are held only `AUTH_CACHE_SECONDS` (5).
2. **HTTP caching.** Cached responses carry an `ETag`, so a browser or CDN that already has the current version gets an empty `304` without any database work; catalogue responses also allow reuse for 30 s (`max-age=30, stale-while-revalidate=120`). The store name is revalidated on every load, but answered from memory.
3. **Storefront server rendering** remembers the catalogue for 30 s (`src/lib/ttl-memo.ts`), so a burst of page views makes one API request.

**What clears the cache.** Every write that changes cached data clears it immediately: editing a product (price, stock, visibility), placing or cancelling an order (stock), changing the store name or logo, a new visitor, changing a password and "sign out everywhere" (so other devices are turned away on their very next request). Never cached: the bag, wishlist, orders, checkout and everything in the admin console.

**Changes made outside the API** (psql, a seed run, `admin:add --promote`) show up when the time-to-live runs out, or straight away after `POST /api/admin/cache/purge`. A role changed directly in the database therefore applies within `AUTH_CACHE_SECONDS`.

`GET /api/admin/cache` (admin only) reports each cache's entries, hits, misses and hit rate, plus the number of database queries made since start. Set `CACHE_ENABLED=false` to turn everything off.

The cache lives in one process. Behind several API instances each keeps its own copy, so a change can take up to the time-to-live to reach the other instances; a shared cache (e.g. Redis) would be the next step.

### Inventory and product photos

**What is in the database.** `products` now carries `sku`, `description`, `tags`, `images` + `image_labels` (what each photo shows), `cost_inr`, `reorder_level`, `needs_review` and `source_folder`. Two new tables: `inventory_movements` (a ledger: every change to a stock count, with the reason, who and — for sales and cancellations — the order; the first entry of an imported product is its `opening_stock`) and `media_assets` (every photo from the shoot and what became of it: `used`, `spare` for photos not on a product yet, `rejected` for unusable frames, `duplicate`).

**Importing the photographed range.** The result of going through the DSLR folder (76 products, 386 distinct photos) is stored in `server/data/catalogue/products.json` and `media.json`:

```bash
cd server
npm run products:import -- --dry-run     # checks the data and that every photo file exists; changes nothing
npm run products:import                  # optimises the photos, then adds the products, opening stock and photo records
```

Each photo becomes a 4:5 WebP on a white canvas (1200×1500, plus a 480×600 `-sm` version for cards) under `MEDIA_DIR` (`server/media/`, git-ignored). The source folder is `PRODUCT_PHOTOS_DIR` (default `D:\Leather Lux India\DSLR Images\New Products`). Running it again is safe: **existing products keep their price, stock and visibility** (only the photos and style number are refreshed); `--overwrite-details` also resets names, copy, tags and colours from the file, `--force-images` re-makes every image, `--skip-images` only writes database rows, `--prune` deletes image files nothing refers to any more. A photo in `products.json` can carry `crop`, `erase` (rectangles to whiten) and `clean` (whiten the pale lavender film the photographer's cut-out left in strap loops, belt buckles and key-ring eyes; the number is a brightness limit, 170 normally). Never use `clean` on wallets or card cases, whose white card inserts are real. File names include a tag for these edits, so a changed edit gets a new URL and browsers don't show the old picture. Every imported product starts with `needs_review = true`: the prices are proposals, the stock counts are placeholders, and `dimensions` and `cost_inr` are empty until measured.

**The media folder is part of the deployment.** The database stores paths such as `/media/products/<slug>/3050-b4471712ad.webp`, and the API serves them from `MEDIA_DIR`, so whichever machine runs the API needs that folder (copy `server/media/` there, or run `products:import` on it). File names contain a hash of the source photo, so they never change and browsers keep them for a year.

**Changing prices, stock and details.** Use **Admin console → Inventory**: edit price and cost right in the table (margin is worked out for you), and open a product to change its details, adjust stock (received, customer return, damaged, correction, or set to a physical count — each is logged) and manage its photos (make one the cover, remove one, add a spare photo from the shoot). "Reviewed" clears a product's review flag. Or use SQL:

```sql
UPDATE products SET price_inr = 2490, needs_review = false WHERE sku = 'LLI-WAL-001';
UPDATE products SET cost_inr = 900 WHERE type = 'Wallets';
UPDATE products SET active = false WHERE sku LIKE 'LLI-SMP-%';        -- hide the 22 starter products
```

A stock count changed with plain SQL is not on the ledger; use the console (or add an `inventory_movements` row yourself) when the history matters. After any SQL change, `POST /api/admin/cache/purge` (or wait up to a minute) makes it show on the site.

### Visitor counter

The footer shows total unique visitors (`GET/POST /visits`). Each browser makes up a random id and keeps it in its own `localStorage`; the server stores only an HMAC of it (no IP, no user agent), skips crawlers and honours Do Not Track / Global Privacy Control. It is a simple counter, not analytics: clearing site data counts as a new visitor.

### Before launch: orders closed

`ORDERS_OPEN=false` in `server/.env` puts the shop in pre-launch mode. Shoppers can browse, search, wishlist and fill a bag (it is saved), but `POST /orders` answers `403 orders_closed`: a shopper calling the API directly is refused too, not just the checkout button. `GET /store-status` reports it, and the storefront follows it: the bag drawer shows a note instead of Checkout, the product page drops "Buy now", and `/checkout` shows "The house opens by Christmas". The default is `true`, so nothing is closed unless you say so; `deploy/env.production.example` ships with `false`.

**Launch day:** set `ORDERS_OPEN=true` and restart the API (`sudo systemctl restart llx-api` on the server). Checkout opens within about 30 seconds (the status is cached that long). Then set `enabled: false` in the storefront's `src/lib/launch.ts` and publish, which removes the "Opening this Christmas" bar message and the home-page band.

### Known limits / next steps

- **Payments are not implemented** — the footer says the payment partner is still to be confirmed. `POST /orders` creates an `unpaid` `pending` order and reserves stock; when you pick a gateway, add its webhook to move `paymentStatus` to `paid`.
- **No email** (verification, password reset, order confirmation, newsletter double opt-in) — needs an SMTP/SES provider decision.
- Rate-limit counters are in memory (correct for one API process). Run several instances → switch to a shared store.
- Registration reveals whether an email is taken (409). Closing that needs email verification.
- Use HTTPS in front of the API (nginx / ALB / CloudFront). Set `TRUST_PROXY=1` behind a single proxy so client IPs are real.

## 4. Production

```bash
npm ci
npm run build
NODE_ENV=production        # plus all other vars from .env, ideally from SSM / Secrets Manager / systemd EnvironmentFile
npm run db:migrate:prod && npm start
```

Run it under systemd or pm2 as an unprivileged user; `SIGTERM` drains connections gracefully. In production
`COOKIE_SECURE` is forced on, and `CORS_ORIGINS` must be `https://` origins.

**The API runs inside the storefront's Vercel deployment, on the same domain (`/api/...`): the whole procedure is in [`deploy/VERCEL.md`](deploy/VERCEL.md).** If you would rather run it on a server of your own, **the procedure for `https://api.leatherluxindia.com` is in [`deploy/README.md`](deploy/README.md)**: DNS and firewall, installing Node and nginx, copying the code and `media/`, the production settings template (`deploy/env.production.example`), the systemd unit (`deploy/llx-api.service`) and the nginx site with a free HTTPS certificate (`deploy/nginx-api.conf`), plus how to update later.

## 5. Tests

```bash
npm test
```

Starts a throw-away embedded PostgreSQL (no install, no EC2 needed, never reads `.env`) and runs 149 tests:
config guards, hashing/JWT forgery, CORS/CSRF, auth rotation & reuse detection, lockout, catalogue filters & SQL-injection
attempts, cart/wishlist isolation, order pricing, idempotency, oversell race, cancellation restock, the admin state machine,
the inventory API (prices, stock ledger, photo gallery), `/media` serving, the photo clean-up, a consistency check of the catalogue data files and a check that the production settings template in `deploy/` is a valid configuration.

The test database uses port 54329. If something else on your machine already holds it, the run stops at start-up with "No test files found"; set `TEST_DB_PORT` to a free port (`$env:TEST_DB_PORT = "54331"; npm test` in PowerShell).
