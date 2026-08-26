const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db/db');
const { checkCsrf } = require('../middleware/auth');
const { sendVerificationEmail } = require('../middleware/mailer');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_CODE_ATTEMPTS = 5;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts from this device. Please wait a few minutes and try again.',
});

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function createUserAccount(pending) {
  const hash = bcrypt.hashSync(pending.password, 12);
  const info = db
    .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(pending.name, pending.email, hash, pending.role);
  if (pending.role === 'seller' || pending.role === 'both') {
    db.prepare('INSERT INTO stores (user_id, name, description) VALUES (?, ?, ?)').run(
      info.lastInsertRowid,
      `${pending.name}'s Store`,
      ''
    );
  }
  return info.lastInsertRowid;
}

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('register', { title: res.locals.t('register_title'), error: null, form: {} });
});

router.post('/register', checkCsrf, async (req, res) => {
  const { name, email, password, confirm_password, role } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  const allowedRoles = ['buyer', 'seller', 'both'];
  const wantRole = allowedRoles.includes(role) ? role : 'buyer';

  const rerender = (error) =>
    res.render('register', { title: res.locals.t('register_title'), error, form: { name, email } });

  if (!name || !cleanEmail || !password) return rerender('Please fill in all fields.');
  if (!EMAIL_RE.test(cleanEmail)) return rerender('Please enter a valid email address.');
  if (password.length < 8) return rerender('Password must be at least 8 characters.');
  if (password !== confirm_password) return rerender('Passwords do not match.');

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) return rerender('An account with that email already exists.');

  const code = generateCode();
  req.session.pendingRegistration = {
    name: name.trim(),
    email: cleanEmail,
    password, // held only in the server-side session until verified, then discarded
    role: wantRole,
    code,
    expiresAt: Date.now() + CODE_TTL_MS,
    attemptsLeft: MAX_CODE_ATTEMPTS,
    lastSentAt: Date.now(),
  };

  try {
    const result = await sendVerificationEmail(cleanEmail, code);
    req.session.pendingRegistration.devCode = result.delivered ? null : code;
  } catch (err) {
    console.error('Failed to send verification email:', err.message);
    return rerender('We could not send a verification email right now. Please try again in a moment.');
  }

  res.redirect('/register/verify');
});

router.get('/register/verify', (req, res) => {
  const pending = req.session.pendingRegistration;
  if (!pending) return res.redirect('/register');
  res.render('verify-email', {
    title: 'Verify your email',
    email: pending.email,
    error: null,
    devCode: pending.devCode || null,
    cooldownMs: Math.max(0, RESEND_COOLDOWN_MS - (Date.now() - pending.lastSentAt)),
  });
});

router.post('/register/verify', checkCsrf, (req, res) => {
  const pending = req.session.pendingRegistration;
  if (!pending) return res.redirect('/register');

  const rerender = (error) =>
    res.render('verify-email', {
      title: 'Verify your email',
      email: pending.email,
      error,
      devCode: pending.devCode || null,
      cooldownMs: Math.max(0, RESEND_COOLDOWN_MS - (Date.now() - pending.lastSentAt)),
    });

  if (Date.now() > pending.expiresAt) {
    delete req.session.pendingRegistration;
    return res.render('register', { title: res.locals.t('register_title'), error: 'That code expired. Please sign up again.', form: { name: pending.name, email: pending.email } });
  }

  const submitted = (req.body.code || '').trim();
  if (submitted !== pending.code) {
    pending.attemptsLeft -= 1;
    if (pending.attemptsLeft <= 0) {
      delete req.session.pendingRegistration;
      return res.render('register', { title: res.locals.t('register_title'), error: 'Too many incorrect attempts. Please sign up again.', form: { name: pending.name, email: pending.email } });
    }
    return rerender(`Incorrect code. ${pending.attemptsLeft} attempt(s) left.`);
  }

  // Re-check in case someone else registered this email while the code was pending.
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(pending.email);
  if (existing) {
    delete req.session.pendingRegistration;
    return res.render('register', { title: res.locals.t('register_title'), error: 'An account with that email already exists.', form: {} });
  }

  const userId = createUserAccount(pending);
  const wantRole = pending.role;
  delete req.session.pendingRegistration;

  req.session.regenerate((err) => {
    if (err) return res.redirect('/login');
    req.session.userId = userId;
    res.redirect(wantRole === 'seller' || wantRole === 'both' ? '/seller/dashboard' : '/');
  });
});

