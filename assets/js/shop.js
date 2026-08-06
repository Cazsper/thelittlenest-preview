/* ============================================================================
   THE LITTLE NEST — SHOP
   Vanilla JS, no build step, matching the rest of the site.

   ARCHITECTURE — read this before changing anything.

   The shop reads through two adapters so the UI never knows where data comes
   from. Today both run in "local" mode off assets/data/catalogue.json. When
   the Zoho store is published, flip SOURCE.mode to "zoho" and the same screens
   run on live catalogue, live cart, live freight and Zoho's own checkout.

     Catalogue  local -> catalogue.json        zoho -> GET  /storefront/api/v1/...
     Cart       local -> localStorage          zoho -> GET/POST /storefront/api/v1/cart

   Verified 6 Aug 2026: the Storefront API answers on the .com.au data centre
   with header `domain-name: staging.thelittlenest.co.nz`. /cart returns live
   JSON. The catalogue endpoints return 200 with an empty body, which is
   consistent with the store never having been published — that is the one
   thing standing between this file and live data.
   ========================================================================= */

const SOURCE = {
  mode: 'local',                                        // 'local' | 'zoho'
  base: 'https://commerce.zoho.com.au/storefront/api/v1',
  domain: 'staging.thelittlenest.co.nz',
};

/* --- small helpers ------------------------------------------------------ */

const money = n =>
  n == null ? null : 'NZ$' + Number(n).toLocaleString('en-NZ',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const esc = s => String(s ?? '').replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const el = document.getElementById.bind(document);

/* --- catalogue adapter -------------------------------------------------- */

const Catalogue = {
  _d: null,

  async load() {
    if (this._d) return this._d;
    if (SOURCE.mode === 'zoho') {
      try { return (this._d = await this._fromZoho()); }
      catch (e) {
        console.warn('[TLN] Zoho catalogue unavailable, using local snapshot.', e);
      }
    }
    const r = await fetch('assets/data/catalogue.json');
    if (!r.ok) throw new Error('catalogue.json ' + r.status);
    return (this._d = await r.json());
  },

  async _fromZoho() {
    const r = await fetch(`${SOURCE.base}/categories`, {
      headers: { 'domain-name': SOURCE.domain },
      credentials: 'include',
    });
    const j = await r.json();
    if (!j?.payload?.categories?.length) throw new Error('empty catalogue');
    return normaliseZoho(j.payload);
  },

  cats()          { return this._d.cats; },
  cat(slug)       { return this._d.cats.find(c => c.slug === slug); },
  product(id)     { return this._d.products.find(p => p.id === id); },
  inCat(name)     { return this._d.products.filter(p => p.cat === name); },
};

/* Shape Zoho's payload into the same objects the views already use, so the
   UI stays identical whichever source is active. Field names follow Zoho's
   Storefront API; confirm against a live response before trusting it. */
function normaliseZoho(payload) {
  return {
    cats: (payload.categories || []).map(c => ({
      name: c.name, slug: c.url || c.seo_url, zid: c.category_id,
      blurb: c.description || '', img: c.image_url || 'assets/img/01-hero.jpg',
    })),
    products: (payload.products || []).map(p => ({
      id: p.product_id, name: p.name, cat: p.category_name, section: '',
      lo: p.min_price, hi: p.max_price,
      unpriced: p.min_price == null ? 1 : 0,
      stock: p.stock_on_hand ?? 0,
      variants: (p.variants || []).map(v => ({
        sku: v.sku, size: v.option_value || 'One size',
        price: v.price, vid: v.product_variant_id,
      })),
    })),
  };
}

/* --- cart adapter ------------------------------------------------------- */

const KEY = 'tln.cart.v1';

const Cart = {
  lines: [],

  load() {
    try { this.lines = JSON.parse(localStorage.getItem(KEY)) || []; }
    catch { this.lines = []; }
    this.paintCount();
  },

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.lines)); } catch {}
    this.paintCount();
  },

  add(product, variant, qty = 1) {
    const line = this.lines.find(l => l.sku === variant.sku);
    if (line) line.qty += qty;
    else this.lines.push({
      sku: variant.sku, vid: variant.vid || null, pid: product.id,
      name: product.name, size: variant.size, price: variant.price, qty,
    });
    this.save();
  },

  setQty(sku, qty) {
    const line = this.lines.find(l => l.sku === sku);
    if (!line) return;
    line.qty = Math.max(0, qty);
    if (!line.qty) this.lines = this.lines.filter(l => l.sku !== sku);
    this.save();
  },

  remove(sku) { this.lines = this.lines.filter(l => l.sku !== sku); this.save(); },

  count()    { return this.lines.reduce((n, l) => n + l.qty, 0); },
  subtotal() { return this.lines.reduce((n, l) => n + l.qty * (l.price || 0), 0); },

  paintCount() {
    document.querySelectorAll('[data-cart-count]')
      .forEach(e => e.textContent = this.count());
  },
};

