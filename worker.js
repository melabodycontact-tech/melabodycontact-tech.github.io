// Production version of the API, for Cloudflare Workers (static assets + 3 routes).
// Mirrors server.py: /api/checkout (Stripe), /api/subscribe (Kit), /api/contact (forward URL).
// Secrets are set with `npx wrangler secret put NAME`; see README.
import catalog from './public/products.json';

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Stripe expects nested form fields: a[b][0][c]=value
function flatten(obj, prefix = '', out = new URLSearchParams()) {
  if (Array.isArray(obj)) obj.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  else if (obj && typeof obj === 'object') Object.entries(obj).forEach(([k, v]) => flatten(v, prefix ? `${prefix}[${k}]` : k, out));
  else out.append(prefix, String(obj));
  return out;
}

function buildSession(items, siteUrl) {
  const byId = Object.fromEntries(catalog.products.map(p => [p.id, p]));
  const qtyById = {};
  for (const it of Array.isArray(items) ? items : []) {
    const qty = Number(it?.qty);
    if (!byId[it?.id]) throw new Error('Your bag has an item we could not find. Please refresh and try again.');
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new Error('Quantities can be between 1 and 20 per item.');
    qtyById[it.id] = Math.min((qtyById[it.id] || 0) + qty, 20);
  }
  const ids = Object.keys(qtyById);
  if (!ids.length) throw new Error('Your bag is empty.');

  let subtotal = 0;
  const line_items = ids.map(id => {
    const p = byId[id], quantity = qtyById[id];
    subtotal += p.priceCents * quantity;
    const product_data = { name: p.name, description: p.size };
    if (siteUrl.startsWith('https://')) product_data.images = [`${siteUrl}/${p.image.replace(/^\//, '')}`];
    return { price_data: { currency: catalog.currency, unit_amount: p.priceCents, product_data }, quantity };
  });

  const ship = catalog.shipping;
  const free = Boolean(ship.freeOverCents) && subtotal >= ship.freeOverCents;
  const session = {
    mode: 'payment',
    line_items,
    success_url: `${siteUrl}/thank-you?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/shop`,
    shipping_address_collection: { allowed_countries: ship.allowedCountries },
    shipping_options: [{ shipping_rate_data: {
      type: 'fixed_amount',
      display_name: free ? 'Free shipping' : ship.label,
      fixed_amount: { amount: free ? 0 : ship.flatRateCents, currency: catalog.currency },
    } }],
    allow_promotion_codes: true,
  };
  if (catalog.automaticTax) session.automatic_tax = { enabled: true };
  return session;
}

async function checkout(data, env, url) {
  if (!env.STRIPE_SECRET_KEY) return json(503, { error: 'Checkout is not available right now.' });
  let session;
  try { session = buildSession(data.items, (env.SITE_URL || url.origin).replace(/\/$/, '')); }
  catch (e) { return json(400, { error: e.message }); }
  const res = await fetch(`${env.STRIPE_API_BASE || 'https://api.stripe.com'}/v1/checkout/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: flatten(session),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Stripe error', res.status, out?.error?.message);
    return json(502, { error: 'Checkout could not start. Please try again in a moment.' });
  }
  return json(200, { url: out.url });
}

async function subscribe(data, env) {
  const email = String(data.email || '').trim();
  if (data.company) return json(200, { ok: true }); // honeypot
  if (!EMAIL_RE.test(email) || email.length > 254) return json(400, { error: 'Please enter a valid email address.' });
  if (!env.KIT_API_KEY) return json(503, { error: 'Sign-up is not available right now.' });
  const headers = { 'Content-Type': 'application/json', 'X-Kit-Api-Key': env.KIT_API_KEY };
  const body = JSON.stringify({ email_address: email });
  let res = await fetch('https://api.kit.com/v4/subscribers', { method: 'POST', headers, body });
  if (res.ok && env.KIT_FORM_ID) {
    res = await fetch(`https://api.kit.com/v4/forms/${env.KIT_FORM_ID}/subscribers`, { method: 'POST', headers, body });
  }
  if (!res.ok) {
    console.error('Kit error', res.status, await res.text());
    return json(502, { error: 'Sign-up failed. Please try again.' });
  }
  return json(200, { ok: true });
}

async function contact(data, env) {
  const name = String(data.name || '').trim(), email = String(data.email || '').trim(), message = String(data.message || '').trim();
  if (data.company) return json(200, { ok: true });
  if (!name || !message || !EMAIL_RE.test(email)) return json(400, { error: 'Please fill in your name, a valid email and a message.' });
  if (!env.CONTACT_FORWARD_URL) return json(503, { error: 'The contact form is not available right now.' });
  const res = await fetch(env.CONTACT_FORWARD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ name: name.slice(0, 200), email: email.slice(0, 254), message: message.slice(0, 5000) }),
  });
  if (!res.ok) return json(502, { error: 'Your message could not be sent. Please try again.' });
  return json(200, { ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (request.method !== 'POST') return json(405, { error: 'Use POST.' });
    let data;
    try { data = await request.json(); } catch { return json(400, { error: 'Bad request.' }); }
    if (!data || typeof data !== 'object') return json(400, { error: 'Bad request.' });
    if (url.pathname === '/api/checkout') return checkout(data, env, url);
    if (url.pathname === '/api/subscribe') return subscribe(data, env);
    if (url.pathname === '/api/contact') return contact(data, env);
    return json(404, { error: 'Not found.' });
  },
};
