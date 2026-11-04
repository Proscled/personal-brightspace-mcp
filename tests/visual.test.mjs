import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractPdf, extractScannedOffice, renderPage } from '../dist/visual.js';

const mac = process.platform === 'darwin';
const pdf = await readFile(new URL('fixtures/text-and-scan.pdf', import.meta.url));
const pptx = await readFile(new URL('fixtures/hidden-first-slide.pptx', import.meta.url));
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

test('visual reader rejects invalid selectors before opening a document', async () => {
  await assert.rejects(renderPage(pdf, 'pdf', 0), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(extractPdf(pdf, 1.5), { code: 'INVALID_ARGUMENT' });
});
test('native PDF text and scanned Dutch OCR retain independent page citations', { skip: !mac }, async () => {
  const data = await extractPdf(pdf);
  assert.deepEqual(data.sections.map(p => [p.locator, p.ocr]), [['Page 1', false], ['Page 2', true]]);
  assert.equal(data.complete, true);
  assert.match(data.sections[0].text, /First PDF page as text/);
  assert.match(data.sections[1].text, /techniek en wiskunde/i);
  assert.match(data.warnings.join(' '), /approximate/);
  const second = await extractPdf(pdf, 2);
  assert.deepEqual(second.sections, [data.sections[1]]);
  await assert.rejects(renderPage(pdf, 'pdf', 3), { code: 'INVALID_ARGUMENT' });
});
test('rendered PDF page PNGs respect selection and the output size cap', { skip: !mac }, async () => {
  const [first, second] = await Promise.all([renderPage(pdf, 'pdf', 1), renderPage(pdf, 'pdf', 2)]);
  assert.deepEqual(second.subarray(0, 8), pngSignature);
  assert.ok(second.length < 3 * 1024 * 1024);
  assert.notDeepEqual(first, second);
});
test('PowerPoint rendering keeps hidden slides in the slide index and OCR sees the selected slide', { skip: !mac }, async t => {
  // The first slide in this synthetic deck is hidden; slide 2 has a hyperlink to example.invalid.
  let image;
  try { image = await renderPage(pptx, 'pptx', 2); }
  catch (error) { if (error.code === 'DEPENDENCY') { t.skip('LibreOffice is optional'); return; } throw error; }
  assert.deepEqual(image.subarray(0, 8), pngSignature);
  const scan = await extractScannedOffice(pptx, 'pptx', 2);
  assert.equal(scan.pageCount, 2);
  assert.equal(scan.sections[0].locator, 'Slide 2');
  assert.match(scan.sections[0].text, /Tweede dia/i);
});

test('Office rendering strips external targets and rejects active packages before conversion', async () => {
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const code = `
import pathlib, sys, tempfile, zipfile
sys.path.insert(0, sys.argv[1])
from visual_launcher import sanitize_office
with tempfile.TemporaryDirectory() as folder:
    target = pathlib.Path(folder) / 'screen.pptx'
    original = pathlib.Path(sys.argv[2])
    with zipfile.ZipFile(original) as src:
        assert any(b'example.invalid' in src.read(n) for n in src.namelist() if n.endswith('.rels'))
    sanitize_office(original, target, 'pptx')
    with zipfile.ZipFile(target) as clean:
        assert all(b'example.invalid' not in clean.read(n) for n in clean.namelist() if n.endswith('.rels'))
    with zipfile.ZipFile(target, 'a') as package:
        package.writestr('ppt/vbaProject.bin', 'blocked')
    try:
        sanitize_office(target, pathlib.Path(folder) / 'blocked.pptx', 'pptx')
    except ValueError:
        pass
    else:
        raise AssertionError('Active package accepted')
`;
  execFileSync('python3', ['-I', '-S', '-B', '-c', code, fileURLToPath(new URL('../scripts', import.meta.url)),
    fileURLToPath(new URL('fixtures/hidden-first-slide.pptx', import.meta.url))]);
});

test('a PDF copy restriction also applies to OCR and page image tools', { skip: !mac }, async () => {
  const restricted = await readFile(new URL('fixtures/no-copy.pdf', import.meta.url));
  await assert.rejects(extractPdf(restricted, 1, true), { code: 'FORBIDDEN' });
  await assert.rejects(renderPage(restricted, 'pdf', 1), { code: 'FORBIDDEN' });
});
