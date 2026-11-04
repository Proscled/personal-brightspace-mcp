import { type JsonRecord } from './types.js';
export interface InstructionLink {
    label: string;
    url: string;
}
export declare function assignmentLinks(instructions: unknown, attachments: unknown, base: string): {
    instructionLinks: InstructionLink[];
    instructionLinksTruncated: boolean;
};
export declare function visibleRubrics(values: unknown, sourceUrl: string): {
    rubrics: JsonRecord[];
    rubricsWithheld: boolean;
};
export declare function rubricItem(r: JsonRecord, courseId: string, folderId: string, sourceUrl: string): {
    id: string;
    courseId: string;
    folderId: string;
    title: string;
    sourceUrl: string;
    description: string;
    scoringMethod: {} | null;
    scoresVisible: boolean;
    reverseLevelDisplayOrder: {} | null;
    criteriaGroups: {
        name: string | null;
        levels: {
            id: string | null;
            name: string | null;
            points: {} | null;
        }[];
        criteria: {
            id: string | null;
            name: string | null;
            cells: {
                levelId: string | null;
                description: string;
                feedback: string;
                points: {} | null;
            }[];
        }[];
    }[];
    overallLevels: {
        id: string | null;
        name: string | null;
        rangeStart: {} | null;
        description: string;
        feedback: string;
    }[];
} | null;
