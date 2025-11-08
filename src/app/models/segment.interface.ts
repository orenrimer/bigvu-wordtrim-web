import { WordRaw } from './word.interface';

/**
 * Interface representing a segment from the segmentation JSON
 * This is the nested structure before flattening
 * Based on PRD Section: Data Sources & Structure - Segmentation JSON Example
 */
export interface Segment {
    /** Segment start time in seconds */
    start: number;

    /** Segment end time in seconds */
    end: number;

    /** Segment confidence score */
    confidence: number;

    /** Array of words within this segment */
    words: WordRaw[];

    /** Full text of the segment */
    text: string;
}

/**
 * Interface for the output format when saving
 * Based on PRD Section 9: Save & Output
 */
export interface OutputSegment {
    /** Start time of the segment to keep */
    start: number;

    /** End time of the segment to keep */
    end: number;
}

