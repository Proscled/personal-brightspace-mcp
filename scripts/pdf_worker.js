// Fixed macOS JXA entry point for PDFKit and on-device Vision. No document script is evaluated.
ObjC.import('Foundation');
ObjC.import('PDFKit');
ObjC.import('AppKit');
ObjC.import('Vision');

function pageImage(page, maxEdge) {
  const rect = page.boundsForBox(1); // Crop box
  const w = rect.size.width, h = rect.size.height;
  if (![w, h].every(n => Number.isFinite(n) && n > 0 && n < 1000000)) throw Error('PAGE');
  const scale = maxEdge / Math.max(w, h);
  const size = $.NSMakeSize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
  const image = page.thumbnailOfSizeForBox(size, 1);
  const rep = $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation);
  const png = rep.representationUsingTypeProperties(4, $({}));
  if (!Number(png.length)) throw Error('IMAGE');
  return png;
}

function recognize(page) {
  const request = $.VNRecognizeTextRequest.alloc.init;
  request.recognitionLevel = 0; // accurate
  request.recognitionLanguages = $(['nl-NL', 'en-US']);
  const handler = $.VNImageRequestHandler.alloc.initWithDataOptions(pageImage(page, 1800), $({}));
  if (!handler.performRequestsError($([request]), Ref())) throw Error('OCR');
  const observations = request.results, lines = [];
  for (let i = 0; i < Number(observations.count); i++) {
    const candidate = observations.objectAtIndex(i).topCandidates(1).firstObject;
    lines.push(ObjC.unwrap(candidate.string));
  }
  return lines.join('\n');
}

function run(argv) {
  const [input, mode, pageArg, force, output, prefix] = argv;
  const pdf = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(input));
  const count = Number(pdf.pageCount), target = Number(pageArg);
  if (!count || pdf.isLocked) return '{"error":"UNREADABLE_PDF"}';
  if (!pdf.allowsCopying) return '{"error":"COPY_PERMISSION"}';
  if (target > count) return '{"error":"PAGE_RANGE"}';
  if (mode === 'render') {
    const page = pdf.pageAtIndex(target - 1);
    // Keep image output bounded even when a page contains a high-entropy raster.
    for (const edge of [1600, 1080, 720]) {
      const png = pageImage(page, edge);
      if (Number(png.length) <= 3 * 1024 * 1024 && png.writeToFileAtomically(output, false)) return '{"ok":true}';
    }
    return '{"error":"IMAGE_LIMIT"}';
  }
  const sections = [], warnings = new Set();
  const start = target || 1, end = target || Math.min(count, 100);
  let budget = 1000000, ocrPages = 0, complete = true;
  if (!target && count > end) { complete = false; warnings.add('Only the first 100 pages were searched. Request a later page by number.'); }
  for (let n = start; n <= end; n++) {
    const page = pdf.pageAtIndex(n - 1);
    let text = ObjC.unwrap(page.string) || '', ocr = false;
    if (force === 'force' || text.trim().length < 8) {
      if (ocrPages < 12) {
        ocrPages++;
        try {
          const detected = recognize(page);
          if (detected.trim()) { text = detected; ocr = true; }
          else { complete = false; warnings.add('OCR returned no text on at least one page. Inspect the page image.'); }
        } catch (_) { complete = false; warnings.add('OCR failed on at least one page. Inspect the page image.'); }
      } else { complete = false; warnings.add('OCR was limited to 12 pages. Request omitted pages individually.'); }
    }
    const limit = Math.min(80000, budget);
    if (text.length > limit) { complete = false; warnings.add('The extracted text reached the output limit. Inspect a page individually or render its image.'); }
    text = text.slice(0, limit);
    budget -= text.length;
    sections.push({ index:n, locator: prefix + ' ' + n, text, ocr });
    if (!budget && n < end) { complete = false; break; }
  }
  if (ocrPages) warnings.add('OCR is approximate, especially for formulas, tables and handwriting.');
  return JSON.stringify({sections, complete, warnings:Array.from(warnings), pageCount:count});
}
