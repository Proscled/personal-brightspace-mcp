import { type JsonRecord } from './types.js';
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
    images?: {
        index: number;
        name: string;
        alt: string;
        mimeType: string | null;
    }[];
    ocr?: boolean;
}
interface Extraction {
    sections: Section[];
    pageCount?: number;
    supported: boolean;
    complete: boolean;
    warnings: string[];
}
export declare function extractText(bytes: Uint8Array, contentType: string, filename?: string): {
    supported: boolean;
    text: string;
    warnings: string[];
};
export declare function extractMaterial(file: MaterialFile, section?: number, ocrPage?: number): Promise<Extraction>;
export declare function readMaterial(file: MaterialFile, offset?: number, maxChars?: number, section?: number, ocrPage?: number): Promise<JsonRecord>;
export declare function validateRef(ref: MaterialRef): void;
export declare function getFile(service: SchoolService, ref: MaterialRef): Promise<MaterialFile>;
export declare class MaterialImage {
    meta: JsonRecord;
    mimeType: string;
    data: string;
    constructor(meta: JsonRecord, mimeType: string, data: string);
}
export declare function viewMaterial(file: MaterialFile, page: number, image?: number): Promise<MaterialImage>;
export type FileEntry = {
    key: string;
    title: string;
    sourceUrl: string;
    ref: MaterialRef;
};
export declare function filesInItems(courseId: string, kind: string, items: Item[]): FileEntry[];
export declare function fileBatch(files: FileEntry[], offset: number, limit: number): {
    batch: FileEntry[];
    totalFiles: number;
    nextFileOffset: number | null;
};
export {};
