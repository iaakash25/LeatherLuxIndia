# Putting the API on https://api.leatherluxindia.com

The storefront (on Vercel) is published on `leatherluxindia.com`; this folder is for the **API**, which runs on your EC2 server next to Postgres.
Until it is live, a published storefront falls back to its built-in sample catalogue and a guest bag.
The API's `CORS_ORIGINS` allows both domains and their www hosts (`leatherluxindia.com` and `leatherluxindia.in`), so the storefront can be served on either without
redirecting one to the other in Vercel. It must list the exact address visitors see in the browser: add any other domain you serve the shop on.

**What works on each domain.** Browsing, search, the wishlist and a guest bag work on both. Signing in works on `leatherluxindia.com`, which is the same *site* as
`api.leatherluxindia.com`. On `leatherluxindia.in` the browser treats the API as another site and drops `SameSite=lax` sign-in cookies, so a sign-in there appears to succeed
but does not stay. Setting `COOKIE_SAMESITE=none` in the API's `.env` lets it work on `.in` too, though Safari and some privacy settings still block those cookies. If sign-in must work
everywhere, make `.com` the primary domain in Vercel and use its *Redirect to* option on the `.in` domain instead.

| File | What it is |
| --- | --- |
| `env.production.example` | the production `.env`, with placeholders only |
| `llx-api.service` | systemd unit: starts the API at boot, restarts it if it stops, and runs it with as few rights as possible |
| `nginx-api.conf` | nginx site: the HTTPS front door, with a request limit and short timeouts |
| `backup-db.sh` | nightly database backup (keeps 14 days) |
| `check-security.sh` | checks the live deployment from outside: HTTPS, security headers, CORS, certificate |

Commands below are for **Ubuntu** (your Postgres reports Ubuntu 20.04). `<EC2-IP>` is the server's public IP, `<key.pem>` your SSH key.
The code lives in `/opt/llx/app` (a clone of the GitHub repository, owned by you, the deploying user). The API runs as a separate, unprivileged user, `llx`, that can **read** it but write only to `logs/`.

## 1. Before you start

1. **Elastic IP.** In the AWS console, give the EC2 instance an Elastic IP, so its address never changes. Use that IP below.
2. **DNS.** At the DNS host for `leatherluxindia.com` add an **A record**: name `api`, value `<EC2-IP>`. (This is separate from the `@` and `www` records that point at Vercel.)
3. **Security group.** Inbound: 22 from your own IP only; 80 and 443 from anywhere. Once the API runs on this server, close 5432 to the world: the API connects over localhost, and your computer can keep a rule for your own IP if you want to run `db:check` or imports from it.

## 2. Install the software (once, on the server)

```bash
ssh -i <key.pem> ubuntu@<EC2-IP>
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs   # Node 20 LTS (the API needs 20.11+)
sudo useradd --system --create-home --shell /usr/sbin/nologin llx
sudo mkdir -p /opt/llx && sudo chown ubuntu:ubuntu /opt/llx
```

## 3. Get the code and build it

The repository is public, so no login is needed. Pulling from it (rather than copying files from Windows) keeps Linux line endings and makes every update the same command.

```bash
cd /opt/llx && git clone https://github.com/iaakash25/LeatherLuxIndia.git app
cd app/server && npm ci && npm run build && npm prune --omit=dev
mkdir -p logs && sudo chown llx:llx logs
```

The product photos are not in git. Send them from your Windows PC (PowerShell), then unpack them on the server:

```powershell
cd "C:\Users\Aakash Srivastava\Downloads\LLI"
tar -czf llx-media.tgz -C server media
scp -i <key.pem> llx-media.tgz ubuntu@<EC2-IP>:/tmp/
```

```bash
tar -xzf /tmp/llx-media.tgz -C /opt/llx/app/server && rm /tmp/llx-media.tgz
```

## 4. Settings

```bash
cd /opt/llx/app/server && cp deploy/env.production.example .env && nano .env
sudo chgrp llx .env && chmod 640 .env        # only you and the API's own user can read it
```

Fill in every `REPLACE_ME`:

- `DB_PASSWORD`, `JWT_ACCESS_SECRET` and `PASSWORD_PEPPER`: take them from the `server/.env` on your PC. **Use the same pepper**: every stored password (including your admin's) depends on it, and with a new one nobody can sign in.
- Leave `CORS_ORIGINS` (both domains and their www hosts) and `COOKIE_DOMAIN=.leatherluxindia.com` as they are. Production refuses an `http://` origin and a placeholder password, and says so when it starts.

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

Certbot adds the certificate and the redirect from http to https, and renews it by itself (`sudo certbot renew --dry-run` proves that works).

## 7. Check it from outside

From any computer with `curl` and `openssl` (Git Bash on Windows is fine), in a clone of the repository:

```bash
bash server/deploy/check-security.sh
```

It checks the storefront on all four addresses and the API: HTTPS everywhere, http redirecting to https, the security headers, that only your own domains are allowed by CORS, that the API shows no version information, and that the certificates have at least 14 days left. Every line says PASS or FAIL, and the exit status is 0 only if all passed. Run it after every deploy.

Then open `https://leatherluxindia.com`: it should show the photographed products, and sign-in, the bag and the admin Inventory page should work.

## 8. Harden the server

The AWS security group is the main firewall. These add a second layer and keep the machine patched. Do them once, after the API works.

```bash
# a host firewall (keep your current SSH session open while you enable it, in case you mistype a rule)
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw default deny incoming && sudo ufw enable
# lock out addresses that keep guessing SSH logins
sudo apt install -y fail2ban && sudo systemctl enable --now fail2ban
# install security updates automatically
sudo apt install -y unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades
```

- **SSH by key only.** AWS images already do this; confirm `PasswordAuthentication no` in `/etc/ssh/sshd_config`.
- **Postgres** should accept connections only from this server and from your own IP (`listen_addresses` and `pg_hba.conf`, and the security group's rule for 5432). Never open 5432 to `0.0.0.0/0`.
- **Secrets stay on the server.** The `.env` is not in git and is readable only by you and the `llx` user. If the database password ever leaks, change it in Postgres and in `.env`, then `sudo systemctl restart llx-api`. Changing `JWT_ACCESS_SECRET` signs every shopper out (harmless); `PASSWORD_PEPPER` cannot be changed without resetting everyone's password.

## 9. Backups

The data is in Postgres, so back it up every night, and keep a copy somewhere other than this server.

```bash
cd /opt/llx/app/server
sudo cp deploy/backup-db.sh /usr/local/bin/llx-backup && sudo chmod 750 /usr/local/bin/llx-backup
sudo /usr/local/bin/llx-backup                          # try it once: it prints the file it wrote
sudo crontab -e                                         # then add this line (2 a.m. every night):
#   0 2 * * * /usr/local/bin/llx-backup >> /var/log/llx-backup.log 2>&1
```

Dumps go to `/var/backups/llx` (readable by root only) and the last 14 days are kept. **A backup you have never restored is a hope, not a backup**: once, restore one into a scratch database and look at it:

```bash
sudo -u postgres createdb llx_restore_test
sudo -u postgres pg_restore --no-owner -d llx_restore_test /var/backups/llx/llx-<date>.dump
sudo -u postgres psql llx_restore_test -c "select count(*) from products"
sudo -u postgres dropdb llx_restore_test
```

Also copy `/var/backups/llx` off the server regularly (an S3 bucket, or another machine). `media/` is rebuilt from your original photos with `products:import`.

## Launch day

The template ships with `ORDERS_OPEN=false`: until then shoppers can browse and fill a bag, but orders are refused by the API itself. To open the shop:

1. On the server, set `ORDERS_OPEN=true` in `/opt/llx/app/server/.env` and `sudo systemctl restart llx-api`.
2. Check `curl -s https://api.leatherluxindia.com/api/store-status` answers `{"ordersOpen":true}`. The storefront picks it up within about 30 seconds.
3. In the storefront set `enabled: false` in `src/lib/launch.ts` and push to GitHub (Vercel publishes it), to remove the "Opening this Christmas" message and the home-page band.

## Updating later

- **Code:** on the server run
  ```bash
  cd /opt/llx/app && git pull --ff-only
  cd server && npm ci && npm run build && npm prune --omit=dev
  sudo -u llx npm run db:migrate:prod && sudo systemctl restart llx-api
  ```
  Your `.env`, `logs/` and `media/` are not in git, so they are not touched. Then run `check-security.sh`.
- **New or changed product photos:** the originals live on your PC, so run `npm run products:import` there (it updates the database), then send the new files as in step 3. Send the files first and import second, so no product points at a photo that is not there yet.
- **Logs:** `/opt/llx/app/server/logs/app-YYYY-MM-DD.log` and `error-…`, or `journalctl -u llx-api`.
