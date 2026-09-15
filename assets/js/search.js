/* ============================================================================
   THE LITTLE NEST · SITE SEARCH
   Added 15 Sep 2026 on Cazsper's instruction: a search box in the header on
   every page, a second one under the header line on the homepage, and
   suggestions as you type.

   THIS FILE OWNS THE MATCHER. `shop.js` used to carry its own copy of
   stems/tokenise/productMatches; it now delegates to `window.TLNSearch`. One
   source of truth on purpose, because the header suggestions and the shop grid
   MUST agree. A customer who is shown "Weavers Premium Duvet Cover White" in
   the dropdown and then gets an empty grid on pressing Enter has been lied to
   by one of the two matchers, and there would be no way to tell which.

   ⚠ LOAD ORDER: this file must come BEFORE shop.js. The generator's foot()
   emits them in that order and index.html lists them in that order.

   THE CATALOGUE IS FETCHED LAZILY, on the first focus or keystroke, never on
   page load. It is ~78KB and the overwhelming majority of visits never search.
   The homepage in particular was carrying nothing before today and should not
   start paying for a feature most people will not touch. On pages that already
   loaded it (shop, categories, products) the in-flight promise is shared, so
   nothing is fetched twice.

   ROOT-RELATIVE URLS THROUGHOUT (`/shop`, `/products/<slug>`). The header lives
   at four different directory depths and a relative href would have to know
   which. The site already serves extensionless root-relative paths · that is
   what every canonical uses · so there is no prefix to get wrong.
   ========================================================================= */

