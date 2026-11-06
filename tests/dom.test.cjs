const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const scripts = Object.fromEntries(['locales.js', 'folder-model.js', 'page-hook.js', 'content.js'].map(name => [name, fs.readFileSync(path.join(__dirname, '..', name), 'utf8')]));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, description) {
  for (let i = 0; i < 100; i++) { if (check()) return; await wait(20); }
  assert.fail(`Timed out: ${description}`);
}

test('UI and real page bridge with fixture responses (no network)', async t => {
  const { Window } = await import('happy-dom');
  const storage = { lc_ui_v190: { autoSync: false, language: 'en', sort: 'name' } };
  let w, shadow, account = 'test-account', nodes, paginated = false, failOnce = false;
  const requests = [], alerts = [], errors = [];
  const file = (i, extra = {}) => ({ id: `libfile_${i}`, file_id: `file_${i}`, name: `Item ${String(i).padStart(4, '0')}.png`, mime_type: 'image/png', size: 1200, created_at: '2025-01-01T00:00:00Z', thumbnail_url: 'data:image/png;base64,fixture', directory_id: null, ...extra });
  const dirs = [
    { type: 'folder', id: 'folder-a', name: 'Project <A>', parent_id: null },
    { type: 'folder', id: 'folder-b', name: 'Assets', parent_id: 'folder-a' },
    { type: 'folder', id: 'folder-c', name: 'Other', parent_id: null }
  ];
  const unknown = file(5); delete unknown.directory_id;
  nodes = [...dirs, file(0), file(1), file(2, { directory_id: 'folder-a' }), file(3, { directory_id: 'folder-b' }), file(4, { directory_id: 'folder-c' }), unknown, file(6), file(7, { file_id: undefined }), ...Array.from({ length: 292 }, (_, i) => file(i + 8))];
  const post = (type, payload) => w.postMessage({ channel: 'LC_BRIDGE_V240', type, payload }, w.location.origin);
  const $ = selector => shadow.querySelector(selector);
  const $$ = selector => [...shadow.querySelectorAll(selector)];
  const selected = () => Number($('#lc-selected').textContent);
  const ids = () => $$('[data-row-id]').map(el => el.dataset.rowId);
  const change = (selector, value) => {
    const el = $(selector);
    if (el.type === 'checkbox') el.checked = value; else el.value = value;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  const click = (id, shiftKey = false) => $(`[data-file-id="libfile_${id}"]`).dispatchEvent(new w.MouseEvent('click', { bubbles: true, shiftKey }));
  const fetchNodes = url => w.fetch(url || '/backend-api/files/library/nodes').then(r => r.json());
  async function setup() {
    w = new Window({ url: 'https://chatgpt.com/library', settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true } });
    w.addEventListener('error', event => errors.push(event.message));
    w.confirm = () => true;
    w.alert = message => alerts.push(message);
    w.chrome = {
      runtime: { getURL: name => `https://fixture-extension.invalid/${name}` },
      storage: { local: {
        get: async keys => Object.fromEntries(keys.filter(key => key in storage).map(key => [key, structuredClone(storage[key])])),
        set: async data => Object.assign(storage, structuredClone(data)),
        remove: async keys => keys.forEach(key => delete storage[key])
      } }
    };
    // Model real same-window postMessage semantics without exposing a real account.
    w.postMessage = data => queueMicrotask(() => w.dispatchEvent(new w.MessageEvent('message', { data, source: w.eval('window'), origin: w.location.origin })));
    w.fetch = async (input, options = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, w.location.href);
      requests.push({ url: url.href, method: options.method || 'GET', body: options.body });
      if (url.pathname === '/backend-api/me') return new w.Response(JSON.stringify({ id: account }));
      if (url.pathname === '/backend-api/files/library/nodes') {
        const result = url.searchParams.has('directory_id') ? { nodes: [file(301, { directory_id: url.searchParams.get('directory_id') })], has_more: false }
          : paginated ? (url.searchParams.has('cursor') ? { nodes: [file(302)], has_more: false } : { nodes: dirs, has_more: true, next_cursor: 'page2' })
          : { nodes, has_more: false };
        return new w.Response(JSON.stringify(result));
      }
      if (url.pathname.endsWith('/delete-batch')) {
        if (failOnce) {
          failOnce = false;
          post('OBSERVED_FILES', { files: [{ id: 'libfile_1', libraryFileId: 'libfile_1', fileId: 'file_1', name: 'Item 0001.png', folderKnown: true, folderIds: ['folder-a'] }] });
          return new w.Response('{}', { status: 429 });
        }
        return new w.Response('{}');
      }
      return new w.Response('{}', { status: 404 });
    };
    for (const name of ['locales.js', 'folder-model.js', 'content.js']) w.eval(scripts[name]);
    await until(() => w.document.querySelector('#lc-extension-host'), 'mounted UI');
    shadow = w.document.querySelector('#lc-extension-host').shadowRoot;
    const viewport = $('#lc-viewport');
    Object.defineProperties(viewport, { clientWidth: { configurable: true, value: 920 }, clientHeight: { configurable: true, value: 500 } });
    w.eval(scripts['page-hook.js']);
    try { await until(() => $('#lc-status').dataset.state === 'ready', 'account ready'); }
    catch (error) { console.error({ errors, requests, console: w.happyDOM.virtualConsolePrinter.readAsString(), status: $('#lc-status').outerHTML }); throw error; }
    $('#lc-launcher').click();
  }
  try {
    await setup();
    await fetchNodes();
    await until(() => $('#lc-total').textContent === '300', 'fixture index');
    await t.test('fixed grid geometry, source order, preview and virtual rows', () => {
      change('#lc-view-mode', 'grid');
      const cards = $$('.lc-card');
      assert.ok(cards.length < 60);
      assert.equal(cards[0].style.height, '244px');
      assert.equal(cards[0].style.width, cards[1].style.width);
      assert.equal(cards[0].style.transform, 'translate(12px,12px)');
      assert.ok(cards[1].style.transform.endsWith(',12px)'));
      assert.deepEqual(ids().slice(0, 5), ['libfile_0', 'libfile_1', 'libfile_2', 'libfile_3', 'libfile_4']);
      assert.ok($('.lc-card img').src.startsWith('data:image/png'));
      assert.equal($('[data-file-id="libfile_7"]').disabled, true);
    });
    await t.test('forward/reverse Shift ranges and list/grid preserve selection', () => {
      click(0); click(4, true); assert.equal(selected(), 5);
      change('#lc-view-mode', 'list'); assert.equal(selected(), 5);
      change('#lc-view-mode', 'grid'); click(2, true); assert.equal(selected(), 2);
      $('#lc-clear-selection').click();
    });
    await t.test('Shift spans unmounted rows and skips missing delete IDs', async () => {
      click(0);
      $('#lc-viewport').scrollTop = 12800;
      $('#lc-viewport').dispatchEvent(new w.Event('scroll'));
      await until(() => $('[data-file-id="libfile_200"]'), 'virtual item 200');
      click(200, true); assert.equal(selected(), 200);
      $('#lc-clear-selection').click();
      $('#lc-viewport').scrollTop = 0;
      $('#lc-viewport').dispatchEvent(new w.Event('scroll'));
      await until(() => $('[data-file-id="libfile_0"]'), 'return to top');
    });
    await t.test('folder includes, descendants, unknown and pruning selections', () => {
      change('#lc-folder-scope', 'folder:folder-a');
      assert.deepEqual(ids(), ['libfile_2', 'libfile_3']);
      change('#lc-include-subfolders', false); assert.deepEqual(ids(), ['libfile_2']);
      $('#lc-reset-folders').click();
      $('#lc-select-all').click(); assert.equal(selected(), 299);
      change('#lc-ignore-folder-files', true); assert.equal(selected(), 295);
      assert.ok(!ids().includes('libfile_5'));
      $('#lc-clear-selection').click();
      change('#lc-ignore-folder-files', false);
      change('[data-ignore-folder="folder-a"]', true);
      $('#lc-select-all').click(); assert.equal(selected(), 296);
      $('#lc-clear-selection').click();
      change('#lc-folder-scope', 'unknown'); assert.deepEqual(ids(), []);
      $('#lc-reset-folders').click();
      change('#lc-folder-scope', 'unknown'); assert.deepEqual(ids(), ['libfile_5']);
      $('#lc-reset-folders').click();
    });
    await t.test('escaped names, search changes and stale Shift anchors', async () => {
      assert.ok($('#lc-folder-scope').textContent.includes('Project <A>'));
      assert.equal($('#lc-folder-scope a'), null);
      click(0);
      $('#lc-search').value = 'Item 0006';
      $('#lc-search').dispatchEvent(new w.Event('input'));
      await until(() => ids().length === 1, 'search applied');
      click(6, true); assert.equal(selected(), 2);
      $('#lc-search-clear').click(); $('#lc-clear-selection').click();
    });
    await t.test('delete retries recheck folder protection when a file moves', async () => {
      change('#lc-folder-scope', 'root');
      change('[data-ignore-folder="folder-a"]', true);
      click(0); click(1); failOnce = true;
      $('#lc-delete').click();
      await until(() => alerts.some(a => a.includes('files skipped')), 'deletion completion');
      const batches = requests.filter(r => r.url.endsWith('/delete-batch')).map(r => JSON.parse(r.body).files.map(f => f.library_file_id));
      assert.deepEqual(batches, [['libfile_0', 'libfile_1'], ['libfile_0']]);
      assert.ok(alerts.at(-1).includes('1 files skipped'));
      assert.equal($('#lc-folder-scope').disabled, false);
    });
    await t.test('Smart Clean honors folder rules and missing IDs', () => {
      $('[data-tab="clean"]').click();
      change('#lc-cutoff', '2026-01-01');
      change('#lc-clean-master-check', true); assert.equal(selected(), 293);
      $('[data-tab="files"]').click(); $('#lc-clear-selection').click();
    });
    await t.test('stored preferences and metadata restore without cross-account leakage', async () => {
      await w.happyDOM.abort(); await setup();
      assert.equal($('#lc-view-mode').value, 'grid');
      assert.equal($('#lc-folder-scope').value, 'root');
      assert.equal($('[data-ignore-folder="folder-a"]').checked, true);
      account = 'another-account';
      post('REQUEST_ACCOUNT', {});
      await until(() => $('#lc-total').textContent === '0', 'account switch');
      assert.equal($('#lc-folder-scope').value, 'all');
      assert.equal($$('[data-ignore-folder]').length, 0);
    });
    await t.test('full sync paginates past folder-only pages; scoped requests do not replace it', async () => {
      paginated = true;
      await fetchNodes();
      await fetchNodes('/backend-api/files/library/nodes?directory_id=folder-a');
      await until(() => $('#lc-total').textContent === '1', 'scoped observation');
      $('#lc-sync').click();
      await until(() => $('#lc-total').textContent === '2', 'second page synced');
      await until(() => $('#lc-sync-title').textContent === 'Sync complete', 'sync complete');
      assert.ok(requests.some(r => r.url.includes('cursor=page2')));
      assert.deepEqual(ids(), ['libfile_301', 'libfile_302']);
    });
    assert.deepEqual(errors, []);
  } finally {
    if (w) await w.happyDOM.abort();
  }
});
