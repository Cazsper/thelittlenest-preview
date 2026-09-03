/* ============================================================================
   The Little Nest · content manager

   SOURCE LIVES HERE, NOT IN build/admin/. build/ is generated output and gets
   wiped; copy_admin() in build-shop-pages.py copies this directory into it.

   Vanilla JS on purpose. The public site has no framework and no build step for
   its own scripts; adding React and a bundler here would mean this project now
   has two toolchains, one of which only the CMS uses. Nothing below is hard
   enough to need one.

   ⚠ NOTHING HERE IS A SECURITY CONTROL.
   Every check in this file is a courtesy to the person using it. The real
   guards live in functions/api/admin/*.js and run on the server for every
   request. If this file were deleted, or rewritten in devtools, the API would
   behave identically.
   ========================================================================= */

'use strict';

const API = {
  session:  '/api/admin/auth/session',
  login:    '/api/admin/auth/login',
  logout:   '/api/admin/auth/logout',
  password: '/api/admin/auth/password',
  content:  '/api/admin/content',
  publish:  '/api/admin/publish',
  history:  '/api/admin/history',
  rollback: '/api/admin/rollback',
  media:    '/api/admin/media',
  users:    '/api/admin/users',
};

/* The header the API requires. A cross-origin form post cannot set it without a
   CORS preflight the Worker never answers, so it is a cheap CSRF guard on top
   of the SameSite=Lax cookie. */
const MARK = { 'x-tln-admin': '1' };

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const bytes = (n) => n < 1024 ? `${n} B`
  : n < 1048576 ? `${(n / 1024).toFixed(0)} KB`
  : `${(n / 1048576).toFixed(1)} MB`;

const when = (ms) => {
  if (!ms) return 'never';
  return new Date(Number(ms)).toLocaleString('en-NZ',
    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/* --- network ------------------------------------------------------------- */

async function call(url, { method = 'GET', body, form } = {}) {
  const init = { method, credentials: 'same-origin', headers: { ...MARK } };
  if (form) {
    init.body = form;                       // let the browser set the boundary
  } else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch {
    /* Offline, DNS, a dropped connection. Distinguished from a server error
       because the useful advice is completely different. */
    throw Object.assign(new Error(
      'Could not reach the server. Check your connection and try again.'),
      { offline: true });
  }

  let data = null;
  try { data = await res.json(); } catch { /* non-JSON error page */ }

  if (res.status === 401 && !url.endsWith('/login')) {
    /* The session went away underneath us. Say so once rather than showing a
       wall of failures, and leave what is on screen alone so nothing typed is
       silently thrown away. */
    toast('Your session has ended. Sign in again.', true);
    setTimeout(() => { location.href = '/admin/'; }, 1600);
    throw new Error('unauthenticated');
  }
  if (!res.ok || (data && data.ok === false)) {
    throw Object.assign(
      new Error(data?.message || `Request failed (${res.status})`),
      { code: data?.error, status: res.status, data });
  }
  return data;
}

/* --- feedback ------------------------------------------------------------ */

function toast(message, isError = false) {
  const host = $('#toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' toast--error' : '');
  el.textContent = message;
  host.append(el);
  setTimeout(() => el.remove(), isError ? 6500 : 3500);
}

function busy(btn, on) {
  if (!btn) return;
  btn.setAttribute('aria-busy', on ? 'true' : 'false');
  btn.disabled = !!on;
}

/* A promise-based confirm. Destructive actions get one, and its button is
   labelled with the verb rather than "OK", so the dialog still reads correctly
   when someone is skimming. */
function confirmModal({ title, body, ok = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const dlg = $('#modal');
    $('#modal-title').textContent = title;
    $('#modal-body').textContent = body;
    $('#modal-extra').innerHTML = '';
    const okBtn = $('#modal-ok');
    const noBtn = $('#modal-cancel');
    okBtn.style.display = '';
    noBtn.textContent = 'Cancel';
    okBtn.textContent = ok;
    okBtn.className = 'btn' + (danger ? ' btn--danger' : '');
    const finish = (v) => {
      okBtn.removeEventListener('click', onOk);
      noBtn.removeEventListener('click', onNo);
      dlg.removeEventListener('cancel', onEsc);
      if (dlg.open) dlg.close();
      resolve(v);
    };
    const onOk = () => finish(true);
    const onNo = () => finish(false);
    const onEsc = () => finish(false);
    okBtn.addEventListener('click', onOk);
    noBtn.addEventListener('click', onNo);
    dlg.addEventListener('cancel', onEsc);
    dlg.showModal();
  });
}

/* ==========================================================================
   SIGN IN
   ========================================================================== */

function initSignIn() {
  const form = $('#form');
  const err = $('#err');
  const go = $('#go');

  const showError = (msg) => { err.textContent = msg; err.hidden = false; };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;

    const email = $('#email').value.trim();
    const password = $('#password').value;

    /* Checked here only so an obviously empty form does not cost a round trip.
       The server checks the same things and is the one that counts. */
    if (!email || !password) { showError('Enter your email and password.'); return; }

    busy(go, true);
    try {
      await call(API.login, { method: 'POST', body: { email, password } });
      location.href = '/admin/app';
    } catch (ex) {
      showError(ex.message);
      $('#password').value = '';
      $('#password').focus();
    } finally {
      busy(go, false);
    }
  });

  /* Already signed in? Skip the form. */
  call(API.session).then((d) => {
    if (d.authenticated) location.replace('/admin/app');
  }).catch(() => { /* not configured or offline; leave the form up */ });
}

/* ==========================================================================
   THE APP
   ========================================================================== */

const State = {
  user: null,
  model: null,
  draft: {},        // key -> { kind, value }   as last saved
  edited: {},       // key -> value             unsaved
  media: [],
  products: null,
  ordering: null,   // { defaults: { featured, order }, featured, order }
  view: null,
};

const valueOf = (key) => (key in State.edited)
  ? State.edited[key]
  : State.draft[key]?.value;

function setValue(key, kind, value) {
  State.edited[key] = value;
  if (!State.draft[key]) State.draft[key] = { kind, value: undefined };
  State.draft[key].kind = kind;
  refreshDirty();
}

function refreshDirty() {
  const n = Object.keys(State.edited).length;
  const pill = $('#dirty');
  pill.hidden = n === 0;
  pill.textContent = `${n} unsaved change${n === 1 ? '' : 's'}`;
  $('#save').disabled = n === 0;
}

/* Closing the tab with unsaved edits is the one way to lose work in this
   system, so it is the one place a browser prompt earns its keep. */
window.addEventListener('beforeunload', (e) => {
  if (Object.keys(State.edited).length) { e.preventDefault(); e.returnValue = ''; }
});

/* --- field editors -------------------------------------------------------- */

function fText(field, key, multiline = false) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const id = `f_${key.replace(/\W/g, '_')}`;
  wrap.innerHTML =
    `<label for="${id}">${esc(field.label)}</label>` +
    (multiline ? `<textarea id="${id}" class="rich"></textarea>`
               : `<input type="text" id="${id}">`) +
    (field.help ? `<p class="hint">${esc(field.help)}</p>` : '');
  const input = $(`#${id}`, wrap);
  input.value = valueOf(key) ?? '';
  input.addEventListener('input', () => setValue(key, field.kind, input.value));
  return wrap;
}

