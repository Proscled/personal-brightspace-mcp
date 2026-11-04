import { assignmentLinks, rubricItem, visibleRubrics } from './assignmentSources.js';
import { extractMaterial, fileBatch, filesInItems, getFile, readMaterial } from './materials.js';
import { AppError, array, id, record, requireId, safeError, text } from './types.js';
import { richText } from './security.js';
import { dateInRange, describeDate, localDay } from './dates.js';
const limitText = (value, length = 40000) => richText(value).slice(0, length);
const finiteOrNull = (v) => typeof v === 'number' && Number.isFinite(v) ? v : null;
function ownReceiptStatus(data) {
    if (!Array.isArray(data))
        throw new AppError('API_SHAPE', 'Expected an array of submission records.');
    let personal = false, group = false;
    for (const entry of data) {
        const { Entity, Submissions } = record(entry);
        const kind = record(Entity).EntityType;
        if ((kind !== 'User' && kind !== 'Group') || !Array.isArray(Submissions) || Submissions.some(s => !id(record(s).Id)))
            throw new AppError('API_SHAPE', 'A submission record had an unrecognized format.');
        if (Submissions.length && kind === 'User')
            personal = true;
        if (Submissions.length && kind === 'Group')
            group = true;
    }
    if (personal)
        return 'receipt_found';
    return group ? 'group_receipt_found' : 'no_personal_receipt_found';
}
export function flattenContent(input, courseId, origin) {
    const root = record(input);
    if (!Array.isArray(root.Modules))
        throw new AppError('API_SHAPE', 'Course content did not contain a Modules array.');
    const items = [], warnings = [];
    const seen = new Set();
    let complete = true;
    function visit(value, parents, depth, isModule, parentLocked = false) {
        if (depth > 30 || items.length >= 10000) {
            complete = false;
            return;
        }
        const r = record(value);
        if (r.IsHidden === true || r.IsVisible === false)
            return;
        const itemId = id(isModule ? r.ModuleId ?? r.Id : r.TopicId ?? r.Identifier ?? r.Id);
        if (!itemId) {
            complete = false;
            warnings.push('A content item had no recognizable ID.');
            return;
        }
        const key = `${isModule ? 'module' : 'topic'}:${itemId}`;
        if (seen.has(key))
            return;
        seen.add(key);
        const title = text(r.Title) ?? '(untitled)';
        const sequenceLocked = parentLocked || r.IsLocked === true;
        items.push({ id: key, itemId, title, courseId, kind: isModule ? 'module' : 'topic',
            path: parents, description: limitText(r.Description),
            dueDate: r.DueDate ?? null, startDate: r.StartDateTime ?? r.StartDate ?? null, endDate: r.EndDateTime ?? r.EndDate ?? null,
            ...(sequenceLocked && { sequenceLocked: true }),
            // Links are references, not instructions or automatic fetch targets.
            linkedUrl: text(r.Url), topicType: r.TopicType ?? r.TypeIdentifier ?? r.Type ?? null,
            sourceUrl: isModule ? `${origin}/d2l/le/content/${courseId}/Home?itemIdentifier=D2L.LE.Content.ContentObject.ModuleCO-${itemId}`
                : `${origin}/d2l/le/content/${courseId}/viewContent/${itemId}/View` });
        if (isModule) {
            for (const child of array(r.Modules))
                visit(child, [...parents, title], depth + 1, true, sequenceLocked);
            for (const child of array(r.Topics))
                visit(child, [...parents, title], depth + 1, false, sequenceLocked);
        }
    }
    for (const mod of root.Modules)
        visit(mod, [], 0, true);
    if (!complete)
        warnings.push('Content traversal was incomplete; do not treat this as all course material.');
    return { items, complete, warnings };
}
export { extractText } from './materials.js';
export class SchoolService {
    client;
    constructor(client) {
        this.client = client;
    }
    get config() { return this.client.config; }
    async whoami() {
        const r = record(await this.client.json(await this.client.path('lp', 'users/whoami')));
        const identifier = id(r.Identifier);
        if (!identifier)
            throw new AppError('API_SHAPE', 'The API did not return a recognizable identity.');
        return { identifier, name: [r.FirstName, r.LastName].filter(x => typeof x === 'string').join(' '),
            verifiedAt: new Date().toISOString() };
    }
    async coursePath(courseId, suffix) {
        requireId(courseId, 'Course ID');
        if (this.config.includeCourseIds.length && !this.config.includeCourseIds.includes(courseId))
            throw new AppError('COURSE_FILTER', 'This course is excluded by includeCourseIds in your local config.');
        return this.client.path('le', `${courseId}/${suffix}`);
    }
    async courses() {
        const url = new URL(await this.client.path('lp', 'enrollments/myenrollments/'), this.config.baseUrl);
        url.searchParams.set('orgUnitTypeId', '3');
        url.searchParams.set('canAccess', 'true');
        if (this.config.activeOnly)
            url.searchParams.set('isActive', 'true');
        const raw = await this.client.collection(url.href);
        const items = [];
        const warnings = [...raw.warnings];
        let complete = raw.complete;
        for (const item of raw.items) {
            const r = record(item), ou = record(r.OrgUnit), access = record(r.Access);
            const courseId = id(ou.Id);
            if (!courseId) {
                complete = false;
                warnings.push('An enrollment had no recognizable course ID.');
                continue;
            }
            if (access.CanAccess === false)
                continue;
            const active = access.IsActive ?? ou.IsActive;
            if (this.config.activeOnly && active === false)
                continue;
            if (this.config.includeCourseIds.length && !this.config.includeCourseIds.includes(courseId))
                continue;
            items.push({ id: courseId, name: text(ou.Name) ?? '(unnamed course)', code: text(ou.Code),
                active: typeof active === 'boolean' ? active : null,
                startDate: access.StartDate ?? ou.StartDate ?? null, endDate: access.EndDate ?? ou.EndDate ?? null,
                sourceUrl: `${this.config.baseUrl}/d2l/home/${courseId}` });
        }
        if (items.length > this.config.maxCourses) {
            complete = false;
            warnings.push(`Only the first ${this.config.maxCourses} courses are returned; narrow includeCourseIds or increase maxCourses.`);
        }
        return { ...raw, items: items.slice(0, this.config.maxCourses), complete, warnings };
    }
    async mapItems(courseId, route, convert) {
        const raw = await this.client.collection(await this.coursePath(courseId, route));
        const items = [], warnings = [...raw.warnings];
        let complete = raw.complete;
        for (const item of raw.items) {
            const r = record(item);
            if (r.IsHidden === true || r.IsPublished === false || r.IsActive === false)
                continue;
            const itemId = id(r.Id ?? r.GradeObjectIdentifier ?? r.CalendarEventId ?? r.QuizId);
            if (!itemId) {
                complete = false;
                warnings.push('A returned item lacked a recognized ID; it was not silently treated as empty.');
                continue;
            }
            items.push(convert(r, itemId, raw.sourceUrl));
        }
        return { ...raw, items, complete, warnings };
    }
    async assignments(courseId, folderId) {
        if (folderId !== undefined)
            requireId(folderId, 'Folder ID');
        const folders = await this.mapItems(courseId, 'dropbox/folders/', (r, itemId, apiSourceUrl) => ({ id: itemId, courseId,
            title: text(r.Name) ?? '(untitled assignment)', instructions: limitText(r.CustomInstructions),
            instructionsTruncated: richText(r.CustomInstructions).length > 40000,
            ...assignmentLinks(r.CustomInstructions, r.LinkAttachments, `${this.config.baseUrl}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${itemId}&ou=${courseId}`),
            dueDate: r.DueDate ?? null, startDate: record(r.Availability).StartDate ?? null,
            endDate: record(r.Availability).EndDate ?? null,
            endDateAvailabilityType: record(r.Availability).EndDateAvailabilityType ?? null,
            submissionStatus: 'unknown', submissionStatusReason: 'Folder metadata does not prove whether you submitted. Check the actual receipt.',
            attachments: array(r.Attachments), ...visibleRubrics(record(r.Assessment).Rubrics, apiSourceUrl),
            sourceUrl: `${this.config.baseUrl}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${itemId}&ou=${courseId}` }));
        if (folderId === undefined)
            return folders;
        const folder = folders.items.find(item => item.id === folderId);
        if (!folder)
            throw new AppError('UNAVAILABLE', 'The selected assignment was not found in the visible folders returned for this course.');
        const path = await this.coursePath(courseId, `dropbox/folders/${folderId}/submissions/mysubmissions/`);
        folder.receiptSourceUrl = new URL(path, this.config.baseUrl).href;
        try {
            const result = ownReceiptStatus(await this.client.json(path));
            folder.receiptCheck = result;
            if (result !== 'no_personal_receipt_found')
                folder.submissionStatus = result;
            folder.submissionStatusReason = {
                receipt_found: 'Brightspace returned a personal submission receipt. Grading and overall completion remain separate.',
                group_receipt_found: 'Brightspace returned a group receipt. The individual submitter and your personal completion are unknown.',
                no_personal_receipt_found: 'No personal receipt was found. Group work, on-paper work and other completion methods may have separate evidence.'
            }[result];
        }
        catch (error) {
            folder.receiptCheck = 'unknown';
            folder.receiptError = safeError(error);
            folder.submissionStatusReason = 'Your submission receipt could not be verified.';
            folders.complete = false;
            folders.warnings.push('The assignment was readable but the personal receipt check failed.');
        }
        folder.receiptCheckedAt = new Date().toISOString();
        return { ...folders, items: [folder] };
    }
    async assignmentRubrics(courseId, folderId) {
        requireId(folderId, 'Folder ID');
        const folders = await this.assignments(courseId);
        const folder = folders.items.find(item => item.id === folderId);
        if (!folder)
            throw new AppError('UNAVAILABLE', 'The assignment was not found in the visible course folders.');
        const source = new URL(await this.coursePath(courseId, 'rubrics/'), this.config.baseUrl);
        source.searchParams.set('objectType', 'Dropbox');
        source.searchParams.set('objectId', folderId);
        const warnings = [];
        const embedded = array(folder.rubrics).map(record);
        let definitions = embedded, complete = true, sourceUrl = source.href;
        let lookupError;
        try {
            const raw = await this.client.json(source.href);
            if (!Array.isArray(raw))
                throw new AppError('API_SHAPE', 'The assignment rubric endpoint did not return a list.');
            const linked = visibleRubrics(raw, source.href);
            const linkedIds = new Set(raw.map(r => id(record(r).RubricId)));
            definitions = [...linked.rubrics, ...embedded.filter(r => !linkedIds.has(id(r.RubricId)))];
            if (linked.rubricsWithheld || folder.rubricsWithheld) {
                complete = false;
                warnings.push('Rubrics with hidden or conditional visibility were withheld.');
            }
        }
        catch (error) {
            complete = false;
            sourceUrl = folders.sourceUrl;
            lookupError = safeError(error);
            warnings.push('The rubric lookup failed. Any returned definitions came from the visible assignment itself. Linked documents can also contain assessment criteria.');
        }
        const items = [];
        for (const r of definitions) {
            const item = rubricItem(r, courseId, folderId, folder.sourceUrl);
            if (item)
                items.push({ ...item, apiSourceUrl: embedded.includes(r) ? folders.sourceUrl : source.href });
            if (!item || !Array.isArray(r.CriteriaGroups) || !Array.isArray(r.OverallLevels)) {
                complete = false;
                warnings.push('A rubric definition was incomplete.');
            }
        }
        return { items, complete, warnings, sourceUrl, fetchedAt: new Date().toISOString(),
            lookupUrl: source.href, lookupError, folderId, assignmentUrl: folder.sourceUrl,
            instructionLinks: folder.instructionLinks, attachments: folder.attachments };
    }
    assignmentAttachment(courseId, folderId, fileId) {
        return this.attachment('assignment', courseId, folderId, fileId);
    }
    announcementAttachment(courseId, newsItemId, fileId) {
        return this.attachment('announcement', courseId, newsItemId, fileId);
    }
    async attachment(kind, courseId, parentId, fileId) {
        requireId(parentId, 'Parent ID');
        requireId(fileId, 'File ID');
        const isAssignment = kind === 'assignment';
        const collection = isAssignment ? await this.assignments(courseId) : await this.announcements(courseId);
        const owner = collection.items.find(x => x.id === parentId);
        const file = array(owner?.attachments).map(record).find(f => id(f.FileId) === fileId);
        if (!owner || !file)
            throw new AppError('UNAVAILABLE', 'The file is not listed on the selected visible item.');
        const route = `${isAssignment ? 'dropbox/folders' : 'news'}/${parentId}/attachments/${fileId}`;
        const result = await this.client.raw(await this.coursePath(courseId, route));
        const filename = text(file.FileName) ?? `Attachment ${fileId}`;
        return { ...result, title: filename, filename };
    }
    announcements(courseId) {
        return this.mapItems(courseId, 'news/', (r, itemId) => ({ id: itemId, courseId,
            title: text(r.Title) ?? '(untitled announcement)', body: limitText(r.Body), bodyTruncated: richText(r.Body).length > 40000,
            createdAt: r.CreatedDate ?? null, modifiedAt: r.LastModifiedDate ?? null,
            startDate: r.StartDate ?? null, endDate: r.EndDate ?? null, attachments: array(r.Attachments),
            sourceUrl: `${this.config.baseUrl}/d2l/le/news/${courseId}/${itemId}/view` }));
    }
    grades(courseId) {
        return this.mapItems(courseId, 'grades/values/myGradeValues/', (r, itemId) => ({ id: itemId, courseId,
            title: text(r.GradeObjectName) ?? '(grade item)', displayedGrade: r.DisplayedGrade ?? null,
            pointsNumerator: finiteOrNull(r.PointsNumerator), pointsDenominator: finiteOrNull(r.PointsDenominator),
            weightedNumerator: finiteOrNull(r.WeightedNumerator), weightedDenominator: finiteOrNull(r.WeightedDenominator),
            gradeType: r.GradeObjectType ?? r.GradeType ?? null, comments: limitText(r.Comments),
            sourceUrl: `${this.config.baseUrl}/d2l/lms/grades/my_grades/main.d2l?ou=${courseId}`,
            caution: 'Missing grades are not zero. Brightspace may not contain official Osiris results; do not infer a final pass/fail.' }));
    }
    quizzes(courseId) {
        return this.mapItems(courseId, 'quizzes/', (r, itemId) => ({ id: itemId, courseId,
            title: text(r.Name) ?? '(untitled quiz)',
            description: record(r.Description).IsDisplayed === false ? '' : limitText(record(r.Description).Text ?? r.Description),
            dueDate: r.DueDate ?? null, startDate: r.StartDate ?? null, endDate: r.EndDate ?? null,
            sourceUrl: `${this.config.baseUrl}/d2l/lms/quizzing/user/quizzes_list.d2l?ou=${courseId}`,
            caution: 'Metadata only. No quiz attempts, questions, timed reviews or external exam systems were opened.' }));
    }
    async content(courseId) {
        const path = await this.coursePath(courseId, 'content/toc');
        const raw = await this.client.json(path);
        return { ...flattenContent(raw, courseId, this.config.baseUrl), sourceUrl: new URL(path, this.config.baseUrl).href, fetchedAt: new Date().toISOString() };
    }
    async calendar(courseId, start, end) {
        const path = await this.coursePath(courseId, 'calendar/events/myEvents/');
        const url = new URL(path, this.config.baseUrl);
        url.searchParams.set('startDateTime', start.toISOString());
        url.searchParams.set('endDateTime', end.toISOString());
        // mapItems accepts only route suffixes; use a dedicated mapping for this date-filtered page.
        const raw = await this.client.collection(url.href);
        let complete = raw.complete;
        const items = [], warnings = [...raw.warnings];
        for (const item of raw.items) {
            const r = record(item), itemId = id(r.CalendarEventId);
            if (!itemId) {
                complete = false;
                warnings.push('An event lacked CalendarEventId.');
                continue;
            }
            const allDay = r.IsAllDayEvent === true;
            const startValue = allDay && typeof r.StartDay === 'string' ? r.StartDay.slice(0, 10) : r.StartDateTime ?? null;
            items.push({ id: itemId, courseId, title: text(r.Title) ?? '(untitled event)', description: limitText(r.Description),
                startDate: startValue, endDate: allDay && typeof r.EndDay === 'string' ? r.EndDay.slice(0, 10) : r.EndDateTime ?? null,
                allDay, eventType: r.EventType ?? null, recurring: r.IsRecurring === true, location: r.LocationName ?? null,
                associatedEntity: record(r.AssociatedEntity),
                sourceUrl: `${this.config.baseUrl}/d2l/le/calendar/${courseId}` });
        }
        if (items.some(x => x.recurring))
            warnings.push('Recurring event rules are not expanded into every occurrence by this version.');
        return { ...raw, items, complete, warnings };
    }
    async topicSource(courseId, topicId) {
        requireId(topicId, 'Topic ID');
        // The default TOC applies the caller's release and date restrictions, including those on parent modules.
        const outline = await this.content(courseId);
        const entry = outline.items.find(item => item.id === `topic:${topicId}`);
        if (!entry || entry.sequenceLocked)
            throw new AppError('FORBIDDEN', 'The topic is unavailable for direct reading in your current course outline.');
        const path = await this.coursePath(courseId, `content/topics/${topicId}`);
        const topic = record(await this.client.json(path));
        if (topic.IsHidden === true || topic.IsVisible === false || topic.IsLocked === true)
            throw new AppError('FORBIDDEN', 'The topic is hidden or sequence-locked.');
        if (id(topic.Id ?? topic.TopicId) !== topicId || !text(topic.Title)?.trim() ||
            (topic.Type !== undefined && topic.Type !== 1) ||
            ['IsHidden', 'IsVisible', 'IsLocked'].some(key => topic[key] !== undefined && typeof topic[key] !== 'boolean'))
            throw new AppError('API_SHAPE', 'Brightspace did not return recognizable metadata for the requested topic.');
        const sourceUrl = `${this.config.baseUrl}/d2l/le/content/${courseId}/viewContent/${topicId}/View`;
        const metadataType = topic.TopicType === undefined ? topic.TypeIdentifier : topic.TopicType;
        // A numeric TOC Type alone may just mean "topic". Use only a literal File entry as fallback.
        const isFile = metadataType === 1 || metadataType === 'File' ||
            (metadataType === undefined && entry.topicType === 'File' && topic.Type === 1 &&
                topic.IsHidden === false && topic.IsLocked === false);
        const outlineAllowsFile = entry.topicType == null || entry.topicType === 1 || entry.topicType === 'File';
        if (!isFile || !outlineAllowsFile)
            return { reference: { title: topic.Title, courseId, topicId, sourceUrl, linkedUrl: topic.Url ?? null,
                    text: limitText(topic.Description), externalOrInteractive: true,
                    warnings: ['The visible outline and topic metadata do not establish a file topic. External links, LTI, quizzes and interactive content are never opened automatically.'],
                    fetchedAt: new Date().toISOString() } };
        const file = await this.client.raw(`${path}/file`);
        return { file: { ...file, sourceUrl, apiSourceUrl: file.sourceUrl, title: String(topic.Title),
                filename: String(topic.Url || entry.linkedUrl || topic.Title).split(/[?#]/, 1)[0] } };
    }
    async readTopic(courseId, topicId, offset = 0, maxChars = 16000, section, ocrPage) {
        const result = await this.topicSource(courseId, topicId);
        if ('reference' in result)
            return result.reference;
        return { courseId, topicId, ...await readMaterial(result.file, offset, maxChars, section, ocrPage) };
    }
    async selectedCourses(ids) {
        const available = await this.courses();
        if (!ids?.length)
            return available;
        ids.forEach(x => requireId(x, 'Course ID'));
        const wanted = new Set(ids);
        const found = available.items.filter(x => wanted.has(x.id));
        const missing = ids.filter(x => !found.some(y => y.id === x));
        return { ...available, items: found, complete: available.complete && missing.length === 0,
            warnings: [...available.warnings, ...(missing.length ? [`Requested courses not in the accessible, configured enrollment set: ${missing.join(', ')}.`] : [])] };
    }
    async deadlines(options) {
        const courses = await this.selectedCourses(options.courseIds);
        const warnings = [...courses.warnings];
        const coverage = [], items = [], undatedItems = [];
        let complete = courses.complete;
        const now = new Date();
        for (const course of courses.items) {
            const sources = [
                ['assignments', () => this.assignments(course.id)],
                ['quizzes', () => this.quizzes(course.id)],
                ['calendar', () => this.calendar(course.id, options.start, options.end)],
                ['content', () => this.content(course.id)],
            ];
            for (const [kind, fetchItems] of sources) {
                try {
                    const result = await fetchItems();
                    coverage.push({ courseId: course.id, kind, complete: result.complete, fetchedAt: result.fetchedAt, warnings: result.warnings });
                    if (!result.complete)
                        complete = false;
                    for (const item of result.items) {
                        const candidates = kind === 'calendar'
                            ? [{ value: item.startDate, label: item.eventType === 6 ? 'calendar_due_date' : 'calendar_event', field: 'startDate' }]
                            : [{ value: item.dueDate, label: 'due_date', field: 'dueDate' },
                                { value: item.endDate, label: 'availability_ends', field: 'endDate' }];
                        if (!candidates.some(x => x.value))
                            undatedItems.push({ courseId: course.id, kind, id: item.id, title: item.title, sourceUrl: item.sourceUrl });
                        for (const candidate of candidates) {
                            const date = describeDate(candidate.value, this.config.timezone);
                            if (date?.invalid) {
                                complete = false;
                                warnings.push(`Unrecognized ${candidate.field} on ${kind} ${item.id}, course ${course.id}; no date was guessed.`);
                            }
                            if (!date || !dateInRange(date, options.start, options.end))
                                continue;
                            const datePassed = date.dateOnly ? date.raw < localDay(now, this.config.timezone) : Date.parse(date.iso) < now.valueOf();
                            items.push({ courseId: course.id, courseName: course.name, id: `${kind}:${item.id}:${candidate.field}`,
                                title: item.title, kind, dateKind: candidate.label, date, datePassed,
                                completionStatus: 'unknown', sourceUrl: item.sourceUrl,
                                note: candidate.label === 'availability_ends' ? 'This is an availability end date, NOT an inferred due date.' : undefined });
                        }
                    }
                }
                catch (error) {
                    complete = false;
                    coverage.push({ courseId: course.id, kind, complete: false, error: safeError(error) });
                }
            }
        }
        items.sort((a, b) => String(record(a.date).iso ?? record(a.date).raw).localeCompare(String(record(b.date).iso ?? record(b.date).raw)));
        return { fetchedAt: new Date().toISOString(), timezone: this.config.timezone,
            start: options.start.toISOString(), end: options.end.toISOString(), complete, items, coverage, undatedItems, warnings,
            limitations: [
                'Complete means the selected API sources answered, not that every school obligation was discovered.',
                'Dates mentioned only inside announcements, slides, assignments or external services are not automatically parsed. Review those sources separately.',
                'Osiris exam registrations, rooms and Remindo reviews are not connected.',
                'Some events may refer to the same assignment; sources are preserved instead of merging potentially different deadlines.',
                'No date-only value is assigned a fictional time. A passed date does not prove missing work.',
                'Personal extensions, exemptions and group-specific dates may need manual confirmation in Brightspace.'
            ] };
    }
    async searchCourse(courseId, query, limit = 20, scan) {
        const term = query.toLocaleLowerCase();
        const matches = [], coverage = [], files = [];
        let linkedReferences = 0;
        for (const [kind, action] of [
            ['content', () => this.content(courseId)], ['announcements', () => this.announcements(courseId)], ['assignments', () => this.assignments(courseId)]
        ]) {
            try {
                const result = await action();
                if (scan)
                    files.push(...filesInItems(courseId, kind, result.items));
                coverage.push({ kind, complete: result.complete, warnings: result.warnings });
                for (const item of result.items) {
                    const links = array(item.instructionLinks).map(record);
                    linkedReferences += links.length;
                    const haystack = [item.title, item.description, item.body, item.instructions, ...links.flatMap(l => [l.label, l.url]), ...array(item.path)].filter(x => typeof x === 'string').join('\n');
                    const index = haystack.toLocaleLowerCase().indexOf(term);
                    if (index >= 0)
                        matches.push({ kind, id: item.id, itemId: item.itemId ?? item.id, title: item.title, sourceUrl: item.sourceUrl,
                            snippet: haystack.slice(Math.max(0, index - 160), index + 440) });
                }
            }
            catch (error) {
                coverage.push({ kind, complete: false, error: safeError(error) });
            }
        }
        let fileSearch;
        if (scan) {
            const name = scan.filename?.toLocaleLowerCase() ?? '';
            const { batch, totalFiles, nextFileOffset } = fileBatch(files.filter(f => f.title.toLocaleLowerCase().includes(name)), scan.offset, scan.limit);
            const fileMatches = [], fileCoverage = [];
            let matchingSections = 0;
            for (const entry of batch) {
                try {
                    const file = await getFile(this, entry.ref);
                    const doc = await extractMaterial(file);
                    fileCoverage.push({ ...entry.ref, title: entry.title, complete: doc.complete, warnings: doc.warnings });
                    for (const section of doc.sections) {
                        const body = [section.text, section.notes].filter(Boolean).join('\n');
                        const index = body.toLocaleLowerCase().indexOf(term);
                        if (index < 0)
                            continue;
                        matchingSections++;
                        if (matchingSections <= (scan.matchOffset ?? 0))
                            continue;
                        if (fileMatches.length < limit)
                            fileMatches.push({ ...entry.ref, title: entry.title, sourceUrl: file.sourceUrl,
                                section: section.index, locator: section.locator, ocr: section.ocr,
                                snippet: body.slice(Math.max(0, index - 150), index + query.length + 250) });
                    }
                }
                catch (error) {
                    fileCoverage.push({ ...entry.ref, title: entry.title, complete: false, error: safeError(error) });
                }
            }
            const matchEnd = (scan.matchOffset ?? 0) + fileMatches.length;
            fileSearch = { matches: fileMatches, matchingSections, matchOffset: scan.matchOffset ?? 0, matchesTruncated: matchEnd < matchingSections,
                nextMatchOffset: matchEnd < matchingSections ? matchEnd : null, coverage: fileCoverage,
                linkedReferences, linkCoverage: 'Authored instruction links are searchable by label and URL. Their destinations are not crawled.',
                totalFiles, fileOffset: scan.offset, nextFileOffset, complete: scan.offset === 0 && nextFileOffset === null &&
                    coverage.every(c => c.complete) && fileCoverage.every(c => c.complete) };
        }
        return { matches: matches.slice(0, limit), totalMatches: matches.length, truncated: matches.length > limit, coverage, fileSearch,
            scope: scan ? 'Metadata matches and a separate batch of file text matches with source locations. Follow nextFileOffset to continue.' :
                'Course outline titles/descriptions, announcements and assignment instructions only; not full text of every attachment.',
            fetchedAt: new Date().toISOString(), untrustedCourseContent: true };
    }
}
//# sourceMappingURL=service.js.map