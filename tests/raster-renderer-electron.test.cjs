const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { ChromiumRasterRenderer, getSharedRasterRenderer, destroySharedRasterRenderer } = require('../dist/main/printers/raster-renderer.js');

const font = { family: 'FloRaster', dataUrl: 'data:font/woff2;base64,AA==' };

function area(unit) {
  return unit.bands.reduce((total, band) => total + band.pixels.reduce((sum, pixel) => sum + pixel, 0), 0);
}

async function run() {
  await app.whenReady();
  let surface;
  const renderer = new ChromiumRasterRenderer({
    timeoutMs: 30_000,
    preloadPath: path.join(__dirname, '../dist/main/raster-preload.js'),
    windowFactory: (options) => {
      surface = new BrowserWindow(options);
      return surface;
    },
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Raster surface did not load')), 15000);
      surface.webContents.once('did-finish-load', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await surface.webContents.executeJavaScript(`
      window.__floNativeFontFace = window.FontFace;
      window.FontFace = class extends window.__floNativeFontFace {
        load() { return Promise.reject(new Error('bundled font unavailable')); }
      };
      true;
    `);
    const fontFailure = await renderer.render({
      version: 1,
      requestId: 'electron-font-failure',
      text: 'שלום עולם',
      widthDots: 120,
      maxBandHeight: 200,
      direction: 'rtl',
      align: 'center',
      style: 'normal',
      financial: false,
      maxLines: 4,
      bundledFont: font,
    });
    assert.deepEqual(fontFailure, {
      version: 1,
      requestId: 'electron-font-failure',
      ok: false,
      code: 'font-unavailable',
      detail: 'bundled font unavailable',
    });
    await surface.webContents.executeJavaScript(`
      window.FontFace = class extends window.__floNativeFontFace {
        load() { return Promise.resolve(this); }
      };
      true;
    `);
    const base = {
      version: 1,
      text: 'שלום עולם',
      widthDots: 120,
      maxBandHeight: 200,
      direction: 'rtl',
      align: 'center',
      style: 'normal',
      financial: false,
      maxLines: 4,
      bundledFont: font,
    };
    const normal = await renderer.render({ ...base, requestId: 'electron-normal', style: 'normal' });
    const styled = await renderer.render({
      ...base,
      requestId: 'electron-styled',
      style: 'bold',
      styles: ['bold', 'double-height', 'double-width'],
    });
    assert.equal(normal.ok, true, `normal raster failed: ${normal.code ?? 'unknown'} - ${normal.detail ?? 'no detail'}`);
    assert.equal(styled.ok, true, `styled raster failed: ${styled.code ?? 'unknown'} - ${styled.detail ?? 'no detail'}`);
    const fontCount = await surface.webContents.executeJavaScript('document.fonts.size');
    assert.equal(fontCount, 1);
    assert.equal(normal.unit.complete, true);
    assert.equal(styled.unit.complete, true);
    assert.equal(normal.unit.bands[0].widthDots, 120);
    assert.equal(styled.unit.bands[0].widthDots, 120);
    assert.ok(area(normal.unit) > 0);
    assert.ok(area(styled.unit) > area(normal.unit));
    const financialOverflow = await renderer.render({
      ...base,
      requestId: 'electron-financial-overflow',
      text: 'שלום '.repeat(200),
      financial: true,
      maxLines: 1,
    });
    assert.equal(financialOverflow.ok, false);
    assert.equal(financialOverflow.code, 'render-failed');
    const nonFinancialOverflow = await renderer.render({
      ...base,
      requestId: 'electron-nonfinancial-overflow',
      text: 'שלום '.repeat(200),
      financial: false,
      maxLines: 1,
    });
    assert.equal(nonFinancialOverflow.ok, false);
    assert.equal(nonFinancialOverflow.code, 'render-failed');

    // Verify system font rendering for pure CJK and pure Arabic when bundledFont is omitted
    const cjkRender = await renderer.render({
      version: 1,
      requestId: 'electron-cjk-system-font',
      text: '煎饼',
      widthDots: 120,
      maxBandHeight: 200,
      direction: 'ltr',
      align: 'left',
      style: 'normal',
      financial: true,
      maxLines: 4,
    });
    assert.equal(cjkRender.ok, true);
    assert.equal(cjkRender.unit.complete, true);
    assert.ok(area(cjkRender.unit) > 0);

    const arabicRender = await renderer.render({
      version: 1,
      requestId: 'electron-arabic-system-font',
      text: 'چای',
      widthDots: 120,
      maxBandHeight: 200,
      direction: 'rtl',
      align: 'left',
      style: 'normal',
      financial: true,
      maxLines: 4,
    });
    assert.equal(arabicRender.ok, true);
    assert.equal(arabicRender.unit.complete, true);
    assert.ok(area(arabicRender.unit) > 0);

    const urduRender = await renderer.render({
      version: 1,
      requestId: 'electron-urdu-system-font',
      text: 'آرڈر سلپ',
      widthDots: 120,
      maxBandHeight: 200,
      direction: 'rtl',
      align: 'left',
      style: 'normal',
      financial: true,
      maxLines: 4,
    });
    assert.equal(urduRender.ok, true, JSON.stringify(urduRender));
    assert.equal(urduRender.unit.complete, true);
    assert.ok(area(urduRender.unit) > 0);

    const hindiRender = await renderer.render({
      version: 1,
      requestId: 'electron-hindi-system-font',
      text: 'किनारा',
      widthDots: 120,
      maxBandHeight: 200,
      direction: 'ltr',
      align: 'left',
      style: 'normal',
      financial: true,
      maxLines: 4,
    });
    assert.equal(hindiRender.ok, true);
    assert.equal(hindiRender.unit.complete, true);
    assert.ok(area(hindiRender.unit) > 0);

    const bengaliRender = await renderer.render({
      version: 1,
      requestId: 'electron-bengali-system-font',
      text: 'বাংলা',
      widthDots: 120,
      maxBandHeight: 200,
      direction: 'ltr',
      align: 'left',
      style: 'normal',
      financial: true,
      maxLines: 4,
    });
    assert.equal(bengaliRender.ok, true);
    assert.equal(bengaliRender.unit.complete, true);
    assert.ok(area(bengaliRender.unit) > 0);

    const thaiRender = await renderer.render({
      version: 1,
      requestId: 'electron-thai-system-font',
      text: 'อาหารไทย',
      widthDots: 120,
      maxBandHeight: 200,
      direction: 'ltr',
      align: 'left',
      style: 'normal',
      financial: true,
      maxLines: 4,
    });
    assert.equal(thaiRender.ok, true);
    assert.equal(thaiRender.unit.complete, true);
    assert.ok(area(thaiRender.unit) > 0);

    // Logo rendering: a real Chromium-generated PNG (left half black, right
    // half white), decoded and thresholded back into a raster band.
    const logoDataUrl = await surface.webContents.executeJavaScript(`
      (() => {
        const c = document.createElement('canvas');
        c.width = 20; c.height = 10;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 20, 10);
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 10, 10);
        return c.toDataURL('image/png');
      })();
    `);
    const logoRender = await renderer.render({
      version: 1,
      requestId: 'electron-logo',
      text: '',
      widthDots: 120,
      maxBandHeight: 200,
      direction: 'ltr',
      style: 'normal',
      financial: false,
      maxLines: 1,
      kind: 'image',
      image: { dataUrl: logoDataUrl, maxHeightDots: 140 },
    });
    assert.equal(logoRender.ok, true, `logo render failed: ${logoRender.code ?? 'unknown'} - ${logoRender.detail ?? 'no detail'}`);
    assert.equal(logoRender.unit.complete, true);
    assert.equal(logoRender.unit.financial, false);
    assert.equal(logoRender.unit.bands.length, 1);
    const logoBand = logoRender.unit.bands[0];
    // Never upscaled past its natural 20x10 size, so it's centered with 50px of
    // white padding on each side within the 120-dot band.
    assert.equal(logoBand.widthDots, 120);
    assert.equal(logoBand.heightDots, 10);
    assert.equal(logoBand.pixels[5 * 120 + 10], 0, 'left padding is white');
    assert.equal(logoBand.pixels[5 * 120 + 55], 1, 'left half of the logo is black');
    assert.equal(logoBand.pixels[5 * 120 + 65], 0, 'right half of the logo is white');
    assert.equal(logoBand.pixels[5 * 120 + 109], 0, 'right padding is white');

    // A logo taller than the natural width is scaled down to maxHeightDots,
    // not left to overflow it.
    const tallLogoDataUrl = await surface.webContents.executeJavaScript(`
      (() => {
        const c = document.createElement('canvas');
        c.width = 10; c.height = 100;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 10, 100);
        return c.toDataURL('image/png');
      })();
    `);
    const tallLogoRender = await renderer.render({
      version: 1,
      requestId: 'electron-tall-logo',
      text: '',
      widthDots: 120,
      maxBandHeight: 200,
      direction: 'ltr',
      style: 'normal',
      financial: false,
      maxLines: 1,
      kind: 'image',
      image: { dataUrl: tallLogoDataUrl, maxHeightDots: 50 },
    });
    assert.equal(tallLogoRender.ok, true);
    assert.equal(tallLogoRender.unit.bands[0].heightDots, 50, 'scaled down to respect maxHeightDots');

    // A logo band taller than one GS v 0 command splits across multiple bands,
    // mirroring how overlong text already splits.
    const splitLogoRender = await renderer.render({
      version: 1,
      requestId: 'electron-split-logo',
      text: '',
      widthDots: 120,
      maxBandHeight: 50,
      direction: 'ltr',
      style: 'normal',
      financial: false,
      maxLines: 1,
      kind: 'image',
      image: { dataUrl: tallLogoDataUrl, maxHeightDots: 100 },
    });
    assert.equal(splitLogoRender.ok, true);
    assert.equal(splitLogoRender.unit.bands.length, 2, 'a 100-dot-tall image splits across two 50-dot bands');
    assert.ok(splitLogoRender.unit.bands.every((band) => band.heightDots <= 50));

    // A malformed/undecodable logo data: URL fails cleanly instead of hanging.
    const badLogoRender = await renderer.render({
      version: 1,
      requestId: 'electron-bad-logo',
      text: '',
      widthDots: 120,
      maxBandHeight: 200,
      direction: 'ltr',
      style: 'normal',
      financial: false,
      maxLines: 1,
      kind: 'image',
      image: { dataUrl: 'data:image/png;base64,AAAA', maxHeightDots: 140 },
    });
    assert.equal(badLogoRender.ok, false);
    assert.equal(badLogoRender.code, 'render-failed');

    surface.webContents.emit('render-process-gone');
    const processFailure = await renderer.render({ ...base, requestId: 'electron-process-failure' });
    assert.deepEqual(processFailure, {
      version: 1,
      requestId: 'electron-process-failure',
      ok: false,
      code: 'render-failed',
      detail: 'Raster renderer process exited',
    });
    console.log('Chromium raster surface rendered styled RTL output.');

    // Verify shared singleton operates cleanly under real Electron
    destroySharedRasterRenderer();
    const shared1 = getSharedRasterRenderer({
      timeoutMs: 30_000,
      preloadPath: path.join(__dirname, '../dist/main/raster-preload.js'),
    });
    assert.equal(shared1.isDestroyed(), false);
    const shared2 = getSharedRasterRenderer();
    assert.equal(shared1, shared2);
    destroySharedRasterRenderer();
    assert.equal(shared1.isDestroyed(), true);
    console.log('Warm Chromium raster singleton lifecycle passed.');
  } finally {
    renderer.destroy();
    destroySharedRasterRenderer();
    if (app.isReady()) app.quit();
  }
}

run().catch((error) => {
  console.error(error);
  if (app.isReady()) app.exit(1);
  else process.exit(1);
});