function fRich(field, key) {
  const wrap = fText(field, key, true);
  const ta = $('textarea', wrap);

  const hint = document.createElement('p');
  hint.className = 'hint';
  /* Two different instructions, because two different renderers. A field with
     `blocks` goes through richText() in cms/inject.js, which turns the Enter
     key and a leading dash into real paragraphs and bullets. Telling the
     product editor to type `<br>` would be telling them to do work the site
     now does for them, and it is the instruction that produced the
     "straightened it back out to a straight line" report on 14 Aug. */
  hint.innerHTML = field.blocks
    ? 'Press <strong>Enter</strong> for a new line and leave a blank line '
      + 'between paragraphs. Start a line with a dash (<code>-</code>) to make '
      + 'a bullet point. <code>&lt;em&gt;</code> and <code>&lt;strong&gt;</code> '
      + 'still work. Anything else is removed when you save.'
    : 'Formatting allowed: <code>&lt;br&gt;</code> line break, '
      + '<code>&lt;em&gt;</code> italic serif accent, <code>&lt;strong&gt;</code>, '
      + 'and links. Anything else is removed when you save.';
  wrap.append(hint);

  /* A live preview, because the raw string contains markup and the whole point
     of an italic accent is being able to see it. Built in a detached template
     with the same allowlist the server uses, never injected as raw HTML. */
  const prev = document.createElement('div');
  prev.style.cssText = 'margin-top:10px;padding:10px 12px;background:var(--cream);'
    + 'border-radius:6px;font-size:15px;min-height:1.2em';
  const draw = () => {
    if (!field.blocks) { prev.innerHTML = previewHtml(ta.value); return; }
    prev.replaceChildren(...previewBlocks(ta.value));
  };
  ta.addEventListener('input', draw);
  draw();
  wrap.append(prev);
  return wrap;
}

/* Block preview for `blocks` fields.

   ⚠ MIRRORS richText() in cms/inject.js. If the grouping rules change there,
   change them here, or Steph sees one thing while typing and another on the
   page. Kept deliberately small for that reason: the STRUCTURE is built as DOM
   nodes here, and the only thing that ever becomes innerHTML is the output of
   previewHtml(), which is the existing sanitiser. So this duplicates the
   grouping rule and nothing about safety. */
const PREVIEW_BULLET_RE = /^\s*[-*•]\s+(.*)$/;

function previewBlocks(raw) {
  const lines = String(raw ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''));

  const out = [];
  let para = [];
  let list = [];

  const flushPara = () => {
    if (!para.length) return;
    const p = document.createElement('p');
    p.style.margin = '0 0 8px';
    p.innerHTML = para.map((l) => previewHtml(l)).join('<br>');
    out.push(p);
    para = [];
  };
  const flushList = () => {
    if (!list.length) return;
    const ul = document.createElement('ul');
    ul.style.cssText = 'margin:0 0 8px;padding-left:20px;list-style:disc';
    for (const item of list) {
      const li = document.createElement('li');
      li.style.listStyle = 'disc';
      li.innerHTML = previewHtml(item);
      ul.append(li);
    }
    out.push(ul);
    list = [];
  };

  for (const line of lines) {
    const m = PREVIEW_BULLET_RE.exec(line);
    if (m) { flushPara(); if (m[1].trim()) list.push(m[1].trim()); continue; }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return out;
}

/* Mirrors the server allowlist. Preview only; the server sanitises
   independently and is the one that decides what reaches the site. */
const PREVIEW_OK = new Set(['BR', 'EM', 'STRONG', 'B', 'I', 'A', 'SPAN', 'SUP']);
function previewHtml(raw) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(raw ?? '');
  const walk = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === 1) {
        if (!PREVIEW_OK.has(child.tagName)) {
          child.replaceWith(...child.childNodes);
          return;
        }
        [...child.attributes].forEach((a) => {
          if (a.name !== 'href') child.removeAttribute(a.name);
        });
        if (child.tagName === 'A'
            && /^\s*(javascript|data|vbscript):/i.test(child.getAttribute('href') || '')) {
          child.removeAttribute('href');
        }
        walk(child);
      } else if (child.nodeType !== 3) {
        child.remove();
      }
    });
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

function fLink(field, key) {
  const v = valueOf(key) ?? { label: '', href: '' };
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const id = `f_${key.replace(/\W/g, '_')}`;
  wrap.innerHTML = `<span class="label">${esc(field.label)}</span>
     <div class="grid2">
       <div><label class="hint" for="${id}_l">Button text</label>
            <input type="text" id="${id}_l"></div>
       <div><label class="hint" for="${id}_h">Links to</label>
            <input type="text" id="${id}_h" spellcheck="false"
                   placeholder="shop.html or https://…"></div>
     </div>`;
  const l = $(`#${id}_l`, wrap);
  const h = $(`#${id}_h`, wrap);
  l.value = v.label ?? '';
  h.value = v.href ?? '';
  const push = () => setValue(key, 'link', { label: l.value, href: h.value });
  l.addEventListener('input', push);
  h.addEventListener('input', push);
  return wrap;
}

function fFlag(field, key) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const cur = valueOf(key);
  const on = cur === undefined ? true : !!cur;
  const label = document.createElement('label');
  label.className = 'toggle';
  label.innerHTML = `<input type="checkbox"${on ? ' checked' : ''}>
    <span class="toggle__track"></span><span>${esc(field.label)}</span>`;
  $('input', label).addEventListener('change',
    (e) => setValue(key, 'flag', e.target.checked));
  wrap.append(label);
  return wrap;
}

/* The shared image control. `read`/`write` let it serve both a top-level
   content key and an item inside a collection, which store their value in
   different places. */
function imageControl(label, initial, write) {
  const state = { ...(initial ?? {}) };
  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap.innerHTML = `<span class="label">${esc(label)}</span>
    <div class="img">
      <div class="img__preview" data-prev></div>
      <div class="img__side">
        <div class="img__actions">
          <button class="btn btn--ghost btn--sm" type="button" data-upload>Upload…</button>
          <button class="btn btn--ghost btn--sm" type="button" data-library>Choose from library</button>
        </div>
        <label class="hint" data-altlabel>Alt text · what the image shows, for
          screen readers and search</label>
        <input type="text" data-alt>
        <p class="img__meta" data-meta></p>
      </div>
    </div>`;

  const url = () => state.r2_key ? `/media/${state.r2_key}`
    : state.src ? (state.src.startsWith('/') ? state.src : `/${state.src}`) : '';

  const paint = () => {
    $('[data-prev]', wrap).innerHTML = url()
      ? `<img src="${esc(url())}" alt="">`
      : '<span>No image</span>';
    $('[data-meta]', wrap).textContent = url() || 'none';
  };

  const alt = $('[data-alt]', wrap);
  alt.value = state.alt ?? '';
  alt.addEventListener('input', () => { state.alt = alt.value; write({ ...state }); });

  const take = (m) => {
    if (!m) return;
    Object.assign(state, { src: m.url, r2_key: m.r2_key, media_id: m.id,
                           width: m.width, height: m.height });
    /* Only fill alt text if the field is empty. Overwriting what someone wrote
       for THIS placement with the library's generic description loses the
       better text. */
    if (!state.alt && m.alt) { state.alt = m.alt; alt.value = m.alt; }
    write({ ...state });
    paint();
  };

  $('[data-upload]', wrap).addEventListener('click',
    async () => take(await pickFile()));
  $('[data-library]', wrap).addEventListener('click',
    async () => take(await pickFromLibrary()));

  paint();
  return wrap;
}

const fImage = (field, key) =>
  imageControl(field.label, valueOf(key) ?? { src: '', alt: '' },
               (v) => setValue(key, 'image', v));

/* --- collections ---------------------------------------------------------- */

