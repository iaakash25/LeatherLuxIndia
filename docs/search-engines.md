# Search engines: Google's icon, pictures in results, and getting into Bing

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

## Pictures beside the site in search

The icon is the small round logo; "pictures" means the product photos showing up in Google Images, as a thumbnail next to a result, and as the
preview when a link is shared on WhatsApp, Facebook, X or LinkedIn. Before, the pages told search engines nothing about their pictures, and
`robots.txt` blocked `/api/`, which is where photos uploaded in the admin console are served. Now:

| What | Where | Effect |
| --- | --- | --- |
| `og:image` / `twitter:image` (+ alt text) on every page | `imageMeta()` in `src/lib/seo.ts`; default (the hero) in `src/routes/__root.tsx`, replaced by a product's first photo or a collection's banner | the picture in link previews, and Google's hint for which picture represents the page |
| `Product` structured data on every product page, **from launch day** | `productJsonLd()` in `src/lib/seo.ts`, used by `src/routes/products.$slug.tsx` | name, photos, SKU, price and stock: lets Google show the price and a product badge in Images and in the listing |
| Pictures in the sitemap | `buildSitemap()` in `src/lib/sitemap.ts` | Google Images finds every photo of every product, including ones added later in the admin console |
| `Allow: /api/photos/` | `public/robots.txt` | Google can fetch photos uploaded in the admin console (the 76 imported products' photos are under `/media/`, which was never blocked) |

**There is no `Product` structured data before launch, on purpose.** Google rejects a Product that has no price, review or rating (the Rich Results
Test says *Either "offers", "review", or "aggregateRating" should be specified*, and the item is "invalid"), and before launch nothing can be
bought, so "in stock" beside a price would be untrue, and the reviews on the product page are samples, not real ones. So until
`LAUNCH.enabled` is set to `false` in `src/lib/launch.ts` (launch day) the product pages carry no Product block, and the Rich Results Test shows
"no items detected" rather than an error. The pictures themselves reach Google without it (the page tags and the sitemap above). A coming-soon
product never gets one. On launch day the block appears by itself, with price and stock, and the test should then pass.

What the site cannot decide: **whether Google shows a thumbnail next to a result, and which one.** Google chooses, mostly on phones, and only after it
has crawled the new tags (days to a few weeks). To prompt it, in Search Console run **URL Inspection → Request indexing** on the home page and a
few product pages, and in **Sitemaps** resubmit `https://leatherluxindia.com/sitemap.xml` (it now carries the pictures). Check the page tags with
any link preview (paste a product link into WhatsApp). After launch, check the product data with Google's Rich Results Test
(search.google.com/test/rich-results) on a product page.

The surest route to product photos with prices in Google Shopping and Google Images is a free **Merchant Center** account (merchants.google.com)
with a product feed. It needs the shop to be open (a working checkout, shipping and return policies), so it belongs to launch week; ask for a feed
generated from the live catalogue when the time comes.

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
