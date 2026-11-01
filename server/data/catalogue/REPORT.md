# Leather Lux India — new-products catalogue review

What was done with `D:\Leather Lux India\DSLR Images\New Products`, what is now in the database, and what is still missing.
All numbers come from `products.json` / `media.json` in this folder, which are exactly what the importer loaded.

## 1. What went in

| | |
| --- | --- |
| Files in the shoot folders | 565 |
| Distinct photos (the same shot sat in several folders; matched by file content) | **386** |
| Products created | **76** (73 live in the shop, 3 hidden) |
| Photos placed on products | **332** (2–8 per product; each as a 4:5 white-background WebP plus a small version) |
| Spare photos, kept in the library for you to assign | 29 |
| Unusable frames (not published) | 14 |
| Duplicates (re-edited copies of the same shot) | 11 |
| Photos with no recorded outcome | **0** |

Every product has a style number (`LLI-WAL-001` …), a name, category, gender, colours, material, tagline, a description, search tags, a proposed price, a placeholder opening stock and a reorder level. The 22 original sample products received style numbers `LLI-SMP-001…022` and were otherwise left alone.

## 2. Range by category and gender (live products)

| Category | For | Products | Price (₹) | Photos each (avg) |
| --- | --- | ---: | --- | ---: |
| Wallets | Men | 19 | 1,990 – 2,790 | 4.0 |
| Belts | Men | 11 | 1,790 – 2,490 | 4.6 |
| Laptop & Work bags | Men / Unisex | 2 + 1 | 6,990 – 12,490 | 7.0 – 8.0 |
| Satchels | Women | 7 | 6,990 – 8,990 | 5.7 |
| Sling bags | Women / Unisex | 6 + 1 | 4,490 – 6,990 | 6.0 |
| Handbags | Women | 4 | 6,490 – 9,490 | 5.5 |
| Totes | Women | 2 | 7,490 – 10,990 | 6.5 |
| Clutches | Women | 3 | 2,490 – 4,490 | 5.7 |
| Key accessories (straps, fobs) | Unisex | 5 | 490 – 590 | 2.0 |
| ID card holders | Unisex | 4 | 690 | 2.0 |
| Card cases | Unisex | 2 | 1,290 – 1,490 | 3.5 |
| Passport holders | Unisex | 2 | 2,490 | 4.0 |
| Eyewear cases | Unisex | 2 | 1,290 | 4.5 |
| Mobile holder | Unisex | 1 | 1,190 | 4.0 |
| Pen pouch (desk) | Unisex | 1 | 990 | 2.0 |

Gender split: **32 men, 22 women, 19 unisex.** "Unisex" pieces appear under both Women and Men in the shop.
Hidden until they have enough photos: *Gloss Dress Belt — Ink* (1 photo), *Lustro Clutch Wallet — Ink* (2), *Work Tote — Ink* (1). The shop rule is 3+ photos for bags and wallets, 2+ for small goods and belts.

## 3. Gaps, as a merchandiser sees them

**Range gaps**
1. **No women's small leather goods.** Every wallet (19) and belt (11) in the shoot is a men's style. Women's only have clutches. Women's wallets, card holders and coin purses are the most natural add-ons to a handbag sale and are the biggest hole.
2. **Thin men's bags.** Men have two laptop briefcases and nothing else: no backpack, messenger, duffle or weekender, which is where the sample (design) range already points.
3. **No travel category** in the photographed range; the sample products carry it for now.
4. **Price ladder has a missing middle.** 26 pieces sit under ₹2,000 and 22 between ₹2,000–3,000, then only 5 pieces between ₹3,000–5,000 and 2 above ₹10,000. There is nothing at ₹3,000–4,400 for the shopper who has outgrown a ₹2,500 wallet: premium wallets, zip-around styles, and gift sets would fill it.
5. **No sets or combos** although 48 pieces are flagged for the Gift Edit. A wallet + belt set and a wallet + key fob set are low-effort wins (the discount-rules screen can price them once checkout applies it).
6. **Colour depth is narrow.** Ink (20 products), Oxblood (14), Tan (13) and Espresso (12) carry the range; Navy appears 5 times and Olive, Hunter, Forest and Slate once or twice each. Treat the single-colour accents as limited editions rather than core colours.