function fList(field, key) {
  const wrap = document.createElement('div');
  const items = structuredClone(valueOf(key) ?? []);
  const locked = !!field.locked_length;

  const commit = () => {
    items.forEach((it, i) => { it._order = i; });
    /* `saveKind` lets a caller store under a different kind while reusing all
       of this control's behaviour. Product galleries need it: the rows look
       like a list here, but the server stores them as `gallery`, which
       normalises each row as a picture plus a SKU instead of running every
       field through sanitiseRich. Defaults to 'list', so every existing
       caller is unchanged. */
    setValue(key, field.saveKind || 'list', structuredClone(items));
  };

  const render = () => {
    wrap.innerHTML = '';

    items.forEach((item, i) => {
      const card = document.createElement('div');
      card.className = 'item' + (item._visible === false ? ' item--hidden' : '');

      const bar = document.createElement('div');
      bar.className = 'item__bar';
      const titleField = field.item.find((f) => /title|name|quote|caption/.test(f.name));
      const label = titleField
        ? String(item[titleField.name] ?? '').replace(/<[^>]*>/g, '').slice(0, 60)
        : '';
      bar.innerHTML = `<strong>${esc(label || `Item ${i + 1}`)}</strong>`;

      const mk = (txt, title, fn, disabled) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'iconbtn';
        b.textContent = txt;
        b.title = title;
        b.setAttribute('aria-label', title);
        b.disabled = !!disabled;
        b.addEventListener('click', fn);
        return b;
      };

      bar.append(
        mk('↑', 'Move up', () => {
          [items[i - 1], items[i]] = [items[i], items[i - 1]]; commit(); render();
        }, i === 0),
        mk('↓', 'Move down', () => {
          [items[i + 1], items[i]] = [items[i], items[i + 1]]; commit(); render();
        }, i === items.length - 1),
        mk(item._visible === false ? '○' : '●',
           item._visible === false ? 'Show on the site' : 'Hide from the site',
           () => { item._visible = item._visible === false; commit(); render(); }),
      );

      if (!locked) {
        bar.append(mk('×', 'Delete this item', async () => {
          const yes = await confirmModal({
            title: 'Delete this item?',
            body: `"${label || `Item ${i + 1}`}" will be removed. You can still `
                + 'roll back to a previous publish from History afterwards.',
            ok: 'Delete', danger: true,
          });
          if (!yes) return;
          items.splice(i, 1); commit(); render();
        }));
      }

      const body = document.createElement('div');
      body.className = 'item__body';

      field.item.forEach((sub) => {
        if (sub.kind === 'image') {
          body.append(imageControl(sub.label, item[sub.name] ?? {},
            (v) => { item[sub.name] = v; commit(); }));
          return;
        }

        /* A SIZE PICKER, added 2 Sep 2026 for product galleries.
           The editor sees "King Lodge 1000grm" and the record stores the SKU,
           because a SKU survives a rebuild and a size label can be edited.
           Options come from `field.variants`, which the Photos control passes
           in from the products API. "All sizes" is the empty string, which the
           renderer treats as a general shot. */
        if (sub.kind === 'variant') {
          const vid = `i_${key.replace(/\W/g, '_')}_${i}_${sub.name}`;
          const f = document.createElement('div');
          f.className = 'field field--variant';
          const current = item[sub.name] ?? '';
          const opts = ['<option value="">All sizes</option>'].concat(
            (field.variants || []).map((v) =>
              `<option value="${esc(v.sku)}">${esc(v.size || v.sku)}</option>`));
          f.innerHTML = `<label for="${vid}">${esc(sub.label)}</label>`
            + `<select id="${vid}">${opts.join('')}</select>`
            + '<p class="hint">Leave on "All sizes" for a general photograph.'
            + ' Pick a size to show this one when a customer chooses it.</p>';
          const sel = $(`#${vid}`, f);
          sel.value = current;
          /* A SKU that is no longer one of this product's sizes must not vanish
             silently: setting .value to a missing option leaves the select on
             its first entry, which would look like the editor had chosen "All
             sizes" and quietly rewrite the record on the next save. Show it
             instead, labelled, so the reason a photograph stopped matching is
             visible. */
          if (current && sel.value !== current) {
            sel.insertAdjacentHTML('beforeend',
              `<option value="${esc(current)}">${esc(current)}`
              + ' · no longer a size</option>');
            sel.value = current;
          }
          sel.addEventListener('change', () => {
            item[sub.name] = sel.value;
            commit();
          });
          body.append(f);
          return;
        }

        const id = `i_${key.replace(/\W/g, '_')}_${i}_${sub.name}`;
        const f = document.createElement('div');
        f.className = 'field';
        const multiline = sub.kind === 'richtext'
          && /quote|caption|blurb|body/.test(sub.name);
        f.innerHTML = `<label for="${id}">${esc(sub.label)}</label>` +
          (multiline ? `<textarea id="${id}"></textarea>`
                     : `<input type="text" id="${id}"${sub.readonly ? ' disabled' : ''}>`);
        const input = $(`#${id}`, f);
        input.value = item[sub.name] ?? '';
        if (!sub.readonly) {
          input.addEventListener('input', () => {
            item[sub.name] = input.value;
            commit();
            /* Update the collapsed header live, without a full re-render, which
               would blur the field being typed into. */
            if (titleField && sub.name === titleField.name) {
              $('strong', bar).textContent =
                input.value.replace(/<[^>]*>/g, '').slice(0, 60) || `Item ${i + 1}`;
            }
          });
        }
        body.append(f);
      });

      card.append(bar, body);
      wrap.append(card);
    });

    if (!locked) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'btn btn--ghost btn--sm';
      /* `addLabel` overrides the derived one. The derivation just strips a
         trailing s and lowercases, which turns "More photographs" into
         "Add more photograph". Fine for "Cards" and "Testimonials";
         wrong the moment a label is more than one word. */
      add.textContent = field.addLabel
        || `Add ${field.label.replace(/s$/, '').toLowerCase()}`;
      add.addEventListener('click', () => {
        const blank = { _visible: true };
        field.item.forEach((s) => {
          blank[s.name] = s.kind === 'image' ? { src: '', alt: '' } : '';
        });
        items.push(blank); commit(); render();
      });
      wrap.append(add);
    }
  };

  render();
  return wrap;
}

/* --- media --------------------------------------------------------------- */

function pickFile() {
  return new Promise((resolve) => {
    const input = $('#filepick');
    const onChange = async () => {
      input.removeEventListener('change', onChange);
      const file = input.files?.[0];
      input.value = '';
      resolve(file ? await uploadFile(file) : null);
    };
    input.addEventListener('change', onChange);
    input.click();
  });
}

async function uploadFile(file) {
  /* Checked before the upload so a 12 MB photo fails in a tenth of a second
     rather than after a slow upload. The server checks again, on the bytes. */
  if (file.size > 8 * 1024 * 1024) {
    toast(`That image is ${bytes(file.size)}. The limit is 8 MB.`, true);
    return null;
  }
  const fd = new FormData();
  fd.append('file', file);
  toast(`Uploading ${file.name}…`);
  try {
    const r = await call(API.media, { method: 'POST', form: fd });
    toast(r.deduplicated
      ? 'That image was already in the library, so it was reused.'
      : `Uploaded ${file.name}`);
    await loadMedia();
    return r.media;
  } catch (ex) {
    toast(ex.message, true);
    return null;
  }
}

async function loadMedia() {
  try { State.media = (await call(API.media)).media ?? []; }
  catch { State.media = []; }
}

async function pickFromLibrary() {
  await loadMedia();
  return new Promise((resolve) => {
    const dlg = $('#modal');
    $('#modal-title').textContent = 'Choose an image';
    $('#modal-body').textContent = State.media.length
      ? 'Click an image to use it.'
      : 'Nothing has been uploaded yet. Use Upload instead.';
    const extra = $('#modal-extra');
    extra.innerHTML = '<div class="media" style="margin-top:14px;max-height:50vh;overflow:auto"></div>';
    const grid = $('.media', extra);

    State.media.forEach((m) => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'media__cell';
      cell.innerHTML = `<img src="${esc(m.url)}" alt="" loading="lazy">
        <figcaption><b>${esc(m.filename)}</b><span>${
          m.width && m.height ? `${m.width}×${m.height} · ` : ''}${bytes(m.bytes)}</span>
        </figcaption>`;
      cell.addEventListener('click', () => finish(m));
      grid.append(cell);
    });

    const okBtn = $('#modal-ok');
    const noBtn = $('#modal-cancel');
    okBtn.style.display = 'none';
    const finish = (v) => {
      noBtn.removeEventListener('click', onNo);
      dlg.removeEventListener('cancel', onEsc);
      okBtn.style.display = '';
      if (dlg.open) dlg.close();
      resolve(v);
    };
    const onNo = () => finish(null);
    const onEsc = () => finish(null);
    noBtn.addEventListener('click', onNo);
    dlg.addEventListener('cancel', onEsc);
    dlg.showModal();
  });
}

