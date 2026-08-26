# DzairPhone

Algeria's marketplace for buying and selling smartphones — buyers browse and contact sellers directly (call or WhatsApp), sellers list phones with real photos, and an admin panel manages the whole site.

## What's included

- Email + password accounts — buyer, seller, or **both**
- No account needed to browse or contact a seller (guest-friendly)
- Email verification with a 6-digit code sent at sign-up (works without email setup too — see "Email verification" below)
- Sellers: upload real photos from their device, set a price (DA), condition, and a public contact number
- Buyers: browse/search/filter, then call or WhatsApp the seller directly — no cart, no checkout
- Admin panel: manage users (ban/unban), stores, and listings — with a full listing detail view and every admin action logged
- Buyers with accounts can save/favorite listings and revisit them later
- Sellers can mark a listing "Sold" instead of just hiding it, and relist it later if a deal falls through
- Price range filtering and pagination on the browse page
- A per-account limit on new listings per hour, to keep the marketplace spam-free
- Three languages: English / Français / العربية — detected from the browser, switchable anytime, with right-to-left layout for Arabic
- Light/dark mode toggle
- Security: hashed passwords, CSRF tokens on every form, rate-limited login, account lockout after repeated failed logins, security headers (helmet), a non-guessable admin URL

This is a local, self-contained app (SQLite file database) meant as a starting point.

## 1. Install

You need [Node.js](https://nodejs.org) (v18+) installed. Then, in this folder:

```bash
npm install
```

## 2. Set up your environment

```bash
cp .env.example .env
```

Open `.env` and set `SESSION_SECRET` to a random string. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

You can also change `ADMIN_PATH` in `.env` — the secret URL where your admin panel lives. Treat it like a password.

## 3. Create the database and admin account

```bash
npm run seed
```

This creates the database, your **admin account** (random secure password), and a few demo listings/sellers.

Your admin login is printed in the terminal **and** saved to `ADMIN_CREDENTIALS.txt`. Save the password somewhere safe (like a password manager), then delete that file.

## 4. Run the app

```bash
npm start
```

Visit **http://localhost:3000**.

## How to log in as admin

1. Go to `/login` and log in with the admin email/password from step 3 — like any normal login (there's no separate admin login form, on purpose: it keeps the attack surface small).
2. Once logged in, visit your `ADMIN_PATH` from `.env` (default: `http://localhost:3000/control-panel-x7q9`).

Only accounts with the `admin` role can access that page.

## Demo accounts (from the seed data)

| Role         | Email               | Password    |
|--------------|---------------------|-------------|
| Seller       | seller1@example.com | Seller123!  |
| Buyer+Seller | seller2@example.com | Seller123!  |
| Buyer        | buyer@example.com   | Buyer123!   |

## How buying works here

There's no cart or checkout. A buyer browses listings and, on any phone's page, sees a **Contact seller** card with a "Call now" button (opens the phone dialer) and a "WhatsApp" button (opens a pre-filled chat). This fits a marketplace where most sellers are individuals selling one phone at a time, not shops shipping many orders — buyers and sellers just talk directly, the way people already do on classifieds sites.

## Currency

Prices are in Algerian Dinar (DA), stored as whole numbers (no decimals). If you'd rather use another currency, this is a one-line label change in the templates plus removing the DZD-specific formatting in `routes/products.js` — ask and I can make that change.

## Email verification

When someone signs up, DzairPhone generates a 6-digit code and asks them to enter it before the account is actually created. By default, no email is configured, so the code is printed to your server terminal (and shown directly on the verification page in a yellow "dev mode" box) — this lets you test signup locally without setting anything up.

To send real emails, add SMTP settings to `.env`:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=you@gmail.com
```

For Gmail, `SMTP_PASS` needs to be an [app password](https://myaccount.google.com/apppasswords), not your normal login password. Any standard SMTP provider works the same way (e.g. a transactional email service).

## Photos

Sellers upload photos directly from their device (phone gallery/camera or computer file picker) — no image URLs needed. Selected photos preview immediately on the form, and can be removed before saving. Each listing supports up to **3 photos**, 5MB each (JPG/PNG/WEBP only).

## Listing moderation

Whether a listing is publicly visible depends on three independent switches:
- The **seller** can hide/restore their own listing, or mark it **sold** (and relist it later if needed).
- The **admin** can separately remove a listing for moderation reasons.

A listing only shows up publicly when it's active, not sold, and not admin-removed. This means a seller can't undo an admin's removal by restoring it themselves — if admin-removed, only an admin can bring it back. The seller dashboard and admin panel both show which state applies to a given listing.

## Favorites

Buyers with an account can save any listing (heart icon on the card or listing page) and revisit it later from "Saved listings" in the account menu. If a saved listing later gets sold, hidden, or removed, it still shows up there under "No longer available" so buyers aren't left wondering where it went.

## Browsing: filters & pagination

The browse page supports a min/max price filter (in DA) alongside the existing brand/condition/search filters, and results are paginated at 12 listings per page so the page stays fast as the catalog grows. All active filters carry over between pages.

## Spam prevention

Each seller account can create at most 10 new listings per hour. This is a basic first line of defense against spam/abuse — it doesn't require any setup and applies automatically.

## Languages

The site defaults to **Arabic** for new visitors, but auto-detects and switches to English or French if that's the visitor's browser language. Once someone picks a language via the switcher in the top navigation, that choice is remembered via a cookie from then on. Arabic renders right-to-left. Note: this translates the site's own text (navigation, buttons, labels) — listings, seller descriptions, and other user-entered content appear in whatever language the seller typed them in.

## Project structure

```
dzairphone/
  server.js            — app entry point
  db/                  — SQLite database, schema, and seed script
  routes/              — auth, products, seller, admin
  middleware/          — auth/CSRF, i18n, photo upload handling
  locales/             — en.json / fr.json / ar.json translation strings
  views/               — EJS templates (pages)
  public/css, public/js — styles and client-side behavior (theme toggle, dropdowns, scroll animation)
  public/uploads/products — seller-uploaded photos (created automatically)
```

## Resetting the database

Delete the files in `db/*.sqlite3*`, then run `npm run seed` again. This won't delete uploaded photo files — remove those separately from `public/uploads/products/` if needed.

## Ideas for what's next

1. **Password reset via email** — there's no "forgot password" flow yet.
2. **Report a listing** — let buyers flag suspicious or fraudulent listings for the admin to review.
3. **Basic seller verification** (e.g. phone number confirmation) to build buyer trust.
4. **Two-factor authentication for the admin account**, given how sensitive that role is.
5. **A "change password" / "edit profile" page** for all account types.
6. **In-app messaging** as an alternative to phone/WhatsApp, for buyers who'd rather not share their number first.

Let me know which of these (or anything else) you'd like next.
