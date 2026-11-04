"""Bounded OOXML reader. The only document input is stdin; never open relationship targets on disk."""
import base64
import io
import json
import posixpath
import re
import struct
import sys
import xml.etree.ElementTree as ET
import zipfile
from urllib.parse import unquote

MIB = 1024 * 1024
# Use local element names so transitional and strict OOXML namespaces are both supported.
def tag(node):
    return node.tag.rsplit('}', 1)[-1]


def children(node, name):
    return [item for item in node if tag(item) == name]


def descendants(node, name):
    return (item for item in node.iter() if tag(item) == name)


def first(node, name):
    return next(descendants(node, name), None)


def rel_id(node, key='id'):
    return next((val for attr, val in node.attrib.items() if attr.endswith('relationships}' + key)), '')


def paragraph(node):
    pieces = []
    for item in node.iter():
        name = tag(item)
        if name == 't':
            pieces.append(item.text or '')
        elif name in ('br', 'cr'):
            pieces.append('\n')
        elif name == 'tab':
            pieces.append('\t')
    return ''.join(pieces).strip()


def paragraphs(node):
    return '\n'.join(filter(None, (paragraph(p) for p in descendants(node, 'p'))))


def check_zip_directory(data):
    # ZipFile creates a Python object for each central-directory entry before infolist()
    # returns. Check its real record count before that allocation, including dishonest ZIPs.
    end = data.rfind(b'PK\x05\x06', max(0, len(data) - 65557))
    if end < 0 or end + 22 > len(data):
        raise ValueError()
    disk, start_disk, here, entries, size, offset, comment = struct.unpack_from('<4H2IH', data, end + 4)
    if (disk or start_disk or here != entries or entries > 10000 or size > 8 * MIB
            or offset + size != end or end + 22 + comment != len(data)):
        raise ValueError()
    for _ in range(entries):
        if data[offset:offset+4] != b'PK\x01\x02' or offset + 46 > end:
            raise ValueError()
        name_len, extra_len, comment_len = struct.unpack_from('<3H', data, offset + 28)
        offset += 46 + name_len + extra_len + comment_len
    if offset != end:
        raise ValueError()