/* --- views --------------------------------------------------------------- */

function renderNav() {
  const nav = $('#nav');
  nav.innerHTML = '';
  const add = (id, label) => {
    const a = document.createElement('a');
    a.className = 'nav';
    a.href = `#${id}`;
    a.textContent = label;
    if (State.view === id) a.setAttribute('aria-current', 'page');
    nav.append(a);
  };
  const group = (text) => {
    const g = document.createElement('div');
    g.className = 'rail__group';
    g.textContent = text;
    nav.append(g);
  };

  group('Website content');
  State.model.groups.forEach((grp) => add(grp.id, grp.title));
  add('products', 'Products');
  add('shoporder', 'Shop order');
  group('Manage');
  add('media', 'Images');
  add('history', 'History');
  if (State.user.role === 'admin') add('users', 'People');
  add('account', 'My account');
}

function renderGroup(group) {
  const view = $('#view');
  view.innerHTML = '';
  $('#title').textContent = group.title;

  if (group.blurb) {
    const p = document.createElement('p');
    p.className = 'lede';
    p.textContent = group.blurb;
    view.append(p);
  }

  group.sections.forEach((section) => {
    const card = document.createElement('section');
    card.className = 'card';

    const head = document.createElement('div');
    head.className = 'card__head';
    head.innerHTML = `<h2>${esc(section.title)}</h2><div class="spacer"></div>`;

    /* A section that can be hidden gets its switch in the header, where it
       reads as a property of the whole section rather than one more field. */
    if (section.orderable) {
      const visKey = `${section.id}.visible`;
      const cur = valueOf(visKey);
      const on = cur === undefined ? true : !!cur;
      const lab = document.createElement('label');
      lab.className = 'toggle';
      lab.innerHTML = `<input type="checkbox"${on ? ' checked' : ''}>
        <span class="toggle__track"></span><span>Visible</span>`;
      $('input', lab).addEventListener('change', (e) => {
        setValue(visKey, 'flag', e.target.checked);
        card.style.opacity = e.target.checked ? '' : '.6';
      });
      card.style.opacity = on ? '' : '.6';
      head.append(lab);
    }

    const body = document.createElement('div');
    body.className = 'card__body';

    section.fields.forEach((field) => {
      const key = field.key;
      if (field.kind === 'flag' && key.endsWith('.visible')) return;  // in the head
      let el;
      switch (field.kind) {
        case 'richtext': el = fRich(field, key); break;
        case 'link':     el = fLink(field, key); break;
        case 'image':    el = fImage(field, key); break;
        case 'list':     el = fList(field, key); break;
        case 'flag':     el = fFlag(field, key); break;
        default:         el = fText(field, key);
      }
      body.append(el);
    });

    /* Ordering lives with the section it moves. A number rather than drag and
       drop, because dragging on a phone fights with scrolling. */
    if (section.orderable) {
      const orderKey = `${section.id}.order`;
      const row = document.createElement('div');
      row.className = 'field';
      row.innerHTML = '<span class="label">Position on the page</span>';
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '10';
      input.value = valueOf(orderKey) ?? 0;
      input.style.maxWidth = '120px';
      input.addEventListener('input',
        () => setValue(orderKey, 'number', Number(input.value)));
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Lower numbers appear higher up the page. The built-in '
        + 'sections are spaced 10 apart so you can slot one between two others.';
      row.append(input, hint);
      body.append(row);
    }

    card.append(head, body);
    view.append(card);
  });
}

async function renderMedia() {
  $('#title').textContent = 'Images';
  const view = $('#view');
  view.innerHTML = '<p class="lede">Loading…</p>';
  await loadMedia();

  view.innerHTML = `
    <p class="lede">Images used across the site. Upload here, or from any image
      field. JPEG, PNG, WebP and AVIF up to 8 MB. Uploading the same file twice
      reuses the first copy rather than making a duplicate.</p>
    <div class="drop" id="drop">
      <p style="margin:0 0 12px">Drag an image here, or</p>
      <button class="btn btn--ghost btn--sm" type="button" id="pick">Choose a file</button>
    </div>
    <div class="media" id="grid"></div>`;

  const grid = $('#grid', view);
  if (!State.media.length) {
    grid.innerHTML = '<p class="lede">Nothing uploaded yet.</p>';
  }

  State.media.forEach((m) => {
    const cell = document.createElement('figure');
    cell.className = 'media__cell';
    cell.innerHTML = `<img src="${esc(m.url)}" alt="" loading="lazy">
      <figcaption><b>${esc(m.filename)}</b><span>${
        m.width && m.height ? `${m.width}×${m.height} · ` : ''}${bytes(m.bytes)} ·
        ${esc(when(m.created_at))}</span></figcaption>`;
    if (State.user.role === 'admin') {
      const foot = document.createElement('div');
      foot.style.cssText = 'padding:0 10px 10px';
      const del = document.createElement('button');
      del.className = 'btn btn--ghost btn--sm';
      del.type = 'button';
      del.textContent = 'Delete';
      del.addEventListener('click', async () => {
        const yes = await confirmModal({
          title: 'Delete this image?',
          body: `${m.filename} will be removed from storage. If any part of the `
              + 'site still uses it the deletion is refused, and you will be told '
              + 'where it is used.',
          ok: 'Delete', danger: true,
        });
        if (!yes) return;
        try {
          await call(API.media, { method: 'DELETE', body: { id: m.id } });
          toast('Image deleted');
          renderMedia();
        } catch (ex) {
          toast(ex.data?.used ? `Still used by: ${ex.data.used.join(', ')}`
                              : ex.message, true);
        }
      });
      foot.append(del);
      cell.append(foot);
    }
    grid.append(cell);
  });

  $('#pick', view).addEventListener('click',
    () => pickFile().then((m) => { if (m) renderMedia(); }));

  const drop = $('#drop', view);
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.remove('over');
  }));
  drop.addEventListener('drop', async (e) => {
    for (const f of [...(e.dataTransfer?.files ?? [])]) await uploadFile(f);
    renderMedia();
  });
}

async function renderHistory() {
  $('#title').textContent = 'History';
  const view = $('#view');
  view.innerHTML = '<p class="lede">Loading…</p>';
  const d = await call(API.history);

  const pubs = d.publishes.map((p) => `
    <tr><td>${esc(when(p.at))}</td><td>${esc(p.email ?? '')}</td>
        <td>${p.key_count} fields</td><td>${bytes(p.bytes)}</td>
        <td>${State.user.role === 'admin'
          ? `<button class="btn btn--ghost btn--sm" data-roll="${p.id}">Restore</button>`
          : ''}</td></tr>`).join('');

  const acts = d.activity.map((a) => `
    <tr><td>${esc(when(a.at))}</td><td>${esc(a.email ?? '')}</td>
        <td>${esc(a.action)}</td>
        <td style="font-family:var(--mono);font-size:12px">${esc((a.target ?? '').slice(0, 90))}</td>
    </tr>`).join('');

  view.innerHTML = `
    <p class="lede">Every publish is snapshotted, so a change that turns out
      wrong can be put back without retyping anything.</p>
    <section class="card">
      <div class="card__head"><h2>Publishes</h2></div>
      <div class="card__body tablewrap">
        <table class="table"><thead><tr>
          <th>When</th><th>Who</th><th>Size</th><th>Bytes</th><th></th>
        </tr></thead><tbody>${pubs
          || '<tr><td colspan="5">Nothing published yet.</td></tr>'}</tbody></table>
      </div>
    </section>
    <section class="card">
      <div class="card__head"><h2>Recent activity</h2></div>
      <div class="card__body tablewrap">
        <table class="table"><thead><tr>
          <th>When</th><th>Who</th><th>Action</th><th>What</th>
        </tr></thead><tbody>${acts
          || '<tr><td colspan="4">Nothing yet.</td></tr>'}</tbody></table>
      </div>
    </section>`;

  $$('[data-roll]', view).forEach((b) => b.addEventListener('click', async () => {
    const yes = await confirmModal({
      title: 'Restore this version?',
      body: 'The live site and your drafts will both be put back to how they were '
          + 'at this publish. Anything changed since then is replaced.',
      ok: 'Restore', danger: true,
    });
    if (!yes) return;
    busy(b, true);
    try {
      const r = await call(API.rollback,
        { method: 'POST', body: { id: Number(b.dataset.roll) } });
      toast(`Restored ${r.restored} fields`);
      State.edited = {};
      refreshDirty();
      await loadDraft();
      renderHistory();
    } catch (ex) { toast(ex.message, true); }
    finally { busy(b, false); }
  }));
}