/* Freight — mirrors policies.html and the live Zoho shipping zones.
   Rural adds a flat $9.00 at every tier, including the free tier.
   Note: written with >= 30 so there is no gap between $29.90 and $30.00.
   Once SOURCE.mode is 'zoho' this is replaced by the rates the Checkout API
   returns, and this function becomes display-only for the pre-checkout
   estimate. */
function freight(subtotal, rural = false) {
  if (subtotal <= 0) return 0;
  // Boundaries match Zoho's zones exactly, which are inclusive at the lower
  // end: 0.01–29.99 / 30.00–149.99 / 150.00–349.99 / 350.00+. In particular
  // an order of exactly $350.00 ships free — quoting 27.90 there would show
  // the customer more than Zoho charges at checkout.
  const base = subtotal >= 350 ? 0
             : subtotal >= 150 ? 27.90
             : subtotal >= 30  ? 17.90
             : 9.90;
  return base + (rural ? 9.00 : 0);
}

/* --- views -------------------------------------------------------------- */

const priceLabel = p => p.unpriced
  ? '<span class="shop-poa">Price on application</span>'
  : (p.lo === p.hi ? money(p.lo) : `${money(p.lo)} – ${money(p.hi)}`);

function tile(p) {
  return `
  <a class="shop-tile" href="#/p/${esc(p.id)}">
    <span class="ph r-4-5 shop-tile__ph"><span class="ph__cap">Photography to come</span></span>
    <span class="shop-tile__name">${esc(p.name)}</span>
    <span class="shop-tile__price">${priceLabel(p)}</span>
  </a>`;
}

function crumbs(parts) {
  return `<nav class="shop-crumbs" aria-label="Breadcrumb">${
    parts.map((x, i) => i === parts.length - 1
      ? `<span aria-current="page">${esc(x.label)}</span>`
      : `<a href="${x.href}">${esc(x.label)}</a>`).join('<i>·</i>')
  }</nav>`;
}

/* Search + sort. Applies to the A–Z listing and to every category, so the
   same controls behave the same way wherever you are. */
function toolbar() {
  return `
  <div class="shop-tools">
    <span class="shop-tools__count" data-count></span>
    <div class="shop-tools__controls">
      <input class="shop-search" type="search" data-q
             placeholder="Search by name or SKU" aria-label="Search products">
      <select class="shop-sort" data-sort aria-label="Sort products">
        <option value="az">Name A–Z</option>
        <option value="lo">Price low to high</option>
        <option value="hi">Price high to low</option>
      </select>
    </div>
  </div>
  <section class="container shop-grid" data-grid></section>`;
}

/* scope: 'all' or a category slug. Unpriced products always sort last on a
   price sort rather than being treated as $0. */
