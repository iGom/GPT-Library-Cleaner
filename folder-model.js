/* Shared by the isolated UI and the page bridge. No network or storage access. */
(() => {
  const own = (node, key) => Object.prototype.hasOwnProperty.call(node || {}, key);
  const parentKeys = ['directory_id', 'directoryId', 'folder_id', 'folderId', 'parent_directory_id', 'parentDirectoryId', 'parent_folder_id', 'parentFolderId', 'parent_id', 'parentId'];
  const validId = value => typeof value === 'string' && value.trim() !== '';
  const unknown = () => ({ folderKnown: false, folderIds: [] });
  const membership = node => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return unknown();
    for (const key of ['directory_ids', 'directoryIds', 'folder_ids', 'folderIds']) {
      if (!own(node, key)) continue;
      const ids = node[key];
      return Array.isArray(ids) && ids.every(validId)
        ? { folderKnown: true, folderIds: [...new Set(ids)] } : unknown();
    }
    for (const key of parentKeys) {
      if (!own(node, key)) continue;
      const id = node[key];
      if (id === null) return { folderKnown: true, folderIds: [] };
      if (validId(id)) return { folderKnown: true, folderIds: [id] };
      return unknown();
    }
    for (const key of ['directory', 'folder', 'parent']) {
      if (!own(node, key)) continue;
      const value = node[key];
      if (value === null) return { folderKnown: true, folderIds: [] };
      const id = value?.id || value?.directory_id || value?.folder_id;
      if (validId(id) && (key !== 'parent' || isFolder(value))) return { folderKnown: true, folderIds: [id] };
    }
    return unknown();
  };
  const isFolder = node => !!node && typeof node === 'object' && !Array.isArray(node) && (
    /^(folder|directory)$/i.test(node.node_type || node.nodeType || node.type || node.kind || '') ||
    /^(libdir|libfolder|folder|directory)[_-]/i.test(String(node.id || ''))
  );
  const folder = node => {
    if (!isFolder(node)) return null;
    const data = node.directory || node.folder || node;
    const id = node.id || data.id || node.directory_id || node.folder_id;
    if (!validId(id)) return null;
    // A directory's own directory_id is its identity, never its parent.
    const parents = Object.fromEntries(Object.entries(node).filter(([key]) => key.startsWith('parent')));
    const location = membership(parents);
    return { id, name: String(data.name || node.name || node.title || id), parentId: location.folderIds[0] || null, parentKnown: location.folderKnown };
  };
  const requestMembership = (url, body) => {
    // Absence of a folder parameter does NOT imply that this is a root listing.
    try {
      const params = new URL(url, 'https://chatgpt.com').searchParams;
      for (const key of parentKeys) if (params.has(key)) {
        const value = params.get(key);
        return value && value !== 'null' ? membership({ [key]: value }) : unknown();
      }
    } catch {}
    try { return membership(typeof body === 'string' ? JSON.parse(body) : body); } catch { return unknown(); }
  };
  const mergeMembership = (base, incoming) => incoming?.folderKnown === true
    ? { folderKnown: true, folderIds: [...new Set(incoming.folderIds || [])] }
    : base?.folderKnown === true ? { folderKnown: true, folderIds: [...(base.folderIds || [])] } : unknown();

  const scan = (json, extractFile, context = unknown()) => {
    const files = [];
    const folders = new Map();
    const walk = (node, inherited, depth = 0) => {
      if (!node || typeof node !== 'object' || depth > 12) return;
      if (Array.isArray(node)) { for (const item of node) walk(item, inherited, depth + 1); return; }
      const dir = folder(node);
      if (dir) {
        if (!dir.parentKnown && inherited.folderKnown) {
          dir.parentKnown = true;
          dir.parentId = inherited.folderIds[0] || null;
        }
        folders.set(dir.id, dir);
        for (const key of ['children', 'items', 'nodes', 'files']) {
          if (node[key]) walk(node[key], { folderKnown: true, folderIds: [dir.id] }, depth + 1);
        }
        return; // Folder names and descendants must never become file candidates.
      }
      const file = extractFile(node);
      const direct = membership(node);
      const location = direct.folderKnown ? direct : inherited;
      if (file) files.push({ ...file, ...location });
      for (const [key, value] of Object.entries(node)) {
        if (!value || typeof value !== 'object') continue;
        // Only carry file/envelope membership downwards, never across siblings.
        walk(value, location, depth + 1);
        if (['directory', 'folder', 'parent'].includes(key) && value.id && value.name && !folders.has(value.id)) {
          const meta = folder({ ...value, type: 'directory' });
          if (meta) folders.set(meta.id, meta);
        }
      }
    };
    walk(json, context);
    return { files, folders: [...folders.values()] };
  };

  const ancestry = (id, folders) => {
    const ids = [];
    const seen = new Set();
    let current = id;
    while (current && !seen.has(current)) {
      seen.add(current);
      ids.push(current);
      const item = folders.get(current);
      if (!item?.parentKnown) return { ids, complete: false };
      current = item.parentId;
    }
    return { ids, complete: !current };
  };
  const allows = (file, options, folders) => {
    const { scope = 'all', ignoreFolderFiles = false, ignoredFolderIds = [], includeSubfolders = true } = options;
    const known = file.folderKnown === true;
    const ids = known ? file.folderIds || [] : [];
    const restricted = ignoreFolderFiles || ignoredFolderIds.length > 0;
    if (restricted && !known) return false;
    if (ignoreFolderFiles && ids.length) return false;
    if (ignoredFolderIds.length) {
      for (const id of ids) {
        const parents = includeSubfolders ? ancestry(id, folders) : { ids: [id], complete: true };
        if (!parents.complete || parents.ids.some(value => ignoredFolderIds.includes(value))) return false;
      }
    }
    if (scope === 'all') return true;
    if (scope === 'root') return known && !ids.length;
    if (scope === 'unknown') return !known;
    if (!known || !scope.startsWith('folder:')) return false;
    const target = scope.slice(7);
    return ids.some(id => id === target || (includeSubfolders && ancestry(id, folders).ids.includes(target)));
  };
  const path = (id, folders) => ancestry(id, folders).ids.reverse().map(value => folders.get(value)?.name || value).join(' / ');
  globalThis.LibraryCleanerFolders = Object.freeze({ membership, isFolder, folder, requestMembership, mergeMembership, scan, ancestry, allows, path });
})();