async function renderUsers() {
  $('#title').textContent = 'People';
  const view = $('#view');
  view.innerHTML = '<p class="lede">Loading…</p>';
  const d = await call(API.users);

  view.innerHTML = `
    <p class="lede">Who can sign in. <strong>Editors</strong> can change and
      publish content. <strong>Administrators</strong> can also add people,
      delete images and restore old versions.</p>
    <section class="card">
      <div class="card__head"><h2>Accounts</h2></div>
      <div class="card__body tablewrap">
        <table class="table"><thead><tr>
          <th>Name</th><th>Email</th><th>Role</th><th>Last signed in</th><th></th>
        </tr></thead><tbody>${d.users.map((u) => `
          <tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td>
            <td><span class="pill${u.role === 'admin' ? ' pill--admin' : ''}">${esc(u.role)}</span>
              ${u.disabled ? '<span class="pill pill--off">disabled</span>' : ''}</td>
            <td>${esc(when(u.last_login_at))}</td>
            <td><button class="btn btn--ghost btn--sm" data-toggle="${esc(u.id)}"
                 data-disabled="${u.disabled ? 1 : 0}">${
                 u.disabled ? 'Enable' : 'Disable'}</button></td>
          </tr>`).join('')}</tbody></table>
      </div>
    </section>
    <section class="card">
      <div class="card__head"><h2>Add someone</h2></div>
      <div class="card__body">
        <p class="msg msg--error" id="uerr" role="alert" hidden></p>
        <div class="grid2">
          <div class="field"><label for="un">Name</label><input type="text" id="un"></div>
          <div class="field"><label for="ue">Email</label>
            <input type="email" id="ue" spellcheck="false"></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="up">Password</label>
            <input type="text" id="up" spellcheck="false">
            <p class="hint">At least 12 characters. Give it to them directly and
              ask them to change it under My account.</p></div>
          <div class="field"><label for="ur">Role</label>
            <select id="ur"><option value="editor">Editor</option>
              <option value="admin">Administrator</option></select></div>
        </div>
        <button class="btn" type="button" id="uadd">Create account</button>
      </div>
    </section>`;

  $$('[data-toggle]', view).forEach((b) => b.addEventListener('click', async () => {
    busy(b, true);
    try {
      await call(API.users, { method: 'PATCH',
        body: { id: b.dataset.toggle, disabled: b.dataset.disabled !== '1' } });
      renderUsers();
    } catch (ex) { toast(ex.message, true); busy(b, false); }
  }));

  $('#uadd', view).addEventListener('click', async () => {
    const err = $('#uerr', view);
    err.hidden = true;
    const btn = $('#uadd', view);
    busy(btn, true);
    try {
      await call(API.users, { method: 'POST', body: {
        name: $('#un', view).value.trim(),
        email: $('#ue', view).value.trim(),
        password: $('#up', view).value,
        role: $('#ur', view).value,
      } });
      toast('Account created');
      renderUsers();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      busy(btn, false);
    }
  });
}

function renderAccount() {
  $('#title').textContent = 'My account';
  $('#view').innerHTML = `
    <section class="card">
      <div class="card__head"><h2>${esc(State.user.name)}</h2></div>
      <div class="card__body">
        <p class="lede" style="margin-top:0">${esc(State.user.email)} ·
          ${esc(State.user.role)}</p>
        <h3>Change password</h3>
        <p class="msg msg--error" id="perr" role="alert" hidden></p>
        <div class="field"><label for="pc">Current password</label>
          <input type="password" id="pc" autocomplete="current-password"></div>
        <div class="field"><label for="pn">New password</label>
          <input type="password" id="pn" autocomplete="new-password">
          <p class="hint">At least 12 characters. A short sentence works well and
            is easier to type than something with symbols in it.</p></div>
        <button class="btn" type="button" id="pgo">Change password</button>
        <p class="hint">You will be signed out on every device afterwards.</p>
      </div>
    </section>`;

  $('#pgo').addEventListener('click', async () => {
    const err = $('#perr');
    err.hidden = true;
    const btn = $('#pgo');
    busy(btn, true);
    try {
      await call(API.password, { method: 'POST',
        body: { current: $('#pc').value, next: $('#pn').value } });
      State.edited = {};             // so beforeunload does not block the redirect
      toast('Password changed. Signing you out.');
      setTimeout(() => { location.href = '/admin/'; }, 1200);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      busy(btn, false);
    }
  });
}

/* --- products --------------------------------------------------------------
   173 products, and the CMS owns exactly three fields of each: title,
   description and photograph. Price, sizes, SKUs and Zoho variant ids are shown
   READ ONLY, because the price list and Zoho own them and a third editable copy
   would make the reconciliation problem in the product-data audit worse.

   The three editable fields write through setValue() to keys of the form
   `product.<slug>.<field>`, which means the existing Save and Publish buttons,
   the unsaved-changes count and the audit trail all work here with no special
   casing anywhere.

   An EMPTY title box means "use the name from the price list". That is why the
   catalogue name is a placeholder rather than a prefilled value: prefilling it
   would turn every product the editor merely looked at into an override that
   silently stops tracking the price list.
   -------------------------------------------------------------------------- */

/* Drive a full Zoho sync from the browser.

   THE BROWSER DRIVES IT BECAUSE THE SERVER CANNOT. A full sync is one sitemap
   read plus one request per Zoho product, and the Workers runtime caps
   subrequests per invocation, so no single request can do all of it. The server
   hands back the id list and the batch size it will accept; this walks them.
   See functions/api/admin/zoho.js.

   IT REFUSES TO PUBLISH A PARTIAL HARVEST. The bundle REPLACES the stored one,
   so publishing a short set would delete descriptions from live product pages.
   If any product failed to come back, this stops and says so, and the server
   independently checks the count as well. Two guards, because a silent content
   deletion is not a failure anyone would notice until a customer did. */
async function syncFromZoho(btn) {
  const status = $('#zstatus');
  const say = (msg) => { if (status) status.textContent = msg; };

  busy(btn, true);
  say('Asking Zoho what products it has…');
  try {
    const { ids, count, batch } = await call('/api/admin/zoho/ids');
    const size = Math.max(1, Number(batch) || 20);

    const rows = [];
    const failed = [];
    for (let i = 0; i < ids.length; i += size) {
      say(`Reading Zoho, ${Math.min(i + size, ids.length)} of ${count}…`);
      const r = await call('/api/admin/zoho/fetch', {
        method: 'POST', body: { ids: ids.slice(i, i + size) },
      });
      rows.push(...(r.rows || []));
      failed.push(...(r.failed || []));
    }

    if (failed.length) {
      say('');
      toast(`${failed.length} product${failed.length === 1 ? '' : 's'} could not `
        + 'be read from Zoho, so nothing was changed. Please try again.', true);
      return;
    }

    say('Matching Zoho to the website and publishing…');
    const done = await call('/api/admin/zoho/publish', {
      method: 'POST', body: { rows, expected: count },
    });

    /* Photos as well as descriptions since 21 Aug 2026. Counted separately
       because "12 descriptions" reading the same when six photographs also
       arrived would make the new half of the feature invisible. */
    const st = done.stats || {};
    const pieces = [];
    if (st.descriptions) {
      pieces.push(`${st.descriptions} description`
        + `${st.descriptions === 1 ? '' : 's'}`);
    }
    if (st.images) pieces.push(`${st.images} photo${st.images === 1 ? '' : 's'}`);

    say(done.written
      ? `${pieces.join(' and ')} brought across from Zoho. `
        + 'The website updates within about a minute.'
        + (st.images_held
            ? ` ${st.images_held} photo${st.images_held === 1 ? ' was' : 's were'} `
              + 'held back · see the note below.'
            : '')
      : 'Zoho has no product descriptions yet, so the website is unchanged.');
    toast(done.message || 'Sync finished');
  } catch (ex) {
    say('');
    toast(ex.message, true);
  } finally {
    busy(btn, false);
  }
}

