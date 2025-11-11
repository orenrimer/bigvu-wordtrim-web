/**
 * Enum representing the different states a word can be in during editing
 * Based on PRD Section 2: Word States
 * 
 * Note: Deleted words CAN be selected for restoration.
 * When a deleted word is selected, it maintains both states visually.
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
    DELETED = 'deleted',

    /** Deleted word that is the start point of selection (for restoration) */
    DELETED_SELECTED_START = 'deleted-selected-start',

    /** Deleted word that is the end point of selection (for restoration) */
    DELETED_SELECTED_END = 'deleted-selected-end',

    /** Deleted word within selected range (for restoration) */
    DELETED_SELECTED_RANGE = 'deleted-selected-range'
}

