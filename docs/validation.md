# Validation: what changed, before and after

Every detail a shopper types is now judged by one set of rules, in the browser (so the message appears as they type) and again on the server
(so nobody can get round it by calling the API directly). The rules live in `src/lib/validation.ts` and `server/src/lib/validation.ts`, which
are the same file twice; `src/test/validation.test.ts` fails if the copies differ.

## The rules now

| Field | Accepted | Refused (with the message the shopper sees) |
| --- | --- | --- |
| **Mobile number** | exactly 10 digits starting 6, 7, 8 or 9. `+91 98450 12367`, `91 9845012367` and `09845012367` are read as `9845012367` and stored as 10 digits | empty; fewer or more than 10 digits; starts with 0–5; letters; **the same digit repeated** (`9999999999`, `6666666666`); **two digits only** (`9898989898`); a digit repeated 7+ times in a row (`9000000012`); **a counting sequence** (`9876543210`, `9123456789`, `9812345678`); the same five digits twice (`9876598765`) |
| **Pincode** | 6 digits, not starting with 0, and (at checkout and on the product page) one that really exists | not 6 digits; starts with 0; `111111`, `123456`, `654321`; a pincode the lookup says does not exist (`560199`) |
| **Name** (checkout and sign-up) | letters of any script (Tamil, Hindi, accented…), spaces, apostrophe, hyphen, full stop; 2 to 80 characters; extra spaces tidied | empty; one letter; digits or symbols (`R2D2`, `<script>`, `Asha@Rao`, emoji); a letter repeated 4+ times (`aaaa`); over 80 characters |
| **Address line 1** | 5 to 150 characters with at least one letter; letters, digits and `, . - / # ( ) & ' : ;` | empty; under 5 characters; digits only (`12345678`); `<` `>` or other symbols; a character repeated 5+ times |
| **Address line 2** | optional; same characters as line 1 | the same symbol and repeat rules |
| **City** | letters, spaces, `. ' ( ) -`; 2 to 60 characters | empty; digits (`12345`, `Pune1`); symbols; a letter repeated 4+ times |
| **State** | one of the 36 states and union territories, spelled as in the list | empty; anything else (`Atlantis`, `kerala`) |
| **Email** (sign-up, newsletter) | `name@domain.tld` with a dotted domain ending in letters; lower-cased | empty; no `@`; no dot in the domain (`a@b`); spaces; `..`; a leading or trailing dot in the name; a name over 64 or an address over 254 characters |

Pincode ↔ city and state: when a real pincode is typed, the **city and state are filled in** from India Post's data (details at the end).

## Before and after, place by place

### Checkout: delivery address

| Field | Before | After |
| --- | --- | --- |
| Name | Only "not empty" in the browser; the server took 1 to 100 characters of anything: `1`, `!!!`, `<script>` were accepted | The name rule above, in both places. Stored tidied (`"  Asha   Rao "` → `Asha Rao`) |
| Mobile number | Pattern `[6-9]` + 9 digits, in both places: `9999999999`, `9876543210`, `9000000000`, `6666666666` were all accepted. The field took any characters. The server stored the number as typed (`+91 98765-43210`) | The mobile rule above. The field accepts digits only; a pasted `+91 …` or leading `0` is turned into the 10 digits. The server stores 10 digits, always |
| Pincode | `[1-9]` + 5 digits: `111111`, `123456`, `999999` and pincodes that do not exist were accepted | The pincode rule above, and a pincode the lookup cannot find is refused ("We couldn't find this pincode. Please check it.") |
| City | Only "not empty" in the browser; the server took anything up to 80 characters: `12345`, `!!!` | Filled in from the pincode. The city rule above, in both places |
| State | Required in the browser; the server accepted any text up to 80 characters (`Atlantis`) | Filled in from the pincode. Must be one of the 36 in the list, in both places. If the shopper picks a different state from the one the pincode belongs to, a note says "This pincode is usually in …" |
| Address line 1 | Only "not empty" in the browser; the server accepted 1 to 150 characters of anything: `.`, `x`, `<b>` | The address rule above (5+ characters, a letter in it, no symbols such as `<`), in both places |
| Address line 2 | Server: up to 150 characters of anything | Same character and repeat rules; still optional |
| When errors appear | Only after pressing Place order, one message at a time | Each field is checked when the shopper leaves it, and all wrong fields are listed together on submit |
| Order of the form | Name, mobile, address, city, pincode, state | Name, mobile, **pincode**, city, state, address, so the pincode comes first and fills in the rest |

