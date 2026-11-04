import { type MaterialFile } from './materials.js';
import { BrightspaceClient } from './client.js';
import { type Collection, type Config, type Course, type JsonRecord } from './types.js';
export type Item = JsonRecord & {
    id: string;
    title: string;
    courseId: string;
    sourceUrl: string;
};
export declare function flattenContent(input: unknown, courseId: string, origin: string): {
    items: Item[];
    complete: boolean;
    warnings: string[];
};
export { extractText } from './materials.js';
export declare class SchoolService {
    client: BrightspaceClient;
    constructor(client: BrightspaceClient);
    get config(): Config;
    whoami(): Promise<JsonRecord>;
    private coursePath;
    courses(): Promise<Collection<Course>>;
    private mapItems;
    assignments(courseId: string, folderId?: string): Promise<Collection<Item>>;
    assignmentRubrics(courseId: string, folderId: string): Promise<{
        items: Item[];
        complete: boolean;
        warnings: string[];
        sourceUrl: string;
        fetchedAt: string;
        lookupUrl: string;
        lookupError: {
            code: string;
            message: string;
            status?: number;
        } | undefined;
        folderId: string;
        assignmentUrl: string;
        instructionLinks: unknown;
        attachments: unknown;
    }>;
    assignmentAttachment(courseId: string, folderId: string, fileId: string): Promise<{
        title: string;
        filename: string;
        bytes: Uint8Array;
        contentType: string;
        sourceUrl: string;
        fetchedAt: string;
    }>;
    announcementAttachment(courseId: string, newsItemId: string, fileId: string): Promise<{
        title: string;
        filename: string;
        bytes: Uint8Array;
        contentType: string;
        sourceUrl: string;
        fetchedAt: string;
    }>;
    private attachment;
    announcements(courseId: string): Promise<Collection<Item>>;
    grades(courseId: string): Promise<Collection<Item>>;
    quizzes(courseId: string): Promise<Collection<Item>>;
    content(courseId: string): Promise<Collection<Item>>;
    calendar(courseId: string, start: Date, end: Date): Promise<Collection<Item>>;
    topicSource(courseId: string, topicId: string): Promise<{
        file: MaterialFile;
    } | {
        reference: JsonRecord;
    }>;
    readTopic(courseId: string, topicId: string, offset?: number, maxChars?: number, section?: number, ocrPage?: number): Promise<JsonRecord>;
    selectedCourses(ids?: string[]): Promise<Collection<Course>>;
    deadlines(options: {
        courseIds?: string[];
        start: Date;
        end: Date;
    }): Promise<JsonRecord>;
    searchCourse(courseId: string, query: string, limit?: number, scan?: {
        offset: number;
        limit: number;
        filename?: string;
        matchOffset?: number;
    }): Promise<JsonRecord>;
}