**Photo gaps**
1. **15 live products have only 2 photos** (key straps and fobs, ID holders, card/passport cases, the pen pouch, coil belts). They need an open/inside view and an in-hand shot for scale.
2. **Nothing shows scale or use.** All photos are packshots on white. Add in-hand / on-model / desk shots for the hero and campaign slots, and a gift-box shot for the Gift Edit.
3. **14 frames could not be published** (9 with a packing box in the frame, 5 with cut-out defects such as white patches). Re-shoot those angles.
4. **19 wallet interior shots are not matched to a wallet.** The camera numbers show they are open wallets, but the file names don't say which. They are in the photo library as *spare*: open Admin → Inventory → a wallet → *Add a spare photo* to put them on the right product.
5. **Two bags in the library may be products we have not listed:** a dark two-zip bag shot from above (3 photos) and a red croc flap bag opened out (2 photos). Check whether they are new styles or extra views.
6. **A few labels are generic** (e.g. two photos both called "Top view"); rename them if you like (labels are in `image_labels`).

**Data gaps (the shop cannot show these until someone measures or confirms them)**
- **Dimensions** are empty on all 76 products (the page hides the row). Shoppers cannot judge size; this is the most common reason for returns in leather goods.
- **Cost price** is empty everywhere, so margins are unknown. Fill `cost_inr` and the Inventory page shows margin and stock value at cost.
- **Stock counts are placeholders** (947 units, ₹22.9 lakh at shop prices). Do a physical count and set each with *Set to a count*.
- **Belt sizes (80–105 cm) and width** are assumed; confirm the real size run and buckle details.
- **Material wording.** Copy says "genuine leather" and "crocodile-embossed leather" (never genuine croc). Confirm the leather type (full-grain, buffalo, corrected-grain) before launch: it is a claim customers rely on, and it affects the price band.
- **Names are working names** (Duo, Classico, Ventaglio, Maren, Lotus…). Rename freely; the style number is what stays fixed.
- **GST / HSN codes and the "incl. taxes" wording** are not captured anywhere yet.

## 4. Pricing: how the proposed prices were set, and what to do with them

There was no cost, competitor or sales data, so these are **proposals from category norms for a premium direct-to-consumer leather brand, not measured prices**. Every product is flagged *Needs review* until you confirm it.

- **Impulse and gifting (₹490–1,290):** key straps and fobs ₹490–590, ID holders ₹690, pen pouch ₹990, mobile holder ₹1,190, eyewear and card cases ₹1,290–1,490. Priced under ₹1,500 so they can be added to a bag purchase without a second thought, and they qualify as the Gift Edit.
- **Core men's small goods (₹1,790–2,790):** belts ₹1,790–2,490, wallets ₹1,990–2,790, with the two-tone and textured styles at the top. Free shipping starts at ₹2,500 (configurable), so the upper wallets and belts clear it by themselves.
- **Women's and unisex bags (₹4,490–10,990):** slings ₹4,490–6,990, satchels and handbags ₹6,490–9,490, totes ₹7,490–10,990; crocodile-embossed finishes carry a ₹500–1,000 premium over the plain version.
- **Work bags (₹6,990–12,490):** the croc briefcase is the price ceiling.

To change a price: Admin → Inventory → type in the Price box and press Enter (or SQL, see `server/README.md`). Use **Reviewed** once a product's price and stock are confirmed.

## 5. Suggested next steps, in order

1. Count stock, then fill dimensions and cost price (this makes the Inventory totals real).
2. Review the 73 live prices; mark each Reviewed.
3. Decide what to do with the 22 sample products: they are still live and appear first. Hide them with one SQL line (`UPDATE products SET active = false WHERE sku LIKE 'LLI-SMP-%'`) or from Inventory, one by one.
4. Trim the "New" badge: all 73 photographed products are marked New, so the badge and the "New In" collection no longer single anything out. Keep it on the 10–15 you want to lead with.
5. Assign the 19 spare wallet interiors; re-shoot the 14 unusable frames and the 15 two-photo products; add scale shots.
6. Commission the range additions: women's wallets and card holders first, then men's backpacks/messengers, then ₹3,000–4,400 premium wallets and gift sets.
7. After a month of orders, set the *bestseller* flags from real sales instead of guesses (none are set today).
