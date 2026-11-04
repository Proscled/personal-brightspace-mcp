import test from 'node:test';
import assert from 'node:assert/strict';
import { safeApiUrl } from '../dist/security.js';
import { ToolRegistry } from '../dist/tools.js';
import { config, response, schoolFixture } from './helpers.mjs';

const base = '/d2l/api/le/1.94/100/dropbox/folders/';
const route = base + '11/submissions/mysubmissions/';
const args = { courseId: '100', folderId: '11' };

async function call(receipts, options = {}) {
  const { service, calls } = schoolFixture(await config(options.config), {
    [route]: () => response(receipts, options.status),
    ...options.overrides
  });
  const result = await new ToolRegistry(service).call('brightspace_get_assignments', options.args ?? args);
  return { result, data: result.structuredContent.data, calls };
}

test('the default listing never reads receipts, and a selected folder uses only the own GET endpoint', async () => {
  const ordinary = await call([], { args: { courseId: '100' } });
  assert.equal(ordinary.calls.length, 1);
  assert.equal(ordinary.data.items[0].submissionStatus, 'unknown');
  const entity = { Entity: { EntityType: 'User', DisplayName: 'PRIVATE_NAME' },
    Feedback: { Text: 'PRIVATE_FEEDBACK' }, Submissions: [{ Id: 7, Comment: { Text: 'PRIVATE_COMMENT' },
      Files: [{ FileName: 'PRIVATE_FILE' }], SubmittedBy: { Id: 'PRIVATE_ID' } }] };
  const { result, data, calls } = await call([entity]);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].submissionStatus, 'receipt_found');
  assert.equal(data.items[0].receiptCheck, 'receipt_found');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
  assert.deepEqual(calls.map(call => [call.options.method, new URL(call.url).pathname]), [['GET', base], ['GET', route]]);
  entity.Entity.EntityType = 'Group';
  const group = await call([entity]);
  assert.equal(group.data.items[0].submissionStatus, 'group_receipt_found');
});

test('no receipt, a forbidden read, and an unexpected receipt shape are distinct', async () => {
  for (const value of [[], [{ Entity: { EntityType: 'User' }, Submissions: [], Status: 'Submitted', CompletionDate: '2025-01-01' }]]) {
    const { data } = await call(value);
    assert.equal(data.items[0].receiptCheck, 'no_personal_receipt_found');
    assert.equal(data.items[0].submissionStatus, 'unknown');
    assert.equal(data.complete, true);
  }
  for (const [value, status, code] of [[{}, 403, 'FORBIDDEN'], [{}, 200, 'API_SHAPE'],
    [[{ Entity: { EntityType: 'User' }, Submissions: [{}] }], 200, 'API_SHAPE']]) {
    const { data } = await call(value, { status });
    assert.equal(data.items[0].receiptError.code, code);
    assert.equal(data.items[0].submissionStatus, 'unknown');
    assert.equal(data.complete, false);
  }
});

test('receipt checks require a visible folder in an included course and reject path arguments', async () => {
  for (const options of [{ config: { includeCourseIds: ['101'] } }, { args: { ...args, folderId: '../11' } },
    { args: { ...args, folderId: '12' } }, { overrides: { [base]: () => response([{ Id: 11, IsHidden: true }]) } }]) {
    const { result, calls } = await call([], options);
    assert.equal(result.isError, true);
    assert.ok(calls.every(call => new URL(call.url).pathname === base));
  }
  const origin = 'https://school.example.edu';
  assert.equal(safeApiUrl(origin, route).pathname, route);
  for (const suffix of ['submissions/', 'submissions/paged/', 'submissions/user/42', 'submissions/group/42',
    'submissions/7/files/1', 'submissions/7/files/1/markAsRead', 'submissions/42/download', 'feedback/user/42']) {
    assert.throws(() => safeApiUrl(origin, base + '11/' + suffix));
  }
});
