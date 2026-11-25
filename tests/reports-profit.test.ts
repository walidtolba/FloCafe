/**
 * GET /api/reports/profit — net sales minus product cost, per day/month/product.
 *
 * Usage: node tests/run-electron-node-test.cjs tests/reports-profit.test.ts
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const Module = require('module');
const originalLoad = Module._load;
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-reports-profit-'));

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  }
  return originalLoad.apply(this, arguments as any);
};

process.env.JWT_SECRET = 'test-secret-reports-profit';

const { assertEqualOrThrow, assertOrThrow } = require('./helpers/test-setup');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { initDatabase, getDatabase, closeDatabase, now } = require('../main/db');
const { getJWTSecret } = require('../main/routes/auth');
const { reportRoutes } = require('../main/routes/reports');

function isNativeAbiMismatch(error: any): boolean {
  return error?.code === 'ERR_DLOPEN_FAILED' && String(error?.message || '').includes('NODE_MODULE_VERSION');
}

function utcDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
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

  const ownerId = 'owner-profit';
  const waiterId = 'server-profit';
  for (const [id, role] of [[ownerId, 'owner'], [waiterId, 'server']]) {
    db.prepare(`INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(id, id, `${id}@test.local`, bcrypt.hashSync('pw', 10), role, now(), now());
  }
  db.prepare(`INSERT INTO categories (id, name, sort_order) VALUES ('cat-x', 'X', 1)`).run();
  const addProduct = (id: string, name: string, price: number, cost: number | null) =>
    db.prepare(`INSERT INTO products (id, category_id, name, price, cost, is_active, sort_order) VALUES (?, 'cat-x', ?, ?, ?, 1, 1)`).run(id, name, price, cost);
  addProduct('prod-tea', 'Tea', 20, 5);
  addProduct('prod-nocost', 'Water', 10, null);

  const day1 = utcDate(-1);
  const day2 = utcDate(0);
  const prevDay = utcDate(-2);

  const addOrder = (number: string, date: string, status = 'completed') => {
    const at = `${date} 12:00:00`;
    db.prepare(`INSERT INTO orders (order_number, user_id, type, status, subtotal, total, created_at, updated_at) VALUES (?, ?, 'takeaway', ?, 0, 0, ?, ?)`)
      .run(number, ownerId, status, at, at);
    return { id: (db.prepare(`SELECT id FROM orders WHERE order_number = ?`).get(number) as any).id, at };
  };
  const addItem = (order: { id: number; at: string }, productId: string, name: string, unit: number, qty: number, opts: { unitCost?: number | null; discount?: number; status?: string } = {}) => {
    db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, tax_amount, discount_amount, total, unit_cost, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`)
      .run(order.id, productId, name, unit, qty, unit * qty, opts.discount ?? 0, unit * qty, opts.unitCost ?? null, opts.status ?? 'served', order.at, order.at);
  };

  const o1 = addOrder('ORD-P-1', day1);
  addItem(o1, 'prod-tea', 'Tea', 20, 10, { unitCost: 4 }); // snapshot 4 (current cost is 5)
  addItem(o1, 'prod-tea', 'Tea', 20, 1, { unitCost: 4, status: 'cancelled' });
  const o2 = addOrder('ORD-P-2', day2);
  addItem(o2, 'prod-tea', 'Tea', 20, 2, { unitCost: null, discount: 10 }); // falls back to current cost 5
  addItem(o2, 'prod-nocost', 'Water', 10, 3, { unitCost: null });
  const cancelled = addOrder('ORD-P-3', day2, 'cancelled');
  addItem(cancelled, 'prod-tea', 'Tea', 20, 100, { unitCost: 4 });
  const prev = addOrder('ORD-P-4', prevDay);
  addItem(prev, 'prod-tea', 'Tea', 20, 1, { unitCost: 4 });

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
    request(app).get(`/api/reports/profit?${qs}`).set('Authorization', `Bearer ${token}`);

  try {
    const res = await get(`start_date=${day1}&end_date=${day2}&compare=previous`);
    assertEqualOrThrow(res.status, 200, 'owner can read profit');
    const profit = res.body.profit;

    // day1: 10 tea, net 200, cost 40. day2: tea net 40-10=30 cost 10, water net 30 cost 0.
    assertEqualOrThrow(profit.totals.netSales, 260, 'net sales subtract discounts and skip cancelled items/orders');
    assertEqualOrThrow(profit.totals.cost, 50, 'cost uses the sale-time snapshot and falls back to current cost when NULL');
    assertEqualOrThrow(profit.totals.profit, 210, 'profit is net sales minus cost');
    assertEqualOrThrow(profit.totals.orders, 2, 'cancelled orders are not counted');

    assertEqualOrThrow(profit.series.length, 2, 'daily series has one point per day');
    assertEqualOrThrow(profit.series[0].profit, 160, 'first day profit');
    assertEqualOrThrow(profit.series[1].profit, 50, 'second day profit');
    assertEqualOrThrow(profit.bestPeriod.period, day1, 'best period is the most profitable day');

    const tea = profit.products.find((p: any) => p.productId === 'prod-tea');
    const water = profit.products.find((p: any) => p.productId === 'prod-nocost');
    assertEqualOrThrow(tea.quantity, 12, 'product quantity excludes cancelled items');
    assertOrThrow(water.missingCost === true && tea.missingCost === false, 'products without a cost are flagged');
    assertEqualOrThrow(profit.products[0].productId, 'prod-tea', 'products are ranked by profit');

    // Previous window is the 2 days before start (day1-2 .. day1-1): only ORD-P-4 on prevDay.
    assertEqualOrThrow(profit.previous.totals.netSales, 20, 'comparison covers the preceding period of equal length');
    assertEqualOrThrow(profit.previous.totals.profit, 16, 'comparison profit uses its own snapshot cost');

    const monthly = await get(`start_date=${day1}&end_date=${day2}&group_by=month`);
    const periods = monthly.body.profit.series.map((p: any) => p.period);
    assertOrThrow(periods.every((p: string) => /^\d{4}-\d{2}$/.test(p)), 'month grouping buckets by YYYY-MM');
    const monthlyProfit = monthly.body.profit.series.reduce((sum: number, p: any) => sum + p.profit, 0);
    assertEqualOrThrow(monthlyProfit, 210, 'month buckets add up to the total');

    assertEqualOrThrow((await get(`start_date=${day2}&end_date=${day1}`)).status, 400, 'inverted range is rejected');
    assertEqualOrThrow((await get(`start_date=2020-01-01&end_date=${day2}`)).status, 400, 'oversized range is rejected');
    assertEqualOrThrow((await get(`start_date=${day1}&end_date=${day2}`, waiterToken)).status, 403, 'non-owners are rejected');
    console.log('reports-profit: all checks passed');
  } finally {
    closeDatabase();
  }
}

main().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