(function () {
  'use strict';

  /* --- the matcher ------------------------------------------------------ */

  /* Conservative singularisation. Original spelling FIRST so an exact name or
     SKU match is never weakened; the stem is only an extra chance to hit.
     No real stemmer: over-stemming ("slip" -> "sli") starts matching things the
     customer did not ask for, which is a worse bug than the plural one because
     it is invisible. See the note in shop.js for the measurements. */
  function stems(tok) {
    const out = [tok];
    if (tok.length > 4 && tok.endsWith('ies')) out.push(tok.slice(0, -3) + 'y');
    if (tok.length > 4 && tok.endsWith('es'))  out.push(tok.slice(0, -2));
    if (tok.length > 3 && tok.endsWith('s'))   out.push(tok.slice(0, -1));
    return out;
  }

  function tokenise(term) {
    return String(term || '').toLowerCase().split(/\s+/).filter(Boolean);
  }

  /* Name AND every variant SKU in one string, so the customer does not need to
     know which field they are searching. */
  function hay(p) {
    return (p.name + ' ' + (p.variants || []).map(v => v.sku || '').join(' ')).toLowerCase();
  }

  function productMatches(p, toks) {
    const h = hay(p);
    return toks.every(t => stems(t).some(s => h.includes(s)));
  }

  function match(products, term) {
    const toks = tokenise(term);
    if (!toks.length) return [];
    return products.filter(p => productMatches(p, toks));
  }

  /* --- catalogue, fetched once, shared ---------------------------------- */

  let catPromise = null;
  function catalogue() {
    if (catPromise) return catPromise;
    /* If shop.js already has it parsed, reuse rather than re-fetch. */
    if (window.Catalogue && typeof window.Catalogue.all === 'function') {
      const already = window.Catalogue.all();
      if (already && already.length) return (catPromise = Promise.resolve(already));
    }
    catPromise = fetch('/assets/data/catalogue.json')
      .then(r => r.json())
      .then(d => (d.products || []).filter(p => !p.hidden))
      /* A failed fetch must not break the form. The GET submit still works
         without suggestions, which is the whole reason the markup is a real
         form and not a JS widget. */
      .catch(() => []);
    return catPromise;
  }

  const money = n => n == null ? null : 'NZ$' + Number(n).toLocaleString('en-NZ',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function priceLabel(p) {
    if (p.lo == null && p.hi == null) return 'Price on application';
    if (p.lo == null) return money(p.hi);
    if (p.hi == null || p.lo === p.hi) return money(p.lo);
    return money(p.lo) + ' – ' + money(p.hi);
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const MAX = 7;

  /* --- one autocomplete, bound to one form ------------------------------ */

  function wire(form, i) {
    const input = form.querySelector('input[name="q"]');
    if (!input) return;

    const list = document.createElement('ul');
    list.className = 'tln-sugg';
    list.id = 'tln-sugg-' + i;
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    form.appendChild(list);

    /* Combobox wiring. Without these the dropdown is invisible to a screen
       reader: it announces an ordinary text field and the customer never
       learns the options exist. */
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', list.id);
    input.setAttribute('autocomplete', 'off');

    let rows = [];   // [{href, label}], the last one being "see all"
    let active = -1;

    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
    }

    function paintActive() {
      [...list.children].forEach((li, n) => {
        const on = n === active;
        li.classList.toggle('is-active', on);
        li.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      if (active >= 0 && list.children[active]) {
        input.setAttribute('aria-activedescendant', list.children[active].id);
        list.children[active].scrollIntoView({ block: 'nearest' });
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    async function suggest() {
      const term = input.value.trim();
      if (term.length < 2) return close();     // one letter matches most of the shop

      const all = await catalogue();
      /* The customer kept typing while the catalogue was in flight; whatever we
         are about to render is already stale. Bail rather than flash it. */
      if (input.value.trim() !== term) return;

      const hits = match(all, term);
      if (!hits.length) {
        rows = [];
        list.innerHTML = '<li class="tln-sugg__none">No matches for “' + esc(term) + '”</li>';
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        active = -1;
        return;
      }

      const shown = hits.slice(0, MAX);
      rows = shown.map(p => ({ href: '/products/' + p.slug, label: p.name }));
      rows.push({
        href: '/shop?q=' + encodeURIComponent(term),
        label: hits.length === 1 ? 'See the 1 result' : 'See all ' + hits.length + ' results'
      });

      list.innerHTML = shown.map((p, n) =>
        '<li class="tln-sugg__row" id="' + list.id + '-' + n + '" role="option" aria-selected="false">'
        + '<a href="/products/' + esc(p.slug) + '">'
        + '<span class="tln-sugg__name">' + esc(p.name) + '</span>'
        + '<span class="tln-sugg__price">' + esc(priceLabel(p)) + '</span>'
        + '</a></li>'
      ).join('')
      + '<li class="tln-sugg__all" id="' + list.id + '-' + shown.length + '" role="option" aria-selected="false">'
      + '<a href="/shop?q=' + encodeURIComponent(term) + '">' + esc(rows[rows.length - 1].label) + ' →</a></li>';

      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      active = -1;
      paintActive();
    }

    input.addEventListener('input', suggest);
    input.addEventListener('focus', () => { if (input.value.trim().length >= 2) suggest(); });

    input.addEventListener('keydown', (e) => {
      if (list.hidden || !rows.length) return;
      if (e.key === 'ArrowDown')      { e.preventDefault(); active = (active + 1) % rows.length; paintActive(); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); active = (active - 1 + rows.length) % rows.length; paintActive(); }
      else if (e.key === 'Escape')    { close(); }
      else if (e.key === 'Enter' && active >= 0) {
        /* Only hijack Enter when the customer has actually arrowed onto a row.
           Otherwise the form submits normally, which is the behaviour someone
           who ignored the dropdown expects. */
        e.preventDefault();
        window.location.href = rows[active].href;
      }
    });

    /* Pointer-down, not click: `blur` fires first on a click and would hide the
       list before the anchor's default ever ran, so every suggestion would look
       dead. */
    list.addEventListener('mousedown', (e) => {
      const a = e.target.closest('a');
      if (!a) return;
      e.preventDefault();
      window.location.href = a.getAttribute('href');
    });

    document.addEventListener('click', (e) => { if (!form.contains(e.target)) close(); });
    input.addEventListener('blur', () => setTimeout(close, 120));
  }

  function init() {
    document.querySelectorAll('form[data-tln-search]').forEach(wire);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.TLNSearch = { stems, tokenise, productMatches, match, catalogue };
})();
