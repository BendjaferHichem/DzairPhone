const express = require('express');
const db = require('../db/db');
const { requireLogin, requireRole, checkCsrf } = require('../middleware/auth');
const { PRIMARY_IMAGE_SQL } = require('./products');

const router = express.Router();

function logAction(adminId, action, details) {
  db.prepare('INSERT INTO admin_audit_log (admin_id, action, details) VALUES (?, ?, ?)').run(adminId, action, details || null);
}

// Every route below requires an authenticated admin. Combined with the
// non-guessable mount path in server.js, this keeps the panel locked down.
router.use(requireLogin, requireRole('admin'));

router.get('/', (req, res) => {
  const stats = {
    buyers: db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'buyer'").get().c,
    sellers: db.prepare("SELECT COUNT(*) c FROM users WHERE role IN ('seller','both')").get().c,
    listings: db.prepare('SELECT COUNT(*) c FROM products WHERE is_active = 1 AND admin_disabled = 0').get().c,
    stores: db.prepare('SELECT COUNT(*) c FROM stores WHERE is_active = 1').get().c,
  };
  const recentListings = db
    .prepare(`SELECT products.*, stores.name AS store_name, ${PRIMARY_IMAGE_SQL} FROM products JOIN stores ON stores.id = products.store_id ORDER BY products.created_at DESC LIMIT 8`)
    .all();
  const recentLog = db
    .prepare('SELECT admin_audit_log.*, users.email AS admin_email FROM admin_audit_log LEFT JOIN users ON users.id = admin_audit_log.admin_id ORDER BY admin_audit_log.created_at DESC LIMIT 15')
    .all();
  res.render('admin/dashboard', { title: 'Admin dashboard', stats, recentListings, recentLog });
});

router.get('/users', (req, res) => {
  const q = req.query.q || '';
  const rows = q
    ? db.prepare('SELECT * FROM users WHERE email LIKE ? OR name LIKE ? ORDER BY created_at DESC').all(`%${q}%`, `%${q}%`)
    : db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  res.render('admin/users', { title: 'Manage users', users: rows, q });
});

router.post('/users/:id/ban', checkCsrf, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (target && target.role !== 'admin') {
    db.prepare('UPDATE users SET is_banned = 1 WHERE id = ?').run(target.id);
    logAction(req.user.id, 'ban_user', `Banned user ${target.email} (id ${target.id})`);
  }
  res.redirect(req.baseUrl + '/users');
});

router.post('/users/:id/unban', checkCsrf, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (target) {
    db.prepare('UPDATE users SET is_banned = 0, failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(target.id);
    logAction(req.user.id, 'unban_user', `Unbanned user ${target.email} (id ${target.id})`);
  }
  res.redirect(req.baseUrl + '/users');
});

router.get('/products', (req, res) => {
  const rows = db
    .prepare(
      `SELECT products.*, stores.name AS store_name, users.email AS seller_email, ${PRIMARY_IMAGE_SQL}
       FROM products JOIN stores ON stores.id = products.store_id JOIN users ON users.id = stores.user_id
       ORDER BY products.created_at DESC`
    )
    .all();
  res.render('admin/products', { title: 'Manage listings', products: rows });
});

router.get('/products/:id', (req, res) => {
  const product = db
    .prepare(
      `SELECT products.*, stores.name AS store_name, stores.phone AS store_phone, users.email AS seller_email, users.id AS seller_id
       FROM products JOIN stores ON stores.id = products.store_id JOIN users ON users.id = stores.user_id
       WHERE products.id = ?`
    )
    .get(req.params.id);
  if (!product) {
    return res.status(404).render('error', { title: 'Not found', message: "That listing doesn't exist." });
  }
  const images = db.prepare('SELECT image_path FROM product_images WHERE product_id = ? ORDER BY position ASC, id ASC').all(product.id).map((r) => r.image_path);
  res.render('admin/product-detail', { title: `${product.brand} ${product.model}`, product, images });
});

// Admin moderation is a separate flag from the seller's own show/hide toggle,
// so a seller can't undo an admin's removal by hiding/restoring their own listing.
router.post('/products/:id/toggle', checkCsrf, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (product) {
    db.prepare('UPDATE products SET admin_disabled = ? WHERE id = ?').run(product.admin_disabled ? 0 : 1, product.id);
    logAction(req.user.id, 'toggle_product', `${product.admin_disabled ? 'Restored' : 'Removed'} listing "${product.brand} ${product.model}" (id ${product.id})`);
  }
  res.redirect(req.get('referer') && req.get('referer').includes(`/products/${req.params.id}`) ? req.baseUrl + '/products/' + req.params.id : req.baseUrl + '/products');
});

router.get('/stores', (req, res) => {
  const rows = db
    .prepare(
      `SELECT stores.*, users.email AS owner_email,
        (SELECT COUNT(*) FROM products WHERE products.store_id = stores.id AND products.is_active = 1) AS product_count
       FROM stores JOIN users ON users.id = stores.user_id ORDER BY stores.created_at DESC`
    )
    .all();
  res.render('admin/stores', { title: 'Manage stores', stores: rows });
});

router.post('/stores/:id/toggle', checkCsrf, (req, res) => {
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.params.id);
  if (store) {
    db.prepare('UPDATE stores SET is_active = ? WHERE id = ?').run(store.is_active ? 0 : 1, store.id);
    logAction(req.user.id, 'toggle_store', `${store.is_active ? 'Suspended' : 'Reactivated'} store "${store.name}" (id ${store.id})`);
  }
  res.redirect(req.baseUrl + '/stores');
});

module.exports = router;
