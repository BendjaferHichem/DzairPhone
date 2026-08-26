const crypto = require('crypto');
const db = require('../db/db');

// Load the logged-in user (if any) onto req.user / res.locals.user for every request.
function attachUser(req, res, next) {
  res.locals.user = null;
  if (req.session && req.session.userId) {
    const user = db.prepare('SELECT id, name, email, role, is_banned FROM users WHERE id = ?').get(req.session.userId);
    if (user && !user.is_banned) {
      req.user = user;
      res.locals.user = user;
    } else {
      req.session.destroy(() => {});
    }
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).render('error', { title: 'Forbidden', message: "You don't have permission to view this page." });
    }
    next();
  };
}

// A "seller" or "both" account can manage a store; buyers/guests cannot.
function canSell(user) {
  return !!user && (user.role === 'seller' || user.role === 'both');
}

function csrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

function checkCsrf(req, res, next) {
  const tokenFromForm = req.body && req.body._csrf;
  if (!tokenFromForm || tokenFromForm !== req.session.csrfToken) {
    return res.status(403).render('error', { title: 'Request rejected', message: 'Your session expired or the form was resubmitted incorrectly. Please go back and try again.' });
  }
  next();
}

module.exports = { attachUser, requireLogin, requireRole, canSell, csrfToken, checkCsrf };
