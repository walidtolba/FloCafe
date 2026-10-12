/**
 * Printing settings save contract.
 *
 * Covers the atomic backend batch endpoint and the frontend contract that
 * prevents the settings page from recreating the old per-key request flood.
 */

const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-printing-settings-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};

const {
  initTestDb, createApp, startServer, api, seedOwnerUser, seedManagerUser, assertEqual, getResults, closeDatabase,
} = require('./helpers/test-setup');
const { settingsRoutes } = require('../main/routes/settings');
const { resolveTicketLogoSetting } = require('../main/printers/thermal');

const basePayload = {
  printer_trim_decimals: true,
  bill_language_policy: { primary: { mode: 'fixed', language: 'de' }, additional: ['fa'] },
  kot_language_policy: { primary: { mode: 'fixed', language: 'tr' }, additional: [] },
  z_report_language_policy: { primary: { mode: 'fixed', language: 'fr' }, additional: [] },
  bill_show_name: false,
  bill_show_address: false,
  bill_show_phone: true,
  bill_show_tax_id: true,
  bill_show_tax_breakdown: false,
  bill_show_customer_name: false,
  bill_show_customer_phone: true,
  bill_show_table_number: false,
  bill_delivery_show_customer_phone_always: true,
  cash_drawer_pulse_enabled: true,
  cash_drawer_pulse_methods: ['cash', 'card'],
};

function settingValue(db: any, key: string): string | null {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value?: string } | undefined)?.value ?? null;
}

function assertPersisted(db: any, key: string, expected: string, message: string): void {
  assertEqual(settingValue(db, key), expected, message);
}