function paint(scope) {
  const root = el('shop-root');
  const grid = root.querySelector('[data-grid]');
  if (!grid) return;

  const q = (root.querySelector('[data-q]')?.value || '').trim().toLowerCase();
  const sort = root.querySelector('[data-sort]')?.value || 'az';

  let list = scope === 'all'
    ? Catalogue.cats().flatMap(c => Catalogue.inCat(c.name))
    : Catalogue.inCat(Catalogue.cat(scope).name);

  if (q) list = list.filter(p =>
    p.name.toLowerCase().includes(q) ||
    p.variants.some(v => (v.sku || '').toLowerCase().includes(q)));

  if (sort === 'lo')      list.sort((a, b) => (a.lo == null) - (b.lo == null) || a.lo - b.lo);
  else if (sort === 'hi') list.sort((a, b) => (a.hi == null) - (b.hi == null) || b.hi - a.hi);
  else                    list.sort((a, b) => a.name.localeCompare(b.name));

  grid.innerHTML = list.length
    ? list.map(tile).join('')
    : `<p class="shop-empty">Nothing matches that search.</p>`;

  const count = root.querySelector('[data-count]');
  if (count) count.textContent = list.length + (list.length === 1 ? ' product' : ' products');
}

function wireTools(scope) {
  const root = el('shop-root');
  const q = root.querySelector('[data-q]');
  const s = root.querySelector('[data-sort]');
  if (q) q.addEventListener('input', () => paint(scope));
  if (s) s.addEventListener('change', () => paint(scope));
  paint(scope);
}

function vShop() {
  const total = Catalogue.cats().reduce((n, c) => n + Catalogue.inCat(c.name).length, 0);
  const variants = Catalogue.cats()
    .flatMap(c => Catalogue.inCat(c.name))
    .reduce((n, p) => n + p.variants.length, 0);

  return `
  <section class="container shop-head">
    ${crumbs([{ label: 'Home', href: 'index.html' }, { label: 'Shop' }])}
    <h1 class="serif">The Range</h1>
    <p class="shop-head__lede">${total} products across eight categories,
      ${variants} sizes and colourways in all. Hotel-grade linen, beds and
      towelling — the same goods we supply to accommodation, available by
      the piece.</p>
  </section>

  <section class="container shop-sec"><h2 class="caps">Shop by category</h2></section>
  <section class="container shop-cats">
    ${Catalogue.cats().map(c => `
      <a class="shop-cat" href="#/c/${esc(c.slug)}">
        <span class="shop-cat__media"><img src="${esc(c.img)}" alt="" loading="lazy"></span>
        <span class="shop-cat__body">
          <span class="shop-cat__name">${esc(c.name)}</span>
          <span class="shop-cat__blurb">${esc(c.blurb)}</span>
          <span class="shop-cat__count">${Catalogue.inCat(c.name).length} products</span>
        </span>
      </a>`).join('')}
  </section>

  <section class="container shop-sec"><h2 class="caps">Everything, A–Z</h2></section>
  ${toolbar()}`;
}

function vCat(slug) {
  const c = Catalogue.cat(slug);
  if (!c) return vNotFound();
  return `
  <section class="container shop-head">
    ${crumbs([{ label: 'Home', href: 'index.html' },
              { label: 'Shop', href: '#/shop' }, { label: c.name }])}
    <h1 class="serif">${esc(c.name)}</h1>
    <p class="shop-head__lede">${esc(c.blurb)}</p>
  </section>
  ${toolbar()}`;
}

