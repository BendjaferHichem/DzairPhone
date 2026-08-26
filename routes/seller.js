const fs = require('fs');
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db/db');
const { requireLogin, requireRole, checkCsrf } = require('../middleware/auth');
const { withPricing, PRIMARY_IMAGE_SQL } = require('./products');
const upload = require('../middleware/upload');

const MAX_IMAGES = 3;
const router = express.Router();
router.use(requireLogin, requireRole('seller', 'both'));

// Basic spam throttling: caps how many new listings one account can create
// in a rolling window, regardless of which device/IP they post from.
const newListingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user.id}`,
  handler: (req, res) => {
    res.status(429).render('error', {
      title: 'Slow down',
      message: "You've created a lot of listings recently. Please wait a bit before adding more, this limit helps keep the marketplace free of spam.",
    });
  },
});

function getStoreOrFail(req, res) {
  const store = db.prepare('SELECT * FROM stores WHERE user_id = ?').get(req.user.id);
  if (!store) {
    res.status(404).render('error', { title: 'No store found', message: 'Something went wrong locating your store.' });
    return null;
  }
  return store;
}

function multerErrorHandler(err, req, res, next) {
  if (err) return res.status(400).render('error', { title: 'Upload problem', message: err.message || 'That upload could not be processed.' });
  next();
}

router.get('/dashboard', (req, res) => {
  const store = getStoreOrFail(req, res);
  if (!store) return;
  const products = db
    .prepare(`SELECT products.*, ${PRIMARY_IMAGE_SQL} FROM products WHERE store_id = ? ORDER BY created_at DESC`)
    .all(store.id)
    .map(withPricing);
  res.render('seller/dashboard', { title: 'Your store', store, products });
});

router.get('/store', (req, res) => {
  const store = getStoreOrFail(req, res);
  if (!store) return;
  res.render('seller/store-settings', { title: 'Store settings', store, error: null });
});

router.post('/store', checkCsrf, (req, res) => {
  const store = getStoreOrFail(req, res);
  if (!store) return;
  const { name, description, phone } = req.body;
  if (!name || !name.trim()) {
    return res.render('seller/store-settings', { title: 'Store settings', store, error: 'Store name is required.' });
  }
  db.prepare('UPDATE stores SET name = ?, description = ?, phone = ? WHERE id = ?').run(
    name.trim(),
    (description || '').trim(),
    (phone || '').trim(),
    store.id
  );
  res.redirect('/seller/dashboard');
});

router.get('/products/new', (req, res) => {
  res.render('seller/product-form', { title: 'Add a phone listing', product: {}, existingImages: [], maxImages: MAX_IMAGES, error: null, formAction: '/seller/products/new' });
});

router.post('/products/new', newListingLimiter, upload.array('photos', MAX_IMAGES), multerErrorHandler, checkCsrf, (req, res) => {
  const store = getStoreOrFail(req, res);
  if (!store) return;
  const { brand, model, price, quantity, condition, storage_gb, color, description, contact_phone, discount_pct } = req.body;
  const rerender = (error) =>
    res.render('seller/product-form', { title: 'Add a phone listing', product: req.body, existingImages: [], maxImages: MAX_IMAGES, error, formAction: '/seller/products/new' });

  if (!brand || !model || !price || !contact_phone) {
    return rerender('Brand, model, price, and a contact phone number are required.');
  }
  if ((req.files || []).length > MAX_IMAGES) {
    return rerender(`You can upload up to ${MAX_IMAGES} photos.`);
  }
  const priceDzd = parseInt(price, 10);
  if (isNaN(priceDzd) || priceDzd <= 0) return rerender('Please enter a valid price.');

  const info = db
    .prepare(
      `INSERT INTO products (store_id, brand, model, price_dzd, quantity, condition, storage_gb, color, description, contact_phone, discount_pct)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      store.id,
      brand.trim(),
      model.trim(),
      priceDzd,
      Math.max(1, parseInt(quantity, 10) || 1),
      ['new', 'used', 'refurbished'].includes(condition) ? condition : 'new',
      storage_gb ? parseInt(storage_gb, 10) : null,
      (color || '').trim() || null,
      (description || '').trim() || null,
      contact_phone.trim(),
      Math.min(90, Math.max(0, parseInt(discount_pct, 10) || 0))
    );

  const insertImage = db.prepare('INSERT INTO product_images (product_id, image_path, position) VALUES (?, ?, ?)');
  (req.files || []).forEach((file, idx) => {
    insertImage.run(info.lastInsertRowid, `/uploads/products/${file.filename}`, idx);
  });

  res.redirect('/seller/dashboard');
});

function getOwnedProduct(req, res) {
  const store = getStoreOrFail(req, res);
  if (!store) return null;
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND store_id = ?').get(req.params.id, store.id);
  if (!product) {
    res.status(404).render('error', { title: 'Not found', message: "That listing doesn't exist or isn't yours." });
    return null;
  }
  return product;
}

