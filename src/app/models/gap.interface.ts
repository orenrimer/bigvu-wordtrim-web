/**
 * Gap State Enum
 * Represents the different states a gap can be in during Gap Review Mode
 * Based on PRD Phase 2: Gap Detection & Review
 */
export enum GapState {
    /** Gap is marked for removal (Active) */
    ACTIVE = 'active',

    /** Gap will be preserved (Ignored/Keep) */
    IGNORED = 'ignored',

    /** Gap is currently focused/selected */
    SELECTED = 'selected'
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
}

