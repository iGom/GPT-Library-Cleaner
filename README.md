# GPT Library Cleaner

A browser extension for managing your ChatGPT Library with full-library sync, type filters, date-based cleanup, bulk selection, ZIP backup, and batch deletion.

## Features

- Optional regular **Grid (test)** view, with equal-sized thumbnails and Shift-click ranges
- Optional folder inclusion, **No folder**, and explicit **Unknown folder** filters
- Ignore all files in folders, or ignore selected folders with optional descendant matching
- Full ChatGPT Library synchronization with resumable pagination
- Account-scoped local index
- File-type filtering by extension and MIME type
- Image thumbnails and file-type icons
- Date-based Smart Clean view
- Bulk selection from both File Manager and Smart Clean
- ZIP backup of selected files
- Batched deletion with retry/backoff
- Automatic system/browser theme following, plus explicit light and dark overrides
- English, Traditional Chinese, and 1337speak UI with an in-app language selector and browser-language auto mode
- Optional automatic synchronization
- Reopen or hide the Library Cleaner panel from the browser toolbar icon

## Install from source

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome, or `edge://extensions` in Microsoft Edge.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the repository folder containing `manifest.json`.
6. Open `https://chatgpt.com/library`.
7. Pin **Library Cleaner** from the browser Extensions menu if you want a permanent toolbar shortcut.

## Localization

The panel UI uses `locales.js`, with English (`en`), Traditional Chinese (`zh-TW`), and 1337speak (`1337`) currently included. Users can choose a language in **Settings → Language** or use **Automatic (Browser)**.

To add another language, add the translated message set in `locales.js`, extend the supported locale resolver, and add matching Chrome extension metadata under `_locales/<locale>/messages.json`.

## Experimental grid and folder options (2.12.0-test.1)

In **File Manager**, select **Grid (test)** next to the sort menu. Tiles have identical dimensions, keep the existing sort order from left to right and row by row, and show images without cropping. Click a tile/checkbox, then Shift-click another checkbox to select a range. Shift-clicking a checked endpoint clears the range. List and Grid share their selection; previews and rows remain virtualized for large libraries.

Expand **Folders (test)** below the sync bar:

| Option | Effect |
| --- | --- |
| All folders | Default: keep the existing file view |
| No folder | Only files explicitly identified as outside folders |
| A named folder | That folder, including descendants when enabled |
| Unknown folder | Records whose folder membership has not been identified |
| Ignore all files in folders | Keep only confirmed files outside folders |
| Ignore selected folders | Exclude the checked folders, optionally including descendants |

Folder rules apply to File Manager, Smart Clean, selection, backup and deletion. Changing a rule deselects files outside the new scope. Deletion checks the current scope again before each batch and retry. Unknown membership is excluded while ignoring folders; unknown ancestry is also excluded when ignoring descendants. Folder options and metadata are saved separately for each account. The view preference is saved globally.

After updating, **reload the ChatGPT Library tab and click Sync**. Manual Sync scans every page to update old records; automatic Sync keeps the existing incremental behavior. Folder names and relationships are learned from Library responses, including native folder navigation. If an ID appears instead of a name, open that folder in native Library, then reopen the cleaner. If needed, use Settings → clear local index, then Sync again; this clears the extension's index only.

This is an experimental adapter for internal API payloads. It supports explicit directory/folder/parent IDs, directory nodes with children, and folder-scoped listing requests. Missing metadata is never assumed to mean “No folder”. It does not guess undocumented folder-list endpoints or infer folder membership from filenames/project names. Actual availability depends on the Library API used by your account. If all results show **Unknown folder**, the current payload is not exposing a supported membership field; ignoring folder files will intentionally show no results.

## Development tests

Node.js 22 or later is recommended. There is no build step and no runtime dependency to install for **Load unpacked**.

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
```

The unit and simulated-DOM integration tests exercise metadata parsing, unknown/root separation, nested exclusions, virtual-grid ordering, Shift selection, persistence, account isolation, and deletion retry guards. The Playwright suite loads the real unpacked extension in Chromium, intercepts all ChatGPT requests with generated fixtures, and writes layout screenshots to `test-results/`. It does not use a real account or delete real files. Set `LC_CHROMIUM_PATH` to use a separately installed Chromium.

See [the test checklist](docs/TESTING.md) for manual verification and API limitations.

## Appearance

By default, Library Cleaner follows the browser/operating-system `prefers-color-scheme` setting and updates live when that preference changes. Users can override this in **Settings → Appearance** with **Light** or **Dark**.

Existing stored Light/Dark preferences remain explicit overrides.

## Notes


- Library Cleaner runs locally in your browser and stores its index in extension storage.
- Index data is separated by ChatGPT account.
- Backup and deletion operate only on the files you explicitly select.
- The floating launcher is not the only way to reopen the tool: clicking the browser toolbar icon toggles the panel as well.
- ChatGPT internal endpoints may change over time; the extension learns the active Library request used by the current page before paginating.

## Version

Current source version: **2.12.0-test.1** (manifest version: `2.12.0`)

## Disclaimer

This is an independent community project and is not an official OpenAI product. Use bulk deletion carefully and keep backups of files you need.