router.get('/products/:id/edit', (req, res) => {
  const product = getOwnedProduct(req, res);
  if (!product) return;
  const existingImages = db.prepare('SELECT id, image_path FROM product_images WHERE product_id = ? ORDER BY position ASC, id ASC').all(product.id);
  res.render('seller/product-form', {
    title: 'Edit listing',
    product: { ...product, price: product.price_dzd },
    existingImages,
    maxImages: MAX_IMAGES,
    error: null,
    formAction: `/seller/products/${product.id}/edit`,
  });
});

router.post('/products/:id/edit', upload.array('photos', MAX_IMAGES), multerErrorHandler, checkCsrf, (req, res) => {
  const product = getOwnedProduct(req, res);
  if (!product) return;
  const { brand, model, price, quantity, condition, storage_gb, color, description, contact_phone, discount_pct } = req.body;
  const priceDzd = parseInt(price, 10);
  const existingImages = db.prepare('SELECT id, image_path FROM product_images WHERE product_id = ? ORDER BY position ASC, id ASC').all(product.id);
  const rerender = (error) =>
    res.render('seller/product-form', { title: 'Edit listing', product: req.body, existingImages, maxImages: MAX_IMAGES, error, formAction: `/seller/products/${product.id}/edit` });

  if (!brand || !model || isNaN(priceDzd) || priceDzd <= 0 || !contact_phone) {
    return rerender('Please fill in brand, model, a valid price, and a contact phone number.');
  }
  if (existingImages.length + (req.files || []).length > MAX_IMAGES) {
    return rerender(`You can have up to ${MAX_IMAGES} photos per listing, remove one before adding more.`);
  }

  db.prepare(
    `UPDATE products SET brand=?, model=?, price_dzd=?, quantity=?, condition=?, storage_gb=?, color=?, description=?, contact_phone=?, discount_pct=?
     WHERE id = ?`
  ).run(
    brand.trim(),
    model.trim(),
    priceDzd,
    Math.max(1, parseInt(quantity, 10) || 1),
    ['new', 'used', 'refurbished'].includes(condition) ? condition : 'new',
    storage_gb ? parseInt(storage_gb, 10) : null,
    (color || '').trim() || null,
    (description || '').trim() || null,
    contact_phone.trim(),
    Math.min(90, Math.max(0, parseInt(discount_pct, 10) || 0)),
    product.id
  );

  if (req.files && req.files.length) {
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM product_images WHERE product_id = ?').get(product.id).m;
    const insertImage = db.prepare('INSERT INTO product_images (product_id, image_path, position) VALUES (?, ?, ?)');
    req.files.forEach((file, idx) => insertImage.run(product.id, `/uploads/products/${file.filename}`, maxPos + 1 + idx));
  }

  res.redirect('/seller/dashboard');
});

router.post('/products/:id/images/:imageId/delete', checkCsrf, (req, res) => {
  const product = getOwnedProduct(req, res);
  if (!product) return;
  const image = db.prepare('SELECT * FROM product_images WHERE id = ? AND product_id = ?').get(req.params.imageId, product.id);
  if (image) {
    db.prepare('DELETE FROM product_images WHERE id = ?').run(image.id);
    if (image.image_path.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, '..', 'public', image.image_path);
      fs.unlink(filePath, () => {});
    }
  }
  res.redirect(`/seller/products/${product.id}/edit`);
});

router.post('/products/:id/delete', checkCsrf, (req, res) => {
  const product = getOwnedProduct(req, res);
  if (!product) return;
  db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(product.id);
  res.redirect('/seller/dashboard');
});

router.post('/products/:id/restore', checkCsrf, (req, res) => {
  const product = getOwnedProduct(req, res);
  if (!product) return;
  if (product.admin_disabled) {
    return res.status(403).render('error', {
      title: "Can't restore this listing",
      message: 'This listing was removed by a site administrator and can only be restored by them. Contact support if you believe this was a mistake.',
    });
  }
  db.prepare('UPDATE products SET is_active = 1 WHERE id = ?').run(product.id);
  res.redirect('/seller/dashboard');
});

router.post('/products/:id/mark-sold', checkCsrf, (req, res) => {
  const product = getOwnedProduct(req, res);
  if (!product) return;
  db.prepare('UPDATE products SET is_sold = 1 WHERE id = ?').run(product.id);
  res.redirect('/seller/dashboard');
});

router.post('/products/:id/relist', checkCsrf, (req, res) => {
  const product = getOwnedProduct(req, res);
  if (!product) return;
  if (product.admin_disabled) {
    return res.status(403).render('error', {
      title: "Can't relist this listing",
      message: 'This listing was removed by a site administrator and can only be restored by them. Contact support if you believe this was a mistake.',
    });
  }
  db.prepare('UPDATE products SET is_sold = 0, is_active = 1 WHERE id = ?').run(product.id);
  res.redirect('/seller/dashboard');
});

module.exports = router;
