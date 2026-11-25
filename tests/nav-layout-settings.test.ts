/**
 * nav_layout Write-Path Tests 
 *
 * `nav_layout` is allowlisted on two transports: the wildcard
 * `PUT /api/settings/:key` route and the Electron `set-setting` IPC channel.
 * A key validated on one transport and not the other is a bypass on the other,
 * so this suite asserts rejection on BOTH surfaces before asserting that the
 * two valid values are accepted on both.
 *
 * Pattern: Electron-ABI integration test (run via run-electron-node-test.cjs
 * because better-sqlite3 is built for Electron's Node ABI). Mocked electron
 * module captures `ipcMain.handle` registrations (theme-mode-settings.test.ts
 * pattern); the real Express app + SQLite DB are mounted so both write paths
 * are exercised against the real branches.
 *
 * Run: npm run test:nav-layout-settings
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { strict as assert } from 'node:assert';
import * as vm from 'node:vm';
import * as ts from 'typescript';

const Module = require('module');
const originalLoad = Module._load;
const express = require('express');
const http = require('http');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-nav-layout-settings-'));

// Captured IPC handlers.
const registered = new Map<string, (...args: any[]) => any>();
const mockApp = {
  isPackaged: true,
  getPath: (name: string) => testDir,
  getName: () => 'FloCafe',
  getVersion: () => '0.0.0-test',
};
const mockBrowserWindow = class {
  loadURL() {}
  on() {}
  webContents = { send: () => {}, on: () => {} };
};

Module._load = function (request: string, parent: any, isMain: boolean) {
  if (request === 'electron') {
    return {
      app: mockApp,
      ipcMain: {
        on: () => {},
        handle: (channel: string, listener: (...args: any[]) => any) => {
          registered.set(channel, listener);
        },
      },
      dialog: {
        showSaveDialog: async () => ({ canceled: true }),
        showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
        showMessageBox: async () => ({ response: 1 }),
      },
      BrowserWindow: mockBrowserWindow,
    };
  }
  // Stubs required by main/ipc.ts imports (mirrors theme-mode-settings.test.ts).
  if (request === './middleware/security') {
    return { clearInMemoryRevokedTokens: () => {}, clearUserAuthCache: () => {} };
  }
  if (request === './routes/auth') return { clearJWTSecretCache: () => {} };
  if (request === './server') return { getLocalIP: () => '127.0.0.1' };
  if (request === './kds-server') return { getKdsPort: () => 3002 };
  if (request === './services/master-pin') {
    return {
      authorizeMasterPin: () => ({ ok: false, error: 'Invalid master PIN' }),
      isMasterPinAvailable: () => true,
      isMasterPinSet: () => true,
    };
  }
  if (request === './services/schema-health') {
    return {
      runHealthCheck: () => ({ status: 'healthy', findings: [] }),
      applySafeFixes: () => ({ applied: [], skipped: [], errors: [] }),
    };
  }
  if (request === './services/whatsapp') return { getStatus: () => ({ connected: false }) };
  if (request === './window-options') return { createKdsWindow: () => ({}) };
  return originalLoad.apply(this, arguments as any);
};

const VALID = ['sidebar', 'topbar'] as const;
/** Strings that reach the enum check and must be refused by it. */
const INVALID_STRINGS = ['bogus', 'SIDEBAR', 'grid', '', 'cards '];
/** Non-string payloads: refused by the IPC type guard before the enum check. */
const INVALID_TYPES = [42, null, true, { value: 'topbar' }];

async function httpRequest(baseUrl: string, urlPath: string, options: any = {}): Promise<any> {
  const url = new URL(urlPath, baseUrl);
  const headers: any = { 'Content-Type': 'application/json' };
  if (options.headers) Object.assign(headers, options.headers);

  return new Promise<any>((resolve) => {
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: options.method || 'GET', headers },
      (res: any) => {
        let body = '';
        res.on('data', (chunk: any) => (body += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch {
            resolve({ status: res.statusCode, data: body });
          }
        });
      },
    );
    if (options.body) req.write(options.body);
    req.end();
  });
}

