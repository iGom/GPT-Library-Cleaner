const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../folder-model.js');
const F = globalThis.LibraryCleanerFolders;
const extract = node => /^libfile_/.test(node.id || '') ? { id: node.id, name: node.name } : null;
const folders = new Map([
  ['a', { id: 'a', name: 'Projects', parentId: null, parentKnown: true }],
  ['b', { id: 'b', name: 'Game', parentId: 'a', parentKnown: true }],
  ['c', { id: 'c', name: 'Other', parentId: null, parentKnown: true }],
  ['orphan', { id: 'orphan', name: 'Unresolved', parentKnown: false }]
]);
const root = { folderKnown: true, folderIds: [] };
const inFolder = id => ({ folderKnown: true, folderIds: [id] });

test('missing, null, empty and malformed parents stay distinct', () => {
  assert.equal(F.membership({}).folderKnown, false);
  assert.deepEqual(F.membership({ directory_id: null }), root);
  assert.deepEqual(F.membership({ parent_directory_id: 'a' }), inFolder('a'));
  assert.equal(F.membership({ parent_id: '' }).folderKnown, false);
  assert.equal(F.membership({ folder_ids: [null] }).folderKnown, false);
  assert.deepEqual(F.membership({ folder_ids: [] }), root);
});
test('nested records inherit parents without leaking across siblings', () => {
  const result = F.scan({ nodes: [
    { type: 'folder', id: 'a', name: 'Projects', parent_id: null, children: [
      { type: 'file', directory_id: 'a', file: { id: 'libfile_1', name: 'one.png' } },
      { type: 'directory', id: 'b', name: 'Game', children: [{ id: 'libfile_2', name: 'two.png' }] }
    ] },
    { id: 'libfile_3', name: 'three.png', directory_id: null },
    { id: 'libfile_4', name: 'four.png' }
  ] }, extract);
  assert.deepEqual(result.files.map(f => [f.id, f.folderKnown, f.folderIds]), [
    ['libfile_1', true, ['a']], ['libfile_2', true, ['b']], ['libfile_3', true, []], ['libfile_4', false, []]
  ]);
  assert.equal(result.folders.find(f => f.id === 'b').parentId, 'a');
  assert.equal(result.folders.find(f => f.id === 'a').parentId, null);
});
test('request scope provides context only when explicit', () => {
  assert.equal(F.requestMembership('/backend-api/files/library/nodes').folderKnown, false);
  assert.equal(F.requestMembership('/backend-api/files/library/nodes?directory_id=').folderKnown, false);
  assert.deepEqual(F.requestMembership('/backend-api/files/library/nodes?directory_id=a'), inFolder('a'));
  assert.deepEqual(F.requestMembership('', '{"directory_id":null}'), root);
  const result = F.scan([{ id: 'libfile_1', name: 'one.png' }], extract, inFolder('a'));
  assert.deepEqual(result.files[0].folderIds, ['a']);
});
test('metadata enrichment preserves membership; a move can clear it', () => {
  assert.deepEqual(F.mergeMembership(inFolder('a'), {}), inFolder('a'));
  assert.deepEqual(F.mergeMembership(inFolder('a'), { folderKnown: false }), inFolder('a'));
  assert.deepEqual(F.mergeMembership(inFolder('a'), root), root);
  assert.deepEqual(F.mergeMembership(root, inFolder('b')), inFolder('b'));
});
test('folder scope and root/unknown are separate', () => {
  assert.equal(F.allows({}, { scope: 'root' }, folders), false);
  assert.equal(F.allows(root, { scope: 'root' }, folders), true);
  assert.equal(F.allows({}, { scope: 'unknown' }, folders), true);
  assert.equal(F.allows(inFolder('b'), { scope: 'folder:a' }, folders), true);
  assert.equal(F.allows(inFolder('b'), { scope: 'folder:a', includeSubfolders: false }, folders), false);
});
test('ignoring all folders admits only confirmed root files', () => {
  for (const file of [{}, inFolder('a'), inFolder('orphan')]) assert.equal(F.allows(file, { ignoreFolderFiles: true }, folders), false);
  assert.equal(F.allows(root, { ignoreFolderFiles: true }, folders), true);
});
test('ignored folders protect descendants and unresolved ancestry', () => {
  const options = { ignoredFolderIds: ['a'] };
  assert.equal(F.allows(inFolder('b'), options, folders), false);
  assert.equal(F.allows(inFolder('c'), options, folders), true);
  assert.equal(F.allows(inFolder('orphan'), options, folders), false);
  assert.equal(F.allows({}, options, folders), false);
  assert.equal(F.allows(root, options, folders), true);
  assert.equal(F.allows(inFolder('b'), { ...options, includeSubfolders: false }, folders), true);
});
test('any ignored membership wins for files in multiple folders', () => {
  assert.equal(F.allows({ folderKnown: true, folderIds: ['c', 'b'] }, { ignoredFolderIds: ['a'] }, folders), false);
});
test('cycles terminate and fail closed while excluding descendants', () => {
  const cyclic = new Map([['x', { name: 'X', parentId: 'y', parentKnown: true }], ['y', { name: 'Y', parentId: 'x', parentKnown: true }]]);
  assert.equal(F.ancestry('x', cyclic).complete, false);
  assert.equal(F.allows(inFolder('x'), { ignoredFolderIds: ['a'] }, cyclic), false);
  assert.equal(F.path('x', cyclic), 'Y / X');
});
test('directory identity is never mistaken for its parent', () => {
  assert.deepEqual(F.folder({ type: 'directory', directory_id: 'a', name: 'A' }), { id: 'a', name: 'A', parentId: null, parentKnown: false });
});
