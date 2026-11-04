export type OfficeKind = 'pptx' | 'docx' | 'xlsx';
export interface OfficeSection {
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
}
export interface OfficeContent {
    sections: OfficeSection[];
    warnings: string[];
    complete: boolean;
}
export interface SlideImage {
    mimeType: 'image/png' | 'image/jpeg';
    data: string;
}
export declare function extractOffice(bytes: Uint8Array, kind: OfficeKind): Promise<OfficeContent>;
export declare function readSlideImage(bytes: Uint8Array, slide: number, image: number): Promise<SlideImage>;
