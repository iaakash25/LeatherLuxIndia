# Putting the API on https://api.leatherluxindia.com

The storefront (on Vercel) is published on `leatherluxindia.com`; this folder is for the **API**, which runs on your EC2 server next to Postgres.
Until it is live, a published storefront falls back to its built-in sample catalogue and a guest bag.
The API's `CORS_ORIGINS` must be the exact address visitors see in the browser: `https://leatherluxindia.com` if that is your primary domain on Vercel,
`https://www.leatherluxindia.com` if you make www primary instead. (`COOKIE_DOMAIN=.leatherluxindia.com` works for both.)

| File | What it is |
| --- | --- |
| `env.production.example` | the production `.env`, with placeholders only |
| `llx-api.service` | systemd unit: starts the API at boot and restarts it if it stops |
| `nginx-api.conf` | nginx site: HTTPS front door that forwards to the API |

Commands below are for **Ubuntu** (your Postgres reports Ubuntu 20.04). `<EC2-IP>` is the server's public IP, `<key.pem>` your SSH key.

## 1. Before you start

1. **Elastic IP.** In the AWS console, give the EC2 instance an Elastic IP, so its address never changes. Use that IP below.
2. **DNS.** At the DNS host for `leatherluxindia.com` add an **A record**: name `api`, value `<EC2-IP>`. (This is separate from the `@` and `www` records that point at Vercel.)
3. **Security group.** Inbound: 22 from your own IP only; 80 and 443 from anywhere. Once the API runs on this server, close 5432 to the world: the API connects over localhost, and your computer can keep a rule for your own IP if you want to run `db:check` or imports from it.

## 2. Install the software (once, on the server)

```bash
ssh -i <key.pem> ubuntu@<EC2-IP>
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs   # Node 20 LTS (the API needs 20.11+)
sudo useradd --system --create-home --shell /usr/sbin/nologin llx
sudo mkdir -p /opt/llx && sudo chown ubuntu:ubuntu /opt/llx
```

## 3. Copy the code and the photos (from your Windows PC, PowerShell)

Do not copy `node_modules` (the image library has a different build for Linux) or your `.env`.

```powershell
cd "C:\Users\Aakash Srivastava\Downloads\LLI"
tar --exclude=server/node_modules --exclude=server/dist --exclude=server/logs --exclude=server/.env --exclude=server/media --exclude=server/test -czf llx-server.tgz server
tar -czf llx-media.tgz -C server media
scp -i <key.pem> llx-server.tgz llx-media.tgz ubuntu@<EC2-IP>:/tmp/
```

On the server:

```bash
cd /opt/llx && tar -xzf /tmp/llx-server.tgz && tar -xzf /tmp/llx-media.tgz -C /opt/llx/server
cd /opt/llx/server && npm ci && npm run build && npm prune --omit=dev
mkdir -p logs && sudo chown -R llx:llx /opt/llx
```

## 4. Settings

```bash
cd /opt/llx/server && cp deploy/env.production.example .env && nano .env && chmod 600 .env
```

Fill in every `REPLACE_ME`:

- `DB_PASSWORD`, `JWT_ACCESS_SECRET` and `PASSWORD_PEPPER`: take them from the `server/.env` on your PC. **Use the same pepper**: every stored password (including your admin's) depends on it, and with a new one nobody can sign in.
- Leave `CORS_ORIGINS=https://leatherluxindia.com` and `COOKIE_DOMAIN=.leatherluxindia.com` as they are, unless your primary domain is different. Production refuses an `http://` origin and a placeholder password, and says so when it starts.

The database already has all migrations. This confirms it (it should apply 0):

```bash
sudo -u llx npm run db:migrate:prod
```

## 5. Start it

```bash
sudo cp deploy/llx-api.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now llx-api
sudo systemctl status llx-api --no-pager
curl -s http://127.0.0.1:4000/api/health/ready        # {"status":"ready"...}
journalctl -u llx-api -n 50 --no-pager                # if it did not start, the reason is here
```

## 6. HTTPS

Wait until the DNS record from step 1 resolves (`nslookup api.leatherluxindia.com`), then:

```bash
sudo cp deploy/nginx-api.conf /etc/nginx/sites-available/llx-api
sudo ln -s /etc/nginx/sites-available/llx-api /etc/nginx/sites-enabled/llx-api
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.leatherluxindia.com
```

Certbot adds the certificate and the redirect from http to https, and renews it by itself.

## 7. Check it from outside

```bash
curl -s https://api.leatherluxindia.com/api/health/ready
curl -s "https://api.leatherluxindia.com/api/products?limit=1" | head -c 300
curl -s -o /dev/null -w "%{http_code}\n" https://api.leatherluxindia.com/media/products/maren-satchel-tan/<any file from the API output>
# CORS: the shop's origin is accepted, another one is not
curl -s -i -H "Origin: https://leatherluxindia.com" https://api.leatherluxindia.com/api/branding | grep -i access-control-allow-origin
curl -s -i -H "Origin: https://example.com"         https://api.leatherluxindia.com/api/branding | grep -ci access-control-allow-origin
```

Then open `https://leatherluxindia.com`: it should show the photographed products, and sign-in, the bag and the admin Inventory page should work.

## Launch day

The template ships with `ORDERS_OPEN=false`: until then shoppers can browse and fill a bag, but orders are refused by the API itself. To open the shop:

1. On the server, set `ORDERS_OPEN=true` in `/opt/llx/server/.env` and `sudo systemctl restart llx-api`.
2. Check `curl -s https://api.leatherluxindia.com/api/store-status` answers `{"ordersOpen":true}`. The storefront picks it up within about 30 seconds.
3. In the storefront set `enabled: false` in `src/lib/launch.ts` and publish, to remove the "Opening this Christmas" message and the home-page band.

## Updating later

- **Code:** repeat the first `tar`/`scp` of step 3, then on the server `cd /opt/llx && tar -xzf /tmp/llx-server.tgz && cd server && npm ci && npm run build && npm prune --omit=dev && sudo chown -R llx:llx /opt/llx && sudo -u llx npm run db:migrate:prod && sudo systemctl restart llx-api`. Your `.env`, `logs/` and `media/` are not in the archive, so they are not touched.
- **New or changed product photos:** the originals live on your PC, so run `npm run products:import` there (it updates the database), then copy the new files: `scp -r` the `server/media` contents (or re-send `llx-media.tgz` and extract it). Copy the files first, then import, so no product points at a photo that is not there yet.
- **Logs:** `/opt/llx/server/logs/app-YYYY-MM-DD.log` and `error-…`, or `journalctl -u llx-api`.
- **Backups:** the data is in Postgres; take regular `pg_dump` backups (or EBS snapshots). `media/` can be rebuilt from your original photos with `products:import`.