### Sign-up, sign-in and password

| Field | Before | After |
| --- | --- | --- |
| Sign-up name | Browser: not empty. Server: 1 to 80 characters of anything (`R2D2 <b>`, `1`) | The name rule above, in both places; stored tidied |
| Sign-up email | Browser pattern `x@y.zz` accepted `a..b@c.com`, `.a@c.com` and `a@-b.com`; the server used its own, different check | The email rule above in the browser (it refuses all three); the server keeps its own standard email check |
| Sign-up password | At least 10 characters, not on the common list, not equal to the email (server); the browser checked the length only | The browser now also refuses a password equal to the email, before sending |
| Sign-in | Email or username and a password, not empty | Unchanged |
| Change password | Current password required, new one 10+ characters, different from the current one, typed twice the same | Unchanged |

### Other forms

| Place | Before | After |
| --- | --- | --- |
| Newsletter email | Browser pattern `x@y.zz` (accepted `a..b@c.com`); server standard email check | The email rule above in the browser; no length limit on the box before, now 254 |
| Product page "Check delivery" | `[1-9]` + 5 digits: a fake pincode (`111111`, `560199`) got a delivery estimate | The pincode rule and a lookup: a pincode that cannot be real or does not exist is refused; a real one says where ("Delivering to Ernakulam, Kerala. Sample estimate: …") |
| Delivery-estimate API | Same `[1-9]` + 5 digits rule | The shared pincode rule |
| Search box | Whitespace-only searches ignored; no length limit on the box | The same, and the box stops at 100 characters (the server's limit) |

## Reviewed and already sound (no change needed)

| Place | What is checked today |
| --- | --- |
| Admin product forms (add and edit) | The server checks every field with fixed ranges: names up to 120 characters without control characters or `<` `>`, price 1 to 10,000,000, cost 0 to 10,000,000, stock 0 to 100,000, 1 to 12 colours, up to 30 tags, one of the three genders; the browser shows the server's message under the field. Photos: 1 to 4 on a new product, JPG/PNG/WebP only, checked by their first bytes |
| Stock adjustments | A count cannot be negative, a "received" must add and "damaged" must remove, a note is limited to 200 characters |
| Offers, loyalty and discount rules | Server checks: names, codes (`A–Z`, digits, `-`, `_`, 3 to 32), percentage 1 to 100, dates (end after start), limits and combinations; messages shown under each field |
| Logo upload | PNG, JPEG or WebP only (SVG refused), 1 MB, checked in the browser and again by the server from the file's first bytes |
| Bag | Quantity 1 to 10, colour and size must belong to the product, a product that is inactive, coming soon or out of stock cannot be added |
| Orders | Prices and stock come from the database, never the browser; one order per attempt (idempotency key) |

## The pincode lookup

- `GET /api/pincode/<pincode>` answers `{ city, state, district, areas }`. The shop's server asks India Post's public service
  (`api.postalpincode.in`) and remembers every answer for a day; the browser never calls it directly (the site's security policy only allows
  the shop's own address).
- The place is the district most post offices share (`Bangalore` is shown as Bengaluru, `Gurgaon` as Gurugram, every Delhi pincode as New
  Delhi). States are written as in the shop's list, and Leh and Kargil are shown as Ladakh although the service still lists them under
  Jammu and Kashmir.
- **If the service is down**, the shopper is told to type the city and state, and ordering carries on: an order never waits on the lookup.
- **If the service says a pincode does not exist**, the checkout refuses it. A pincode that is brand new may be missing from India Post's data
  for a while; that is the one case where a real address could be turned away.
- The server does not re-check the lookup when an order is placed (so an order never depends on a third party); it checks the pincode's
  format and that the state is on the list.

## How this was checked

- `server/test/validation.test.ts`: the API refuses each kind of bad value with the right message, reports every wrong field at once, stores the
  address cleaned, and the pincode lookup (found, not found, service down, caching, name and state spellings, Ladakh, Delhi).
- `src/test/validation.test.ts`: the same rules in the browser copy, and that both copies are identical.
- In a browser against a local copy of the shop: typing `682001` filled Ernakulam and Kerala, `400001` replaced them with Mumbai and
  Maharashtra, `560199` and `111111` were refused, a pasted `+91 98450 12367` became `9845012367`, fake numbers and names with digits were
  refused when the shopper left the field, and an order placed with messy input was stored cleaned.
