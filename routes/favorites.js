const express = require('express');
const db = require('../db/db');
const { requireLogin, checkCsrf } = require('../middleware/auth');
const { withPricing, withFavorites, PRIMARY_IMAGE_SQL } = require('./products');

const router = express.Router();

router.get('/', requireLogin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT products.*, stores.name AS store_name, ${PRIMARY_IMAGE_SQL}, favorites.created_at AS saved_at
       FROM favorites
       JOIN products ON products.id = favorites.product_id
       JOIN stores ON stores.id = products.store_id
       WHERE favorites.user_id = ?
       ORDER BY favorites.created_at DESC`
    )
    .all(req.user.id);

  const active = rows.filter((r) => r.is_active && !r.admin_disabled && !r.is_sold);
  const unavailable = rows.filter((r) => !(r.is_active && !r.admin_disabled && !r.is_sold));

  res.render('favorites', {
    title: 'Saved listings',
    active: withFavorites(active.map(withPricing), new Set(rows.map((r) => r.id))),
    unavailable: unavailable.map(withPricing),
  });
});

router.post('/:productId/toggle', requireLogin, checkCsrf, (req, res) => {
  const productId = parseInt(req.params.productId, 10);
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
  if (!product) {
    return res.status(404).render('error', { title: 'Not found', message: "That listing doesn't exist." });
  }
  const existing = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND product_id = ?').get(req.user.id, productId);
  if (existing) {
    db.prepare('DELETE FROM favorites WHERE id = ?').run(existing.id);
  } else {
    db.prepare('INSERT INTO favorites (user_id, product_id) VALUES (?, ?)').run(req.user.id, productId);
  }
  res.redirect(req.body.redirect_to || req.get('referer') || '/products/' + productId);
});

module.exports = router;
