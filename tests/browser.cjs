// Loads the real unpacked extension. All ChatGPT requests are intercepted locally.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'test-results');
const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="280" height="180"><rect width="280" height="180" fill="#d9e7ff"/><circle cx="140" cy="80" r="48" fill="#719bd7"/><text x="140" y="157" text-anchor="middle" font-size="20">Test image</text></svg>');
const file = (i, extra = {}) => ({ id: `libfile_${i}`, file_id: `file_${i}`, name: `Item ${String(i).padStart(4, '0')}.png`, mime_type: 'image/png', size: 1200 + i, created_at: '2025-01-01T00:00:00Z', thumbnail_url: svg, directory_id: null, ...extra });
const fixtures = [
  file(0), file(1), file(2, { directory_id: 'folder-project' }),
  file(3, { directory_id: 'folder-child' }), file(4, { directory_id: 'folder-other' }),
  file(5), file(6), file(7, { directory_id: null, file_id: undefined }),
  ...Array.from({ length: 292 }, (_, i) => file(i + 8))
];
delete fixtures[5].directory_id; // A legacy/unsupported record must not count as root.
const dirs = [
  { id: 'folder-project', type: 'directory', name: 'Project A', parent_id: null },
  { id: 'folder-child', type: 'directory', name: 'Assets', parent_id: 'folder-project' },
  { id: 'folder-other', type: 'directory', name: 'Other', parent_id: null }
];
const deletes = [];
const errors = [];
const alerts = [];
let mode = 'normal';
let account = 'fixture-account';
let failOnce = false;
let page;
const count = async expected => {
  await page.waitForFunction(expected => document.querySelector('#lc-extension-host')?.shadowRoot?.querySelector('#lc-selected')?.textContent === String(expected), expected);
};
const clickFile = (id, options = {}) => page.locator(`input[data-file-id="libfile_${id}"]`).click(options);
const currentIds = () => page.locator('[data-row-id]').evaluateAll(nodes => nodes.map(node => node.dataset.rowId));

