require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

const { attachUser, csrfToken } = require('./middleware/auth');
const { i18n } = require('./middleware/i18n');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const sellerRoutes = require('./routes/seller');
const adminRoutes = require('./routes/admin');
const favoritesRoutes = require('./routes/favorites');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PATH = process.env.ADMIN_PATH || '/control-panel-x7q9';
const IS_PROD = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET) {
  console.warn('\n[warning] SESSION_SECRET is not set in .env, using an insecure default.');
  console.warn('Run "cp .env.example .env" and set a real random SESSION_SECRET before deploying.\n');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

// A per-request nonce lets the two small inline <script> blocks (the
// before-paint dark-mode setter, and the verify-email page's input helper)
// run under a strict CSP without resorting to 'unsafe-inline'.
app.use((req, res, next) => {
  res.locals.cspNonce = require('crypto').randomBytes(16).toString('base64');
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
        fontSrc: ["'self'", 'https:', 'data:'],
      },
    },
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite3', dir: path.join(__dirname, 'db') }),
    name: 'dzairphone.sid',
    secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD,
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  })
);

app.use(attachUser);
app.use(csrfToken);
app.use(i18n);

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use((req, res, next) => {
  res.locals.ADMIN_PATH = ADMIN_PATH;
  next();
});

// Language switcher: sets a cookie and returns to where the user was.
app.post('/lang/:code', (req, res) => {
  const { SUPPORTED } = require('./middleware/i18n');
  const code = SUPPORTED.includes(req.params.code) ? req.params.code : 'en';
  res.cookie('lang', code, { maxAge: 1000 * 60 * 60 * 24 * 365, httpOnly: false, sameSite: 'lax' });
  res.redirect(req.get('referer') || '/');
});

app.use('/', authRoutes);
app.use('/products', productRoutes);
app.use('/seller', sellerRoutes);
app.use('/favorites', favoritesRoutes);
app.use(ADMIN_PATH, adminRoutes);

app.get('/', (req, res) => {
  const db = require('./db/db');
  const { withPricing, withFavorites, getFavoriteIds, PRIMARY_IMAGE_SQL, VISIBLE_SQL } = require('./routes/products');
  const favoriteIds = getFavoriteIds(req.user && req.user.id);
  const deals = db
    .prepare(
      `SELECT products.*, stores.name AS store_name, ${PRIMARY_IMAGE_SQL} FROM products
       JOIN stores ON stores.id = products.store_id
       WHERE ${VISIBLE_SQL} AND stores.is_active = 1 AND products.discount_pct > 0
       ORDER BY products.discount_pct DESC LIMIT 8`
    )
    .all()
    .map(withPricing);
  const newest = db
    .prepare(
      `SELECT products.*, stores.name AS store_name, ${PRIMARY_IMAGE_SQL} FROM products
       JOIN stores ON stores.id = products.store_id
       WHERE ${VISIBLE_SQL} AND stores.is_active = 1
       ORDER BY products.created_at DESC LIMIT 8`
    )
    .all()
    .map(withPricing);
  const brands = db.prepare('SELECT DISTINCT brand FROM products WHERE is_active = 1 AND admin_disabled = 0 AND is_sold = 0 ORDER BY brand').all().map((r) => r.brand);
  res.render('index', { title: 'DzairPhone, ' + res.locals.t('hero_title'), deals: withFavorites(deals, favoriteIds), newest: withFavorites(newest, favoriteIds), brands });
});

app.use((req, res) => {
  res.status(404).render('error', { title: 'Page not found', message: "That page doesn't exist." });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Something went wrong', message: 'An unexpected error occurred. Please try again.' });
});

app.listen(PORT, () => {
  console.log(`DzairPhone running at http://localhost:${PORT}`);
  console.log(`Log in at http://localhost:${PORT}/login with your admin account, then visit http://localhost:${PORT}${ADMIN_PATH}`);
});
