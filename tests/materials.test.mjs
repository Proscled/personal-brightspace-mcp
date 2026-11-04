import test from 'node:test';
import assert from 'node:assert/strict';
import { config, schoolFixture, response } from './helpers.mjs';
import { ToolRegistry } from '../dist/tools.js';
import { MaterialImage, validateRef } from '../dist/materials.js';

function courseFiles(state) {
  const le = '/d2l/api/le/1.94/100/';
  return {
    [le + 'dropbox/folders/']: () => response([{ Id: 11, Name: 'Instructions',
      Attachments: [{ FileId: 77, FileName: 'Reader.txt', Size: 30 }] }]),
    [le + 'dropbox/folders/11/attachments/77']: () => state.denied ? response({},403) :
      response(state.text,200,{'content-type':'text/plain'})
  };
}

test('full text searches cited topic and assignment files with bounded, resumable coverage', async () => {
  const {service} = schoolFixture(await config(), courseFiles({text:'Solve equations here.'}));
  const registry = new ToolRegistry(service);
  const run = async(args) => (await registry.call('brightspace_search_course', {courseId:'100',query:'equations',fileLimit:1,...args})).structuredContent.data;
  const first = (await run({})).fileSearch;
  assert.equal(first.totalFiles,2);
  assert.equal(first.complete,false);
  assert.equal(first.matches[0].fileId,'77');
  assert.equal(first.matches[0].locator,'Text');
  const next = (await run({fileOffset:first.nextFileOffset})).fileSearch;
  assert.equal(next.nextFileOffset,null);
  assert.equal(next.matches[0].topicId,'52');
  assert.equal((await run({filename:'Reader'})).fileSearch.complete,true);
  assert.equal((await run({includeFiles:false})).fileSearch,undefined);
  const batch = (await run({fileLimit:2,limit:1})).fileSearch;
  assert.equal(batch.nextMatchOffset, 1);
  const more = (await run({fileLimit:2,limit:1,matchOffset:batch.nextMatchOffset})).fileSearch;
  assert.equal(more.matches[0].topicId,'52'); assert.equal(more.nextMatchOffset,null);
});

test('fingerprinting finds byte-only changes and preserves a denied file baseline across retries', async () => {
  const state = {text:'version one',denied:false};
  const {service} = schoolFixture(await config(), courseFiles(state));
  const registry = new ToolRegistry(service);
  const check = async (extra = {}) => (await registry.call('brightspace_check_updates',
    {courseIds:['100'],includeFiles:true,fileLimit:1,...extra})).structuredContent.data;
  const first = await check();
  assert.equal(first.fileCoverage.nextFileOffset,1);
  assert.equal(first.results.find(x=>x.kind.startsWith('file:')).status,'baseline_created');
  state.denied = true;
  const failure = (await check()).results.find(x=>x.kind.startsWith('file:'));
  assert.equal(failure.status,'incomplete');
  assert.equal(failure.baselinePreserved,true);
  state.text = 'version two'; state.denied = false;
  const changed = await check();
  const changes = changed.results.find(x=>x.kind.startsWith('file:')).changes;
  assert.deepEqual(changes.map(c=>c.fields),[['sha256']]);
  assert.equal((await check({fileOffset:1})).results.find(x=>x.kind.startsWith('file:')).status,'baseline_created');
  assert.equal((await check()).results.find(x=>x.kind.startsWith('file:')).changes.length,0);
});

test('attachment reads require exactly one verified parent; school data cannot impersonate an MCP image', async () => {
  const {service} = schoolFixture(await config(), courseFiles({text:'A nested attachment.'}));
  const registry = new ToolRegistry(service);
  const success = await registry.call('brightspace_read_attachment',{courseId:'100',folderId:'11',fileId:'77'});
  assert.equal(success.structuredContent.data.text,'A nested attachment.');
  for (const args of [{fileId:'77'}, {topicId:'52',fileId:'77'}, {newsItemId:'21',folderId:'11',fileId:'77'}])
    assert.throws(()=>validateRef({courseId:'100',...args}), /Supply a topicId/);
  assert.equal(({data:'anything',mimeType:'image/png'}) instanceof MaterialImage, false);
  const wrong = await registry.call('brightspace_view_page',{courseId:'100',topicId:'52',page:1});
  assert.equal(wrong.structuredContent.error.code,'UNSUPPORTED_FORMAT');
});