async function main() {
  const db = initTestDb();
  const owner = seedOwnerUser(db);
  const manager = seedManagerUser(db);
  const app = createApp({ '/api/settings': settingsRoutes });
  const { baseUrl, server } = await startServer(app);

  try {
    console.log('Printing settings batch endpoint');

    const ownerResponse = await api(baseUrl, '/api/settings/printing', { method: 'PUT', headers: owner.authHeader, body: basePayload });
    assertEqual(ownerResponse.status, 200, 'owner can save the complete printing settings payload atomically');
    assertPersisted(db, 'printer_trim_decimals', 'true', 'trim decimals is persisted');
    assertPersisted(db, 'bill_language_policy', JSON.stringify({ primary: { mode: 'fixed', language: 'de' }, additional: ['fa'] }), 'receipt policy is normalized and persisted');
    assertPersisted(db, 'kot_language_policy', JSON.stringify({ primary: { mode: 'fixed', language: 'tr' }, additional: [] }), 'KOT policy is normalized and persisted');
    assertPersisted(db, 'z_report_language_policy', JSON.stringify({ primary: { mode: 'fixed', language: 'fr' }, additional: [] }), 'Z-report policy is normalized and persisted');
    const zReportRead = await api(baseUrl, '/api/settings/z_report_language_policy', { headers: owner.authHeader });
    assertEqual(zReportRead.status, 200, 'Z-report policy can be read through the settings API');
    assertEqual(zReportRead.data.setting.value, JSON.stringify({ primary: { mode: 'fixed', language: 'fr' }, additional: [] }), 'settings API returns the persisted Z-report policy');
    assertPersisted(db, 'bill_show_name', 'false', 'bill name visibility is persisted');
  assertPersisted(db, 'bill_delivery_show_customer_phone_always', 'true', 'the delivery customer-number override is persisted');
    assertPersisted(db, 'bill_show_tax_id', 'true', 'tax ID visibility is persisted');
    assertPersisted(db, 'cash_drawer_pulse_methods', JSON.stringify(['cash', 'card']), 'cash drawer methods are persisted');

    const managerResponse = await api(baseUrl, '/api/settings/printing', { method: 'PUT', headers: manager.authHeader, body: { ...basePayload, printer_trim_decimals: false } });
    assertEqual(managerResponse.status, 200, 'manager can save printing settings');
    assertPersisted(db, 'printer_trim_decimals', 'false', 'manager update is persisted');

    const unauthorizedResponse = await api(baseUrl, '/api/settings/printing', { method: 'PUT', body: basePayload });
    assertEqual(unauthorizedResponse.status, 401, 'unauthenticated printing-settings write is rejected');

    const deniedResponse = await api(baseUrl, '/api/settings/printing', { method: 'PUT', headers: { Authorization: `Bearer ${owner.token}.invalid` }, body: basePayload });
    assertEqual(deniedResponse.status, 401, 'invalid printing-settings credentials are rejected');

    const beforeInvalid = Object.fromEntries(
      ['printer_trim_decimals', 'bill_show_name', 'bill_language_policy', 'cash_drawer_pulse_methods']
        .map((key) => [key, settingValue(db, key)]),
    );
    const invalidPolicyResponse = await api(baseUrl, '/api/settings/printing', { method: 'PUT', headers: owner.authHeader, body: { ...basePayload, printer_trim_decimals: true, bill_show_name: true, bill_language_policy: { primary: { mode: 'fixed', language: 'xx' }, additional: [] } } });
    assertEqual(invalidPolicyResponse.status, 400, 'invalid receipt policy is rejected before persistence');
    for (const [key, expected] of Object.entries(beforeInvalid)) {
      assertEqual(settingValue(db, key), expected, `${key} is unchanged after invalid policy`);
    }

    const invalidBooleanResponse = await api(baseUrl, '/api/settings/printing', { method: 'PUT', headers: owner.authHeader, body: { ...basePayload, printer_trim_decimals: 'true' } });
    assertEqual(invalidBooleanResponse.status, 400, 'non-boolean printing flags are rejected');
    assertPersisted(db, 'printer_trim_decimals', beforeInvalid.printer_trim_decimals as string, 'invalid boolean does not change trim decimals');

    const invalidMethodsResponse = await api(baseUrl, '/api/settings/printing', { method: 'PUT', headers: owner.authHeader, body: { ...basePayload, cash_drawer_pulse_methods: ['cash', 7] } });
    assertEqual(invalidMethodsResponse.status, 400, 'invalid cash drawer methods are rejected');
    assertPersisted(db, 'cash_drawer_pulse_methods', beforeInvalid.cash_drawer_pulse_methods as string, 'invalid cash drawer methods do not partially persist');

    // Existing wildcard writes remain available for unrelated callers.
    const wildcardResponse = await api(baseUrl, '/api/settings/printer_trim_decimals', { method: 'PUT', headers: owner.authHeader, body: { value: 'true' } });
    assertEqual(wildcardResponse.status, 200, 'legacy wildcard setting writes remain compatible');
    assertPersisted(db, 'printer_trim_decimals', 'true', 'legacy wildcard write still persists');

    console.log('\nDedicated ticket_logo setting');

    const validLogo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const nowIso = new Date().toISOString();

    // resolveTicketLogoSetting: the pure resolution the print path uses to pick
    // which logo to render and whether it owns its own breathing-room padding.
    db.prepare("DELETE FROM settings WHERE key IN ('business_logo', 'ticket_logo')").run();
    assertEqual(resolveTicketLogoSetting(), null, 'neither logo set resolves to nothing');

    db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('business_logo', ?, ?)").run(validLogo, nowIso);
    assertEqual(resolveTicketLogoSetting()?.hasOwnSpacing, false, 'falling back to business_logo keeps the legacy fixed gap');

    db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('ticket_logo', ?, ?)").run(validLogo, nowIso);
    const bothSetResolved = resolveTicketLogoSetting();
    assertEqual(bothSetResolved?.logo, validLogo, 'a dedicated ticket_logo wins over business_logo');
    assertEqual(bothSetResolved?.hasOwnSpacing, true, 'a dedicated ticket_logo supplies its own gap, no legacy feed added');

    db.prepare("DELETE FROM settings WHERE key = 'business_logo'").run();
    assertEqual(resolveTicketLogoSetting()?.hasOwnSpacing, true, 'a ticket_logo alone also owns its own spacing');
    db.prepare("DELETE FROM settings WHERE key IN ('business_logo', 'ticket_logo')").run();

    // PUT /settings/ticket-logo — a validated write, independent of business_logo.
    const ticketLogoWriteResponse = await api(baseUrl, '/api/settings/ticket-logo', { method: 'PUT', headers: owner.authHeader, body: { ticket_logo: validLogo } });
    assertEqual(ticketLogoWriteResponse.status, 200, 'owner can set a dedicated ticket logo');
    assertEqual(ticketLogoWriteResponse.data.has_ticket_logo, true, 'the write response reports the logo is now set');
    assertPersisted(db, 'ticket_logo', validLogo, 'the ticket logo is persisted under its own key');

    const invalidTicketLogoResponse = await api(baseUrl, '/api/settings/ticket-logo', { method: 'PUT', headers: owner.authHeader, body: { ticket_logo: 'not-a-data-uri' } });
    assertEqual(invalidTicketLogoResponse.status, 400, 'an invalid ticket logo data URI is rejected');
    assertPersisted(db, 'ticket_logo', validLogo, 'the invalid write does not overwrite the persisted logo');

    const unauthenticatedTicketLogoWrite = await api(baseUrl, '/api/settings/ticket-logo', { method: 'PUT', body: { ticket_logo: validLogo } });
    assertEqual(unauthenticatedTicketLogoWrite.status, 401, 'unauthenticated ticket-logo write is rejected');

    // GET /settings/business reports has_ticket_logo alongside has_logo.
    const businessReadResponse = await api(baseUrl, '/api/settings/business', { headers: owner.authHeader });
    assertEqual(businessReadResponse.status, 200, 'owner can read business settings');
    assertEqual(businessReadResponse.data.has_ticket_logo, true, 'has_ticket_logo reflects the persisted ticket logo');

    // GET /settings/ticket-logo — serves the decoded image (like GET /settings/logo).
    // This harness's auth stub requires a Bearer token on every /api route,
    // unlike the real app's main/server.ts allow-list for <img>-tag GETs — the
    // allow-list entry itself is covered by its main/server.ts counterpart for
    // /api/settings/logo, mirrored for /api/settings/ticket-logo above.
    const ticketLogoGetResponse = await fetch(`${baseUrl}/api/settings/ticket-logo`, { headers: owner.authHeader });
    assertEqual(ticketLogoGetResponse.status, 200, 'the stored ticket logo is served');
    assertEqual(ticketLogoGetResponse.headers.get('content-type'), 'image/png', 'the served logo keeps its original content type');

    // Clearing it (ticket_logo: null) falls back to the restaurant logo again.
    const clearTicketLogoResponse = await api(baseUrl, '/api/settings/ticket-logo', { method: 'PUT', headers: owner.authHeader, body: { ticket_logo: null } });
    assertEqual(clearTicketLogoResponse.status, 200, 'owner can clear the ticket logo');
    assertEqual(clearTicketLogoResponse.data.has_ticket_logo, false, 'the clear response reports no ticket logo is set');
    assertPersisted(db, 'ticket_logo', '', 'clearing the ticket logo empties the stored value');

    const clearedGetResponse = await fetch(`${baseUrl}/api/settings/ticket-logo`, { headers: owner.authHeader });
    assertEqual(clearedGetResponse.status, 404, 'no stored ticket logo serves 404, matching GET /settings/logo for an unset business_logo');

    // DEDICATED_SETTING_KEYS: the generic wildcard route refuses to write it.
    const wildcardTicketLogoResponse = await api(baseUrl, '/api/settings/ticket_logo', { method: 'PUT', headers: owner.authHeader, body: { value: validLogo } });
    assertEqual(wildcardTicketLogoResponse.status, 403, 'the generic wildcard route refuses to write ticket_logo');

    console.log(`\n${getResults().passed}/${getResults().total} passed`);
    if (getResults().failed) process.exit(1);
  } catch (error: any) {
    console.error(`\n✗ Test crashed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDatabase();
  }
}

main();
