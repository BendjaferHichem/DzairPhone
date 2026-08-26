const express = require('express');
const db = require('../db/db');

const router = express.Router();

const PRIMARY_IMAGE_SQL = `(SELECT image_path FROM product_images WHERE product_images.product_id = products.id ORDER BY position ASC, id ASC LIMIT 1) AS primary_image`;
// A listing is publicly visible only when the seller has it active, it hasn't
// been marked sold, and no admin has removed it.
const VISIBLE_SQL = `products.is_active = 1 AND products.admin_disabled = 0 AND products.is_sold = 0`;
const FINAL_PRICE_SQL = `(products.price_dzd * (1 - products.discount_pct / 100.0))`;
const PAGE_SIZE = 12;

function withPricing(p) {
  const finalPrice = Math.round(p.price_dzd * (1 - (p.discount_pct || 0) / 100));
  return {
    ...p,
    price_fmt: p.price_dzd.toLocaleString('en-US'),
    final_price_dzd: finalPrice,
    final_price_fmt: finalPrice.toLocaleString('en-US'),
    image: p.primary_image || 'https://placehold.co/500x500/e8edff/2f5fed?text=No+photo',
  };
}

function getFavoriteIds(userId) {
  if (!userId) return new Set();
  const rows = db.prepare('SELECT product_id FROM favorites WHERE user_id = ?').all(userId);
  return new Set(rows.map((r) => r.product_id));
}

function withFavorites(products, favoriteIds) {
  return products.map((p) => ({ ...p, is_favorited: favoriteIds.has(p.id) }));
}

router.get('/', (req, res) => {
  const { q, brand, condition, sort, min_price, max_price, store } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  let where = `WHERE ${VISIBLE_SQL} AND stores.is_active = 1`;
  const params = [];

  if (q) {
    where += ' AND (products.brand LIKE ? OR products.model LIKE ? OR products.description LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (brand) {
    where += ' AND products.brand = ?';
    params.push(brand);
  }
  if (condition) {
    where += ' AND products.condition = ?';
    params.push(condition);
  }
  if (store) {
    where += ' AND stores.id = ?';
    params.push(store);
  }
  const minPriceNum = parseInt(min_price, 10);
  const maxPriceNum = parseInt(max_price, 10);
  if (!isNaN(minPriceNum) && minPriceNum > 0) {
    where += ` AND ${FINAL_PRICE_SQL} >= ?`;
    params.push(minPriceNum);
  }
  if (!isNaN(maxPriceNum) && maxPriceNum > 0) {
    where += ` AND ${FINAL_PRICE_SQL} <= ?`;
    params.push(maxPriceNum);
  }

  const sortMap = {
    price_asc: `${FINAL_PRICE_SQL} ASC`,
    price_desc: `${FINAL_PRICE_SQL} DESC`,
    newest: 'products.created_at DESC',
  };
  const orderBy = sortMap[sort] || 'products.created_at DESC';

  const totalCount = db
    .prepare(`SELECT COUNT(*) AS c FROM products JOIN stores ON stores.id = products.store_id ${where}`)
    .get(...params).c;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const offset = (currentPage - 1) * PAGE_SIZE;

  const sql = `SELECT products.*, stores.name AS store_name, ${PRIMARY_IMAGE_SQL} FROM products
             JOIN stores ON stores.id = products.store_id
             ${where}
             ORDER BY ${orderBy}
             LIMIT ? OFFSET ?`;

  const rows = db.prepare(sql).all(...params, PAGE_SIZE, offset).map(withPricing);
  const favoriteIds = getFavoriteIds(req.user && req.user.id);
  const brands = db.prepare('SELECT DISTINCT brand FROM products WHERE is_active = 1 AND admin_disabled = 0 AND is_sold = 0 ORDER BY brand').all().map((r) => r.brand);
  const storeInfo = store ? db.prepare('SELECT id, name FROM stores WHERE id = ?').get(store) : null;

  res.render('products', {
    title: 'Browse phones',
    products: withFavorites(rows, favoriteIds),
    brands,
    storeInfo,
    filters: {
      q: q || '',
      brand: brand || '',
      condition: condition || '',
      sort: sort || '',
      min_price: min_price || '',
      max_price: max_price || '',
      store: store || '',
    },
    pagination: { currentPage, totalPages, totalCount },
  });
});

function toWhatsAppNumber(phone) {
  if (!phone) return '';
  let digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('0')) digits = '213' + digits.slice(1);
  else if (!digits.startsWith('213')) digits = '213' + digits;
  return digits;
}

router.get('/:id', (req, res) => {
  const product = db
    .prepare(
      `SELECT products.*, stores.name AS store_name, stores.id AS store_id, stores.description AS store_description,
              stores.phone AS store_phone, stores.created_at AS store_created_at
       FROM products JOIN stores ON stores.id = products.store_id
       WHERE products.id = ? AND ${VISIBLE_SQL}`
    )
    .get(req.params.id);

  if (!product) {
    return res.status(404).render('error', { title: 'Not found', message: "That phone listing doesn't exist or was removed." });
  }
  const images = db.prepare('SELECT image_path FROM product_images WHERE product_id = ? ORDER BY position ASC, id ASC').all(product.id).map((r) => r.image_path);
  const related = db
    .prepare(`SELECT products.*, ${PRIMARY_IMAGE_SQL} FROM products WHERE brand = ? AND id != ? AND ${VISIBLE_SQL} LIMIT 4`)
    .all(product.brand, product.id)
    .map(withPricing);
  const sellerListingCount = db
    .prepare(`SELECT COUNT(*) AS c FROM products WHERE store_id = ? AND ${VISIBLE_SQL} AND id != ?`)
    .get(product.store_id, product.id).c;

  const favoriteIds = getFavoriteIds(req.user && req.user.id);
  const contactPhone = product.contact_phone || product.store_phone || '';
  res.render('product', {
    title: `${product.brand} ${product.model}`,
    product: withFavorites([withPricing(product)], favoriteIds)[0],
    images: images.length ? images : [withPricing(product).image],
    contactPhone,
    contactWhatsApp: toWhatsAppNumber(contactPhone),
    sellerListingCount,
    related: withFavorites(related, favoriteIds),
  });
});

module.exports = router;
module.exports.withPricing = withPricing;
module.exports.PRIMARY_IMAGE_SQL = PRIMARY_IMAGE_SQL;
module.exports.VISIBLE_SQL = VISIBLE_SQL;
module.exports.getFavoriteIds = getFavoriteIds;
module.exports.withFavorites = withFavorites;
