# Search engines: Google's icon, and getting into Bing

## Google showed a globe instead of the logo

Google lists a site's icon only if it is **square, a multiple of 48 px on a side (48, 96, 144…), and reachable by its crawler**. The site was
offering the logo itself (636 × 438, wide), so Google ignored it and drew the plain globe. The old `favicon.ico` file was also still the
template's default (a heart), which was never the shop's.

What the site gives now (`public/`, linked from the page head in `src/routes/__root.tsx`):

| File | Size | For |
| --- | --- | --- |
| `favicon-96x96.png` | 96 × 96 | Google's results, modern browsers |
| `favicon.ico` | 16, 32 and 48 px in one file | browser tabs and bookmarks |
| `apple-touch-icon.png` | 180 × 180 | iPhone and iPad home screen |

They are the three letters of the logo on the shop's off-white (the 16 px size is the single letter L, which stays readable). They are made by
`node scripts/make-favicons.mjs` from `scripts/favicon-source.png`, a copy of the logo; run it again, and look at the result, whenever the
logo changes. Changing the logo in the admin console updates the header but **not** these icon files, on purpose: crawlers need a fixed square.

Google refreshes an icon on its own schedule: usually a few days, sometimes a few weeks after it next crawls the home page. To prompt it,
in Search Console open **URL Inspection**, paste `https://leatherluxindia.com/` and press **Request indexing**. Browsers show the new icon
as soon as their cache lets go of the old one (a hard refresh, or a few days).

## Bing and Edge show nothing yet

Edge searches with Bing, and Bing has not indexed the site at all (a `site:leatherluxindia.com` search there returns unrelated pages). Its crawler
is not blocked (robots.txt allows everything public, and the pages answer normally to Bingbot); it simply has not found the site yet, because the
domain is new. Google found it because it was told through Search Console. Bing has to be told the same way:

1. Go to **Bing Webmaster Tools** (bing.com/webmasters) and sign in.
2. Choose **Import from Google Search Console**: it brings in the verified site, with no code to add. (Otherwise add the site by hand and verify
   it with the meta-tag or XML-file option.)
3. Open **Sitemaps** and submit `https://leatherluxindia.com/sitemap.xml`.
4. Open **URL Submission** and submit the home page and the collection pages.
5. Optional, and instant: `node scripts/indexnow.mjs` sends every page of the sitemap to Bing and the other IndexNow engines (Yandex, Naver,
   Seznam). The key file it relies on is `public/<key>.txt`. Use `--dry-run` to see what it would send. Run it again after adding products.

Expect Bing to take anywhere from a couple of days to a few weeks to list a new site; "leather lux india" is also a name other sellers use, so the
shop may not be first at the start. Links to the shop from other sites (social profiles, business listings) speed it up for every search engine.
