import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { extractOffice, readSlideImage } from '../dist/office.js';

const pkgRel = 'http://schemas.openxmlformats.org/package/2006/relationships';
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOdXNxkAAAAASUVORK5CYII=';
const rels = items => '<Relationships xmlns="' + pkgRel + '">' + items.map(([id, type, target, mode]) =>
  '<Relationship Id="' + id + '" Type="' + rel + '/' + type + '" Target="' + target + '"' + (mode ? ' TargetMode="' + mode + '"' : '') + '/>').join('') + '</Relationships>';
function zip(files) {
  const builder = [
    'import base64,io,json,sys,zipfile',
    'buf=io.BytesIO()',
    'with zipfile.ZipFile(buf,"w",zipfile.ZIP_DEFLATED) as z:',
    ' for name,value in json.load(sys.stdin).items():',
    '  z.writestr(name,base64.b64decode(value["b64"]) if isinstance(value,dict) else value.encode())',
    'sys.stdout.buffer.write(buf.getvalue())'
  ].join('\n');
  const out = spawnSync('python3', ['-I', '-c', builder], { input: JSON.stringify(files), maxBuffer: 4*1024*1024 });
  assert.equal(out.status, 0, 'Synthetic OOXML fixture requires Python 3');
  return out.stdout;
}
const slide = (content) => '<p:sld xmlns:p="ppt" xmlns:a="drawing" xmlns:r="' + rel + '"><p:cSld><p:spTree>' + content + '</p:spTree></p:cSld></p:sld>';
const pic = '<p:pic><p:nvPicPr><p:cNvPr name="Chart" descr="Change over time"/></p:nvPicPr><p:blipFill><a:blip r:embed="rPic"/></p:blipFill></p:pic>';
const presentation = {
  'ppt/presentation.xml': '<p:presentation xmlns:p="ppt" xmlns:r="' + rel + '"><p:sldIdLst><p:sldId r:id="rB"/><p:sldId r:id="rA"/></p:sldIdLst><p:extLst><p:sectionLst><p:sldId id="301"/></p:sectionLst></p:extLst></p:presentation>',
  'ppt/_rels/presentation.xml.rels': rels([['rA','slide','slides/slide1.xml'],['rB','slide','slides/slide2.xml']]),
  'ppt/slides/slide1.xml': slide('<p:sp><a:p><a:r><a:t>End</a:t></a:r></a:p></p:sp>'),
  'ppt/slides/slide2.xml': slide('<p:sp><a:p><a:r><a:t>Groe</a:t></a:r><a:r><a:t>ilijn</a:t></a:r></a:p></p:sp>' + pic),
  'ppt/slides/_rels/slide2.xml.rels': rels([['rPic','image','../media/image.png'],['rN','notesSlide','../notesSlides/notes2.xml']]),
  'ppt/media/image.png': {b64:png},
  'ppt/notesSlides/notes2.xml': '<p:notes xmlns:p="ppt" xmlns:a="drawing"><p:sp><p:ph type="sldNum"/><a:p><a:t>3</a:t></a:p></p:sp><p:sp><p:ph type="body"/><a:p><a:t>Leg de helling uit.</a:t></a:p></p:sp></p:notes>',
};
test('PPTX uses presentation order and extracts joined text runs, speaker notes and a selected embedded image', async () => {
  const bytes = zip(presentation);
  const doc = await extractOffice(bytes,'pptx');
  assert.equal(doc.complete, true);
  assert.deepEqual(doc.sections.map(s=>[s.index,s.locator,s.text,s.notes]), [
    [1,'Slide 1','Groeilijn','Leg de helling uit.'],[2,'Slide 2','End','']]);
  assert.deepEqual(doc.sections[0].images, [{index:1,name:'Chart',alt:'Change over time',mimeType:'image/png'}]);
  assert.deepEqual(await readSlideImage(bytes, 1, 1), {mimeType:'image/png',data:png});
  await assert.rejects(readSlideImage(bytes,2,1), {code:'EXTRACTION'});
  assert.throws(()=>readSlideImage(bytes,0,1), {code:'INVALID_ARGUMENT'});
});
test('PPTX excludes remote, traversal and disguised image payloads', async () => {
  const key = 'ppt/slides/_rels/slide2.xml.rels';
  for (const row of [['rPic','image','https://example.edu/image.png','External'],['rPic','image','../../../outside.png']]) {
    const doc = await extractOffice(zip({...presentation,[key]:rels([row])}),'pptx');
    assert.equal(doc.sections[0].images, undefined);
  }
  await assert.rejects(readSlideImage(zip({...presentation,'ppt/media/image.png':'<svg/>'}),1,1), {code:'EXTRACTION'});
});
test('DOCX returns ordered Word paragraphs, rows, and explicit image-only coverage', async () => {
  const doc = await extractOffice(zip({'word/document.xml':'<w:document xmlns:w="word"><w:body><w:p><w:r><w:t>Vraag 1</w:t></w:r><w:drawing/></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Score</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'}),'docx');
  assert.deepEqual(doc.sections.map(s=>[s.locator,s.text]), [['Paragraph 1','Vraag 1'],['Table 1, row 1','Score | 3']]);
  assert.match(doc.warnings.join(),/images/);
});
test('XLSX preserves sheet, row, column, rich strings and cached formulas without calculation', async () => {
  const files = {
    'xl/workbook.xml':'<workbook xmlns:r="' + rel + '"><sheets><sheet name="Toets" r:id="a"/><sheet name="Secret" state="hidden" r:id="b"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':rels([['a','worksheet','worksheets/sheet2.xml'],['b','worksheet','worksheets/sheet1.xml'],['s','sharedStrings','sharedStrings.xml']]),
    'xl/sharedStrings.xml':'<sst><si><r><t>Reg</t></r><r><t>ressie</t></r></si></sst>',
    'xl/worksheets/sheet2.xml':'<worksheet><sheetData><row r="9"><c r="C9" t="s"><v>0</v></c><c r="D9"><f>SUM(A1:B3)</f><v>12</v></c><c r="E9" t="inlineStr"><is><t>leerdoel</t></is></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet1.xml':'<worksheet/>',
  };
  const doc=await extractOffice(zip(files),'xlsx');
  assert.equal(doc.complete,false);
  assert.deepEqual(doc.sections.map(s=>[s.locator,s.text]),[['Sheet Toets, row 9','C9: Regressie\tD9: =SUM(A1:B3) [cached: 12]\tE9: leerdoel']]);
  assert.match(doc.warnings.join(), /Hidden worksheets/);
});
test('Office parsing rejects XML DTDs and unsafe ZIP paths', async () => {
  for (const files of [
    {'word/document.xml':'<!DOCTYPE test [<!ENTITY test SYSTEM "file:///etc/hosts">]><document><body>&test;</body></document>'},
    {'../outside':'invalid','word/document.xml':'<document><body/></document>'},
  ]) await assert.rejects(extractOffice(zip(files),'docx'),{code:'EXTRACTION'});
});
test('absolute package relationships and escaped part names resolve without a filesystem path', async () => {
  const files = {
    '_rels/.rels': rels([['rMain','officeDocument','/a%20b/deck.xml']]),
    'a b/deck.xml': presentation['ppt/presentation.xml'].replace('<p:sldId r:id="rA"/>',''),
    'a b/_rels/deck.xml.rels': rels([['rB','slide','/ppt/slides/a%20slide.xml']]),
    'ppt/slides/a%20slide.xml': slide('<p:sp><a:p><a:r><a:t>Visible</a:t></a:r></a:p></p:sp>'),
  };
  assert.equal((await extractOffice(zip(files),'pptx')).sections[0].text,'Visible');
  await assert.rejects(extractOffice(zip({...files,'ppt/slides/a slide.xml':'<sld/>'}),'pptx'),{code:'EXTRACTION'});
});
test('Office caps text expanded from repeated shared strings and reports incomplete coverage', async () => {
  const files = {
    'xl/workbook.xml':'<workbook xmlns:r="' + rel + '"><sheets><sheet name="Large" r:id="sheet"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':rels([['sheet','worksheet','worksheets/s.xml'],['ss','sharedStrings','shared.xml']]),
    'xl/shared.xml':'<sst><si><t>'+'x'.repeat(25000)+'</t></si></sst>',
    'xl/worksheets/s.xml':'<worksheet><row r="1">'+'<c t="s"><v>0</v></c>'.repeat(30)+'</row></worksheet>',
  };
  const doc=await extractOffice(zip(files),'xlsx');
  assert.equal(doc.complete,false);
  assert.equal(doc.sections[0].text.length,80000);
  assert.match(doc.warnings.join(), /limit/);
});
