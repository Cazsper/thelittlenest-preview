# The Little Nest — design preview

A read-only preview of thelittlenest.co.nz, published for internal review.

Pages: `index.html`, `about.html`, `sustainability.html`, `contact.html`,
`policies.html`, `shop.html`, `cart.html`, `account.html`, plus
`categories/<slug>.html` (8) and `products/<slug>.html` (173) — 187 URLs in
`sitemap.xml`.

**The shop is included and browsable** — 8 categories, 173 products, 367 size
variants, a working cart and the real freight rate card. **Every page is a real
static URL.** Hash routing (`#/p/<id>`) was removed on 6 Aug 2026 because it
meant all 173 products shared one URL and none could ever appear in a search
result. `assets/js/shop.js` hydrates the static markup; it does not render it.

**This is not the live store.** Checkout does not take payment: that needs the
Zoho Commerce Storefront API, which needs the store published. Sign-in is
Zoho's and is still a placeholder. Product photography is not shot yet — tiles
carry an explicit "Photography to come" frame.

Prices and SKUs come from the approved price list. Rows with a blank
`WEBSITE DISPLAY` are excluded, and rows with no approved price show
"Price on application" rather than a made-up number.

Search engines are blocked via `robots.txt` and a `noindex` meta tag so this preview
cannot compete with the production domain. Canonical tags still point at
thelittlenest.co.nz, which is deliberate.

`og:image` is rewritten to this preview's own URL so shared links render a card;
`build/` keeps the production URL.

Regenerate and re-publish with `deploy-tln-preview.sh`. Do not edit this folder
directly — edit `build/` and re-run the script. No credentials are stored in the
script; it uses `gh`, an SSH key, or a `GH_TOKEN` environment variable.
