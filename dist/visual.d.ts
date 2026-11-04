import type { OfficeKind } from './office.js';
export interface PageText {
    sections: {
        index: number;
        locator: string;
        text: string;
        ocr: boolean;
    }[];
    complete: boolean;
    warnings: string[];
    pageCount: number;
}
type MaterialKind = OfficeKind | 'pdf';
export declare function extractPdf(bytes: Uint8Array, page?: number, forceOcr?: boolean): Promise<PageText>;
export declare function extractScannedOffice(bytes: Uint8Array, kind: OfficeKind, page?: number): Promise<PageText>;
export declare function renderPage(bytes: Uint8Array, kind: MaterialKind, page: number): Promise<Buffer>;
export {};