class Package:
    def __init__(self, data):
        check_zip_directory(data)
        self.archive = zipfile.ZipFile(io.BytesIO(data))
        infos = self.archive.infolist()
        if len(infos) > 10000 or sum(item.file_size for item in infos) > 160 * MIB:
            raise ValueError()
        self.names = set()
        for item in infos:
            path = item.filename.rstrip('/')
            if (not path or path in self.names or '\0' in item.orig_filename or item.flag_bits & 1 or
                    path.startswith('/') or '\\' in path or
                    any(p in ('', '.', '..') for p in path.split('/')) or
                    item.file_size > 48 * MIB or item.file_size > max(1, item.compress_size) * 2000 or
                    item.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
                raise ValueError()
            self.names.add(path)
        self.xml_bytes = 0

    def xml(self, name):
        if self.archive.getinfo(name).file_size > 12 * MIB:
            raise ValueError()
        data = self.archive.read(name)
        self.xml_bytes += len(data)
        if self.xml_bytes > 72 * MIB:
            raise ValueError()
        encoding = 'utf-16' if data.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig'
        text = data.decode(encoding)
        if '\0' in text or text.count('<') > 600000 or re.search(r'<!\s*(DOCTYPE|ENTITY)', text, re.I):
            raise ValueError()
        root = ET.fromstring(text)
        if sum(1 for _ in root.iter()) > 350000:
            raise ValueError()
        return root

    def relationships(self, part):
        folder, name = posixpath.split(part)
        path = posixpath.join(folder, '_rels', name + '.rels')
        if path not in self.names:
            return {}
        rels = {}
        ids = set()
        for rel in self.xml(path):
            if tag(rel) != 'Relationship':
                continue
            key = rel.get('Id')
            if not key or key in ids:
                raise ValueError()
            ids.add(key)
            if rel.get('TargetMode', 'Internal') != 'Internal':
                continue
            raw = rel.get('Target', '')
            target = unquote(raw)
            if (not raw or '#' in raw or '?' in raw or re.search(r'[\\:\x00-\x1f]', target)
                    or target.startswith('//')):
                continue
            # Some writers store URI-escaped part names literally; others store actual spaces.
            # Resolve only existing members inside this package and reject ambiguous targets.
            paths = set()
            for value in (raw, target):
                full = posixpath.normpath(value.lstrip('/') if value.startswith('/') else posixpath.join(folder, value))
                if not full.startswith('../') and full in self.names:
                    paths.add(full)
            if len(paths) > 1:
                raise ValueError()
            if paths:
                rels[key] = (rel.get('Type', '').rsplit('/', 1)[-1], paths.pop())
        return rels

    def main_part(self, default):
        if '_rels/.rels' not in self.names:
            return default
        parts = [target for kind, target in self.relationships('').values() if kind == 'officeDocument']
        if len(parts) != 1:
            raise ValueError()
        return parts[0]


class Result:
    def __init__(self):
        self.sections = []
        self.warnings = []
        self.complete = True
        self.chars = 0

    def warn(self, message):
        if message not in self.warnings:
            self.warnings.append(message)

    def truncate(self):
        self.complete = False
        self.warn('The local Office reader reached its text, image or section limit.')

    def add(self, locator, text, notes=None, images=None):
        if len(self.sections) >= 10000 or self.chars >= 1000000:
            self.truncate()
            return False
        section = {'index': len(self.sections) + 1, 'locator': locator[:240]}
        for key, value in [('text', text), ('notes', notes)]:
            if value is None:
                continue
            available = min(80000, 1000000 - self.chars)
            section[key] = value[:available]
            self.chars += len(section[key])
            if len(value) > available:
                self.truncate()
        if images:
            section['images'] = images[:100]
            if len(images) > 100:
                self.truncate()
            self.chars += sum(len(i['name']) + len(i['alt']) for i in section['images'])
        self.sections.append(section)
        return True

    def value(self):
        return {'sections': self.sections, 'warnings': self.warnings, 'complete': self.complete}


def ordered_parts(pkg, part, node_name, kind, result):
    rels = pkg.relationships(part)
    root = pkg.xml(part)
    if tag(root) != ('presentation' if kind == 'slide' else 'workbook'):
        raise ValueError()
    # Section/custom-show extension lists can repeat numeric slide IDs without a relationship.
    # Only the canonical sldIdLst (or sheets for Excel) declares the document's part ordering.
    container = next(iter(children(root, 'sldIdLst' if kind == 'slide' else 'sheets')), None)
    if container is None:
        raise ValueError()
    for item in children(container, node_name):
        rel = rels.get(rel_id(item))
        if rel and rel[0] == 'chartsheet' and kind == 'worksheet':
            result.warn('Chart sheets contain visuals rather than worksheet rows and were omitted.')
            result.complete = False
            continue
        if not rel or rel[0] != kind:
            raise ValueError()
        yield item, rel[1]


def image_type(name):
    return {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'}.get(posixpath.splitext(name)[1].lower())


def image_dimensions(data, mime):
    if mime == 'image/png' and data.startswith(b'\x89PNG\r\n\x1a\n') and data[12:16] == b'IHDR':
        return struct.unpack('>II', data[16:24])
    if mime == 'image/jpeg' and data.startswith(b'\xff\xd8'):
        i = 2
        while i < len(data) and data[i] == 255:
            while i < len(data) and data[i] == 255:
                i += 1
            marker = data[i]
            i += 1
            if marker in (0xda, 0xd9):
                break
            n, = struct.unpack('>H', data[i:i+2])
            if n < 2 or i + n > len(data):
                break
            if marker in (0xc0, 0xc1, 0xc2):
                height, width = struct.unpack('>HH', data[i+3:i+7])
                return width, height
            i += n
    raise ValueError()


def slide_images(slide, rels):
    for picture in descendants(slide, 'pic'):
        prop = first(picture, 'cNvPr')
        for blip in descendants(picture, 'blip'):
            rel = rels.get(rel_id(blip, 'embed'))
            if not rel or rel[0] != 'image':
                continue
            path = rel[1]
            name = prop.get('name', '') if prop is not None else ''
            alt = prop.get('descr', '') if prop is not None else ''
            yield path, {'name': (name or posixpath.basename(path))[:240], 'alt': alt[:1000], 'mimeType': image_type(path)}


def presentation(pkg, result, selection):
    for n, (_, path) in enumerate(ordered_parts(pkg, pkg.main_part('ppt/presentation.xml'), 'sldId', 'slide', result), 1):
        if selection and selection[0] != n:
            continue
        slide = pkg.xml(path)
        if tag(slide) != 'sld':
            raise ValueError()
        rels = pkg.relationships(path)
        images = []
        for index, (media, meta) in enumerate(slide_images(slide, rels), 1):
            if selection == (n, index):
                if not meta['mimeType'] or pkg.archive.getinfo(media).file_size > 3 * MIB:
                    return {'error': 'IMAGE_LIMIT'}
                data = pkg.archive.read(media)
                w, h = image_dimensions(data, meta['mimeType'])
                if not (0 < w <= 16384 and 0 < h <= 16384 and w*h <= 32_000_000):
                    return {'error': 'IMAGE_LIMIT'}
                return {'mimeType': meta['mimeType'], 'data': base64.b64encode(data).decode('ascii')}
            if index <= 100:
                images.append(dict(meta, index=index))
            else:
                result.truncate()
        if selection:
            break
        notes = []
        for kind, target in rels.values():
            if kind == 'notesSlide':
                for shape in descendants(pkg.xml(target), 'sp'):
                    placeholder = first(shape, 'ph')
                    if placeholder is None or placeholder.get('type', 'body') in ('body', 'obj'):
                        notes.append(paragraphs(shape))
        text = paragraphs(slide)
        if images and not text.strip():
            result.warn('Slides with only pictures may need OCR. Inspect the rendered slide or its embedded images.')
        if not result.add('Slide %d' % n, text, '\n'.join(filter(None, notes)), images):
            break
    return {'error': 'IMAGE_UNAVAILABLE'} if selection else result.value()


def word_document(pkg, result):
    doc = pkg.xml(pkg.main_part('word/document.xml'))
    body = first(doc, 'body')
    if tag(doc) != 'document' or body is None:
        raise ValueError()
    if first(body, 'drawing') is not None or first(body, 'pict') is not None:
        result.warn('Word images may contain additional text. Their pixels are not included in this text extraction.')
    p_index = table_index = 0
    # Traverse wrappers (including content controls) without counting table paragraphs twice.
    pending = list(reversed(list(body)))
    while pending:
        node = pending.pop()
        name = tag(node)
        if name == 'p':
            p_index += 1
            if not result.add('Paragraph %d' % p_index, paragraph(node)):
                break
        elif name == 'tbl':
            table_index += 1
            for row_index, row in enumerate(children(node, 'tr'), 1):
                cells = [paragraphs(cell) for cell in children(row, 'tc')]
                if not result.add('Table %d, row %d' % (table_index, row_index), ' | '.join(cells)):
                    return result.value()
        elif name not in ('del', 'moveFrom'):
            pending.extend(reversed(list(node)))
    return result.value()


def workbook(pkg, result):
    part = pkg.main_part('xl/workbook.xml')
    shared = []
    for kind, target in pkg.relationships(part).values():
        if kind == 'sharedStrings':
            shared = [''.join(t.text or '' for t in descendants(s, 't')) for s in children(pkg.xml(target), 'si')]
    for sheet, path in ordered_parts(pkg, part, 'sheet', 'worksheet', result):
        name = sheet.get('name', '')[:90]
        if sheet.get('state', 'visible') != 'visible':
            result.warn('Hidden worksheets were omitted.')
            result.complete = False
            continue
        root = pkg.xml(path)
        if tag(root) != 'worksheet':
            raise ValueError()
        if first(root, 'drawing') is not None:
            result.warn('Worksheet drawings and images may contain additional text; use the source workbook to inspect them.')
        for n, row in enumerate(descendants(root, 'row'), 1):
            cells = []
            row_chars = 0
            for cell in children(row, 'c'):
                addr = cell.get('r', '?')[:16]
                val = next(iter(children(cell, 'v')), None)
                value = val.text or '' if val is not None else ''
                cell_type = cell.get('t', 'n')
                if cell_type == 's':
                    idx = int(value)
                    if idx < 0 or idx >= len(shared):
                        raise ValueError()
                    value = shared[idx]
                elif cell_type == 'inlineStr':
                    value = ''.join(item.text or '' for item in descendants(cell, 't'))
                elif cell_type == 'b':
                    value = {'1': 'TRUE', '0': 'FALSE'}.get(value, value)
                formula = next(iter(children(cell, 'f')), None)
                if formula is not None and formula.text:
                    value = '=' + formula.text + (' [cached: ' + value + ']' if value else '')
                if value:
                    remaining = 80000 - row_chars
                    if remaining <= 0:
                        result.truncate()
                        break
                    chunk = addr + ': ' + value[:remaining]
                    cells.append(chunk)
                    row_chars += len(chunk) + 1
                    if len(value) > remaining:
                        result.truncate()
                        break
            if cells and not result.add('Sheet %s, row %s' % (name, row.get('r', str(n))[:10]), '\t'.join(cells)):
                return result.value()
    result.warn('Spreadsheet cells contain stored values and formula text; numeric display formats are not applied.')
    return result.value()


def main():
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (9, 10))
        if sys.platform.startswith('linux'):
            resource.setrlimit(resource.RLIMIT_AS, (384 * MIB, 384 * MIB))
    except (ImportError, ValueError, OSError):
        pass
    data = sys.stdin.buffer.read(32 * MIB + 1)
    if len(data) > 32 * MIB:
        raise ValueError()
    pkg = Package(data)
    result = Result()
    kind = sys.argv[1]
    if kind == 'pptx':
        output = presentation(pkg, result, tuple(map(int, sys.argv[2:])))
    elif kind == 'docx':
        output = word_document(pkg, result)
    elif kind == 'xlsx':
        output = workbook(pkg, result)
    else:
        raise ValueError()
    sys.stdout.buffer.write(json.dumps(output, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        sys.exit(1)
