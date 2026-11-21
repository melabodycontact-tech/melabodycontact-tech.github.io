/* mela site script: menu, cart, checkout, "join the list" forms and popup. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }
  };
  const money = c => '$' + (c / 100).toFixed(2).replace(/\.00$/, '');
  const ETSY = 'https://www.etsy.com/shop/melabotanical';
  let catalogPromise;
  const loadCatalog = () => (catalogPromise ??= fetch('products.json').then(r => r.json()));

  // On static hosting (e.g. GitHub Pages) there is no /api server: those requests come back as HTML or fail.
  class NoServer extends Error {}
  async function postJSON(url, body) {
    let r;
    try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch { throw new NoServer(); }
    const data = await r.json().catch(() => null);
    if (!data) throw new NoServer();
    if (!r.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }

  /* ---------- dropdown menu ---------- */
  const menuBtn = $('.menu-toggle'), menuList = $('#menu-list');
  const setMenu = open => { if (!menuBtn) return; menuBtn.setAttribute('aria-expanded', String(open)); menuList.classList.toggle('open', open); };
  menuBtn?.addEventListener('click', () => setMenu(menuBtn.getAttribute('aria-expanded') !== 'true'));
  document.addEventListener('click', e => { if (!e.target.closest('.menu')) setMenu(false); });
  $$('.menu-list a').forEach(a => { if (a.pathname === location.pathname.replace(/\.html$/, '')) a.setAttribute('aria-current', 'page'); });

  /* ---------- injected UI: cart drawer + join popup ---------- */
  document.body.insertAdjacentHTML('beforeend', `
    <div class="drawer-backdrop" data-close-cart></div>
    <aside class="cart-drawer" id="cart" aria-label="Shopping bag" aria-hidden="true">
      <div class="drawer-head"><h2>your bag</h2><button class="icon-btn" type="button" data-close-cart aria-label="Close bag">&times;</button></div>
      <ul class="cart-items"></ul>
      <div class="cart-empty"><p>Your bag is empty.</p><a class="btn btn-outline" href="shop">shop the collection</a></div>
      <div class="drawer-foot">
        <div class="row"><span>Subtotal</span><span class="cart-subtotal">$0</span></div>
        <p class="ship-note"></p>
        <button class="btn btn-block checkout-btn" type="button">checkout</button>
        <p class="cart-error" role="alert"></p>
        <p class="secure">Secure checkout by Stripe. Visa, Mastercard, Amex, Discover, Apple Pay and Google Pay accepted.</p>
      </div>
    </aside>
    <div class="modal-backdrop" data-close-modal></div>
    <div class="modal" id="join-modal" role="dialog" aria-modal="true" aria-labelledby="join-title" aria-hidden="true">
      <div class="modal-card">
        <div class="modal-media"><img src="images/face-oil-gua-sha-700.webp" alt="Beauty Face Oil with a rose quartz gua sha and gold jewelry" loading="lazy"></div>
        <div class="modal-body">
          <button class="icon-btn modal-close" type="button" data-close-modal aria-label="Close">&times;</button>
          <img class="emblem" src="images/rose.svg" alt="" width="38" height="26">
          <h2 id="join-title">join the list</h2>
          <p>For special offers and exclusive product updates.</p>
          <form class="join-form" data-source="popup">
            <label class="sr-only" for="join-popup-email">Email address</label>
            <input id="join-popup-email" type="email" name="email" placeholder="email address" autocomplete="email" required>
            <input class="hp" type="text" name="company" tabindex="-1" autocomplete="off" aria-hidden="true">
            <button class="btn" type="submit">join</button>
            <p class="form-msg" role="status"></p>
          </form>
          <button class="link" type="button" data-close-modal>no thanks</button>
        </div>
      </div>
    </div>`);

  /* ---------- cart ---------- */
  const drawer = $('#cart'), drawerBackdrop = $('.drawer-backdrop');
  let cartItems = store.get('mela-cart', []).filter(i => i && typeof i.id === 'string' && i.qty > 0);
  const saveCart = () => { store.set('mela-cart', cartItems); renderCart(); };
  const cartCount = () => cartItems.reduce((n, i) => n + i.qty, 0);

  function addToCart(id, qty = 1) {
    const line = cartItems.find(i => i.id === id);
    if (line) line.qty = Math.min(line.qty + qty, 20); else cartItems.push({ id, qty: Math.min(qty, 20) });
    saveCart(); openCart();
  }
  function setQty(id, qty) {
    cartItems = qty <= 0 ? cartItems.filter(i => i.id !== id) : cartItems.map(i => i.id === id ? { ...i, qty: Math.min(qty, 20) } : i);
    saveCart();
  }

  async function renderCart() {
    const n = cartCount();
    $$('.cart-count').forEach(el => { el.textContent = n; el.hidden = n === 0; });
    const { products, shipping } = await loadCatalog();
    const byId = Object.fromEntries(products.map(p => [p.id, p]));
    cartItems = cartItems.filter(i => byId[i.id]);
    const empty = cartItems.length === 0;
    $('.cart-items', drawer).innerHTML = cartItems.map(i => {
      const p = byId[i.id];
      return `<li class="cart-line">
        <img src="${p.thumb}" alt="" width="72" height="90">
        <div><a href="${p.url}">${p.name}</a><span class="muted">${p.size} &middot; ${money(p.priceCents)}</span>
          <div class="qty" data-id="${p.id}"><button type="button" data-step="-1" aria-label="Decrease quantity">&minus;</button><span>${i.qty}</span><button type="button" data-step="1" aria-label="Increase quantity">+</button></div></div>
        <div class="line-end"><span>${money(p.priceCents * i.qty)}</span><button class="link" type="button" data-remove="${p.id}">remove</button></div>
      </li>`;
    }).join('');
    $('.cart-empty', drawer).hidden = !empty;
    $('.drawer-foot', drawer).hidden = empty;
    const subtotal = cartItems.reduce((s, i) => s + byId[i.id].priceCents * i.qty, 0);
    $('.cart-subtotal', drawer).textContent = money(subtotal);
    const free = shipping.freeOverCents;
    $('.ship-note', drawer).textContent = free && subtotal >= free
      ? 'Your order ships free.'
      : free ? `You're ${money(free - subtotal)} away from free shipping. Shipping and any tax are added at checkout.`
             : 'Shipping and any tax are added at checkout.';
  }

  function openCart() {
    drawer.classList.add('open'); drawerBackdrop.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden';
    $('[data-close-cart].icon-btn', drawer).focus();
  }
  function closeCart() {
    drawer.classList.remove('open'); drawerBackdrop.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true'); document.body.style.overflow = '';
  }

  async function checkout(btn) {
    const err = $('.cart-error', drawer);
    err.textContent = ''; btn.disabled = true; btn.textContent = 'one moment';
    try {
      const { url } = await postJSON('api/checkout', { items: cartItems });
      location.href = url;
    } catch (e) {
      if (e instanceof NoServer) err.innerHTML = `Online checkout is coming soon. For now, you can order from our <a href="${ETSY}" target="_blank" rel="noopener">Etsy shop</a>.`;
      else err.textContent = e.message;
      btn.disabled = false; btn.textContent = 'checkout';
    }
  }

  /* ---------- join popup (homepage only) ---------- */
  const modal = $('#join-modal'), modalBackdrop = $('.modal-backdrop');
  let lastFocus = null;
  function openModal() {
    lastFocus = document.activeElement;
    modal.classList.add('open'); modalBackdrop.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => $('input[type=email]', modal).focus({ preventScroll: true }), 300);
  }
  function closeModal() {
    if (!modal.classList.contains('open')) return;
    modal.classList.remove('open'); modalBackdrop.classList.remove('open'); modal.setAttribute('aria-hidden', 'true');
    store.set('mela-popup-hidden-until', Date.now() + 14 * 864e5);
    lastFocus?.focus?.({ preventScroll: true });
  }
  function initPopup() {
    const force = new URLSearchParams(location.search).has('popup');
    if (!force && (document.body.dataset.page !== 'home' || store.get('mela-joined', false) || Date.now() < store.get('mela-popup-hidden-until', 0))) return;
    let shown = false;
    const show = () => { if (shown || drawer.classList.contains('open')) return; shown = true; removeEventListener('scroll', onScroll); openModal(); };
    const onScroll = () => { if (scrollY > innerHeight * 0.9) show(); };
    setTimeout(show, force ? 300 : 6000);
    addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- forms ---------- */
  document.addEventListener('submit', async e => {
    const form = e.target;
    if (!form.matches('.join-form, .contact-form')) return;
    e.preventDefault();
    const msg = $('.form-msg', form), btn = $('button[type=submit]', form);
    const data = Object.fromEntries(new FormData(form));
    msg.classList.remove('error'); msg.textContent = ''; btn.disabled = true;
    try {
      if (form.matches('.join-form')) {
        await postJSON('api/subscribe', { email: data.email, company: data.company, source: form.dataset.source });
        store.set('mela-joined', true);
        msg.textContent = "Thank you. You're on the list.";
        form.reset();
        if (form.closest('#join-modal')) setTimeout(closeModal, 1600);
      } else {
        await postJSON('api/contact', data);
        msg.textContent = 'Thank you. Your note is on its way to us.';
        form.reset();
      }
    } catch (err) {
      if (err instanceof NoServer) {
        msg.innerHTML = form.matches('.join-form')
          ? 'Sign-up opens soon. Thank you for your interest.'
          : `The contact form opens soon. Until then, you can message us on <a href="${ETSY}" target="_blank" rel="noopener">Etsy</a>.`;
      } else { msg.classList.add('error'); msg.textContent = err.message; }
    } finally { btn.disabled = false; }
  });

  /* ---------- clicks ---------- */
  document.addEventListener('click', e => {
    const t = e.target.closest('button, a, [data-close-cart], [data-close-modal]');
    if (!t) return;
    if (t.matches('[data-open-cart]')) { openCart(); return; }
    if (t.matches('[data-close-cart]')) { closeCart(); return; }
    if (t.matches('[data-close-modal]')) { closeModal(); return; }
    if (t.matches('.checkout-btn')) { checkout(t); return; }
    if (t.dataset.add) {
      const input = t.dataset.qtyInput ? $(t.dataset.qtyInput) : null;
      addToCart(t.dataset.add, Math.max(1, parseInt(input?.value, 10) || 1));
      return;
    }
    if (t.dataset.remove) { setQty(t.dataset.remove, 0); return; }
    if (t.dataset.step && t.closest('.qty')) {
      const id = t.closest('.qty').dataset.id, line = cartItems.find(i => i.id === id);
      if (line) setQty(id, line.qty + Number(t.dataset.step));
      return;
    }
    if (t.dataset.stepFor) {
      const input = $(t.dataset.stepFor);
      input.value = Math.min(20, Math.max(1, (parseInt(input.value, 10) || 1) + Number(t.dataset.delta)));
      return;
    }
    if (t.dataset.src && t.closest('.pp-thumbs')) {
      const main = $('.pp-main img');
      main.src = t.dataset.src; main.srcset = t.dataset.srcset || ''; main.alt = $('img', t).alt;
      $$('.pp-thumbs button').forEach(b => b.setAttribute('aria-current', String(b === t)));
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    setMenu(false); closeModal(); if (drawer.classList.contains('open')) closeCart();
  });

  /* ---------- prices from products.json (single source of truth) ---------- */
  loadCatalog().then(({ products }) => {
    const byId = Object.fromEntries(products.map(p => [p.id, p]));
    $$('[data-price]').forEach(el => { const p = byId[el.dataset.price]; if (p) el.textContent = money(p.priceCents); });
  }).catch(() => {});

  /* ---------- page-specific ---------- */
  if (document.body.dataset.page === 'thanks' && new URLSearchParams(location.search).has('session_id')) {
    cartItems = []; saveCart();
  }
  $$('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });
  renderCart().catch(() => {});
  initPopup();
})();
