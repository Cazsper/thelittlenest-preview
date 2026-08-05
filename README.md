# The Little Nest — static design preview

A read-only preview of the marketing pages for thelittlenest.co.nz, published for internal review.

Pages: `index.html`, `about.html`, `sustainability.html`, `contact.html`, `policies.html`

**This is not the live store.** Shop, cart, account and category links point at the
future online store and are not part of this preview — they resolve to `404.html`.

Search engines are blocked via `robots.txt` and a `noindex` meta tag so this preview
cannot compete with the production domain. Canonical tags still point at
thelittlenest.co.nz, which is deliberate.

`og:image` is rewritten to this preview's own URL so shared links render a card;
`build/` keeps the production URL.

Regenerate and re-publish with `deploy-tln-preview.sh`. Do not edit this folder
directly — edit `build/` and re-run the script. No credentials are stored in the
script; it uses `gh`, an SSH key, or a `GH_TOKEN` environment variable.
