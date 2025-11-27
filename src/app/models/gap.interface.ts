/**
 * Gap State Enum
 * Represents the different states a gap can be in during Gap Review Mode
 * Based on PRD Phase 2: Gap Detection & Review
 */
export enum GapState {
    /** Gap is selected (marked for removal) - visually appears as selected */
    SELECTED = 'selected',

    /** Gap will be preserved (Ignored/Keep) */
    IGNORED = 'ignored',

    /** Gap is active (deleted) - visually appears as deleted */
    ACTIVE = 'active'
}

/**
 * Interface representing a gap between two words
 * Based on PRD Phase 2: Gap Detection & Review
 */
export interface Gap {
    /** Unique identifier for the gap (index of the word before the gap) */
    id: number;

    /** Index of the word before the gap */
    beforeWordIndex: number;

    /** Index of the word after the gap */
    afterWordIndex: number;

    /** Duration of the gap in seconds */
    duration: number;

    /** Current state of the gap */
    state: GapState;

    /** Start time of the gap (end time of previous word) */
    start: number;

    /** End time of the gap (start time of next word) */
    end: number;

    /** Optional filler word text (e.g., "um", "uh") - if present, display this instead of duration */
    fillerWordText?: string;
}

