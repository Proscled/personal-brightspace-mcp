"""Preflight Office archives, then exec a sandboxed native reader with resource limits."""
import os
import pathlib
import posixpath
import re
import resource
import sys
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from office_reader import Package, tag  # Bundled sibling, never a document-provided module.


def sanitize_office(source, output, kind):
    expected = {'pptx': 'ppt/presentation.xml', 'xlsx': 'xl/workbook.xml', 'docx': 'word/document.xml'}[kind]
    package = Package(source.read_bytes())
    if expected not in package.names:
        raise ValueError()
    with package.archive, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as clean:
        for item in package.archive.infolist():
            name = item.filename
            if item.is_dir():
                continue
            lower = name.lower()
            if 'vbaproject' in lower or '/activex/' in lower or lower.startswith('scripts/'):
                raise ValueError()
            data = package.archive.read(item)
            if lower.endswith(('.xml', '.rels', '.svg', '.vml')):
                root = package.xml(name)
                if lower.endswith('.rels'):
                    # Retain internal parts only. Hyperlinks remain visible as text/shapes.
                    owner_dir = posixpath.dirname(posixpath.dirname(name))
                    original_count = len(root)
                    for rel in list(root):
                        target = urllib.parse.unquote(rel.get('Target', ''))
                        path = posixpath.normpath(target.lstrip('/') if target.startswith('/') else posixpath.join(owner_dir, target))
                        if (rel.get('TargetMode', 'Internal') != 'Internal' or target.startswith('//') or
                                re.search(r'[\\:#?\x00-\x1f]', target) or path not in package.names):
                            root.remove(rel)
                    if len(root) != original_count:
                        ET.register_namespace('', 'http://schemas.openxmlformats.org/package/2006/relationships')
                        data = ET.tostring(root, encoding='utf-8', xml_declaration=True)
                elif lower == '[content_types].xml':
                    if any('macroenabled' in node.get('ContentType', '').lower() for node in root):
                        raise ValueError()
                elif lower.endswith(('.svg', '.vml')):
                    # Linked content, scripts and embedded HTML in vector images cannot be rendered here.
                    for node in root.iter():
                        if tag(node).lower() in ('script', 'foreignobject'):
                            raise ValueError()
                        for attr, value in node.attrib.items():
                            if attr.rsplit('}', 1)[-1].lower() in ('href', 'src') and not value.lower().startswith(('#', 'data:image/png;', 'data:image/jpeg;')):
                                raise ValueError()
                        css = ' '.join([node.text or '', *node.attrib.values()])
                        references = re.findall(r'url\(\s*([^)]*)\)', css, re.I)
                        if '@import' in css.lower() or any(not ref.strip().strip("'\"").startswith('#') for ref in references):
                            raise ValueError()
            clean.writestr(name, data)


def main():
    mode, kind, work_arg, app_arg, page, ocr = sys.argv[1:]
    work = pathlib.Path(work_arg).resolve()
    profile = HERE / 'visual.sb'
    helper = HERE / 'pdf_worker.js'
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CPU, (45, 50))
    resource.setrlimit(resource.RLIMIT_FSIZE, (96 * 1024**2, 96 * 1024**2))
    if mode == 'convert':
        source = work / ('original.' + kind)
        target = work / ('material.' + kind)
        sanitize_office(source, target, kind)
        app = pathlib.Path(app_arg)
        exe = str(app / 'Contents/MacOS/soffice')
        # Disable macros and external link updates in the disposable profile as well as sandboxing the process.
        user = work / 'profile/user'
        user.mkdir(parents=True)
        (user / 'registrymodifications.xcu').write_text(
            '<oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting">'
            '<prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>'
            '<prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item></oor:items>')
        export_filter = {'pptx': 'impress_pdf_Export', 'docx': 'writer_pdf_Export', 'xlsx': 'calc_pdf_Export'}[kind]
        options = ':{"ExportHiddenSlides":{"type":"boolean","value":"true"}}' if kind == 'pptx' else ''
        args = ['-env:UserInstallation=' + user.parent.as_uri(), '--headless', '--nologo', '--nodefault',
                '--norestore', '--convert-to', 'pdf:' + export_filter + options, '--outdir', str(work), str(target)]
    else:
        exe = '/usr/bin/osascript'
        app = pathlib.Path('/usr/bin')
        args = ['-l', 'JavaScript', str(helper), str(work / 'material.pdf'), mode, page, ocr, str(work / 'page.png'),
                'Slide' if kind == 'pptx' else 'Page']
    program = '/usr/bin/sandbox-exec'
    os.execv(program, [program, '-D', 'WORK=' + str(work), '-D', 'APP=' + str(app), '-D', 'EXE=' + exe,
                       '-D', 'HELPER=' + str(helper), '-f', str(profile), exe, *args])


if __name__ == '__main__':
    try:
        main()
    except Exception:
        sys.exit(1)
