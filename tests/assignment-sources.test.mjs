import test from 'node:test';
import assert from 'node:assert/strict';
import { safeApiUrl } from '../dist/security.js';
import { config, response, schoolFixture } from './helpers.mjs';
const origin = 'https://school.example.edu', prefix = '/d2l/api/le/1.94/100';
const folders = prefix + '/dropbox/folders/', news = prefix + '/news/', rubrics = prefix + '/rubrics/';
const rubric = { RubricId: 7, Name: 'Design', RubricStateId: 0, Visibility: 0, IsScoreVisibleToAssessedUsers: true,
  CriteriaGroups: [{ Name: 'Group', Levels: [{ Id: 2, Name: 'Good', Points: 3 }], Criteria: [{ Id: 5, Name: 'Method', Cells: [{ Description: { Text: 'Justified' }, Points: 2.5 }] }] }],
  OverallLevels: [{ Id: 2, Name: 'Good', RangeStart: 2 }] };

test('assignment links keep labels and decoded hrefs even when Brightspace also supplies plain text', async () => {
  const { service, calls } = schoolFixture(await config(), { [folders]: () => response([{ Id: 11, Name: 'Demo',
    CustomInstructions: { Text: 'See materials', Html: '<a href="/content/file?x=1&amp;y=2"><b>Workbook</b></a> <a HREF="https://course.example.org/test.ipynb" title="Template"></a>' +
      '<!-- <a href="/comment">bad</a> --><script>\'<a href="/script">bad</a>\'</script><a href="javascript:foo()">bad</a><a href="https://user:pass@example.org/">bad</a>' },
    LinkAttachments: [{ LinkName: 'Notes', Href: 'https://notes.example.org/class' }, { LinkName: 'redacted', Href: 'https://example.org/#access_token=some-secret' }] }]) });
  const result = await service.assignments('100');
  assert.equal(result.items[0].instructions, 'See materials');
  assert.deepEqual(result.items[0].instructionLinks, [
    { label: 'Workbook', url: origin + '/content/file?x=1&y=2' },
    { label: 'Template', url: 'https://course.example.org/test.ipynb' },
    { label: 'Notes', url: 'https://notes.example.org/class' }
  ]);
  assert.equal(calls.length, 1);
});

test('attachment URLs and rubric association filters have narrow GET route allowlists', () => {
  const attachment = folders + '11/attachments/14';
  const query = '?objectType=Dropbox&objectId=11';
  for (const path of [attachment, news + '21/attachments/14', rubrics + query]) assert.equal(safeApiUrl(origin, path).href, origin + path);
  for (const path of [attachment + '?bookmark=1', attachment + '/other', rubrics, rubrics + '?objectType=Grades&objectId=11',
    rubrics + query + '&userId=42', rubrics + query + '&objectId=9', rubrics + '?objectType=Dropbox&objectId=x', folders + query, rubrics + '7',
    prefix + '/assessment?userId=1', folders + '11/feedback/user/42/attachments/14', 'https://other.example.org' + attachment])
    assert.throws(() => safeApiUrl(origin, path));
});

test('file downloads require a visible parent and its own file ID, with no receipt or external fetch', async () => {
  const { service, calls } = schoolFixture(await config(), {
    [folders]: () => response([{ Id: 11, Name: 'Visible', Attachments: [{ FileId: 3, FileName: 'Demo.pptx' }] },
      { Id: 12, IsHidden: true, Attachments: [{ FileId: 4 }] }]),
    [news]: () => response([{ Id: 21, Title: 'Published', IsPublished: true, Attachments: [{ FileId: 4, FileName: 'Intro.pdf' }] },
      { Id: 22, IsPublished: false, Attachments: [{ FileId: 4 }] }]),
    [folders + '11/attachments/3']: () => new Response('slide bytes'),
    [news + '21/attachments/4']: () => new Response('PDF bytes')
  });
  const a = await service.assignmentAttachment('100', '11', '3');
  const b = await service.announcementAttachment('100', '21', '4');
  assert.equal(a.filename, 'Demo.pptx'); assert.equal(b.title, 'Intro.pdf');
  assert.equal(new TextDecoder().decode(a.bytes), 'slide bytes');
  await assert.rejects(service.assignmentAttachment('100', '12', '4'), /not listed/);
  await assert.rejects(service.assignmentAttachment('100', '11', '4'), /not listed/);
  await assert.rejects(service.announcementAttachment('100', '22', '4'), /not listed/);
  await assert.rejects(service.announcementAttachment('100', '21', '../4'), /positive decimal/);
  assert.deepEqual(calls.filter(c => c.url.includes('attachments')).map(c => c.url), [origin + folders + '11/attachments/3', origin + news + '21/attachments/4']);
  assert.ok(calls.every(c => c.options.method === 'GET' && c.options.redirect === 'manual' && !c.url.includes('mysubmissions')));
});

test('rubric definitions preserve level/criterion associations and visibility of points', async () => {
  const definitions = [rubric, { ...rubric, RubricId: 8, IsScoreVisibleToAssessedUsers: false },
    { ...rubric, RubricId: 9, Visibility: 1 }, { ...rubric, RubricId: 10, Visibility: 2 },
    { ...rubric, RubricId: 13, Visibility: undefined }, { ...rubric, RubricId: 14, RubricStateId: 2 }];
  const { service } = schoolFixture(await config(), {
    [folders]: () => response([{ Id: 11, Assessment: { Rubrics: definitions } }]),
    [rubrics]: url => { assert.equal(url.search, '?objectType=Dropbox&objectId=11'); return response(definitions); }
  });
  const raw = await service.assignments('100');
  assert.deepEqual(raw.items[0].rubrics.map(r => r.RubricId), [7,8]);
  assert.equal(raw.items[0].rubrics[1].OverallLevels[0].RangeStart, null);
  const result = await service.assignmentRubrics('100','11');
  assert.deepEqual(result.items.map(r => r.id), ['7','8']);
  assert.equal(result.complete, false);
  const group = result.items[0].criteriaGroups[0];
  assert.equal(group.criteria[0].cells[0].levelId, '2');
  assert.equal(group.criteria[0].cells[0].description, 'Justified');
  assert.equal(group.criteria[0].cells[0].points, 2.5);
  assert.equal(result.items[1].criteriaGroups[0].levels[0].points, null);
  assert.equal(result.items[1].criteriaGroups[0].criteria[0].cells[0].points, null);
  await assert.rejects(service.assignmentRubrics('100','12'), /visible/);
});

test('a denied rubric read preserves embedded definitions and supporting references with partial coverage', async () => {
  const {service} = schoolFixture(await config(), {
    [folders]: () => response([{ Id: 11, Name: 'Assignment', Assessment: { Rubrics: [rubric] },
      LinkAttachments:[{LinkName:'Beoordelingsmatrix',Href:'/example.xlsx'}] }]),
    [rubrics]: () => response({ private: 'ignore me' }, 403)
  });
  const result = await service.assignmentRubrics('100','11');
  assert.equal(result.items[0].title, 'Design'); assert.equal(result.complete, false);
  assert.equal(result.lookupError.status, 403); assert.equal(result.sourceUrl, origin + folders);
  assert.equal(result.instructionLinks[0].label, 'Beoordelingsmatrix');
  assert.ok(!JSON.stringify(result).includes('ignore me'));
});
