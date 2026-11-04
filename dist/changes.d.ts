import { type JsonRecord } from './types.js';
import { SchoolService, type Item } from './service.js';
export declare function canonical(value: unknown): string;
export declare function diffItems(previous: Item[], current: Item[]): JsonRecord[];
export declare class ChangeTracker {
    private service;
    constructor(service: SchoolService);
    check(courseIds?: string[], validateReport?: (report: JsonRecord) => void, scan?: {
        offset: number;
        limit: number;
    }): Promise<JsonRecord>;
}
