import { htmlToText, richText } from './security.js';
import { array, id, record, text, type JsonRecord } from './types.js';

export interface InstructionLink { label: string; url: string }

function link(label: string, href: unknown, base: string): InstructionLink | null {
  if (typeof href !== 'string' || !href.trim() || href.length > 8192 || /[\u0000-\u001f\\]/.test(href)) return null;
  let url: URL;
  try { url = new URL(href, base); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
  const secret = /^(?:access_token|id_token|refresh_token|authorization|password|signature|x-amz-signature|sig)$/i;
  if ([...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()].some(key => secret.test(key))) return null;
  return { label: label.trim() || url.href, url: url.href };
}

// Web destinations are references only. The file reader accepts IDs from API metadata.
export function assignmentLinks(instructions: unknown, attachments: unknown, base: string) {
  const html = typeof instructions === 'string' ? instructions : text(record(instructions).Html) ?? '';
  const maxHtml = 256000;
  const input = html.slice(0, maxHtml).replace(/<!--[\s\S]*?(?:-->|$)|<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
  const links: InstructionLink[] = [], seen = new Set<string>();
  let truncated = html.length > maxHtml;
  function add(item: InstructionLink | null) {
    if (!item) return;
    const key = JSON.stringify([item.label, item.url]);
    if (seen.has(key)) return;
    if (links.length >= 200) { truncated = true; return; }
    links.push(item); seen.add(key);
  }
  let anchor: { start: number; href: string; title: string } | undefined;
  for (const m of input.matchAll(/<\/?a(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
    if (anchor) {
      const label = htmlToText(input.slice(anchor.start, m.index)) || anchor.title;
      add(link(label, anchor.href, base));
      anchor = undefined;
    }
    if (m[0].startsWith('</')) continue;
    let href = '', title = '';
    const attributes = m[0].slice(2, -1);
    for (const a of attributes.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>\x60]+)))?/g)) {
      const value = a[2] ?? a[3] ?? a[4] ?? '';
      if (a[1]?.toLowerCase() === 'href' && !href) href = htmlToText(value);
      if (a[1]?.toLowerCase() === 'title') title = htmlToText(value);
    }
    anchor = { start: m.index + m[0].length, href, title };
  }
  if (anchor) add(link(htmlToText(input.slice(anchor.start)), anchor.href, base));
  for (const value of array(attachments)) {
    const attachment = record(value);
    add(link(text(attachment.LinkName) ?? '', attachment.Href, base));
  }
  return { instructionLinks: links, instructionLinksTruncated: truncated };
}

export function visibleRubrics(values: unknown, sourceUrl: string) {
  const version = /\/d2l\/api\/le\/1\.(\d+)\//.exec(sourceUrl);
  const legacyVisibility = version !== null && Number(version[1]) < 93;
  const rubrics: JsonRecord[] = [];
  let rubricsWithheld = false;
  for (const value of array(values)) {
    const r = record(value);
    // Visibility was added in LE 1.93. Older APIs can still return definitions to their allowed callers.
    const visible = r.Visibility === 0 || (legacyVisibility && r.Visibility === undefined);
    if (!visible || (r.RubricStateId !== 0 && r.RubricStateId !== 1)) {
      rubricsWithheld = true; continue;
    }
    const points = (n: unknown) => r.IsScoreVisibleToAssessedUsers === true && typeof n === 'number' && Number.isFinite(n) ? n : null;
    // Preserve the Brightspace field layout used by existing assignment listings.
    rubrics.push({ RubricId: r.RubricId, Name: text(r.Name), Description: r.Description,
      RubricType: r.RubricType, RubricStateId: r.RubricStateId, Visibility: r.Visibility,
      ScoringMethod: r.ScoringMethod, IsScoreVisibleToAssessedUsers: r.IsScoreVisibleToAssessedUsers === true,
      ReverseLevelDisplayOrder: r.ReverseLevelDisplayOrder,
      CriteriaGroups: Array.isArray(r.CriteriaGroups) ? r.CriteriaGroups.map(value => {
        const group = record(value);
        return { Name: group.Name, Levels: array(group.Levels).map(value => {
          const l = record(value); return { Id: l.Id, Name: l.Name, Points: points(l.Points) };
        }), Criteria: array(group.Criteria).map(value => {
          const c = record(value); return { Id: c.Id, Name: c.Name, Cells: array(c.Cells).map(value => {
            const cell = record(value); return { Description: cell.Description, Feedback: cell.Feedback, Points: points(cell.Points) };
          }) };
        }) };
      }) : undefined,
      OverallLevels: Array.isArray(r.OverallLevels) ? r.OverallLevels.map(value => {
        const l = record(value); return { Id: l.Id, Name: l.Name, Description: l.Description, Feedback: l.Feedback, RangeStart: points(l.RangeStart) };
      }) : undefined });
  }
  return { rubrics, rubricsWithheld };
}

export function rubricItem(r: JsonRecord, courseId: string, folderId: string, sourceUrl: string) {
  const rubricId = id(r.RubricId);
  if (!rubricId) return null;
  return { id: rubricId, courseId, folderId, title: text(r.Name) ?? '(untitled rubric)', sourceUrl,
    description: richText(r.Description), scoringMethod: r.ScoringMethod ?? null,
    scoresVisible: r.IsScoreVisibleToAssessedUsers === true, reverseLevelDisplayOrder: r.ReverseLevelDisplayOrder ?? null,
    criteriaGroups: array(r.CriteriaGroups).map(value => {
      const group = record(value);
      const levels = array(group.Levels).map(value => {
        const l = record(value); return { id: id(l.Id), name: text(l.Name), points: l.Points ?? null };
      });
      return { name: text(group.Name), levels, criteria: array(group.Criteria).map(value => {
        const c = record(value);
        return { id: id(c.Id), name: text(c.Name), cells: array(c.Cells).map((value, index) => {
          const cell = record(value);
          return { levelId: levels[index]?.id ?? null, description: richText(cell.Description),
            feedback: richText(cell.Feedback), points: cell.Points ?? null };
        }) };
      }) };
    }),
    overallLevels: array(r.OverallLevels).map(value => {
      const level = record(value); return { id: id(level.Id), name: text(level.Name), rangeStart: level.RangeStart ?? null,
        description: richText(level.Description), feedback: richText(level.Feedback) };
    }) };
}