(async () => {
  await fs.mkdir(out, { recursive: true });
  const context = await chromium.launchPersistentContext('', {
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    ...(process.env.LC_CHROMIUM_PATH ? { executablePath: process.env.LC_CHROMIUM_PATH } : { channel: 'chromium' }),
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-sandbox'],
    viewport: { width: 1440, height: 1000 }
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({ lc_ui_v190: { autoSync: false, language: 'en', sort: 'name' } }));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.protocol === 'chrome-extension:') return route.continue();
      if (url.origin !== 'https://chatgpt.com') return route.abort();
      if (url.pathname === '/backend-api/me') return route.fulfill({ json: { id: account } });
      if (url.pathname === '/library') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Cleaner fixture</title><h1>Local fixture — no real account</h1>' });
      if (url.pathname === '/backend-api/files/library/nodes') {
        if (url.searchParams.has('directory_id')) return route.fulfill({ json: { nodes: [file(301, { directory_id: 'folder-project' })], has_more: false } });
        if (mode === 'pagination') {
          if (!url.searchParams.has('cursor')) return route.fulfill({ json: { nodes: dirs, has_more: true, next_cursor: 'page2' } });
          return route.fulfill({ json: { nodes: [file(302)], has_more: false } });
        }
        return route.fulfill({ json: { nodes: [...dirs, ...fixtures], has_more: false } });
      }
      if (url.pathname.endsWith('/delete-batch')) {
        deletes.push(route.request().postDataJSON().files.map(f => f.library_file_id));
        if (failOnce) {
          failOnce = false;
          // A sync observes a move into an ignored folder while the first request fails.
          await page.evaluate(() => window.postMessage({ channel: 'LC_BRIDGE_V240', type: 'OBSERVED_FILES', payload: { files: [{ id: 'libfile_1', libraryFileId: 'libfile_1', fileId: 'file_1', name: 'Item 0001.png', folderKnown: true, folderIds: ['folder-project'] }] } }, location.origin));
          return route.fulfill({ status: 429, json: {} });
        }
        return route.fulfill({ json: {} });
      }
      return route.fulfill({ status: 404, json: {} });
    });
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.accept(); });
    await page.goto('https://chatgpt.com/library');
    await page.locator('#lc-launcher').click();
    await page.waitForFunction(() => window.__LC_PAGE_BRIDGE_V220__ === true);
    await page.waitForFunction(() => document.querySelector('#lc-extension-host')?.shadowRoot?.querySelector('#lc-status')?.dataset.state === 'ready');
    await page.evaluate(() => fetch('/backend-api/files/library/nodes').then(r => r.json()));
    await page.waitForFunction(() => document.querySelector('#lc-extension-host').shadowRoot.querySelector('#lc-total').textContent === '300');
    await page.locator('#lc-view-mode').selectOption('grid');
    await page.waitForSelector('.lc-card');

    // Regular rows, uniform dimensions and bounded DOM size for large result sets.
    const boxes = await page.locator('.lc-card').evaluateAll(nodes => nodes.slice(0, 12).map(node => { const r = node.getBoundingClientRect(); return { id: node.dataset.rowId, x: r.x, y: r.y, w: r.width, h: r.height }; }));
    assert.equal(boxes[0].h, 244);
    assert.ok(boxes.every(b => Math.abs(b.w - boxes[0].w) < 1 && b.h === 244));
    assert.equal(boxes[0].y, boxes[1].y);
    assert.ok(boxes[1].x > boxes[0].x);
    assert.ok(await page.locator('.lc-card').count() < 60);
    assert.equal(await page.locator('.lc-card .lc-thumb img').first().evaluate(img => getComputedStyle(img).objectFit), 'contain');
    await clickFile(0);
    await clickFile(4, { modifiers: ['Shift'] });
    await count(5);
    await page.locator('#lc-view-mode').selectOption('list');
    await count(5);
    await page.locator('#lc-view-mode').selectOption('grid');
    await clickFile(2, { modifiers: ['Shift'] });
    await count(2); // Reverse range deselects 2,3,4.

    // Range anchor spans virtual rows and skips records without delete IDs.
    await page.locator('#lc-clear-selection').click();
    await clickFile(0);
    const columns = boxes.filter(box => box.y === boxes[0].y).length;
    await page.locator('#lc-viewport').evaluate((el, columns) => { el.scrollTop = Math.floor(200 / columns) * 256; }, columns);
    await page.waitForFunction(() => document.querySelector('#lc-extension-host').shadowRoot.querySelector('[data-file-id="libfile_200"]'));
    await clickFile(200, { modifiers: ['Shift'] });
    await count(200); // 0..200 inclusive, except incomplete item 7.
    await page.locator('#lc-clear-selection').click();
    await page.locator('#lc-viewport').evaluate(el => { el.scrollTop = 0; });
    await page.locator('#lc-folder-options > summary').click();
    await page.locator('#lc-folder-scope').selectOption('folder:folder-project');
    assert.deepEqual(await currentIds(), ['libfile_2', 'libfile_3']);
    await page.locator('#lc-include-subfolders').uncheck();
    assert.deepEqual(await currentIds(), ['libfile_2']);
    await page.locator('#lc-include-subfolders').check();
    await page.locator('#lc-reset-folders').click();

    // Folder changes remove existing selections, including hidden results.
    await page.locator('#lc-select-all').click();
    await count(299);
    await page.locator('#lc-ignore-folder-files').check();
    await count(295);
    assert.ok(!(await currentIds()).some(id => ['libfile_2', 'libfile_3', 'libfile_4', 'libfile_5'].includes(id)));
    await page.locator('#lc-clear-selection').click();
    await page.locator('#lc-ignore-folder-files').uncheck();
    await page.locator('[data-ignore-folder="folder-project"]').check();
    await page.locator('#lc-select-all').click();
    await count(296);
    await page.locator('#lc-clear-selection').click();
    await page.locator('#lc-folder-scope').selectOption('root');
    await clickFile(0);
    await clickFile(1);
    failOnce = true;
    await page.locator('#lc-delete').click();
    await page.waitForFunction(() => !document.querySelector('#lc-extension-host').shadowRoot.querySelector('#lc-folder-scope').disabled);
    assert.deepEqual(deletes, [['libfile_0', 'libfile_1'], ['libfile_0']]);
    assert.ok(alerts.some(message => message.includes('1 files skipped')));

    // Smart Clean uses the same root rule and excludes unknown metadata.
    await page.locator('[data-tab="clean"]').click();
    await page.locator('#lc-cutoff').fill('2026-01-01');
    await page.locator('#lc-cutoff').dispatchEvent('change');
    await page.locator('#lc-clean-master-check').check();
    await count(293); // 0 deleted, 1 moved, 2/3/4 in folders, 5 unknown, 7 incomplete.
    await page.locator('[data-tab="files"]').click();
    await page.locator('#lc-clear-selection').click();

    // Folder choices and grid preference survive a page reload, scoped to account.
    await page.reload();
    await page.locator('#lc-launcher').click();
    await page.waitForFunction(() => document.querySelector('#lc-extension-host').shadowRoot.querySelector('#lc-folder-scope').value === 'root');
    assert.equal(await page.locator('#lc-view-mode').inputValue(), 'grid');
    await page.locator('#lc-folder-options > summary').click();
    assert.equal(await page.locator('[data-ignore-folder="folder-project"]').isChecked(), true);
    await page.locator('#lc-reset-folders').click();

    // Visiting a folder after discovery refreshes metadata without narrowing full sync.
    await page.evaluate(() => fetch('/backend-api/files/library/nodes').then(r => r.json()));
    await page.evaluate(() => fetch('/backend-api/files/library/nodes?directory_id=folder-project').then(r => r.json()));
    await page.waitForFunction(() => document.querySelector('#lc-extension-host').shadowRoot.querySelector('#lc-folder-summary').textContent.includes('1 files with unknown'));
    await page.locator('#lc-folder-scope').selectOption('folder:folder-project');
    await page.waitForFunction(() => document.querySelector('#lc-extension-host').shadowRoot.querySelector('[data-row-id="libfile_301"]'));
    await page.locator('#lc-reset-folders').click();

    // Resize and both themes: no horizontal spill or variable tile heights.
    await page.locator('#lc-folder-options > summary').click();
    await page.screenshot({ path: path.join(out, 'grid-light.png') });
    await page.locator('#lc-theme').click();
    await page.screenshot({ path: path.join(out, 'grid-dark.png') });
    await page.setViewportSize({ width: 700, height: 800 });
    await page.waitForTimeout(150);
    const geometry = await page.locator('#lc-viewport').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    assert.ok(geometry.scroll <= geometry.width + 1);
    await page.screenshot({ path: path.join(out, 'grid-narrow.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });

    // Separate account gets its own folder index and settings.
    account = 'second-fixture-account';
    mode = 'pagination';
    await page.reload();
    await page.locator('#lc-launcher').click();
    await page.waitForFunction(() => document.querySelector('#lc-extension-host').shadowRoot.querySelector('#lc-folder-scope').value === 'all');
    await page.evaluate(() => fetch('/backend-api/files/library/nodes').then(r => r.json()));
    await page.locator('#lc-sync').click();
    await page.waitForFunction(() => document.querySelector('#lc-extension-host').shadowRoot.querySelector('#lc-total').textContent === '1');
    await page.waitForFunction(() => document.querySelector('#lc-extension-host').shadowRoot.querySelector('#lc-sync-title').textContent === 'Sync complete');
    assert.deepEqual(await currentIds(), ['libfile_302']);
    assert.deepEqual(errors, []);
    console.log('PASS: real extension, grid/list, Shift ranges, virtualization, folder rules, retry protection, Smart Clean, persistence, account isolation, folder-only pagination and responsive layouts.');
  } catch (error) {
    if (page) { await page.screenshot({ path: path.join(out, 'failure.png') }); console.error('Page errors:', errors); }
    throw error;
  } finally {
    await context.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
