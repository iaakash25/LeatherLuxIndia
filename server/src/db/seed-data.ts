// Generated from src/lib/catalog.ts. `images` are keys of the frontend's `images` map, not URLs.
export type SeedProduct = {
  slug: string; name: string; type: string; gender: "women" | "men" | "unisex"; priceInr: number;
  colours: string[]; images: string[]; isNew: boolean; bestseller: boolean; gift: boolean;
  stockQty: number; tagline: string; material: string; dimensions: string; sizes: string[] | null; rank: number;
};

export const SEED_PRODUCTS: SeedProduct[] = [
  {
    "slug": "aria-top-handle",
    "name": "Aria Top-Handle",
    "type": "Handbags",
    "gender": "women",
    "priceInr": 14990,
    "colours": [
      "Oxblood",
      "Ink",
      "Taupe"
    ],
    "images": [
      "handbag",
      "hero",
      "texture"
    ],
    "isNew": true,
    "bestseller": true,
    "gift": false,
    "stockQty": 25,
    "tagline": "A sculpted top-handle with a brass turn-lock and a detachable strap.",
    "material": "Smooth leather, textile lining, antique brass-tone hardware",
    "dimensions": "24 × 19 × 11 cm",
    "sizes": null,
    "rank": 0
  },
  {
    "slug": "meridian-tote",
    "name": "Meridian Tote",
    "type": "Totes",
    "gender": "women",
    "priceInr": 12490,
    "colours": [
      "Taupe",
      "Ink"
    ],
    "images": [
      "tote",
      "women",
      "texture"
    ],
    "isNew": true,
    "bestseller": false,
    "gift": false,
    "stockQty": 25,
    "tagline": "An open, softly structured tote sized for a working day.",
    "material": "Pebbled leather, unlined interior with zip pocket",
    "dimensions": "38 × 30 × 14 cm",
    "sizes": null,
    "rank": 1
  },
  {
    "slug": "halden-satchel",
    "name": "Halden Saddle Crossbody",
    "type": "Crossbody",
    "gender": "women",
    "priceInr": 8990,
    "colours": [
      "Ink",
      "Cognac"
    ],
    "images": [
      "crossbody",
      "women",
      "texture"
    ],
    "isNew": false,
    "bestseller": true,
    "gift": false,
    "stockQty": 3,
    "tagline": "A rounded saddle shape with a push-lock and adjustable strap.",
    "material": "Smooth leather, microfibre lining, brass-tone hardware",
    "dimensions": "22 × 16 × 7 cm",
    "sizes": null,
    "rank": 2
  },
  {
    "slug": "solenne-mini",
    "name": "Solenne Mini Bag",
    "type": "Handbags",
    "gender": "women",
    "priceInr": 5490,
    "colours": [
      "Oxblood",
      "Porcelain"
    ],
    "images": [
      "handbag",
      "texture",
      "hero"
    ],
    "isNew": true,
    "bestseller": false,
    "gift": true,
    "stockQty": 25,
    "tagline": "The Aria silhouette, reduced to hold the essentials.",
    "material": "Smooth leather, textile lining",
    "dimensions": "16 × 12 × 7 cm",
    "sizes": null,
    "rank": 3
  },
  {
    "slug": "corbel-briefcase",
    "name": "Corbel Slim Briefcase",
    "type": "Laptop & Work",
    "gender": "men",
    "priceInr": 14990,
    "colours": [
      "Ink",
      "Espresso"
    ],
    "images": [
      "brief",
      "men",
      "texture"
    ],
    "isNew": false,
    "bestseller": true,
    "gift": false,
    "stockQty": 25,
    "tagline": "A clean-lined briefcase with a padded sleeve for 14\" laptops.",
    "material": "Grained leather, padded laptop sleeve, gunmetal-tone hardware",
    "dimensions": "39 × 29 × 8 cm",
    "sizes": null,
    "rank": 4
  },
  {
    "slug": "atlas-weekender",
    "name": "Atlas Weekender",
    "type": "Travel",
    "gender": "unisex",
    "priceInr": 21990,
    "colours": [
      "Ink",
      "Cognac"
    ],
    "images": [
      "travel",
      "texture",
      "brief"
    ],
    "isNew": true,
    "bestseller": false,
    "gift": false,
    "stockQty": 3,
    "tagline": "A generous holdall for two nights away, with a detachable strap.",
    "material": "Grained leather, cotton-blend lining, brass-tone hardware",
    "dimensions": "52 × 30 × 26 cm",
    "sizes": null,
    "rank": 5
  },
  {
    "slug": "verso-backpack",
    "name": "Verso Backpack",
    "type": "Backpacks",
    "gender": "unisex",
    "priceInr": 11490,
    "colours": [
      "Espresso",
      "Ink"
    ],
    "images": [
      "backpack",
      "men",
      "texture"
    ],
    "isNew": false,
    "bestseller": true,
    "gift": false,
    "stockQty": 25,
    "tagline": "A rounded city backpack with a front zip pocket and laptop sleeve.",
    "material": "Smooth leather, textile lining",
    "dimensions": "30 × 42 × 14 cm",
    "sizes": null,
    "rank": 6
  },
  {
    "slug": "linea-bifold",
    "name": "Linea Bifold Wallet",
    "type": "Wallets",
    "gender": "men",
    "priceInr": 2490,
    "colours": [
      "Ink",
      "Espresso",
      "Cognac"
    ],
    "images": [
      "wallet",
      "slg",
      "texture"
    ],
    "isNew": false,
    "bestseller": true,
    "gift": true,
    "stockQty": 25,
    "tagline": "Six card slots and a full-length note section in a slim fold.",
    "material": "Smooth leather, leather interior",
    "dimensions": "11 × 9.5 × 1.5 cm",
    "sizes": null,
    "rank": 7
  },
  {
    "slug": "plinth-card-case",
    "name": "Plinth Card Case",
    "type": "Card Cases",
    "gender": "unisex",
    "priceInr": 1790,
    "colours": [
      "Oxblood",
      "Ink",
      "Taupe"
    ],
    "images": [
      "belt",
      "slg",
      "texture"
    ],
    "isNew": false,
    "bestseller": true,
    "gift": true,
    "stockQty": 25,
    "tagline": "Four slots and a centre pocket, cut close to the cards.",
    "material": "Smooth leather, painted edges",
    "dimensions": "10.5 × 8 × 0.6 cm",
    "sizes": null,
    "rank": 8
  },
  {
    "slug": "arc-belt-35",
    "name": "Arc Belt 35mm",
    "type": "Belts",
    "gender": "men",
    "priceInr": 3490,
    "colours": [
      "Ink",
      "Cognac"
    ],
    "images": [
      "belt",
      "slg",
      "texture"
    ],
    "isNew": false,
    "bestseller": false,
    "gift": true,
    "stockQty": 25,
    "tagline": "A 35mm everyday belt with an antique brass-tone buckle.",
    "material": "Smooth leather, brass-tone buckle",
    "dimensions": "Width 3.5 cm",
    "sizes": [
      "80",
      "85",
      "90",
      "95",
      "100",
      "105"
    ],
    "rank": 9
  },
  {
    "slug": "fine-belt-20",
    "name": "Fine Belt 20mm",
    "type": "Belts",
    "gender": "women",
    "priceInr": 2990,
    "colours": [
      "Ink",
      "Oxblood",
      "Taupe"
    ],
    "images": [
      "belt",
      "women",
      "texture"
    ],
    "isNew": true,
    "bestseller": false,
    "gift": false,
    "stockQty": 25,
    "tagline": "A narrow belt for tailoring and knitwear.",
    "material": "Smooth leather, brass-tone buckle",
    "dimensions": "Width 2 cm",
    "sizes": [
      "70",
      "75",
      "80",
      "85",
      "90"
    ],
    "rank": 10
  },
  {
    "slug": "tessera-key-loop",
    "name": "Tessera Key Loop",
    "type": "Key Accessories",
    "gender": "unisex",
    "priceInr": 590,
    "colours": [
      "Cognac",
      "Ink",
      "Oxblood"
    ],
    "images": [
      "slg",
      "texture",
      "wallet"
    ],
    "isNew": false,
    "bestseller": false,
    "gift": true,
    "stockQty": 25,
    "tagline": "A folded leather tab on a solid brass-tone ring.",
    "material": "Smooth leather, brass-tone ring",
    "dimensions": "9 × 3 cm",
    "sizes": null,
    "rank": 11
  },
  {
    "slug": "coin-pouch",
    "name": "Ovale Coin Pouch",
    "type": "Pouches",
    "gender": "unisex",
    "priceInr": 990,
    "colours": [
      "Oxblood",
      "Ink"
    ],
    "images": [
      "slg",
      "texture",
      "belt"
    ],
    "isNew": false,
    "bestseller": false,
    "gift": true,
    "stockQty": 25,
    "tagline": "A small zipped pouch for coins, earphones or keys.",
    "material": "Smooth leather, zip closure",
    "dimensions": "11 × 8 cm",
    "sizes": null,
    "rank": 12
  },
  {
    "slug": "folio-pouch",
    "name": "Folio Document Pouch",
    "type": "Pouches",
    "gender": "unisex",
    "priceInr": 4290,
    "colours": [
      "Ink",
      "Taupe"
    ],
    "images": [
      "brief",
      "texture",
      "men"
    ],
    "isNew": false,
    "bestseller": false,
    "gift": false,
    "stockQty": 25,
    "tagline": "A flat zipped folio for tablets and papers.",
    "material": "Grained leather, textile lining",
    "dimensions": "34 × 25 cm",
    "sizes": null,
    "rank": 13
  },
  {
    "slug": "zip-around-wallet",
    "name": "Linea Zip-Around Wallet",
    "type": "Wallets",
    "gender": "women",
    "priceInr": 3990,
    "colours": [
      "Oxblood",
      "Ink",
      "Porcelain"
    ],
    "images": [
      "wallet",
      "slg",
      "texture"
    ],
    "isNew": true,
    "bestseller": false,
    "gift": true,
    "stockQty": 25,
    "tagline": "Twelve card slots, a coin compartment and a smooth zip.",
    "material": "Smooth leather, leather interior",
    "dimensions": "19 × 10 × 2 cm",
    "sizes": null,
    "rank": 14
  },
  {
    "slug": "travel-card-holder",
    "name": "Transit Card Holder",
    "type": "Card Cases",
    "gender": "men",
    "priceInr": 1290,
    "colours": [
      "Ink",
      "Espresso"
    ],
    "images": [
      "slg",
      "wallet",
      "texture"
    ],
    "isNew": false,
    "bestseller": false,
    "gift": false,
    "stockQty": 0,
    "tagline": "A slim two-slot holder with a thumb cut-out.",
    "material": "Smooth leather",
    "dimensions": "10 × 7 cm",
    "sizes": null,
    "rank": 15
  },
  {
    "slug": "rue-shoulder",
    "name": "Rue Shoulder Bag",
    "type": "Handbags",
    "gender": "women",
    "priceInr": 10990,
    "colours": [
      "Ink",
      "Oxblood"
    ],
    "images": [
      "women",
      "handbag",
      "texture"
    ],
    "isNew": false,
    "bestseller": true,
    "gift": false,
    "stockQty": 25,
    "tagline": "A slouched shoulder bag that sits close under the arm.",
    "material": "Soft leather, suede-effect lining",
    "dimensions": "30 × 18 × 9 cm",
    "sizes": null,
    "rank": 16
  },
  {
    "slug": "nomad-sling",
    "name": "Nomad Sling",
    "type": "Crossbody",
    "gender": "men",
    "priceInr": 4990,
    "colours": [
      "Ink",
      "Espresso"
    ],
    "images": [
      "crossbody",
      "men",
      "texture"
    ],
    "isNew": true,
    "bestseller": false,
    "gift": false,
    "stockQty": 25,
    "tagline": "A compact crossbody for phone, wallet and passport.",
    "material": "Grained leather, textile lining",
    "dimensions": "24 × 15 × 5 cm",
    "sizes": null,
    "rank": 17
  },
  {
    "slug": "ledger-laptop-tote",
    "name": "Ledger Work Tote",
    "type": "Laptop & Work",
    "gender": "women",
    "priceInr": 13490,
    "colours": [
      "Ink",
      "Taupe"
    ],
    "images": [
      "women",
      "tote",
      "texture"
    ],
    "isNew": false,
    "bestseller": false,
    "gift": false,
    "stockQty": 3,
    "tagline": "A structured tote with a padded laptop sleeve and zip top.",
    "material": "Pebbled leather, padded sleeve, textile lining",
    "dimensions": "40 × 30 × 13 cm",
    "sizes": null,
    "rank": 18
  },
  {
    "slug": "dossier-messenger",
    "name": "Dossier Messenger",
    "type": "Laptop & Work",
    "gender": "men",
    "priceInr": 12990,
    "colours": [
      "Espresso",
      "Ink"
    ],
    "images": [
      "men",
      "brief",
      "texture"
    ],
    "isNew": false,
    "bestseller": false,
    "gift": false,
    "stockQty": 25,
    "tagline": "A flapped messenger with magnetic closures.",
    "material": "Grained leather, textile lining",
    "dimensions": "38 × 28 × 9 cm",
    "sizes": null,
    "rank": 19
  },
  {
    "slug": "cabin-duffle",
    "name": "Cabin Duffle",
    "type": "Travel",
    "gender": "unisex",
    "priceInr": 18490,
    "colours": [
      "Ink",
      "Espresso"
    ],
    "images": [
      "travel",
      "brief",
      "texture"
    ],
    "isNew": false,
    "bestseller": false,
    "gift": false,
    "stockQty": 25,
    "tagline": "A cabin-sized duffle with a separate shoe compartment.",
    "material": "Grained leather, textile lining",
    "dimensions": "48 × 27 × 24 cm",
    "sizes": null,
    "rank": 20
  },
  {
    "slug": "washbag",
    "name": "Strata Wash Bag",
    "type": "Travel",
    "gender": "unisex",
    "priceInr": 3290,
    "colours": [
      "Ink",
      "Cognac"
    ],
    "images": [
      "slg",
      "travel",
      "texture"
    ],
    "isNew": false,
    "bestseller": false,
    "gift": true,
    "stockQty": 25,
    "tagline": "A wipe-clean lined wash bag with a wide opening.",
    "material": "Smooth leather, coated lining",
    "dimensions": "25 × 14 × 12 cm",
    "sizes": null,
    "rank": 21
  }
];
