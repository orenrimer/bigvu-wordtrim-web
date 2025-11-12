import { Injectable, signal, computed } from '@angular/core';
import { Word } from '../models';
import { HandlePosition } from './timeline.service';

/**
 * Editor State Snapshot
 * Represents a complete snapshot of the editor state at a point in time
 * Used for undo/redo functionality
 */
export interface EditorStateSnapshot {
    /** Array of words with their current states */
    words: Word[];
    /** Current selection start word (or null) */
    selectionStart: Word | null;
    /** Current selection end word (or null) */
    selectionEnd: Word | null;
    /** Timeline start handle position (or null) */
    startHandle: HandlePosition | null;
    /** Timeline end handle position (or null) */
    endHandle: HandlePosition | null;
}

/**
 * History Service
 * Manages undo/redo state using Angular Signals
 * Based on PRD: Undo/Redo System (Feature 8)
 * 
 * Features:
 * - History stack (array of editor state snapshots)
 * - Redo stack (array of undone states)
 * - Capture current editor state
 * - Undo/redo operations
 * - Clear redo stack on new action
 */
@Injectable({
    providedIn: 'root'
})
export class HistoryService {
    // Private writable signals for history management
    private readonly _historyStack = signal<EditorStateSnapshot[]>([]);
    private readonly _redoStack = signal<EditorStateSnapshot[]>([]);

    // Public read-only signals
    public readonly historyStack = this._historyStack.asReadonly();
    public readonly redoStack = this._redoStack.asReadonly();

    // Computed signals for button states
    public readonly canUndo = computed(() => this._historyStack().length > 0);
    public readonly canRedo = computed(() => this._redoStack().length > 0);

    /**
     * Capture current editor state and push to history
     * Clears redo stack when new state is pushed
     * @param snapshot Current editor state snapshot
     */
    public pushState(snapshot: EditorStateSnapshot): void {
        // Create deep copy of snapshot to avoid reference issues
        const stateCopy = this.deepCopySnapshot(snapshot);

        // Add to history stack
        this._historyStack.update(stack => [...stack, stateCopy]);

        // Clear redo stack on new action (per PRD requirement)
        this._redoStack.set([]);

        // DEBUG: Log state capture
        console.log('[HistoryService] pushState:', {
            selectionStart: snapshot.selectionStart?.word || 'null',
            selectionEnd: snapshot.selectionEnd?.word || 'null',
            startHandle: snapshot.startHandle?.time || 'null',
            endHandle: snapshot.endHandle?.time || 'null',
            historyStackLength: this._historyStack().length
        });
    }

    /**
     * Undo: Restore previous state
     * Moves current state to redo stack and restores previous state
     * @param currentSnapshot Current editor state (to be moved to redo stack)
     * @returns Previous state snapshot or null if no history
     */
    public undo(currentSnapshot: EditorStateSnapshot): EditorStateSnapshot | null {
        const history = this._historyStack();
        
        // DEBUG: Log undo attempt
        console.log('[HistoryService] undo called:', {
            currentState: {
                selectionStart: currentSnapshot.selectionStart?.word || 'null',
                selectionEnd: currentSnapshot.selectionEnd?.word || 'null'
            },
            historyStackLength: history.length,
            historyStack: history.map((s, i) => ({
                index: i,
                selectionStart: s.selectionStart?.word || 'null',
                selectionEnd: s.selectionEnd?.word || 'null',
                isLast: i === history.length - 1
            })),
            lastItemInHistory: history.length > 0 ? {
                selectionStart: history[history.length - 1].selectionStart?.word || 'null',
                selectionEnd: history[history.length - 1].selectionEnd?.word || 'null'
            } : 'empty'
        });

        if (history.length === 0) {
            console.log('[HistoryService] undo: No history, returning null');
            return null;
        }

        // Check if the last item in history matches current state
        // If it does, we need to get the second-to-last item instead
        const lastItem = history[history.length - 1];
        const lastMatchesCurrent = 
            (lastItem.selectionStart?.index === currentSnapshot.selectionStart?.index) &&
            (lastItem.selectionEnd?.index === currentSnapshot.selectionEnd?.index);

        let previousState: EditorStateSnapshot;
        let newHistoryStack: EditorStateSnapshot[];

        if (lastMatchesCurrent && history.length > 1) {
            // Last item matches current state, get second-to-last item
            console.log('[HistoryService] undo: Last item matches current, using second-to-last');
            previousState = history[history.length - 2];
            // Remove both last and second-to-last, then add back the second-to-last
            // Actually, we just remove the last item (current state)
            newHistoryStack = history.slice(0, -1);
        } else {
            // Standard case: get last item (previous state)
            previousState = history[history.length - 1];
            newHistoryStack = history.slice(0, -1);
        }

        // Update history stack
        this._historyStack.set(newHistoryStack);

        // Push current state to redo stack
        const currentCopy = this.deepCopySnapshot(currentSnapshot);
        this._redoStack.update(stack => [...stack, currentCopy]);

        // DEBUG: Log what we're restoring to
        console.log('[HistoryService] undo: Restoring to:', {
            selectionStart: previousState.selectionStart?.word || 'null',
            selectionEnd: previousState.selectionEnd?.word || 'null',
            startHandle: previousState.startHandle?.time || 'null',
            endHandle: previousState.endHandle?.time || 'null',
            newHistoryStackLength: this._historyStack().length,
            wasLastItemCurrent: lastMatchesCurrent
        });

        return previousState;
    }

    /**
     * Redo: Reapply undone state
     * Moves current state to history stack and restores undone state
     * @param currentSnapshot Current editor state (to be moved to history stack)
     * @returns Next state snapshot or null if no redo available
     */
    public redo(currentSnapshot: EditorStateSnapshot): EditorStateSnapshot | null {
        const redo = this._redoStack();
        if (redo.length === 0) return null;

        // Get next state (last item in redo stack)
        const nextState = redo[redo.length - 1];

        // Remove from redo stack
        this._redoStack.update(stack => stack.slice(0, -1));

        // Push current state to history stack
        const currentCopy = this.deepCopySnapshot(currentSnapshot);
        this._historyStack.update(stack => [...stack, currentCopy]);

        return nextState;
    }

    /**
     * Clear all history (useful for resetting editor)
     */
    public clear(): void {
        this._historyStack.set([]);
        this._redoStack.set([]);
    }

    /**
     * Create deep copy of state snapshot to avoid reference issues
     * @param snapshot Snapshot to copy
     * @returns Deep copy of snapshot
     */
    private deepCopySnapshot(snapshot: EditorStateSnapshot): EditorStateSnapshot {
        return {
            words: snapshot.words.map(word => ({ ...word })),
            selectionStart: snapshot.selectionStart ? { ...snapshot.selectionStart } : null,
            selectionEnd: snapshot.selectionEnd ? { ...snapshot.selectionEnd } : null,
            startHandle: snapshot.startHandle ? { ...snapshot.startHandle } : null,
            endHandle: snapshot.endHandle ? { ...snapshot.endHandle } : null
        };
    }
}

