# Grid and folder test build

## Installation

1. Download the `test/grid-folder-filters` branch as a ZIP and extract it.
2. In `chrome://extensions` or `edge://extensions`, enable Developer mode.
3. Disable the previous cleaner if loading this as a separate unpacked extension.
4. Choose **Load unpacked** and select the extracted folder containing `manifest.json`. Alternatively, replace an existing unpacked installation's files and click Reload.
5. Reload `https://chatgpt.com/library` so the new page bridge is installed.
6. Open the cleaner, click **Sync**, and choose **Grid (test)** in File Manager.

## Manual checks on your Library

- Check that thumbnails have the same width/height and run left to right, row by row, in each sort order.
- Click a checkbox, then Shift-click another one. Try forwards/backwards, after scrolling, and after narrowing search/type filters. Switch List/Grid and check the selection count.
- Expand **Folders (test)**. Compare a folder's contents with the native Library view. If only its ID is known, open it in native Library and reopen the cleaner.
- Test **No folder**, a specific folder, and **Include subfolders**. A file with unknown membership must not appear in **No folder**.
- Select files, then enable **Ignore all files in folders** or check individual ignored folders. Confirm that affected selections disappear from the count and from Smart Clean.
- Check that selected/ignored folder rules persist after a reload. Reset restores the default unrestricted behavior.
- Before a real cleanup, inspect the selection and the existing delete confirmation. There is no automatic deletion in this build.

## Automated coverage

`npm test` runs pure folder-model tests and integration tests using the actual UI and page-bridge scripts with Happy DOM and generated response fixtures. It covers:

- missing/null/malformed parent values, nested directory nodes and explicit request scopes;
- folder moves, metadata enrichment and preservation of known membership;
- inclusion/exclusion with descendants, multiple memberships and incomplete/cyclic ancestry;
- bounded virtual rendering, fixed tile dimensions and range selection across unmounted rows;
- stale Shift anchors after filtering and selections surviving view changes;
- exclusion of hidden selections, Smart Clean, and per-attempt deletion rechecks;
- persisted account-scoped folder settings and folder-only pagination pages.

`npm run test:browser` runs the unpacked extension in Chromium with mocked HTTP responses. GitHub Actions runs both suites and uploads screenshots as `browser-test-results` when available. Browser screenshots and dependencies are not included in the extension source.

## Limitations

Folder extraction is tested against explicit fixtures, not a captured payload from a live signed-in account. It recognizes `directory_id`, `folder_id`, `parent_directory_id`, `parent_folder_id`, `parent_id`, camelCase equivalents, explicit ID arrays and embedded parent objects. It recognizes directory/folder nodes and child collections. It does not request guessed endpoints or perform a speculative recursive crawl.

An absent field is **Unknown folder**. Explicit null/empty ID arrays mean **No folder**. If ignored-folder protection is active, unknown membership is not selectable; when ignoring descendants, an unresolved ancestor chain is protected too. Cached metadata can become stale if files move elsewhere; use manual Sync before relying on a folder rule. Different ChatGPT API variants may need an adapter update.

The local execution environment used for this change blocks Chromium process sockets and disallows permission escalation. Local verification therefore uses simulated DOM; the browser suite is provided for GitHub Actions and normal development machines. Consult the workflow result for whether the browser checks passed on the published commit.