/* One fetch, two screens. Products and Shop order both need the catalogue, and
   the second also needs the running order that comes back with it, so caching
   only half of the response would send the Shop order screen back to the
   network for something it already had. */
async function loadProducts() {
  if (State.products) return;
  const data = await call('/api/admin/products');
  State.products = data.products;
  State.ordering = data.ordering || { defaults: { featured: [], order: [] } };
}

async function renderProducts() {
  const view = $('#view');
  $('#title').textContent = 'Products';
  view.innerHTML = '<p class="lede">Loading the product list…</p>';

  await loadProducts();
  const all = State.products;

  view.innerHTML = `
    <p class="lede">${all.length} products from the price list. You can change
      the name shown on the website, add a description, and set the photograph.
      Prices, sizes and SKUs come from the price list and Zoho, so they are shown
      here but cannot be edited.</p>

    <section class="card">
      <div class="card__head">
        <h2>Descriptions written in Zoho</h2>
      </div>
      <div class="card__body">
        <p class="hint">If you write product descriptions in Zoho, press this to
          bring them across to the website. Nothing happens automatically, so
          press it whenever you have finished a batch of writing in Zoho.</p>
        <p class="hint">Anything you have typed into a product below stays as it
          is. What you write here always beats what is in Zoho, so this will not
          overwrite your own wording.</p>
        <p>
          <button class="btn" type="button" id="zsync">Sync from Zoho</button>
        </p>
        <p class="hint" id="zstatus" role="status" aria-live="polite"></p>
      </div>
    </section>

    <section class="card">
      <div class="card__body">
        <div class="field">
          <label for="psearch">Find a product</label>
          <input type="text" id="psearch" placeholder="Search by name, category or SKU">
          <p class="hint" id="pcount"></p>
        </div>
      </div>
    </section>
    <div id="plist" class="plist"></div>`;

  $('#zsync', view).addEventListener('click', (e) => syncFromZoho(e.currentTarget));

  const list = $('#plist', view);
  const search = $('#psearch', view);
  const count = $('#pcount', view);

  const isEdited = (p) => {
    const photos = valueOf(`product.${p.key}.photos`);
    return valueOf(`product.${p.key}.title`)
      || valueOf(`product.${p.key}.description`)
      || valueOf(`product.${p.key}.image`)
      /* An empty array is a real saved value but not an edit worth a pill, and
         `[]` is truthy in JavaScript, so the length matters here. */
      || (Array.isArray(photos) && photos.length > 0);
  };

  const money = (p) => {
    if (p.unpriced) return 'Price on application';
    if (p.lo == null) return '';
    return p.lo === p.hi ? `NZ$${p.lo.toFixed(2)}`
      : `NZ$${p.lo.toFixed(2)} to NZ$${p.hi.toFixed(2)}`;
  };

  function draw() {
    const q = search.value.trim().toLowerCase();
    const shown = !q ? all : all.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.cat || '').toLowerCase().includes(q) ||
      (p.section || '').toLowerCase().includes(q) ||
      p.skus.some((s) => s.toLowerCase().includes(q)));

    const editedCount = all.filter(isEdited).length;
    count.textContent = `${shown.length} shown of ${all.length}. `
      + (editedCount ? `${editedCount} with CMS changes.` : 'None changed yet.');

    list.innerHTML = '';
    shown.forEach((p) => list.append(row(p)));
  }

  function row(p) {
    const el = document.createElement('section');
    el.className = 'card prow';

    const head = document.createElement('div');
    head.className = 'card__head';
    const shownName = valueOf(`product.${p.key}.title`) || p.name;
    head.innerHTML =
      `<h2>${esc(shownName)}</h2>` +
      (isEdited(p) ? '<span class="pill">edited</span>' : '') +
      '<div class="spacer"></div>' +
      `<span class="prow__meta">${esc(p.cat || '')} · ${esc(money(p))}</span>` +
      '<button class="btn btn--ghost btn--sm" type="button" data-open>Edit</button>';
    el.append(head);

    const body = document.createElement('div');
    body.className = 'card__body';
    body.hidden = true;
    el.append(body);

    let built = false;
    $('[data-open]', head).addEventListener('click', () => {
      body.hidden = !body.hidden;
      $('[data-open]', head).textContent = body.hidden ? 'Edit' : 'Close';
      if (built || body.hidden) return;
      built = true;

      /* Read-only facts first, so it is obvious what this screen does not own. */
      const facts = document.createElement('p');
      facts.className = 'hint';
      facts.innerHTML =
        `Price list name: <b>${esc(p.name)}</b><br>` +
        `Category: ${esc(p.cat || '')}${p.section ? ` · ${esc(p.section)}` : ''}<br>` +
        `${p.sku_count} size${p.sku_count === 1 ? '' : 's'}: ` +
        `${esc(p.skus.join(', '))}${p.sku_count > p.skus.length ? '…' : ''}<br>` +
        `Price: ${esc(money(p))} · ` +
        `<a href="${esc(p.url)}" target="_blank" rel="noopener">view on the website</a>`;
      body.append(facts);

      const titleField = fText(
        { label: 'Name shown on the website', kind: 'text',
          help: 'Leave empty to use the name from the price list.' },
        `product.${p.key}.title`);
      $('input', titleField).placeholder = p.name;
      body.append(titleField);

      body.append(fRich(
        { label: 'Description', kind: 'richtext', blocks: true,
          help: 'Shown on the product page. There are no descriptions today, so '
              + 'anything here is new copy.' },
        `product.${p.key}.description`));

      /* The single photograph, kept because 33 products are live on it and the
         renderer falls back to it. An editor who never opens Photographs sees
         exactly the control they saw before. */
      body.append(fImage({ label: 'Photograph' }, `product.${p.key}.image`));

      /* The gallery, added 2 Sep 2026. Built on the existing `list` kind, so
         reorder, delete, the image picker and the media library all come for
         free. `variants` rides along on the field descriptor purely so the
         size dropdown inside each row can label itself; fList ignores any
         property it does not know. */
      body.append(fList({
        label: 'More photographs',
        kind: 'list',
        saveKind: 'gallery',
        addLabel: 'Add a photograph',
        variants: p.variants || [],
        help: 'Add as many as you like and drag to reorder. The first one set '
            + 'to "All sizes" is the photograph used on the shop page. Leave '
            + 'this empty and the single Photograph above is used, exactly as '
            + 'before.',
        item: [
          { name: 'image', label: 'Photograph', kind: 'image' },
          { name: 'sku', label: 'Shows which size', kind: 'variant' },
        ],
      }, `product.${p.key}.photos`));
    });

    return el;
  }

  let t;
  search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(draw, 120);      // 173 rows redraw fast, but not per keystroke
  });
  draw();
}

