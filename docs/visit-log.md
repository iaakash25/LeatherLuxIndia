# The visit log

Every page a visitor opens is written to the `visit_log` table in the shop's database: **who** (their IP address), **what** (the page), and
**when** (date and time). Table created by `server/src/db/migrations/009_visit_log.sql`.

## What is stored

| Column | What | Example |
| --- | --- | --- |
| `id` | running number of the entry | `18342` |
| `visited_at` | date and time, to the millisecond, with time zone (shown in Indian time in the queries below) | `2026-11-03 21:14:07+05:30` |
| `ip` | the visitor's IP address (IPv4 or IPv6), as the real address of the connection, not one the visitor can make up | `203.0.113.7` |
| `path` | the page, without the query string | `/products/aria-top-handle` |
| `referrer` | the site they came from (its address only, never the page or the search words), on the first page of a visit | `https://www.google.com` |
| `user_agent` | the browser and device | `Mozilla/5.0 (iPhone; …) Safari/…` |
| `is_bot` | `true` for crawlers (Google, Bing…), monitors and anything without a browser name, so you can leave them out | `false` |

Not stored: cookies or ids, names, emails, anything typed in a form, search words, or what is in a bag. A signed-in shopper is not linked to
their entries. The admin console's own pages are not logged.

## How it fills

The storefront reports each page it shows (the first page of a visit and every page the visitor moves on to) to `POST /api/visits/log`; the server
adds the IP address and the time and writes one row. The same page opened twice is two rows. One address can log at most 3,000 views an hour (a
guard against a script filling the table). Entries older than **365 days** are deleted automatically; change that with `VISIT_LOG_RETENTION_DAYS`
(`0` keeps everything for ever).

What it cannot see: visitors whose browser blocks the site's scripts, or an ad blocker that stops the report. Those pages are only in Vercel's own
request logs (Vercel → project → Logs), which are kept for a short time. The footer's "Total visitors" number is a separate counter (`site_counters`)
that goes up by one on every page load or refresh.

## Reading it

Connect to the database as you do for backups (`psql`) and run, for example:

```sql
-- the latest 50 page views (Indian time)
SELECT visited_at AT TIME ZONE 'Asia/Kolkata' AS time_ist, ip, path, is_bot
  FROM visit_log ORDER BY visited_at DESC LIMIT 50;

-- everything one address looked at, in order
SELECT visited_at AT TIME ZONE 'Asia/Kolkata' AS time_ist, path, referrer
  FROM visit_log WHERE ip = '203.0.113.7' ORDER BY visited_at;

-- per day: page views and different addresses (people only, no crawlers)
SELECT (visited_at AT TIME ZONE 'Asia/Kolkata')::date AS day, count(*) AS page_views, count(DISTINCT ip) AS addresses
  FROM visit_log WHERE NOT is_bot GROUP BY 1 ORDER BY 1 DESC;

-- the most viewed pages this week
SELECT path, count(*) AS views, count(DISTINCT ip) AS addresses
  FROM visit_log WHERE NOT is_bot AND visited_at > now() - interval '7 days'
 GROUP BY path ORDER BY views DESC LIMIT 20;

-- where visitors come from
SELECT referrer, count(*) AS visits FROM visit_log
 WHERE referrer IS NOT NULL AND NOT is_bot GROUP BY referrer ORDER BY visits DESC;

-- addresses that looked at the most pages today (a very high number is usually a crawler or a script)
SELECT ip, count(*) AS views FROM visit_log WHERE visited_at > date_trunc('day', now()) GROUP BY ip ORDER BY views DESC LIMIT 20;
```

## Privacy: please read

An IP address is **personal data** under India's Digital Personal Data Protection Act, 2023, and under the GDPR for visitors in Europe. Keeping
this log is common for security and understanding traffic, but it comes with duties. This is a practical checklist, not legal advice:

1. **Tell visitors.** The shop has no privacy notice yet. Add a page, linked from the footer, saying that IP addresses and pages visited are
   recorded, why (security and understanding what visitors look at), and how long they are kept.
2. **Keep it private.** Only people who need it should reach the database. The log is not exposed through the shop's public API.
3. **Keep it short.** 365 days is the default; shorten it if you do not need a year (`VISIT_LOG_RETENTION_DAYS`).
4. **Honour deletion requests.** To remove one address: `DELETE FROM visit_log WHERE ip = '203.0.113.7';`
5. The log records every visitor, including those whose browser sends "Do Not Track". The earlier footer counter honoured that signal because it
   identified browsers; this log is a deliberate record of addresses, so it does not. If you would rather honour the signal, say so.
