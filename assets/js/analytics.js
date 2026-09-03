/* THE LITTLE NEST · ANALYTICS
   GA4, loaded only if a real Measurement ID is set below. Ships INERT: with
   the placeholder in place, this file does nothing at all -- no script tag,
   no request, no cookie. Nothing to disable while there is no ID; nothing
   fires until one is added.

   HOW TO TURN IT ON
     Replace MEASUREMENT_ID below with a real one ("G-XXXXXXXXXX") and
     rebuild. That is the only step. Every event hook already exists and is
     already wired to the real add-to-cart, checkout and product-view code
     paths in shop.js -- see the addEventListener('tln:*', ...) calls below.

   WHY EVENTS ARE DISPATCHED AS CustomEvents RATHER THAN CALLING gtag()
   DIRECTLY FROM shop.js
     shop.js should not need to know whether analytics exists, what it is
     called, or whether the ID is set. It dispatches plain DOM events
     ('tln:add_to_cart', 'tln:view_item', 'tln:begin_checkout') with the
     product/cart data as event.detail, and this file is the only place that
     turns those into GA4's ecommerce shape. Delete this file entirely and
     shop.js still works, unchanged.

   WHAT IS NOT WIRED YET, AND WHY
     `purchase` is not fired anywhere. The customer leaves this site entirely
     at checkout (location.href = Zoho's hosted checkout page), and Zoho does
     not currently redirect back to a page on this domain that could fire it,
     so there is no confirmed-purchase moment this site can see. Firing it on
     `begin_checkout` instead would count abandoned carts as sales, which is
     a worse number than no number. Options once this matters: a GA4
     Measurement Protocol call from a Zoho webhook (server-side, immune to ad
     blockers, needs Zoho Flow work), or configuring a return URL in Zoho
     Checkout that lands back on an order-confirmation page here. Both are a
     real decision, not a code change to make silently. */
const MEASUREMENT_ID = ""; // e.g. "G-XXXXXXXXXX" -- empty means analytics is off.

if (MEASUREMENT_ID) {
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + MEASUREMENT_ID;
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag("js", new Date());
  // GST-inclusive prices, one currency, one market: nothing to anonymise
  // beyond GA4's own defaults. IP anonymisation is on by default in GA4 and
  // is not a flag here the way it was in Universal Analytics.
  gtag("config", MEASUREMENT_ID);

  document.addEventListener("tln:view_item", (e) => {
    const d = e.detail;
    gtag("event", "view_item", {
      currency: "NZD",
      value: d.price ?? 0,
      items: [{ item_id: d.sku, item_name: d.name, item_category: d.category,
                price: d.price ?? 0, quantity: 1 }],
    });
  });

  document.addEventListener("tln:add_to_cart", (e) => {
    const d = e.detail;
    gtag("event", "add_to_cart", {
      currency: "NZD",
      value: (d.price ?? 0) * d.qty,
      items: [{ item_id: d.sku, item_name: d.name, item_category: d.category,
                item_variant: d.size, price: d.price ?? 0, quantity: d.qty }],
    });
  });

  document.addEventListener("tln:begin_checkout", (e) => {
    const d = e.detail;
    gtag("event", "begin_checkout", {
      currency: "NZD",
      value: d.value ?? 0,
      items: d.items || [],
    });
  });
}
