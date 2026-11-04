export interface DateInfo {
    raw: string;
    iso: string | null;
    local: string;
    dateOnly: boolean;
    timezone: string;
    invalid?: boolean;
}
export declare function localDay(date: Date, timezone: string): string;
export declare function describeDate(value: unknown, timezone: string): DateInfo | null;
export declare function dateInRange(date: DateInfo, start: Date, end: Date): boolean;
export declare function parseWindow(start?: string, end?: string, daysAhead?: number, now?: Date): {
    start: Date;
    end: Date;
};
