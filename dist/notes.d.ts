import { type Config, type JsonRecord } from './types.js';
export declare class NoteStore {
    private directory;
    constructor(config: Config);
    private hasDirectory;
    importFile(filename: string, title?: string, asOf?: string): Promise<JsonRecord>;
    private load;
    list(): Promise<JsonRecord>;
    search(query: string, limit?: number): Promise<JsonRecord>;
    read(noteId: string, startLine?: number, lineCount?: number): Promise<JsonRecord>;
}
