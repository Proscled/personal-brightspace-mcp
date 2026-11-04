import { fileBatch, filesInItems, getFile } from './materials.js';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { AppError, record, safeError } from './types.js';
import { readPrivateJson, withLock, writePrivateJson } from './storage.js';
export function canonical(value) {
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object')
        return `{${Object.entries(value).filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
    return JSON.stringify(value) ?? 'null';
}
export function diffItems(previous, current) {
    const before = new Map(previous.map(x => [x.id, x])), after = new Map(current.map(x => [x.id, x]));
    const changes = [];
    for (const [id, item] of after) {
        const old = before.get(id);
        if (!old)
            changes.push({ type: 'added', id, title: item.title, sourceUrl: item.sourceUrl });
        else if (canonical(old) !== canonical(item)) {
            const fields = [...new Set([...Object.keys(old), ...Object.keys(item)])].filter(key => canonical(old[key]) !== canonical(item[key]));
            changes.push({ type: 'changed', id, title: item.title, sourceUrl: item.sourceUrl, fields,
                datesBefore: { dueDate: old.dueDate ?? null, startDate: old.startDate ?? null, endDate: old.endDate ?? null },
                datesAfter: { dueDate: item.dueDate ?? null, startDate: item.startDate ?? null, endDate: item.endDate ?? null } });
        }
    }
    for (const [id, item] of before)
        if (!after.has(id))
            changes.push({ type: 'no_longer_visible', id, title: item.title,
                sourceUrl: item.sourceUrl, note: 'Not returned now; this does not prove deletion or completion.' });
    return changes;
}
export class ChangeTracker {
    service;
    constructor(service) {
        this.service = service;
    }
    async check(courseIds, validateReport, scan) {
        if (scan && courseIds?.length !== 1)
            throw new AppError('INVALID_ARGUMENT', 'File checks require one course ID at a time. Use nextFileOffset to continue.');
        const who = await this.service.whoami();
        const courses = await this.service.selectedCourses(courseIds);
        const records = [];
        for (const course of courses.items) {
            for (const [kind, fn] of [
                ['assignments', () => this.service.assignments(course.id)], ['announcements', () => this.service.announcements(course.id)],
                ['content', () => this.service.content(course.id)], ['quizzes', () => this.service.quizzes(course.id)]
            ]) {
                try {
                    records.push({ courseId: course.id, kind, data: await fn() });
                }
                catch (error) {
                    records.push({ courseId: course.id, kind, error });
                }
            }
        }
        let fileCoverage;
        if (scan && courses.items.length) {
            const courseId = courses.items[0].id;
            const files = [];
            for (const row of records)
                if (row.data)
                    files.push(...filesInItems(courseId, row.kind, row.data.items));
            const { batch, totalFiles, nextFileOffset } = fileBatch(files, scan.offset, scan.limit);
            fileCoverage = { fileOffset: scan.offset, totalFiles, nextFileOffset, checked: batch.length };
            // Each file has its own baseline. Paging or a denied file cannot erase another file's hash.
            for (const entry of batch) {
                const kind = 'file:' + entry.key;
                try {
                    const file = await getFile(this.service, entry.ref);
                    const sha256 = createHash('sha256').update(file.bytes).digest('hex');
                    records.push({ courseId, kind, data: { complete: true, warnings: [], fetchedAt: file.fetchedAt, sourceUrl: file.sourceUrl,
                            items: [{ id: entry.key, courseId, title: entry.title, sourceUrl: file.sourceUrl, sha256 }] } });
                }
                catch (error) {
                    records.push({ courseId, kind, error });
                }
            }
        }
        const dir = join(this.service.config.dataDir, 'snapshots');
        return withLock(dir, async () => {
            const results = [];
            const baselines = [];
            for (const row of records) {
                if (!row.data?.complete) {
                    results.push({ courseId: row.courseId, kind: row.kind, status: 'incomplete', baselinePreserved: true,
                        error: row.error ? safeError(row.error) : null, warnings: row.data?.warnings ?? [] });
                    continue;
                }
                const namespace = `${this.service.config.baseUrl}|${who.identifier}|${row.courseId}|${row.kind}`;
                const key = createHash('sha256').update(namespace).digest('hex');
                const path = join(dir, `${key}.json`);
                const previous = record(await readPrivateJson(path));
                if (typeof previous.fetchedAt === 'string' && previous.fetchedAt > row.data.fetchedAt) {
                    results.push({ courseId: row.courseId, kind: row.kind, status: 'newer_baseline_exists', baselinePreserved: true });
                    continue;
                }
                const old = Array.isArray(previous.items) ? previous.items : null;
                const changes = old ? diffItems(old, row.data.items) : [];
                baselines.push({ path, value: { format: 1, origin: this.service.config.baseUrl, accountId: who.identifier,
                        courseId: row.courseId, kind: row.kind, fetchedAt: row.data.fetchedAt, items: row.data.items } });
                results.push({ courseId: row.courseId, kind: row.kind, status: old ? 'compared' : 'baseline_created',
                    previousCheck: previous.fetchedAt ?? null, checkedAt: row.data.fetchedAt,
                    changes, totalChanges: changes.length, changesTruncated: false });
            }
            const report = { checkedAt: new Date().toISOString(), complete: courses.complete && (!fileCoverage || (fileCoverage.fileOffset === 0 && fileCoverage.nextFileOffset === null)) && results.every(x => x.status !== 'incomplete'),
                results, fileCoverage, warnings: courses.warnings, persistence: 'Private local files only; no Brightspace writes.',
                monitoring: 'Runs only when called. It does not schedule itself, send notifications or monitor in the background.' };
            // An oversized tool response must leave the old baselines available for a narrower retry.
            validateReport?.(report);
            for (const baseline of baselines)
                await writePrivateJson(baseline.path, baseline.value);
            return report;
        });
    }
}
//# sourceMappingURL=changes.js.map