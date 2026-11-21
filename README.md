# mela website

A small online shop for mela: homepage photo gallery, shop, about and connect pages, a page for each product, a shopping bag, card checkout through Stripe, and "join the list" sign-up (popup on the homepage plus a form at the bottom of every page).

## Run it on your Mac

1. Open Terminal and go to this folder:

   ```
   cd ~/Library/Mobile\ Documents/com~apple~CloudDocs/miscellaneous/mela/website/mela-site
   ```

2. Start the server:

   ```
   python3 server.py
   ```

   If macOS asks to install the command line developer tools, say yes, then run the command again.

3. Open http://localhost:8000 in your browser. Stop the server with Ctrl+C.

The popup shows once, about 6 seconds after you land on the homepage, then stays hidden for 14 days (or for good after someone joins). To see it again while testing, open http://localhost:8000/?popup=1.

Locally, sign-ups are saved to `local-data/subscribers.csv` and contact messages to `local-data/messages.csv`.

## Preview on GitHub Pages

GitHub Pages hosts the pages, photos, menu, popup and bag for free, at https://melabodycontact-tech.github.io. It can't run server code, so on Pages the checkout button and the forms show a "coming soon" note that points to the Etsy shop. Everything works fully once the site moves to Cloudflare (launch plan below).

One-time setup:

1. Signed in as melabodycontact-tech, create a new repository at https://github.com/new named `melabodycontact-tech.github.io`. Make it Public and leave every "add a file" option unchecked.
2. In the new repo, open Settings, then Pages, and set Source to "GitHub Actions".
3. In Terminal:

   ```
   cd ~/Library/Mobile\ Documents/com~apple~CloudDocs/miscellaneous/mela/website/mela-site
   git init -b main
   git add .
   git commit -m "mela website"
   git remote add origin https://github.com/melabodycontact-tech/melabodycontact-tech.github.io.git
   git push -u origin main
   ```

The workflow in `.github/workflows/pages.yml` publishes the `public` folder on every push. Progress shows under the repo's Actions tab, and the site is live a minute or two later. To update the site later: `git add .`, `git commit -m "what changed"`, `git push`.

`.gitignore` keeps `.env` (your Stripe key) and `local-data/` (sign-up emails and messages) out of the repo.

## Turn on test checkout (free)

1. Create a free account at https://stripe.com. Test mode works right away, before any business verification.
2. Copy your test secret key from https://dashboard.stripe.com/test/apikeys (it starts with `sk_test_`).
3. In this folder, copy `.env.example` to a new file named `.env` and paste the key after `STRIPE_SECRET_KEY=`.
4. Restart `python3 server.py`. Add something to the bag and press checkout.
5. Pay with the test card `4242 4242 4242 4242`, any future expiry date, any CVC and any ZIP code. The order appears under Payments in the Stripe dashboard (test mode), with the customer's shipping address.

## What's where

| Path | What it is |
| --- | --- |
| `public/` | The website itself |
| `public/products.json` | Prices, sizes and shipping rules. The bag and checkout read prices from here, and prices on the pages update from it too, so change a price here. |
| `public/*.html` | One file per page (home, shop, about, connect, the three products, thank-you, 404) |
| `public/css/styles.css` | All styling. The color palette is at the top. |
| `public/js/main.js` | Menu, bag, checkout button, sign-up forms and popup |
| `public/images/` | Product photos (WebP, two sizes each), logo and rose emblem taken from the label files |
| `server.py` | Local server (Python standard library only) |
| `worker.js`, `wrangler.jsonc` | The same API for Cloudflare, used at launch |

## To confirm before launch

- Face oil size: the label says 2 fl oz, the Etsy listing says 1 fl oz. The site currently shows 2 fl oz (`products.json` and `face-oil.html`).
- Shipping: $5 flat and free over $50 are placeholders. Change them in `products.json`; the text on the site follows.
- Instagram handle and a contact email, if you want them on the connect page and footer.
- Sales tax: Etsy collects and remits sales tax for you. On your own site that becomes your job. Check what New York requires for your sales. Stripe Tax can calculate and collect it at checkout for 0.5% per transaction in states where you're registered; after enabling it in Stripe, set `"automaticTax": true` in `products.json`.
- Stripe email receipts: turn on "Successful payments" at https://dashboard.stripe.com/settings/emails so customers get a receipt.

## Launch plan

### 1. Build and test locally

(this folder).

### 2. Pick the name and buy the domain

Recommended registrar: Cloudflare Registrar, which sells domains at cost (about $10.46 a year for a .com, same price on renewal, free privacy protection).

1. Create a free account at https://dash.cloudflare.com.
2. Open Domain Registration and choose Register Domains.
3. Search for your name, pick the .com, and pay by card. Leave auto-renew on.

### 3. Set up the email list

Kit (kit.com) has a free plan for up to 10,000 subscribers. Create a form, then copy your API key and the form's ID.

### 4. Put the site online with Cloudflare Workers

(free plan; one deploy serves the pages and the checkout API).

1. Install Node.js (LTS) from https://nodejs.org.
2. In this folder run `npx wrangler login`.
3. Add your secrets, one at a time (each command asks you to paste the value):

   ```
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put KIT_API_KEY
   npx wrangler secret put KIT_FORM_ID
   npx wrangler secret put CONTACT_FORWARD_URL
   ```

   `CONTACT_FORWARD_URL` is the endpoint of a form service (Formspree or similar) that emails you each message from the connect page. Start with your Stripe test key.
4. Run `npx wrangler deploy`. You get a `*.workers.dev` address to test on.
5. In the Cloudflare dashboard, open Workers & Pages, then the `mela` worker, then Settings, Domains & Routes, and add your domain (both `yourdomain.com` and `www.yourdomain.com`).
6. Set `SITE_URL` in `wrangler.jsonc` to `https://www.yourdomain.com` and run `npx wrangler deploy` again.

### 5. Go live

Activate your Stripe account (business details and a bank account for payouts), replace the secret with your live key (`sk_live_...`) using `npx wrangler secret put STRIPE_SECRET_KEY`, place one real order and refund it.

Costs: about $10.46 a year for the domain; hosting and the email list are free at this size; Stripe takes 2.9% + 30 cents per card payment.