router.post('/register/resend', checkCsrf, async (req, res) => {
  const pending = req.session.pendingRegistration;
  if (!pending) return res.redirect('/register');

  if (Date.now() - pending.lastSentAt < RESEND_COOLDOWN_MS) {
    return res.render('verify-email', {
      title: 'Verify your email',
      email: pending.email,
      error: 'Please wait a moment before requesting another code.',
      devCode: pending.devCode || null,
      cooldownMs: RESEND_COOLDOWN_MS - (Date.now() - pending.lastSentAt),
    });
  }

  pending.code = generateCode();
  pending.expiresAt = Date.now() + CODE_TTL_MS;
  pending.attemptsLeft = MAX_CODE_ATTEMPTS;
  pending.lastSentAt = Date.now();

  try {
    const result = await sendVerificationEmail(pending.email, pending.code);
    pending.devCode = result.delivered ? null : pending.code;
  } catch (err) {
    console.error('Failed to resend verification email:', err.message);
  }

  res.redirect('/register/verify');
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: res.locals.t('login_title'), error: null, email: '' });
});

router.post('/login', loginLimiter, checkCsrf, (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const genericError = 'Incorrect email or password.';
  const rerender = (error, e) => res.render('login', { title: res.locals.t('login_title'), error, email: e });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return rerender(genericError, email);

  if (user.locked_until && Date.now() < user.locked_until) {
    const minsLeft = Math.ceil((user.locked_until - Date.now()) / 60000);
    return rerender(`Too many failed attempts. Try again in ${minsLeft} minute(s).`, email);
  }
  if (user.is_banned) return rerender('This account has been suspended.', email);

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    const attempts = user.failed_login_attempts + 1;
    const lockUntil = attempts >= MAX_FAILED_ATTEMPTS ? Date.now() + LOCK_MINUTES * 60 * 1000 : null;
    db.prepare('UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?').run(attempts, lockUntil, user.id);
    return rerender(genericError, email);
  }

  db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);

  req.session.regenerate((err) => {
    if (err) return rerender('Something went wrong. Please try again.', email);
    req.session.userId = user.id;
    const dest = req.session.returnTo || '/';
    delete req.session.returnTo;
    res.redirect(dest);
  });
});

router.get('/become-seller', (req, res) => {
  if (!req.user) return res.redirect('/login');
  if (req.user.role === 'seller' || req.user.role === 'both') return res.redirect('/seller/dashboard');
  res.render('become-seller', { title: res.locals.t('nav_become_seller'), error: null });
});

router.post('/become-seller', checkCsrf, (req, res) => {
  if (!req.user) return res.redirect('/login');
  if (req.user.role === 'seller' || req.user.role === 'both') return res.redirect('/seller/dashboard');
  const { store_name, store_description, store_phone } = req.body;
  if (!store_name || !store_name.trim()) {
    return res.render('become-seller', { title: res.locals.t('nav_become_seller'), error: 'Please give your store a name.' });
  }
  // Buyers upgrade to "both" so they keep the ability to browse/contact as a buyer too.
  const newRole = req.user.role === 'buyer' ? 'both' : 'seller';
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, req.user.id);
  db.prepare('INSERT INTO stores (user_id, name, description, phone) VALUES (?, ?, ?, ?)').run(
    req.user.id,
    store_name.trim(),
    (store_description || '').trim(),
    (store_phone || '').trim()
  );
  res.redirect('/seller/dashboard');
});

router.post('/logout', checkCsrf, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('dzairphone.sid');
    res.redirect('/');
  });
});

router.get('/privacy', (req, res) => {
  res.render('privacy', { title: res.locals.t('privacy_title') });
});

module.exports = router;