/* --- shop order ------------------------------------------------------------
   TWO ORDERED LISTS OF PRODUCT SLUGS, and they are deliberately independent.

       product.featured   what the shop shows first, under the heading
                          "Featured Products", in this order.
       product.order      the running order of the whole range. It decides where
                          anything NOT featured sits, and it is the order inside
                          each of the eight category pages.

   Both save through setValue() as kind `slugs`, which means the existing Save
   and Publish buttons, the unsaved-changes count, the audit trail and rollback
   all work here with no special casing, exactly as the product fields do.

   NEITHER KEY EXISTS UNTIL SOMETHING IS MOVED, and that is load-bearing rather
   than lazy. Absent means "use the price-list order", which is what the site
   ships with and what Cazsper asked for: every product featured, in the order
   of the `Casper` worksheet. Writing 173 slugs into the database on first load
   would freeze that, and a product added to the price list next month would
   then arrive un-featured and last instead of in its spreadsheet position. So
   this screen READS the built default and only writes once an editor has
   actually changed something.

   ⚠ AN EMPTY FEATURED LIST IS A REAL STATE, not the same as an absent one. It
   means "nothing is featured", and the shop honours it: everything drops below
   the "The rest of the range" divider. That is why "Feature nothing" saves `[]`
   rather than deleting the key.

   A NUMBER BOX AS WELL AS ARROWS, because 173 rows is where one-step-at-a-time
   stops being usable. The category list next door is eight items and arrows
   alone are right there. Same buttons, same icons, one more control.
   -------------------------------------------------------------------------- */

const KEY_FEATURED = 'product.featured';
const KEY_ORDER = 'product.order';

async function renderShopOrder() {
  const view = $('#view');
  $('#title').textContent = 'Shop order';
  view.innerHTML = '<p class="lede">Loading the product list…</p>';

  await loadProducts();
  const all = State.products;
  const bySlug = new Map(all.map((p) => [p.slug, p]));
  const defaults = State.ordering.defaults;

  /* Resolve a key to a usable list: the draft if one exists, the built default
     if not, then filtered to products that still exist. `complete` appends
     anything the list does not mention, so the full-range order can never be
     missing a product just because it was added after the order was saved. */
  const resolve = (key, fallback, complete) => {
    const raw = valueOf(key);
    const src = Array.isArray(raw) ? raw : fallback;
    const seen = new Set();
    const out = [];
    src.forEach((s) => {
      if (bySlug.has(s) && !seen.has(s)) { seen.add(s); out.push(s); }
    });
    if (complete) {
      defaults.order.forEach((s) => {
        if (bySlug.has(s) && !seen.has(s)) { seen.add(s); out.push(s); }
      });
    }
    return out;
  };

  let featured = resolve(KEY_FEATURED, defaults.featured, false);
  let order = resolve(KEY_ORDER, defaults.order, true);
  let tab = 'featured';

  const commitFeatured = () => setValue(KEY_FEATURED, 'slugs', featured.slice());
  const commitOrder = () => setValue(KEY_ORDER, 'slugs', order.slice());

  view.innerHTML = `
    <p class="lede">The order customers see. <b>Featured</b> is what the shop
      shows first, under the heading “Featured Products”. <b>Full range</b> is
      the running order of everything, and it is also the order inside each
      category page. Changing one does not change the other.</p>

    <section class="card">
      <div class="card__head">
        <h2 id="ordhead">Featured</h2>
        <span class="pill" id="ordcount"></span>
        <div class="spacer"></div>
        <div class="ord__tabs" role="tablist">
          <button class="btn btn--sm" type="button" role="tab" data-tab="featured">Featured</button>
          <button class="btn btn--sm btn--ghost" type="button" role="tab" data-tab="order">Full range</button>
        </div>
      </div>
      <div class="card__body">
        <p class="hint" id="ordhint"></p>
        <div class="ord__bulk" id="ordbulk"></div>
        <div class="field">
          <label for="ordfind">Find a product</label>
          <input type="text" id="ordfind" placeholder="Search by name, category or SKU">
          <p class="hint">Searching only filters what is listed. The arrows still
            move a product one place in the real order, not one place in what you
            can see.</p>
        </div>
        <div class="ord" id="ordlist"></div>
      </div>
    </section>`;

  const listEl = $('#ordlist', view);
  const findEl = $('#ordfind', view);
  const headEl = $('#ordhead', view);
  const countEl = $('#ordcount', view);
  const hintEl = $('#ordhint', view);
  const bulkEl = $('#ordbulk', view);

  const matches = (p, q) => !q
    || p.name.toLowerCase().includes(q)
    || (p.cat || '').toLowerCase().includes(q)
    || (p.section || '').toLowerCase().includes(q)
    || p.skus.some((s) => s.toLowerCase().includes(q));

  /* Move `from` to `to` in `list`, clamped. One helper for the arrows, the
     first/last buttons and the position box, so the four cannot disagree about
     what happens at the ends. */
  const move = (list, from, to) => {
    const at = Math.max(0, Math.min(list.length - 1, to));
    if (at === from) return false;
    list.splice(at, 0, list.splice(from, 1)[0]);
    return true;
  };

  function draw() {
    const isFeatured = tab === 'featured';
    const list = isFeatured ? featured : order;
    const featuredSet = new Set(featured);
    const q = findEl.value.trim().toLowerCase();

    headEl.textContent = isFeatured ? 'Featured' : 'Full range';
    countEl.textContent = isFeatured
      ? `${featured.length} of ${all.length} featured`
      : `${order.length} products`;
    hintEl.textContent = isFeatured
      ? 'These appear first on the shop page, in this order. Everything you '
        + 'un-feature is still for sale and still on the shop page, below a '
        + '“The rest of the range” heading, in full-range order.'
      : 'The order of the whole range. It decides where un-featured products '
        + 'sit on the shop page, and the order of products inside each category.';

    bulkEl.innerHTML = isFeatured
      ? '<button class="btn btn--ghost btn--sm" type="button" data-bulk="all">Feature everything</button>'
        + '<button class="btn btn--ghost btn--sm" type="button" data-bulk="none">Feature nothing</button>'
        + '<button class="btn btn--ghost btn--sm" type="button" data-bulk="reset">Back to price-list order</button>'
      : '<button class="btn btn--ghost btn--sm" type="button" data-bulk="resetorder">Back to price-list order</button>';

    $$('[data-bulk]', bulkEl).forEach((b) =>
      b.addEventListener('click', () => bulk(b.dataset.bulk)));

    const frag = document.createDocumentFragment();
    let shown = 0;

    list.forEach((slug, i) => {
      const p = bySlug.get(slug);
      if (!p || !matches(p, q)) return;
      shown += 1;

      const row = document.createElement('div');
      row.className = 'ord__row'
        + (!isFeatured && !featuredSet.has(slug) ? ' ord__row--plain' : '');
      row.innerHTML = `
        <input class="ord__pos" type="number" min="1" max="${list.length}"
               value="${i + 1}" aria-label="Position of ${esc(p.name)}">
        <span class="ord__name">${esc(valueOf(`product.${p.key}.title`) || p.name)}</span>
        <span class="ord__cat">${esc(p.cat || '')}</span>
        <span class="ord__acts"></span>`;

      const acts = $('.ord__acts', row);
      const mk = (txt, title, fn, disabled) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'iconbtn';
        b.textContent = txt;
        b.title = title;
        b.setAttribute('aria-label', `${title}: ${p.name}`);
        b.disabled = !!disabled;
        b.addEventListener('click', fn);
        acts.append(b);
        return b;
      };

      /* NOT named `save`. There is a module-level save() that drives the Save
         button, and shadowing it inside a click handler is the kind of thing
         that works until somebody moves a line. */
      const persist = () => (isFeatured ? commitFeatured() : commitOrder());
      const shift = (to) => { if (move(list, i, to)) { persist(); draw(); } };

      mk('⤒', 'Move to the top', () => shift(0), i === 0);
      mk('↑', 'Move up', () => shift(i - 1), i === 0);
      mk('↓', 'Move down', () => shift(i + 1), i === list.length - 1);
      mk('⤓', 'Move to the bottom', () => shift(list.length - 1),
         i === list.length - 1);

      if (isFeatured) {
        mk('×', 'Remove from Featured', () => {
          featured.splice(i, 1); commitFeatured(); draw();
        });
      } else {
        const on = featuredSet.has(slug);
        mk(on ? '★' : '☆', on ? 'Remove from Featured' : 'Add to Featured', () => {
          if (on) featured = featured.filter((s) => s !== slug);
          /* Appended, not inserted at the full-range position. Featured is a
             curated list with its own order, and quietly deciding where a
             newly featured product belongs in it would be this screen making
             an editorial choice on the editor's behalf. */
          else featured.push(slug);
          commitFeatured(); draw();
        });
      }

      /* `change`, not `input`: typing "12" fires once for "1" and once for
         "12", and moving the row on the first keystroke pulls the box out from
         under the cursor. */
      $('.ord__pos', row).addEventListener('change', (ev) => {
        const n = parseInt(ev.target.value, 10);
        if (!Number.isFinite(n)) { draw(); return; }
        shift(n - 1);
      });

      frag.append(row);
    });

    listEl.innerHTML = '';
    if (!shown) {
      listEl.innerHTML = q
        ? '<p class="hint">Nothing matches that search.</p>'
        : '<p class="hint">Nothing is featured. Every product is still on the '
          + 'shop page, under “The rest of the range”.</p>';
      return;
    }
    listEl.append(frag);
  }

  async function bulk(what) {
    if (what === 'all') {
      /* Everything, in FULL-RANGE order rather than the current featured order,
         because "feature everything" after un-featuring a handful should give
         back the running order, not the running order with the strays welded
         onto the end. */
      featured = order.slice();
      commitFeatured();
    } else if (what === 'none') {
      const yes = await confirmModal({
        title: 'Feature nothing?',
        body: 'The shop page will show every product under “The rest of the '
            + 'range” instead of a featured selection. Nothing is removed from '
            + 'sale and no product disappears. You can undo this before you '
            + 'publish, or roll back afterwards from History.',
        ok: 'Feature nothing',
      });
      if (!yes) return;
      featured = [];
      commitFeatured();
    } else if (what === 'reset') {
      featured = defaults.featured.filter((s) => bySlug.has(s));
      commitFeatured();
    } else if (what === 'resetorder') {
      order = defaults.order.filter((s) => bySlug.has(s));
      commitOrder();
    }
    draw();
  }

  $$('[data-tab]', view).forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    $$('[data-tab]', view).forEach((x) =>
      x.classList.toggle('btn--ghost', x.dataset.tab !== tab));
    findEl.value = '';
    draw();
  }));

  let t;
  findEl.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(draw, 120);
  });
  draw();
}

