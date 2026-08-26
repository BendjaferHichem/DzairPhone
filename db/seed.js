// Seeds the database: one admin account (random password) + demo sellers/listings.
// Safe to re-run: it skips anything that already exists.
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');

function randomPassword(len = 16) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  return Array.from(crypto.randomFillSync(new Uint32Array(len)))
    .map((n) => chars[n % chars.length])
    .join('');
}

function upsertUser({ name, email, password, role }) {
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existing) return existing;
  const hash = bcrypt.hashSync(password, 12);
  const info = db
    .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, email, hash, role);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

// --- Admin account ---
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@dzairphone.local';
let adminPasswordToShow = null;
const existingAdmin = db.prepare('SELECT * FROM users WHERE role = ?').get('admin');
if (!existingAdmin) {
  adminPasswordToShow = process.env.ADMIN_PASSWORD || randomPassword(18);
  upsertUser({ name: 'Admin', email: ADMIN_EMAIL, password: adminPasswordToShow, role: 'admin' });

  const outFile = path.join(__dirname, '..', 'ADMIN_CREDENTIALS.txt');
  fs.writeFileSync(
    outFile,
    `DzairPhone admin login\n` +
      `------------------------\n` +
      `Step 1, log in like a normal user at:  http://localhost:3000/login\n` +
      `  Email:    ${ADMIN_EMAIL}\n` +
      `  Password: ${adminPasswordToShow}\n` +
      `Step 2, then open the admin panel at:  http://localhost:3000${process.env.ADMIN_PATH || '/control-panel-x7q9'}\n\n` +
      `Change this password after your first login, and delete this file once you've saved the credentials somewhere safe.\n`,
    { mode: 0o600 }
  );
  console.log('\n=== Admin account created ===');
  console.log('Email:   ', ADMIN_EMAIL);
  console.log('Password:', adminPasswordToShow);
  console.log('(Also saved to ADMIN_CREDENTIALS.txt, delete that file once you have the password saved safely.)\n');
} else {
  console.log('Admin account already exists, skipping.');
}

// --- Demo sellers + stores + listings (only if no products exist yet) ---
const productCount = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
if (productCount === 0) {
  const seller1 = upsertUser({ name: 'Nadia Boudiaf', email: 'seller1@example.com', password: 'Seller123!', role: 'seller' });
  const seller2 = upsertUser({ name: 'TechHub Alger', email: 'seller2@example.com', password: 'Seller123!', role: 'both' });
  upsertUser({ name: 'Demo Buyer', email: 'buyer@example.com', password: 'Buyer123!', role: 'buyer' });

  function ensureStore(userId, name, description, phone) {
    let store = db.prepare('SELECT * FROM stores WHERE user_id = ?').get(userId);
    if (!store) {
      const info = db
        .prepare('INSERT INTO stores (user_id, name, description, phone) VALUES (?, ?, ?, ?)')
        .run(userId, name, description, phone);
      store = db.prepare('SELECT * FROM stores WHERE id = ?').get(info.lastInsertRowid);
    }
    return store;
  }

  const store1 = ensureStore(seller1.id, "Nadia's Mobile Shop", 'Vendeuse de confiance de smartphones neufs et reconditionnés à Alger.', '0555 12 34 56');
  const store2 = ensureStore(seller2.id, 'TechHub Alger', 'Revendeur agréé des derniers smartphones haut de gamme.', '0661 98 76 54');

  const insertProduct = db.prepare(`
    INSERT INTO products (store_id, brand, model, price_dzd, quantity, condition, storage_gb, color, description, contact_phone, discount_pct)
    VALUES (@store_id, @brand, @model, @price_dzd, @quantity, @condition, @storage_gb, @color, @description, @contact_phone, @discount_pct)
  `);
  const insertImage = db.prepare('INSERT INTO product_images (product_id, image_path, position) VALUES (?, ?, ?)');

  const demoProducts = [
    { store_id: store1.id, brand: 'Apple', model: 'iPhone 15 Pro', price_dzd: 285000, quantity: 3, condition: 'new', storage_gb: 256, color: 'Titanium Black', description: 'Dernier iPhone avec puce A17 Pro et design en titane. Facture disponible.', contact_phone: '0555 12 34 56', discount_pct: 10, image: 'iphone15pro' },
    { store_id: store1.id, brand: 'Apple', model: 'iPhone 14', price_dzd: 195000, quantity: 5, condition: 'new', storage_gb: 128, color: 'Blue', description: 'iPhone fiable et rapide, excellent au quotidien.', contact_phone: '0555 12 34 56', discount_pct: 0, image: 'iphone14' },
    { store_id: store2.id, brand: 'Samsung', model: 'Galaxy S24 Ultra', price_dzd: 340000, quantity: 2, condition: 'new', storage_gb: 512, color: 'Titanium Gray', description: 'Flagship Samsung avec S Pen et caméra 200MP.', contact_phone: '0661 98 76 54', discount_pct: 15, image: 's24ultra' },
    { store_id: store2.id, brand: 'Samsung', model: 'Galaxy A54', price_dzd: 115000, quantity: 8, condition: 'new', storage_gb: 128, color: 'Awesome Lime', description: 'Excellent téléphone milieu de gamme avec un bon appareil photo.', contact_phone: '0661 98 76 54', discount_pct: 5, image: 'a54' },
    { store_id: store1.id, brand: 'Google', model: 'Pixel 8', price_dzd: 170000, quantity: 4, condition: 'new', storage_gb: 128, color: 'Obsidian', description: 'Pure Android avec d\u2019excellentes fonctionnalit\u00e9s cam\u00e9ra bas\u00e9es sur l\u2019IA.', contact_phone: '0555 12 34 56', discount_pct: 0, image: 'pixel8' },
    { store_id: store2.id, brand: 'Xiaomi', model: 'Redmi Note 13 Pro', price_dzd: 85000, quantity: 10, condition: 'new', storage_gb: 256, color: 'Midnight Black', description: 'Excellent rapport qualit\u00e9-prix avec charge rapide.', contact_phone: '0661 98 76 54', discount_pct: 20, image: 'redminote13' },
    { store_id: store1.id, brand: 'Apple', model: 'iPhone 13', price_dzd: 145000, quantity: 1, condition: 'used', storage_gb: 128, color: 'Midnight', description: 'Vendu par un particulier. Bon \u00e9tat, batterie \u00e0 90%. Contactez-moi pour plus de photos.', contact_phone: '0770 11 22 33', discount_pct: 8, image: 'iphone13refurb' },
    { store_id: store2.id, brand: 'OnePlus', model: '12', price_dzd: 225000, quantity: 3, condition: 'new', storage_gb: 256, color: 'Flowy Emerald', description: 'Flagship killer avec charge ultra rapide.', contact_phone: '0661 98 76 54', discount_pct: 0, image: 'oneplus12' },
  ];

  const insertMany = db.transaction((items) => {
    items.forEach((p) => {
      const info = insertProduct.run(p);
      insertImage.run(info.lastInsertRowid, `https://picsum.photos/seed/${p.image}/600/600`, 0);
    });
  });
  insertMany(demoProducts);
  console.log(`Seeded ${demoProducts.length} demo listings across 2 demo stores.`);
  console.log('Demo seller login: seller1@example.com / Seller123!  (and seller2@example.com / Seller123!, role "both")');
  console.log('Demo buyer login:  buyer@example.com / Buyer123!');
} else {
  console.log('Listings already exist, skipping product seed.');
}