function readStored(key: string): string | undefined {
  const { getDatabase } = require('../main/db');
  const row = getDatabase()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  nav_layout Write-Path Tests ');
  console.log('═══════════════════════════════════════════════════════════\n');

  const { initDatabase, getDatabase, closeDatabase, now } = require('../main/db');
  const { settingsRoutes } = require('../main/routes/settings');
  const { registerIpcHandlers } = require('../main/ipc');

  try {
    initDatabase();
  } catch (e: any) {
    if (e?.message?.includes('ABI')) {
      console.log('  ⚠ Skipping: better-sqlite3 ABI mismatch (run via Electron)');
      process.exit(77);
    }
    throw e;
  }

  // requirePermission() resolves effective permissions from a real users row
  // keyed by req.user.userId — seed an active owner so settings checks pass.
  getDatabase().prepare(`
    INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at)
    VALUES ('nav-layout-owner', 'Test Owner', 'nav-layout-owner@test.local', 'unused', 'owner', 1, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(now(), now());

  registerIpcHandlers();

  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    // Permissions resolve from the users row keyed by userId, so the header lets
    // a case act as a restricted role without re-mounting the app.
    req.user = {
      userId: String(req.headers['x-test-user'] || 'nav-layout-owner'),
      role: 'owner',
      name: 'Test Owner',
    };
    next();
  });
  app.use('/api/settings', settingsRoutes);

  let server: any;
  let baseUrl: string;
  try {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
        resolve();
      });
    });

    console.log('0. Key is allowlisted on both transports (403 would mean it is not registered)');
    {
      const res = await httpRequest(baseUrl, '/api/settings/nav_layout', {
        method: 'PUT',
        body: JSON.stringify({ value: 'sidebar' }),
      });
      assert.notEqual(res.status, 403, 'wildcard route allows the nav_layout key');
    }

    console.log('\n1. PUT /api/settings/nav_layout rejects every non-enum value → HTTP 400');
    {
      for (const value of [...INVALID_STRINGS, ...INVALID_TYPES]) {
        const res = await httpRequest(baseUrl, '/api/settings/nav_layout', {
          method: 'PUT',
          body: JSON.stringify({ value }),
        });
        assert.equal(res.status, 400, `rejects ${JSON.stringify(value)}`);
        assert.ok(
          String(res.data?.error).includes('nav_layout'),
          `error names nav_layout for ${JSON.stringify(value)}`,
        );
      }
      assert.equal(readStored('nav_layout'), 'sidebar', 'no rejected value reached SQLite');
    }

    console.log('\n2. PUT /api/settings/nav_layout accepts "sidebar" and "topbar" → HTTP 200');
    {
      for (const value of VALID) {
        const res = await httpRequest(baseUrl, '/api/settings/nav_layout', {
          method: 'PUT',
          body: JSON.stringify({ value }),
        });
        assert.equal(res.status, 200, `accepts ${value}`);
        assert.equal(readStored('nav_layout'), value, `persisted ${value}`);
      }
    }

    console.log('\n3. IPC set-setting("nav_layout", <invalid>) → { success: false }');
    {
      const handler = registered.get('set-setting');
      assert.ok(!!handler, 'set-setting IPC handler is registered');
      const trustedSender = { sender: { getURL: () => 'http://localhost:3001/' } };
      for (const value of INVALID_STRINGS) {
        const result = await handler(trustedSender, 'nav_layout', value);
        assert.equal(result?.success, false, `rejects ${JSON.stringify(value)}`);
        assert.ok(
          String(result?.error).includes('nav_layout'),
          `error names nav_layout for ${JSON.stringify(value)}`,
        );
      }
      // Non-string payloads never reach the enum check; the type guard rejects them.
      for (const value of INVALID_TYPES) {
        const result = await handler(trustedSender, 'nav_layout', value);
        assert.equal(result?.success, false, `rejects non-string ${JSON.stringify(value)}`);
      }
      assert.equal(readStored('nav_layout'), 'topbar', 'no rejected value reached SQLite via IPC');
    }

    console.log('\n4. IPC set-setting("nav_layout", "sidebar" | "topbar") → { success: true }');
    {
      const handler = registered.get('set-setting');
      const trustedSender = { sender: { getURL: () => 'http://localhost:3001/' } };
      for (const value of VALID) {
        const result = await handler(trustedSender, 'nav_layout', value);
        assert.equal(result?.success, true, `accepts ${value}`);
        assert.equal(readStored('nav_layout'), value, `IPC persisted ${value}`);
      }
    }

    console.log('\n5. GET before any explicit save returns the "sidebar" default, not 404');
    {
      getDatabase().prepare("DELETE FROM settings WHERE key = 'nav_layout'").run();
      const res = await httpRequest(baseUrl, '/api/settings/nav_layout');
      assert.equal(res.status, 200, 'returns 200 with no persisted row');
      assert.equal(res.data?.setting?.value, 'sidebar', 'defaults to "sidebar"');
    }

    console.log('\n7. Roles denied settings.view can still read the layout');
    {
      const db = getDatabase();
      db.prepare(`
        INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at)
        VALUES ('nav-layout-server', 'Test Server', 'nav-layout-server@test.local', 'unused', 'server', 1, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(now(), now());
      db.prepare("DELETE FROM user_permission_overrides WHERE user_id = 'nav-layout-server'").run();
      db.prepare(`
        INSERT INTO user_permission_overrides (user_id, permission_id, effect, updated_by, created_at, updated_at)
        VALUES ('nav-layout-server', 'settings.view', 'deny', 'nav-layout-owner', ?, ?)
      `).run(now(), now());
      const restricted = { headers: { 'x-test-user': 'nav-layout-server' } };

      const read = await httpRequest(baseUrl, '/api/settings/nav_layout', restricted);
      assert.equal(read.status, 200, 'a role denied settings.view still reads the tenant layout');
      assert.equal(
        read.data?.setting?.value,
        readStored('nav_layout') ?? 'sidebar',
        'returns the persisted layout or its default',
      );

      const write = await httpRequest(baseUrl, '/api/settings/nav_layout', {
        ...restricted,
        method: 'PUT',
        body: JSON.stringify({ value: 'topbar' }),
      });
      assert.equal(write.status, 403, 'writes still require settings.manage');
      assert.notEqual(readStored('nav_layout'), 'topbar', 'the refused write never reached SQLite');
    }

    console.log('\n8. Unknown keys are still refused by the wildcard route');
    {
      const res = await httpRequest(baseUrl, '/api/settings/not_a_setting', {
        method: 'PUT',
        body: JSON.stringify({ value: 'x' }),
      });
      assert.equal(res.status, 403, 'rejects keys outside the allowlist');
    }
  } finally {
    if (server) server.close();
    closeDatabase();
    Module._load = originalLoad;
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});