/* --- routing -------------------------------------------------------------- */

async function route() {
  const id = location.hash.slice(1) || State.model.groups[0].id;
  State.view = id;
  renderNav();
  $('#rail').dataset.open = 'false';
  $('#scrim').hidden = true;
  window.scrollTo(0, 0);

  try {
    if (id === 'products') return await renderProducts();
    if (id === 'shoporder') return await renderShopOrder();
    if (id === 'media')   return await renderMedia();
    if (id === 'history') return await renderHistory();
    if (id === 'users')   return await renderUsers();
    if (id === 'account') return renderAccount();
    const group = State.model.groups.find((g) => g.id === id);
    if (!group) { location.hash = State.model.groups[0].id; return; }
    renderGroup(group);
  } catch (ex) {
    if (ex.message === 'unauthenticated') return;
    $('#view').innerHTML = `<p class="msg msg--error">${esc(ex.message)}</p>`;
  }
}

/* --- save and publish ----------------------------------------------------- */

async function save() {
  const keys = Object.keys(State.edited);
  if (!keys.length) return;
  const btn = $('#save');
  busy(btn, true);

  const changes = {};
  keys.forEach((k) => {
    changes[k] = { kind: State.draft[k]?.kind ?? 'text', value: State.edited[k] };
  });

  try {
    const r = await call(API.content, { method: 'PUT', body: { changes } });
    /* Adopt the SERVER'S normalised values, not the ones that were typed.
       Sanitising can change what was entered, and re-showing the raw input
       would let someone save the same rejected markup over and over without
       ever seeing that it had been stripped. */
    Object.entries(r.values ?? {}).forEach(([k, v]) => {
      State.draft[k] = { ...(State.draft[k] ?? {}), value: v };
    });
    State.edited = {};
    refreshDirty();
    toast(`Saved ${r.saved} field${r.saved === 1 ? '' : 's'}. `
        + 'Publish to put it on the site.');
    route();
  } catch (ex) {
    toast(ex.message, true);
  } finally {
    busy(btn, false);
    /* busy() re-enables the button unconditionally, which would leave Save
       clickable with nothing to save. Re-derive it from the dirty count, which
       is the thing that actually decides. */
    refreshDirty();
  }
}

async function publish() {
  if (Object.keys(State.edited).length) {
    const yes = await confirmModal({
      title: 'You have unsaved changes',
      body: 'Publishing puts the last SAVED version on the live site, so your '
          + 'unsaved edits would not be included. Save them first?',
      ok: 'Save, then publish',
    });
    if (!yes) return;
    await save();
  }

  const yes = await confirmModal({
    title: 'Publish to the live website?',
    body: 'Everything currently saved goes live at thelittlenest.co.nz and '
        + 'appears within about a minute. You can restore this version later '
        + 'from History.',
    ok: 'Publish',
  });
  if (!yes) return;

  const btn = $('#publish');
  busy(btn, true);
  try {
    const r = await call(API.publish, { method: 'POST' });
    toast(`Published ${r.keys} fields. Live within a minute.`);
  } catch (ex) {
    toast(ex.message, true);
  } finally {
    busy(btn, false);
  }
}

async function loadDraft() {
  State.draft = (await call(API.content)).draft ?? {};
}

/* --- boot ---------------------------------------------------------------- */

async function initApp() {
  try {
    const s = await call(API.session);
    if (!s.authenticated) { location.replace('/admin/'); return; }
    State.user = s.user;
  } catch (ex) {
    $('#view').innerHTML = `<p class="msg msg--error">${esc(ex.message)}</p>`;
    return;
  }

  $('#who').innerHTML = `${esc(State.user.name)}<span>${
    esc(State.user.email)} · ${esc(State.user.role)}</span>`;

  try {
    const [model] = await Promise.all([
      fetch('model.json', { credentials: 'same-origin' })
        .then((r) => { if (!r.ok) throw new Error(`model.json ${r.status}`); return r.json(); }),
      loadDraft(),
    ]);
    State.model = model;
  } catch (ex) {
    $('#view').innerHTML =
      `<p class="msg msg--error">Could not load the content model. ${esc(ex.message)}</p>`;
    return;
  }

  $('#save').addEventListener('click', save);
  $('#publish').addEventListener('click', publish);

  $('#signout').addEventListener('click', async () => {
    if (Object.keys(State.edited).length) {
      const yes = await confirmModal({
        title: 'Sign out with unsaved changes?',
        body: `${Object.keys(State.edited).length} change(s) have not been saved. `
            + 'They will be lost.',
        ok: 'Sign out anyway', danger: true,
      });
      if (!yes) return;
    }
    State.edited = {};
    try { await call(API.logout, { method: 'POST' }); } catch { /* leave anyway */ }
    location.href = '/admin/';
  });

  const rail = $('#rail');
  const scrim = $('#scrim');
  $('#railtoggle').addEventListener('click', () => {
    const open = rail.dataset.open !== 'true';
    rail.dataset.open = String(open);
    scrim.hidden = !open;
    $('#railtoggle').setAttribute('aria-expanded', String(open));
  });
  scrim.addEventListener('click', () => {
    rail.dataset.open = 'false';
    scrim.hidden = true;
  });

  /* Ctrl/Cmd+S is what anyone editing text will reach for. Intercepting it
     beats letting the browser offer to save the page as an HTML file. */
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  });

  window.addEventListener('hashchange', route);
  route();
}

document.addEventListener('DOMContentLoaded', () => {
  if ($('#form')) initSignIn();
  else if ($('#view')) initApp();
});
