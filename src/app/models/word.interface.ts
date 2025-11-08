import { WordState } from './word-state.enum';

/**
 * Interface representing a single word from the video transcription
 * Based on PRD Section: Data Sources & Structure
 */
export interface Word {
    /** The text content of the word */
    word: string;

    /** Start time in seconds */
    start: number;

    /** End time in seconds */
    end: number;

    /** Confidence score from transcription (0-1) */
    confidence: number;

    /** Current state of the word in the editor */
    state: WordState;

    /** Unique identifier/index for tracking */
    index: number;
}

/**
 * Interface for a word as it comes from the API (before processing)
 */
export interface WordRaw {
    word: string;
    start: number;
    end: number;
    confidence: number;
}

