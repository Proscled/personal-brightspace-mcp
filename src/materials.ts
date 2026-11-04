import { AppError, array, id, record, safeError, text, type JsonRecord } from './types.js';
import { htmlToText } from './security.js';
import { extractOffice, readSlideImage } from './office.js';
import { extractPdf, extractScannedOffice, renderPage } from './visual.js';
import type { Item, SchoolService } from './service.js';

export interface MaterialFile {
  bytes: Uint8Array;
  contentType: string;
  title: string;
  filename: string;
  sourceUrl: string;
  apiSourceUrl?: string;
  fetchedAt: string;
}
export interface MaterialRef {
  courseId: string;
  topicId?: string;
  folderId?: string;
  newsItemId?: string;
  fileId?: string;
}
export interface Section {
  index: number;
  locator: string;
  text: string;
  notes?: string;
  images?: {index:number; name:string; alt:string; mimeType:string|null}[];
  ocr?: boolean;
}
interface Extraction {
  sections: Section[];
  pageCount?: number;
  supported: boolean;
  complete: boolean;
  warnings: string[];
}
export function extractText(bytes: Uint8Array, contentType: string, filename = ''): { supported: boolean; text: string; warnings: string[] } {
  const lower = `${contentType} ${filename}`.toLowerCase();
  const string = Buffer.from(bytes).toString('utf8');
  if (/ipynb|application\/json/.test(lower) || /^\s*\{\s*"cells"/.test(string)) {
    let raw: unknown;
    try { raw = JSON.parse(string); } catch { return { supported: false, text: '', warnings: ['The JSON/notebook could not be parsed.'] }; }
    const notebook = record(raw);
    if (Array.isArray(notebook.cells)) {
      return { supported: true, text: notebook.cells.map((cell, i) => {
        const c = record(cell), source = Array.isArray(c.source) ? c.source.join('') : text(c.source) ?? '';
        return `## Cell ${i + 1} (${c.cell_type || 'unknown'})\n${source}`;
      }).join('\n\n'), warnings: ['Notebook code was read, never executed. Rich outputs and images are not extracted.'] };
    }
    return { supported: true, text: JSON.stringify(raw, null, 2), warnings: [] };
  }
  if (/text\/html|application\/xhtml|\.html?\b/.test(lower))
    return { supported: true, text: htmlToText(string), warnings: ['Plain-text extraction omits images and may flatten formulas or tables.'] };
  if (!string.includes('\0') && (/^text\//i.test(contentType) || /\.(md|txt|csv|py|js|ts|r)\b/.test(lower)))
    return { supported: true, text: string, warnings: [] };
  return { supported: false, text: '', warnings: ['No text extractor is available for this file type.'] };
}

function format(file: MaterialFile): 'pptx' | 'docx' | 'xlsx' | 'pdf' | 'text' {
  const mime = file.contentType.split(';')[0]!.trim().toLowerCase();
  const filename = file.filename.toLowerCase();
  if (mime === 'application/pdf' || filename.endsWith('.pdf') || Buffer.from(file.bytes.subarray(0, 5)).equals(Buffer.from('%PDF-'))) return 'pdf';
  if (mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || filename.endsWith('.pptx')) return 'pptx';
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || filename.endsWith('.docx')) return 'docx';
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || filename.endsWith('.xlsx')) return 'xlsx';
  return 'text';
}

export async function extractMaterial(file: MaterialFile, section?: number, ocrPage?: number): Promise<Extraction> {
  const kind = format(file);
  if (section !== undefined && ocrPage !== undefined) throw new AppError('INVALID_ARGUMENT', 'Select either an extracted section or a rendered OCR page.');
  if (kind === 'text') {
    if (ocrPage !== undefined) throw new AppError('UNSUPPORTED_FORMAT', 'OCR pages require a PDF or Office document.');
    const extracted = extractText(file.bytes, file.contentType, file.filename);
    return { supported: extracted.supported, complete: extracted.supported, warnings: extracted.warnings,
      sections: extracted.supported ? [{ index: 1, locator: 'Text', text: extracted.text }] : [] };
  }
  if (kind === 'pdf') {
    return { ...await extractPdf(file.bytes, ocrPage ?? section, ocrPage !== undefined), supported: true };
  }
  if (ocrPage !== undefined)
    return { ...await extractScannedOffice(file.bytes, kind, ocrPage), supported: true };
  const office = await extractOffice(file.bytes, kind);
  // Rendered slide numbers match native slide numbers. Word paragraphs and Excel rows are not printed pages.
  const selected = section !== undefined && kind === 'pptx' ? office.sections.filter(s => s.index === section) : office.sections;
  if ((section === undefined || kind === 'pptx') && (!section || selected.length > 0) &&
      selected.every(s => !s.text.trim() && !s.notes?.trim())) {
    try {
      const scan = await extractScannedOffice(file.bytes, kind, section);
      if (scan.sections.some(s => s.text.trim())) {
        return { ...scan, supported: true, sections: scan.sections.map(s => ({ ...s,
          ...(kind === 'pptx' && { images: office.sections.find(page => page.index === s.index)?.images }) })) };
      }
      return { ...office, supported: true, complete: false, warnings: [...office.warnings, ...scan.warnings, 'OCR found no readable text.'] };
    } catch (error) {
      return { ...office, supported: true, complete: false, warnings: [...office.warnings, safeError(error).message] };
    }
  }
  return { ...office, supported: true };
}

function sectionText(section: Section): string {
  return section.text + (section.notes ? '\nSpeaker notes\n' + section.notes : '');
}

export async function readMaterial(file: MaterialFile, offset = 0, maxChars = 16000, section?: number, ocrPage?: number): Promise<JsonRecord> {
  const extracted = await extractMaterial(file, section, ocrPage);
  const sections = extracted.sections.filter(s => section === undefined || s.index === section);
  if (section !== undefined && !sections.length && extracted.supported)
    throw new AppError('SECTION_UNAVAILABLE', 'The requested section was absent or outside the extraction limit.');
  // Keep one canonical character stream for paging. Only include metadata for visible sections.
  const parts: string[] = [], visible: JsonRecord[] = [];
  let length = 0, visibleCount = 0;
  for (const s of sections) {
    const part = (parts.length ? '\n\n' : '') + (s.locator === 'Text' ? '' : '[' + s.locator + ']\n') + sectionText(s);
    if (length < offset + maxChars && length + part.length > offset) {
      visibleCount++;
      if (visible.length < 200) visible.push({ section: s.index, locator: s.locator, startOffset: length, ocr: s.ocr,
        hasNotes: Boolean(s.notes), images: s.images?.slice(0, 30), ...(s.images && { imageCount: s.images.length }) });
    }
    parts.push(part);
    length += part.length;
  }
  const {bytes: _, ...source} = file;
  return { ...source, supported: extracted.supported, complete: extracted.complete, warnings: extracted.warnings,
    text: parts.join('').slice(offset, offset + maxChars), totalChars: length, offset, nextOffset: offset + maxChars < length ? offset + maxChars : null,
    sections: visible, sectionsTruncated: visibleCount > visible.length, sectionCount: extracted.pageCount ?? extracted.sections.length,
    untrustedCourseContent: true };
}

export function validateRef(ref: MaterialRef): void {
  const parents = [ref.topicId, ref.folderId, ref.newsItemId].filter(x => x !== undefined);
  if (parents.length !== 1 || Boolean(ref.topicId) === Boolean(ref.fileId))
    throw new AppError('INVALID_ARGUMENT', 'Supply a topicId alone, or a folderId/newsItemId with a fileId from its attachment list.');
}

export async function getFile(service: SchoolService, ref: MaterialRef): Promise<MaterialFile> {
  validateRef(ref);
  if (ref.topicId) {
    const result = await service.topicSource(ref.courseId, ref.topicId);
    if ('reference' in result) throw new AppError('NOT_A_FILE', 'This visible topic is an external or interactive reference.');
    return result.file;
  }
  if (ref.folderId) return service.assignmentAttachment(ref.courseId, ref.folderId, ref.fileId!);
  return service.announcementAttachment(ref.courseId, ref.newsItemId!, ref.fileId!);
}

// Use a class so school-controlled JSON fields can never become MCP image blocks.
export class MaterialImage {
  constructor(public meta: JsonRecord, public mimeType: string, public data: string) {}
}
export async function viewMaterial(file: MaterialFile, page: number, image?: number): Promise<MaterialImage> {
  const kind = format(file);
  if ((kind !== 'pptx' && kind !== 'pdf') || (image !== undefined && kind !== 'pptx'))
    throw new AppError('UNSUPPORTED_FORMAT', 'Page images support PDF and PowerPoint. Embedded image numbers apply to PowerPoint only.');
  const visual = image === undefined
    ? { mimeType: 'image/png', data: (await renderPage(file.bytes, kind, page)).toString('base64') }
    : await readSlideImage(file.bytes, page, image);
  return new MaterialImage({ title: file.title, sourceUrl: file.sourceUrl, fetchedAt: file.fetchedAt, page, image,
    locator: (kind === 'pdf' ? 'Page ' : 'Slide ') + page, untrustedCourseContent: true }, visual.mimeType, visual.data);
}

export type FileEntry = { key: string; title: string; sourceUrl: string; ref: MaterialRef };
export function filesInItems(courseId: string, kind: string, items: Item[]): FileEntry[] {
  const files: FileEntry[] = [];
  for (const item of items) {
    if (kind === 'content') {
      if (item.kind === 'topic' && !item.sequenceLocked && (item.topicType == null || item.topicType === 1 || item.topicType === 'File')) {
        files.push({ key: 'topic:' + item.itemId, title: item.title, sourceUrl: item.sourceUrl, ref: { courseId, topicId: String(item.itemId) } });
      }
    } else if (kind === 'assignments' || kind === 'announcements') {
      for (const attachment of array(item.attachments)) {
        const a = record(attachment), fileId = id(a.FileId);
        if (!fileId) continue;
        files.push({ key: [kind,item.id,fileId].join(':'), title: text(a.FileName) || item.title, sourceUrl: item.sourceUrl,
          ref: { courseId, ...(kind === 'assignments' ? { folderId: item.id } : { newsItemId: item.id }), fileId } });
      }
    }
  }
  return files;
}

export function fileBatch(files: FileEntry[], offset: number, limit: number) {
  const unique = [...new Map(files.map(file => [file.key, file])).values()].sort((a,b) => a.key.localeCompare(b.key, 'en'));
  return { batch: unique.slice(offset, offset + limit), totalFiles: unique.length,
    nextFileOffset: offset + limit < unique.length ? offset + limit : null };
}
