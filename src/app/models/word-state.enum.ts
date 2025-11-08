/**
 * Enum representing the different states a word can be in during editing
 * Based on PRD Section 2: Word States
 */
export enum WordState {
    /** Default state - word is not selected and not deleted */
    NORMAL = 'normal',

    /** Word is the start point of the current selection */
    SELECTED_START = 'selected-start',

    /** Word is the end point of the current selection */
    SELECTED_END = 'selected-end',

    /** Word is within the selected range (between start and end) */
    SELECTED_RANGE = 'selected-range',

    /** Word has been marked as deleted (removed from output) */
    DELETED = 'deleted'
}

