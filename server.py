#!/usr/bin/env python3
"""Local development server for the mela website.

Serves the files in ./public and handles three small API routes:
  POST /api/checkout   creates a Stripe Checkout session and returns its URL
  POST /api/subscribe  saves "join the list" emails to local-data/subscribers.csv
  POST /api/contact    saves contact-form messages to local-data/messages.csv

Uses only the Python standard library. Run:  python3 server.py
Stripe keys are read from a .env file next to this script (see .env.example).
"""
import csv, json, os, re, ssl, sys, time
import urllib.error, urllib.parse, urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / 'public'
DATA = ROOT / 'local-data'


def load_env():
    env_file = ROOT / '.env'
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env()
PORT = int(os.environ.get('PORT', '8000'))
SITE_URL = os.environ.get('SITE_URL', f'http://localhost:{PORT}').rstrip('/')
STRIPE_KEY = os.environ.get('STRIPE_SECRET_KEY', '').strip()
STRIPE_API = os.environ.get('STRIPE_API_BASE', 'https://api.stripe.com').rstrip('/')
EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


def catalog():
    return json.loads((PUBLIC / 'products.json').read_text())


def flatten(obj, prefix=''):
    """Encode nested dicts/lists the way Stripe expects: a[b][0][c]=value."""
    pairs = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            pairs += flatten(v, f'{prefix}[{k}]' if prefix else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            pairs += flatten(v, f'{prefix}[{i}]')
    elif isinstance(obj, bool):
        pairs.append((prefix, 'true' if obj else 'false'))
    else:
        pairs.append((prefix, str(obj)))
    return pairs


def build_session(items, cat, site_url):
    """Build Checkout Session parameters. Prices always come from products.json, never the browser."""
    by_id = {p['id']: p for p in cat['products']}
    qty_by_id = {}
    for it in items if isinstance(items, list) else []:
        pid = str(it.get('id', '')) if isinstance(it, dict) else ''
        try:
            qty = int(it.get('qty'))
        except (TypeError, ValueError):
            raise ValueError('Invalid quantity in your bag.')
        if pid not in by_id:
            raise ValueError('Your bag has an item we could not find. Please refresh and try again.')
        if not 1 <= qty <= 20:
            raise ValueError('Quantities can be between 1 and 20 per item.')
        qty_by_id[pid] = min(qty_by_id.get(pid, 0) + qty, 20)
    if not qty_by_id:
        raise ValueError('Your bag is empty.')

    line_items, subtotal = [], 0
    for pid, qty in qty_by_id.items():
        p = by_id[pid]
        product_data = {'name': p['name'], 'description': p['size']}
        if site_url.startswith('https://'):  # Stripe can only show images from a public URL
            product_data['images'] = [f"{site_url}/{p['image'].lstrip('/')}"]
        line_items.append({'price_data': {'currency': cat['currency'], 'unit_amount': p['priceCents'],
                                          'product_data': product_data}, 'quantity': qty})
        subtotal += p['priceCents'] * qty

    ship = cat['shipping']
    free = bool(ship.get('freeOverCents')) and subtotal >= ship['freeOverCents']
    session = {
        'mode': 'payment',
        'line_items': line_items,
        'success_url': f'{site_url}/thank-you?session_id={{CHECKOUT_SESSION_ID}}',
        'cancel_url': f'{site_url}/shop',
        'shipping_address_collection': {'allowed_countries': ship['allowedCountries']},
        'shipping_options': [{'shipping_rate_data': {
            'type': 'fixed_amount',
            'display_name': 'Free shipping' if free else ship['label'],
            'fixed_amount': {'amount': 0 if free else ship['flatRateCents'], 'currency': cat['currency']},
        }}],
        'allow_promotion_codes': True,
    }
    if cat.get('automaticTax'):
        session['automatic_tax'] = {'enabled': True}
    return session


def ssl_context():
    try:
        import certifi  # present in most Python installs; fixes macOS python.org certificate errors
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def stripe_post(path, params):
    body = urllib.parse.urlencode(flatten(params)).encode()
    req = urllib.request.Request(STRIPE_API + path, data=body, method='POST', headers={
        'Authorization': f'Bearer {STRIPE_KEY}', 'Content-Type': 'application/x-www-form-urlencoded'})
    ctx = ssl_context() if STRIPE_API.startswith('https') else None
    with urllib.request.urlopen(req, timeout=20, context=ctx) as res:
        return json.loads(res.read())


def append_csv(name, header, row, unique_col=None):
    DATA.mkdir(exist_ok=True)
    path = DATA / name
    new = not path.exists()
    if unique_col is not None and not new:
        with path.open(newline='') as f:
            if any(r and r[unique_col].lower() == row[unique_col].lower() for r in csv.reader(f)):
                return
    with path.open('a', newline='') as f:
        w = csv.writer(f)
        if new:
            w.writerow(header)
        w.writerow(row)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        if args and '/api/' in str(args[0]):
            super().log_message(fmt, *args)

    def send_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_404(self):
        body = (PUBLIC / '404.html').read_bytes()
        self.send_response(404)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def route(self):
        """Clean URLs: /shop serves shop.html. Returns False if nothing matches."""
        parts = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(parts.path)
        if path != '/' and not os.path.splitext(path)[1]:
            candidate = PUBLIC / (path.strip('/') + '.html')
            if candidate.is_file() and candidate.resolve().is_relative_to(PUBLIC):
                self.path = '/' + path.strip('/') + '.html' + (f'?{parts.query}' if parts.query else '')
                return True
        return Path(self.translate_path(self.path)).exists()

    def do_GET(self):
        if self.path.startswith('/api/'):
            return self.send_json(405, {'error': 'Use POST.'})
        if not self.route():
            return self.send_404()
        return super().do_GET()

    def do_HEAD(self):
        if not self.route():
            return self.send_404()
        return super().do_HEAD()

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path
        try:
            length = int(self.headers.get('Content-Length', 0))
            if length > 20_000:
                return self.send_json(413, {'error': 'Request too large.'})
            data = json.loads(self.rfile.read(length) or b'{}')
            if not isinstance(data, dict):
                raise ValueError
        except ValueError:
            return self.send_json(400, {'error': 'Bad request.'})

        if path == '/api/checkout':
            return self.checkout(data)
        if path == '/api/subscribe':
            return self.subscribe(data)
        if path == '/api/contact':
            return self.contact(data)
        return self.send_json(404, {'error': 'Not found.'})

    def checkout(self, data):
        if not STRIPE_KEY:
            return self.send_json(503, {'error': 'Checkout is not connected yet. Add your Stripe test key to the .env file '
                                                 '(see README), then restart the server.'})
        try:
            session = build_session(data.get('items'), catalog(), SITE_URL)
        except ValueError as e:
            return self.send_json(400, {'error': str(e)})
        try:
            result = stripe_post('/v1/checkout/sessions', session)
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read()).get('error', {}).get('message', '')
            except ValueError:
                msg = ''
            print(f'  Stripe error {e.code}: {msg}', file=sys.stderr)
            return self.send_json(502, {'error': f'Stripe could not start checkout. {msg}'.strip()})
        except (urllib.error.URLError, TimeoutError) as e:
            print(f'  Could not reach Stripe: {e}', file=sys.stderr)
            return self.send_json(502, {'error': 'Could not reach Stripe. Check your internet connection and try again.'})
        return self.send_json(200, {'url': result['url']})

    def subscribe(self, data):
        email = str(data.get('email', '')).strip()
        if data.get('company'):  # hidden honeypot field: bots fill it, people don't
            return self.send_json(200, {'ok': True})
        if not EMAIL_RE.match(email) or len(email) > 254:
            return self.send_json(400, {'error': 'Please enter a valid email address.'})
        append_csv('subscribers.csv', ['email', 'source', 'joined_at'],
                   [email, str(data.get('source', ''))[:20], time.strftime('%Y-%m-%d %H:%M:%S')], unique_col=0)
        print(f'  New subscriber: {email}')
        return self.send_json(200, {'ok': True})

    def contact(self, data):
        name, email, message = (str(data.get(k, '')).strip() for k in ('name', 'email', 'message'))
        if data.get('company'):
            return self.send_json(200, {'ok': True})
        if not name or not message or not EMAIL_RE.match(email):
            return self.send_json(400, {'error': 'Please fill in your name, a valid email and a message.'})
        append_csv('messages.csv', ['received_at', 'name', 'email', 'message'],
                   [time.strftime('%Y-%m-%d %H:%M:%S'), name[:200], email[:254], message[:5000]])
        print(f'  New message from {name} <{email}>')
        return self.send_json(200, {'ok': True})


def main():
    if STRIPE_KEY.startswith('sk_live') and SITE_URL.startswith('http://'):
        print('Warning: a LIVE Stripe key is set on a local server. Use your sk_test_ key for local testing.')
    mode = ('test mode' if STRIPE_KEY.startswith(('sk_test', 'rk_test')) else 'LIVE mode') if STRIPE_KEY else 'not connected (add STRIPE_SECRET_KEY to .env)'
    server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print(f'\n  mela is running at {SITE_URL}\n  Stripe checkout: {mode}\n  Press Ctrl+C to stop.\n')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n  Stopped.')


if __name__ == '__main__':
    main()
