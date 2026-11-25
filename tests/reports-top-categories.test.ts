/**
 * GET /api/reports/topCategories — date-ranged category ranking used by the
 * dashboard card and its full-list page.
 *
 * Usage: node tests/run-electron-node-test.cjs tests/reports-top-categories.test.ts
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const Module = require('module');
const originalLoad = Module._load;
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-reports-top-categories-'));

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  }
  return originalLoad.apply(this, arguments as any);
};

process.env.JWT_SECRET = 'test-secret-reports-top-categories';

const { assertEqualOrThrow, assertOrThrow } = require('./helpers/test-setup');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { initDatabase, getDatabase, closeDatabase, now, localDateInTimezone } = require('../main/db');
const { getJWTSecret } = require('../main/routes/auth');
const { reportRoutes } = require('../main/routes/reports');

function isNativeAbiMismatch(error: any): boolean {
  return error?.code === 'ERR_DLOPEN_FAILED' && String(error?.message || '').includes('NODE_MODULE_VERSION');
}

async function main() {
  try {
    initDatabase();
  } catch (error: any) {
    if (isNativeAbiMismatch(error)) {
      console.log('Skipping: better-sqlite3 ABI mismatch (run via Electron)');
      process.exit(77);
    }
    throw error;
  }

  const db = getDatabase();
  db.prepare(`UPDATE settings SET value = 'UTC' WHERE key = 'timezone'`).run();
  if ((db.prepare(`SELECT COUNT(*) as c FROM settings WHERE key = 'timezone'`).get() as any).c === 0) {
    db.prepare(`INSERT INTO settings (key, value) VALUES ('timezone', 'UTC')`).run();
  }
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('country', 'IN', ?) ON CONFLICT(key) DO UPDATE SET value='IN', updated_at=excluded.updated_at`).run(now());

  const ownerId = 'owner-top-cat';
  const waiterId = 'server-top-cat';
  for (const [id, role] of [[ownerId, 'owner'], [waiterId, 'server']]) {
    db.prepare(`INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(id, id, `${id}@test.local`, bcrypt.hashSync('pw', 10), role, now(), now());
  }

  db.prepare(`INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?)`).run('cat-drinks', 'Drinks', 1);
  db.prepare(`INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?)`).run('cat-food', 'Food', 2);
  db.prepare(`INSERT INTO products (id, category_id, name, price, is_active, sort_order) VALUES (?, ?, ?, ?, 1, 1)`).run('prod-tea', 'cat-drinks', 'Tea', 20);
  db.prepare(`INSERT INTO products (id, category_id, name, price, is_active, sort_order) VALUES (?, ?, ?, ?, 1, 2)`).run('prod-burger', 'cat-food', 'Burger', 200);

  const today = localDateInTimezone(new Date(), 'UTC');
  const old = new Date();
  old.setUTCDate(old.getUTCDate() - 10);
  const oldDate = localDateInTimezone(old, 'UTC');
  const oldCreatedAt = `${oldDate} 12:00:00`;

  const addOrder = (number: string, createdAt: string) => {
    db.prepare(`INSERT INTO orders (order_number, user_id, type, status, subtotal, total, created_at, updated_at) VALUES (?, ?, 'takeaway', 'completed', 0, 0, ?, ?)`)
      .run(number, ownerId, createdAt, createdAt);
    return (db.prepare(`SELECT id FROM orders WHERE order_number = ?`).get(number) as any).id;
  };
  const addItem = (orderId: number, productId: string, name: string, unit: number, qty: number, status: string, createdAt: string) => {
    db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, tax_amount, total, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`)
      .run(orderId, productId, name, unit, qty, unit * qty, unit * qty, status, createdAt, createdAt);
  };

  const todayAt = now();
  const todayOrder = addOrder('ORD-TC-TODAY', todayAt);
  addItem(todayOrder, 'prod-tea', 'Tea', 20, 5, 'served', todayAt);
  addItem(todayOrder, 'prod-burger', 'Burger', 200, 2, 'served', todayAt);
  addItem(todayOrder, 'prod-burger', 'Burger', 200, 50, 'cancelled', todayAt);
  const oldOrder = addOrder('ORD-TC-OLD', oldCreatedAt);
  addItem(oldOrder, 'prod-tea', 'Tea', 20, 100, 'served', oldCreatedAt);

  const app = express();
  app.use(express.json());
  app.use((req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
    try {
      req.user = jwt.verify(authHeader.split(' ')[1], getJWTSecret());
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  });
  app.use('/api/reports', reportRoutes);
  const ownerToken = jwt.sign({ userId: ownerId, email: `${ownerId}@test.local`, role: 'owner' }, getJWTSecret(), { expiresIn: '1h' });
  const waiterToken = jwt.sign({ userId: waiterId, email: `${waiterId}@test.local`, role: 'server' }, getJWTSecret(), { expiresIn: '1h' });
  const get = (qs: string, token = ownerToken) =>
    request(app).get(`/api/reports/topCategories?${qs}`).set('Authorization', `Bearer ${token}`);

  try {
    const day = await get(`start_date=${today}&end_date=${today}`);
    assertEqualOrThrow(day.status, 200, 'owner can read top categories');
    const dayRows = day.body.topCategories;
    assertEqualOrThrow(dayRows.length, 2, 'day window ignores orders outside the range');
    assertEqualOrThrow(dayRows[0].name, 'Food', 'categories are ranked by revenue');
    assertEqualOrThrow(Number(dayRows[0].revenue), 400, 'cancelled items are excluded from revenue');
    assertEqualOrThrow(Number(dayRows[1].quantity), 5, 'quantity is summed per category');

    const range = await get(`start_date=${oldDate}&end_date=${today}`);
    assertEqualOrThrow(range.body.topCategories[0].name, 'Drinks', 'wider range includes older orders and re-ranks');

    const limited = await get(`start_date=${oldDate}&end_date=${today}&limit=1`);
    assertEqualOrThrow(limited.body.topCategories.length, 1, 'limit caps the list');

    const inverted = await get(`start_date=${today}&end_date=${oldDate}`);
    assertEqualOrThrow(inverted.status, 400, 'inverted range is rejected');

    const forbidden = await get(`start_date=${today}&end_date=${today}`, waiterToken);
    assertOrThrow(forbidden.status === 403, 'servers without reports.view are rejected');
    console.log('reports-top-categories: all checks passed');
  } finally {
    closeDatabase();
  }
}

main().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
