import { Word } from './word.interface';
import { WordState } from './word-state.enum';
import { HandlePosition } from '../services/timeline.service';

/**
 * Editor State Snapshot
 * Represents a complete snapshot of the editor state at a point in time
 * Used for undo/redo functionality
 * 
 * OPTIMIZATION: Only stores word states (not full word objects) since
 * word properties (text, start, end, confidence, index) never change.
 */
export interface EditorStateSnapshot {
    /** Array of word states indexed by word index (optimized: only states, not full words) */
    wordStates: Array<WordState>;

    /** Current selection start word index (or null) */
    selectionStartIndex: number | null;
    /** Current selection end word index (or null) */
    selectionEndIndex: number | null;

    /** Timeline start handle position (or null) */
    startHandle: HandlePosition | null;
    /** Timeline end handle position (or null) */
    endHandle: HandlePosition | null;
    /** Deleted segments with fine-tuned handle times */
    deletedSegments: Array<{ start: number; end: number }>;
    /** Flag indicating if this is the initial baseline state (first frame) */
    isInitialState?: boolean;
}