function vProduct(id) {
  const p = Catalogue.product(id);
  if (!p) return vNotFound();
  const c = Catalogue.cats().find(x => x.name === p.cat);
  const multi = p.variants.length > 1;

  return `
  <section class="container shop-product">
    ${crumbs([{ label: 'Home', href: 'index.html' },
              { label: 'Shop', href: '#/shop' },
              { label: p.cat, href: `#/c/${esc(c ? c.slug : '')}` },
              { label: p.name }])}
    <div class="shop-product__grid">
      <div class="ph r-4-5"><span class="ph__cap">Photography to come</span></div>
      <div class="shop-product__body">
        <p class="eyebrow">${esc(p.section || p.cat)}</p>
        <h1 class="serif">${esc(p.name)}</h1>
        <p class="shop-product__price" data-price>${priceLabel(p)}</p>

        ${p.unpriced ? `
          <p class="shop-note">This line is not priced on the current approved
          price list. Contact us for a quote.</p>` : ''}

        ${multi ? `
          <div class="shop-sizes" role="radiogroup" aria-label="Size">
            ${p.variants.map((v, i) => `
              <button type="button" class="shop-size" role="radio"
                      aria-checked="${i === 0}" data-i="${i}">${esc(v.size)}</button>`).join('')}
          </div>` : ''}

        <p class="shop-sku" data-sku>SKU ${esc(p.variants[0].sku)}</p>

        <div class="shop-buy">
          <div class="shop-qty">
            <button type="button" data-qty="-" aria-label="Decrease quantity">–</button>
            <input type="text" inputmode="numeric" value="1" data-qty-val aria-label="Quantity">
            <button type="button" data-qty="+" aria-label="Increase quantity">+</button>
          </div>
          <button class="btn shop-add" type="button" data-add
                  ${p.unpriced ? 'disabled' : ''}>
            ${p.unpriced ? 'Enquire' : 'Add to Nest'}
          </button>
        </div>

        <p class="shop-ship">Free freight over $350 · 48 hour despatch NZ-wide ·
          Prices GST inclusive</p>
      </div>
    </div>
  </section>`;
}

function vCart() {
  if (!Cart.lines.length) return `
    <section class="container shop-head">
      ${crumbs([{ label: 'Home', href: 'index.html' }, { label: 'Your Nest' }])}
      <h1 class="serif">Your Nest is empty</h1>
      <p class="shop-head__lede">Nothing here yet.</p>
      <p><a class="btn" href="#/shop">Shop the range →</a></p>
    </section>`;

  const sub = Cart.subtotal();
  const fr = freight(sub);
  return `
  <section class="container shop-head">
    ${crumbs([{ label: 'Home', href: 'index.html' }, { label: 'Your Nest' }])}
    <h1 class="serif">Your Nest</h1>
  </section>
  <section class="container shop-cart">
    <div class="shop-cart__lines">
      ${Cart.lines.map(l => `
        <div class="shop-line">
          <span class="ph r-4-5 shop-line__ph"></span>
          <div class="shop-line__body">
            <a class="shop-line__name" href="#/p/${esc(l.pid)}">${esc(l.name)}</a>
            <p class="shop-line__meta">${esc(l.size)} · SKU ${esc(l.sku)}</p>
            <button class="shop-line__rm" type="button" data-rm="${esc(l.sku)}">Remove</button>
          </div>
          <div class="shop-qty shop-qty--sm">
            <button type="button" data-line="-" data-sku="${esc(l.sku)}" aria-label="Decrease">–</button>
            <input type="text" inputmode="numeric" value="${l.qty}" data-line-val="${esc(l.sku)}" aria-label="Quantity">
            <button type="button" data-line="+" data-sku="${esc(l.sku)}" aria-label="Increase">+</button>
          </div>
          <span class="shop-line__price">${money(l.qty * l.price)}</span>
        </div>`).join('')}
    </div>

    <aside class="shop-sum">
      <h2 class="caps">Summary</h2>
      <p class="shop-sum__row"><span>Subtotal</span><span>${money(sub)}</span></p>
      <p class="shop-sum__row"><span>Freight</span><span>${fr === 0 ? 'Free' : money(fr)}</span></p>
      <p class="shop-sum__note">Rural delivery adds $9.00. Final freight is
        confirmed at checkout against your address.</p>
      <p class="shop-sum__total"><span>Total</span><span>${money(sub + fr)}</span></p>
      <button class="btn shop-checkout" type="button" data-checkout>Checkout →</button>
      <p class="shop-sum__note">GST inclusive. Payment is taken securely by
        Stripe.</p>
    </aside>
  </section>`;
}

const vNotFound = () => `
  <section class="container shop-head">
    <h1 class="serif">Not found</h1>
    <p class="shop-head__lede">That page doesn't exist.
      <a href="#/shop">Back to the shop</a>.</p>
  </section>`;

/* --- routing + wiring --------------------------------------------------- */

function render() {
  const h = location.hash.replace(/^#/, '') || '/shop';
  const [, seg, arg] = h.split('/');
  const root = el('shop-root');

  root.innerHTML =
      seg === 'c'    ? vCat(arg)
    : seg === 'p'    ? vProduct(arg)
    : seg === 'cart' ? vCart()
    : vShop();

  window.scrollTo(0, 0);
  Cart.paintCount();
  if (seg === 'c')       wireTools(arg);
  else if (seg === 'p')  wireProduct(arg);
  else if (seg === 'cart') wireCart();
  else                   wireTools('all');
}

function wireProduct(id) {
  const p = Catalogue.product(id);
  if (!p) return;
  let i = 0, qty = 1;

  const root  = el('shop-root');
  const price = root.querySelector('[data-price]');
  const sku   = root.querySelector('[data-sku]');
  const qtyIn = root.querySelector('[data-qty-val]');

  const paint = () => {
    const v = p.variants[i];
    if (!p.unpriced) price.textContent = money(v.price);
    sku.textContent = 'SKU ' + v.sku;
    root.querySelectorAll('.shop-size').forEach((b, n) =>
      b.setAttribute('aria-checked', String(n === i)));
    qtyIn.value = qty;
  };

  root.querySelectorAll('.shop-size').forEach(b =>
    b.addEventListener('click', () => { i = +b.dataset.i; paint(); }));

  root.querySelectorAll('[data-qty]').forEach(b =>
    b.addEventListener('click', () => {
      qty = Math.max(1, qty + (b.dataset.qty === '+' ? 1 : -1));
      paint();
    }));

  qtyIn.addEventListener('change', () => {
    qty = Math.max(1, parseInt(qtyIn.value, 10) || 1);
    paint();
  });

  const add = root.querySelector('[data-add]');
  if (add && !p.unpriced) add.addEventListener('click', () => {
    Cart.add(p, p.variants[i], qty);
    add.textContent = 'Added ✓';
    setTimeout(() => { add.textContent = 'Add to Nest'; }, 1400);
  });

  paint();
}

function wireCart() {
  const root = el('shop-root');

  root.querySelectorAll('[data-rm]').forEach(b =>
    b.addEventListener('click', () => { Cart.remove(b.dataset.rm); render(); }));

  root.querySelectorAll('[data-line]').forEach(b =>
    b.addEventListener('click', () => {
      const line = Cart.lines.find(l => l.sku === b.dataset.sku);
      Cart.setQty(b.dataset.sku, line.qty + (b.dataset.line === '+' ? 1 : -1));
      render();
    }));

  root.querySelectorAll('[data-line-val]').forEach(inp =>
    inp.addEventListener('change', () => {
      Cart.setQty(inp.dataset.lineVal, parseInt(inp.value, 10) || 0);
      render();
    }));

  const go = root.querySelector('[data-checkout]');
  if (go) go.addEventListener('click', checkout);
}

/* Checkout hands the cart to Zoho, which owns payment, tax, freight and the
   sales order. Until the store is published there is nothing to hand it to,
   so this states that plainly rather than failing silently. */
async function checkout() {
  if (SOURCE.mode !== 'zoho') {
    alert(
      'Checkout is not connected yet.\n\n' +
      'The shop, cart and freight all work. Payment needs the Zoho store ' +
      'published so its Storefront API can take the order — that is the one ' +
      'remaining step.'
    );
    return;
  }
  for (const l of Cart.lines) {
    await fetch(`${SOURCE.base}/cart`, {
      method: 'POST',
      headers: { 'domain-name': SOURCE.domain, 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ product_variant_id: l.vid, quantity: String(l.qty) }),
    });
  }
  location.href = `https://${SOURCE.domain}/checkout`;
}

/* --- boot --------------------------------------------------------------- */

(async function init() {
  Cart.load();
  try {
    await Catalogue.load();
  } catch (e) {
    el('shop-root').innerHTML =
      '<section class="container shop-head"><h1 class="serif">Shop unavailable</h1>' +
      '<p class="shop-head__lede">The catalogue could not be loaded. ' +
      'Please refresh, or contact us.</p></section>';
    console.error('[TLN] catalogue failed to load', e);
    return;
  }
  addEventListener('hashchange', render);
  render();
})();
