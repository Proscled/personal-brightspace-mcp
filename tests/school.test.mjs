import test from 'node:test';
import assert from 'node:assert/strict';
import { describeDate, dateInRange, parseWindow } from '../dist/dates.js';
import { flattenContent, extractText } from '../dist/service.js';
import { config, schoolFixture, response } from './helpers.mjs';
const tz = 'Europe/Amsterdam';

test('date-only deadlines never become a guessed time', () => {
  const date = describeDate('2026-11-29', tz);
  assert.equal(date.iso, null); assert.equal(date.dateOnly, true); assert.match(date.local, /time not provided/);
});
test('Amsterdam winter and summer offsets are handled', () => {
  assert.match(describeDate('2026-11-03T15:00:00Z', tz).local, /16:00/);
  assert.match(describeDate('2026-07-03T15:00:00Z', tz).local, /17:00/);
});
test('invalid or ambiguous dates are flagged, not guessed', () => {
  for (const value of ['2026-02-30', '2026-11-03T15:00:00', 'next Friday']) assert.equal(describeDate(value, tz).invalid, true);
  assert.equal(describeDate(null, tz), null);
});
test('time windows require explicit timezones and bounded durations', () => {
  assert.throws(() => parseWindow('2026-11-03', '2026-11-10'));
  assert.throws(() => parseWindow('2026-11-10T00:00:00Z', '2026-11-03T00:00:00Z'));
  assert.throws(() => parseWindow('2026-01-01T00:00:00Z', '2028-01-01T00:00:00Z'));
});
test('range filtering respects absolute end-exclusivity', () => {
  const w = parseWindow('2026-11-03T00:00:00Z', '2026-11-10T00:00:00Z');
  assert.equal(dateInRange(describeDate('2026-11-10T00:00:00Z', tz), w.start, w.end), false);
  assert.equal(dateInRange(describeDate('2026-11-09', tz), w.start, w.end), true);
});
test('date-only filtering includes just the local dates touched by the half-open window', () => {
  const { start, end } = parseWindow('2026-10-19T00:00:00+02:00', '2026-10-26T00:00:00+01:00');
  const monday = describeDate('2026-10-26', tz);
  assert.equal(dateInRange(describeDate('2026-10-25', tz), start, end), true);
  assert.equal(dateInRange(monday, start, end), false);
  assert.equal(dateInRange(monday, start, new Date(end.valueOf() + 1)), true);
});
test('a malformed whoami ID cannot become a shared account baseline', async () => {
  const { service } = schoolFixture(await config(), { '/d2l/api/lp/1.49/users/whoami': () => response({ Identifier: null }) });
  await assert.rejects(() => service.whoami(), /recognizable identity/);
});
test('myenrollments Access fields supply course activity and dates', async () => {
  const records = { Items: [
    { OrgUnit: { Id: 1, Name: 'Current' }, Access: { IsActive: true, CanAccess: true, StartDate: '2026-09-01' } },
    { OrgUnit: { Id: 2, Name: 'Past' }, Access: { IsActive: false, CanAccess: true } },
    { OrgUnit: { Id: 3, Name: 'Restricted' }, Access: { IsActive: true, CanAccess: false } }
  ], PagingInfo: { HasMoreItems: false } };
  for (const activeOnly of [true, false]) {
    const { service } = schoolFixture(await config({ activeOnly }), { '/d2l/api/lp/1.49/enrollments/myenrollments/': () => response(records) });
    const { items } = await service.courses();
    assert.deepEqual(items.map(item => item.active), activeOnly ? [true] : [true, false]);
    assert.equal(items[0].startDate, '2026-09-01');
  }
});
test('course filtering is enforced on direct tools too', async () => {
  const { service } = schoolFixture(await config({ includeCourseIds: ['200'] }));
  await assert.rejects(() => service.assignments('100'), /excluded/);
});
test('nested content is flattened with provenance and hidden items excluded', () => {
  const r = flattenContent({ Modules: [{ ModuleId: 1, Title: 'Block', Modules: [{ ModuleId: 2, Title: 'Week', Topics: [{ TopicId: 3, Title: 'Notes' }] }],
    Topics: [{ TopicId: 4, Title: 'Hidden', IsHidden: true }] }] }, '100', 'https://school.example.edu');
  assert.equal(r.items.length, 3); assert.deepEqual(r.items[2].path, ['Block', 'Week']);
  assert.match(r.items[2].sourceUrl, /viewContent\/3/);
});
test('malformed content roots fail instead of appearing empty', () => assert.throws(() => flattenContent({}, '100', 'https://school.example.edu')));
test('D2L outline end timestamps appear as availability boundaries, separate from due dates', async () => {
  const { service } = schoolFixture(await config(), { '/d2l/api/le/1.94/100/content/toc': () => response({
    Modules: [{ ModuleId: 51, Topics: [{ TopicId: 52, TypeIdentifier: 'File',
      StartDateTime: '2026-11-04T06:00:00Z', EndDateTime: '2026-11-10T08:05:00Z' }] }]
  }) });
  const result = await service.deadlines(parseWindow('2026-11-01T00:00:00Z', '2026-11-12T00:00:00Z'));
  const topicDates = result.items.filter(item => item.kind === 'content');
  assert.deepEqual(topicDates.map(item => [item.dateKind, item.date.raw]), [['availability_ends', '2026-11-10T08:05:00Z']]);
});
test('notebooks are extracted without executing cells or outputs', () => {
  const source = JSON.stringify({ cells: [{ cell_type: 'code', source: ['print("hello")'], outputs: [{ text: 'MUST_NOT_EXECUTE' }] }] });
  const r = extractText(Buffer.from(source), 'application/json', 'week.ipynb');
  assert.equal(r.supported, true); assert.match(r.text, /print/); assert.doesNotMatch(r.text, /MUST_NOT_EXECUTE/);
});
test('binary material is explicitly unsupported, not gibberish', () => {
  const r = extractText(Buffer.from('%PDF-1.7'), 'application/pdf');
  assert.equal(r.supported, false); assert.equal(r.text, '');
});
test('assignment status stays unknown and end date stays separate', async () => {
  const { service } = schoolFixture(await config());
  const assignment = (await service.assignments('100')).items[0];
  assert.equal(assignment.submissionStatus, 'unknown'); assert.notEqual(assignment.dueDate, assignment.endDate);
});
test('missing grade values stay null, not zero', async () => {
  const { service } = schoolFixture(await config());
  assert.equal((await service.grades('100')).items[0].pointsNumerator, null);
});
test('deadline aggregation preserves source kinds and uncertainty', async () => {
  const { service } = schoolFixture(await config());
  const r = await service.deadlines({ start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-12-01T00:00:00Z') });
  assert.equal(r.complete, true); assert.equal(r.coverage.length, 4);
  assert.ok(r.items.some(x => x.dateKind === 'due_date'));
  assert.ok(r.items.some(x => x.dateKind === 'availability_ends'));
  assert.ok(r.items.some(x => x.dateKind === 'calendar_event'));
  assert.ok(r.items.every(x => x.completionStatus === 'unknown'));
  assert.ok(r.items.some(x => x.date.dateOnly && x.date.iso === null));
});
test('unreadable quiz source yields partial coverage but keeps other dates', async () => {
  const { service } = schoolFixture(await config(), { '/d2l/api/le/1.94/100/quizzes/': () => response({}, 403) });
  const r = await service.deadlines({ start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-12-01T00:00:00Z') });
  assert.equal(r.complete, false); assert.ok(r.items.length > 0);
  assert.equal(r.coverage.find(x => x.kind === 'quizzes').error.status, 403);
});
test('file topic can be read with bounded output and next offset', async () => {
  const { service } = schoolFixture(await config());
  const r = await service.readTopic('100', '52', 0, 10);
  assert.equal(r.text.length, 10); assert.equal(r.nextOffset, 10); assert.equal(r.supported, true);
});
test('non-file topics never follow external URLs or start attempts', async () => {
  const { service, calls } = schoolFixture(await config(), { '/d2l/api/le/1.94/100/content/topics/52': () => response({ Id: 52, Title: 'Exam', TopicType: 3, Url: 'https://remindo.example.org/exam' }) });
  const r = await service.readTopic('100', '52');
  assert.equal(r.externalOrInteractive, true);
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), ['/d2l/api/le/1.94/100/content/toc', '/d2l/api/le/1.94/100/content/topics/52']);
});
test('HHS string file types are readable only with consistent visible topic metadata', async () => {
  const metadata = { Id: 52, Type: 1, Title: 'Study guide', IsHidden: false, IsLocked: false };
  for (const [outlineType, details, expected] of [
    ['File', { ...metadata, TopicType: 'File' }, 'file'],
    ['File', { ...metadata, TopicType: 1 }, 'file'],
    ['File', metadata, 'file'],
    ['Link', { ...metadata, TopicType: 'Link' }, 'reference'],
    ['Link', { ...metadata, TopicType: 'File' }, 'reference'],
    ['File', { ...metadata, TopicType: 'Link' }, 'reference'],
    ['File', { ...metadata, TopicType: {} }, 'reference'],
    ['File', { ...metadata, TopicType: null }, 'reference'],
    ['File', { ...metadata, IsHidden: undefined }, 'reference'],
    ['File', { ...metadata, Id: 53 }, 'error'],
    ['File', { ...metadata, IsHidden: true }, 'error'],
    ['File', {}, 'error']
  ]) {
    const { service, calls } = schoolFixture(await config(), {
      '/d2l/api/le/1.94/100/content/toc': () => response({ Modules: [{ ModuleId: 51,
        Topics: [{ TopicId: 52, TypeIdentifier: outlineType }] }] }),
      '/d2l/api/le/1.94/100/content/topics/52': () => response(details)
    });
    const result = service.readTopic('100', '52');
    if (expected === 'error') await assert.rejects(result);
    else if (expected === 'file') assert.equal((await result).supported, true);
    else assert.equal((await result).externalOrInteractive, true);
    assert.equal(calls.some(call => new URL(call.url).pathname.endsWith('/file')), expected === 'file');
  }
});
test('a guessed ID or a hidden or sequenced ancestor cannot lead to a topic file request', async () => {
  for (const modules of [[], [{ ModuleId: 1, IsHidden: true, Topics: [{ TopicId: 52 }] }],
    [{ ModuleId: 1, IsLocked: true, Topics: [{ TopicId: 52 }] }]]) {
    const { service, calls } = schoolFixture(await config(), { '/d2l/api/le/1.94/100/content/toc': () => response({ Modules: modules }) });
    await assert.rejects(() => service.readTopic('100', '52'), /unavailable/);
    assert.deepEqual(calls.map(call => new URL(call.url).pathname), ['/d2l/api/le/1.94/100/content/toc']);
  }
});
test('search covers descriptions but labels its limited scope', async () => {
  const { service } = schoolFixture(await config());
  const r = await service.searchCourse('100', 'reasoning');
  assert.equal(r.totalMatches, 1); assert.match(r.scope, /not full text/);
});

test('quiz descriptions unwrap documented visible RichText wrappers', async () => {
  const { service } = schoolFixture(await config(), { '/d2l/api/le/1.94/100/quizzes/': () => response([
    { QuizId: 9, Name: 'Practice', IsActive: true, Description: { Text: { Text: 'Study chapters 1-4.', Html: '' }, IsDisplayed: true } }
  ]) });
  assert.equal((await service.quizzes('100')).items[0].description, 'Study chapters 1-4.');
});
test('quiz descriptions marked not displayed are not exposed', async () => {
  const { service } = schoolFixture(await config(), { '/d2l/api/le/1.94/100/quizzes/': () => response([
    { QuizId: 9, Name: 'Practice', IsActive: true, Description: { Text: { Text: 'Hidden description', Html: '' }, IsDisplayed: false } }
  ]) });
  assert.equal((await service.quizzes('100')).items[0].description, '');
});
