import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, readdir, stat, readFile, chmod, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { NoteStore } from '../dist/notes.js';
import { ChangeTracker, diffItems, canonical } from '../dist/changes.js';
import { withLock } from '../dist/storage.js';
import { ToolRegistry } from '../dist/tools.js';
import { config, schoolFixture, response } from './helpers.mjs';

test('explicit Markdown imports support line-based search/read and provenance', async () => {
  const cfg = await config(), notes = new NoteStore(cfg), source = join(cfg.dataDir, 'sample.md');
  await writeFile(source, '# Demo course\nAssignment deadline: 20 November\nDo not assume a time.\n');
  const imported = await notes.importFile(source, 'Demo snapshot', '2026-11-03');
  assert.equal(imported.asOf, '2026-11-03');
  const search = await notes.search('deadline');
  assert.equal(search.matches.length, 1); assert.match(search.matches[0].snippet, /\[L2\]/);
  const read = await notes.read(imported.id, 2, 1);
  assert.equal(read.startLine, 2); assert.equal(read.endLine, 2); assert.equal(read.nextLine, 3);
  assert.match(read.text, /Assignment deadline/); assert.equal(read.asOf, '2026-11-03');
});
test('identical note import uses the same ID instead of duplicating', async () => {
  const cfg = await config(), notes = new NoteStore(cfg), source = join(cfg.dataDir, 'sample.txt');
  await writeFile(source, 'Demo notes');
  const a = await notes.importFile(source), b = await notes.importFile(source);
  assert.equal(a.id, b.id); assert.equal((await notes.list()).items.length, 1);
});
test('note tools cannot read arbitrary local file paths', async () => {
  const notes = new NoteStore(await config());
  await assert.rejects(() => notes.read('../../etc/passwd'), /note ID/);
});
test('listing and searching before the first import leave local state untouched', async () => {
  const cfg = await config(), notes = new NoteStore(cfg);
  assert.deepEqual((await notes.list()).items, []);
  assert.deepEqual((await notes.search('sample')).matches, []);
  assert.deepEqual(await readdir(cfg.dataDir), []);
});
test('note reads reject an unsafe directory without changing it', { skip: process.platform === 'win32' }, async () => {
  const cfg = await config(), notes = new NoteStore(cfg), directory = join(cfg.dataDir, 'notes');
  await mkdir(directory);
  await chmod(directory, 0o750);
  await assert.rejects(() => notes.list(), /unsafe permissions/);
  assert.equal((await stat(directory)).mode & 0o777, 0o750);
  const linked = await config(), linkedNotes = new NoteStore(linked);
  await symlink(directory, join(linked.dataDir, 'notes'));
  await assert.rejects(() => linkedNotes.list(), /real directory/);
  await assert.rejects(() => linkedNotes.read('1'.repeat(24)), /real directory/);
});
test('non-text files and invalid snapshot dates cannot be imported', async () => {
  const cfg = await config(), notes = new NoteStore(cfg), source = join(cfg.dataDir, 'sample.md');
  await writeFile(source, 'demo');
  await assert.rejects(() => notes.importFile('session.json'), /Only explicitly/);
  await assert.rejects(() => notes.importFile(source, 'demo', '2026-02-30'), /valid YYYY/);
});
test('snapshot comparison ignores JSON key order but shows actual due-date changes', () => {
  assert.equal(canonical({ a: 1, b: 2 }), canonical({ b: 2, a: 1 }));
  const base = { id: '1', title: 'Demo', courseId: '100', sourceUrl: 'https://school.example.edu', dueDate: '2026-11-10' };
  const diff = diffItems([base], [{ ...base, dueDate: '2026-11-12' }]);
  assert.equal(diff[0].type, 'changed'); assert.ok(diff[0].fields.includes('dueDate'));
  assert.equal(diff[0].datesBefore.dueDate, '2026-11-10'); assert.equal(diff[0].datesAfter.dueDate, '2026-11-12');
});
test('disappearing item is no_longer_visible, not deleted or completed', () => {
  assert.equal(diffItems([{ id: '1', title: 'Demo' }], [])[0].type, 'no_longer_visible');
});
test('first update establishes baselines; second finds no invented changes', async () => {
  const { service } = schoolFixture(await config()); const tracker = new ChangeTracker(service);
  const first = await tracker.check();
  assert.ok(first.results.every(x => x.status === 'baseline_created' && x.changes.length === 0));
  const second = await tracker.check();
  assert.ok(second.results.every(x => x.status === 'compared' && x.changes.length === 0));
});
test('failed fetch preserves the last successful baseline', async () => {
  const cfg = await config(); let broken = false;
  const { service } = schoolFixture(cfg, { '/d2l/api/le/1.94/100/dropbox/folders/': () => broken
    ? response({}, 403) : response([{ Id: 1, Name: 'Demo', DueDate: '2026-11-20T00:00:00Z' }]) });
  const tracker = new ChangeTracker(service);
  await tracker.check();
  const files = await readdir(join(cfg.dataDir, 'snapshots'));
  const before = await Promise.all(files.map(f => readFile(join(cfg.dataDir, 'snapshots', f), 'utf8')));
  const assignmentFile = files[before.findIndex(x => JSON.parse(x).kind === 'assignments')];
  const saved = await readFile(join(cfg.dataDir, 'snapshots', assignmentFile), 'utf8');
  broken = true;
  const result = await tracker.check();
  const row = result.results.find(x => x.kind === 'assignments');
  assert.equal(row.status, 'incomplete'); assert.equal(row.baselinePreserved, true);
  assert.equal(await readFile(join(cfg.dataDir, 'snapshots', assignmentFile), 'utf8'), saved);
});
test('update baselines are isolated by authenticated account', async () => {
  const cfg = await config(); let account = '42';
  const { service } = schoolFixture(cfg, { '/d2l/api/lp/1.49/users/whoami': () => response({ Identifier: account }) });
  const tracker = new ChangeTracker(service); await tracker.check(); account = '43';
  const result = await tracker.check();
  assert.ok(result.results.every(x => x.status === 'baseline_created'));
  assert.equal((await readdir(join(cfg.dataDir, 'snapshots'))).length, 8);
});
test('an oversized update preserves all changes for narrower retries, including changes beyond 100', async () => {
  const cfg = await config(), courseIds = ['100', '101'];
  let assignments = [];
  const { service } = schoolFixture(cfg, {
    '/d2l/api/lp/1.49/enrollments/myenrollments/': () => response({
      Items: courseIds.map(Id => ({ OrgUnit: { Id, IsActive: true }, Access: { CanAccess: true } }))
    }),
    ...Object.fromEntries(courseIds.map(id => [`/d2l/api/le/1.94/${id}/dropbox/folders/`, () => response(assignments)]))
  });
  const registry = new ToolRegistry(service);
  const check = args => registry.call('brightspace_check_updates', args);
  assert.equal((await check({})).isError, undefined);
  assignments = Array.from({ length: 120 }, (_, i) => ({ Id: i + 1, Name: 'x'.repeat(5000) }));
  const tooLarge = await check({});
  assert.equal(tooLarge.structuredContent.error.code, 'OUTPUT_LIMIT');
  assert.match(tooLarge.structuredContent.error.message, /courseIds/);
  for (const id of courseIds) {
    const retry = await check({ courseIds: [id] });
    const row = retry.structuredContent.data.results.find(x => x.kind === 'assignments');
    assert.equal(row.changesTruncated, false);
    assert.equal(row.changes.length, 120);
    assert.ok(row.changes.every(x => x.type === 'added'));
  }
  const next = await check({});
  assert.ok(next.structuredContent.data.results.every(x => x.totalChanges === 0));
});
test('local update lock serializes concurrent writes', async () => {
  const cfg = await config(), order = [];
  await Promise.all(['a', 'b'].map(label => withLock(cfg.dataDir, async () => {
    order.push(label + '-start');
    await new Promise(r => setTimeout(r, 30));
    order.push(label + '-end');
  })));
  const expected = order[0] === 'a-start' ? ['a-start', 'a-end', 'b-start', 'b-end'] : ['b-start', 'b-end', 'a-start', 'a-end'];
  assert.deepEqual(order, expected);
});
