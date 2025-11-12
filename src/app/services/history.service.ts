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
    /** Flag indicating if this is the initial baseline state (first frame) */
    isInitialState?: boolean;
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

    // Flag to track if we're currently at the initial baseline state
    // When true, undo button should be disabled
    private _isAtInitialState = true;

    // Public read-only signals
    public readonly historyStack = this._historyStack.asReadonly();
    public readonly redoStack = this._redoStack.asReadonly();

    // Computed signals for button states
    // Can't undo if we're at the initial baseline state (page load)
    public readonly canUndo = computed(() => {
        const isAtInitial = this._isAtInitialState;
        const historyLength = this._historyStack().length;
        const canUndoResult = !isAtInitial && historyLength > 0;
        return canUndoResult;
    });
    public readonly canRedo = computed(() => this._redoStack().length > 0);

    /**
     * Capture current editor state and push to history
     * Clears redo stack when new state is pushed
     * @param snapshot Current editor state snapshot
     */
    public pushState(snapshot: EditorStateSnapshot): void {
        // Create deep copy of snapshot to avoid reference issues
        const stateCopy = this.deepCopySnapshot(snapshot);

        // STEP 1: Check if this is the first frame (history is empty)
        // If yes, mark this snapshot with the isInitialState flag
        const isFirstFrame = this._historyStack().length === 0;
        if (isFirstFrame) {
            stateCopy.isInitialState = true;
            console.log('[HistoryService] pushState: First frame detected, marking as initial state');
        }

        // Add to history stack
        this._historyStack.update(stack => [...stack, stateCopy]);

        // Clear redo stack on new action (per PRD requirement)
        this._redoStack.set([]);

        // STEP 2: Once we push any state, we're no longer at initial state
        // This ensures that after the first action, undo button becomes enabled
        this._isAtInitialState = false;
    }

    /**
     * Undo: Restore previous state
     * Moves current state to redo stack and restores previous state
     * @param currentSnapshot Current editor state (to be moved to redo stack)
     * @returns Previous state snapshot or null if no history
     */
    public undo(currentSnapshot: EditorStateSnapshot): EditorStateSnapshot | null {
        const history = this._historyStack();

        if (history.length === 0) {
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

        // STEP 3: Check if we're restoring to a frame marked with isInitialState flag
        // If yes, it means we've undone back to the initial baseline state
        // In this case, we need to:
        // 1. Set _isAtInitialState = true to disable undo button
        // 2. Return an empty state (no selection) instead of the start-only state
        if (previousState.isInitialState) {
            // Create empty state snapshot (initial baseline - no selection)
            const emptyState: EditorStateSnapshot = {
                words: previousState.words.map(w => ({ ...w })),
                selectionStart: null,
                selectionEnd: null,
                startHandle: null,
                endHandle: null,
                isInitialState: true
            };

            // Mark that we're at initial state - this will disable undo button
            this._isAtInitialState = true;
            return emptyState;
        }

        // STEP 3B: Check if current frame is empty AND next frame in history is also empty
        // If both are empty, disable undo button (we're at a baseline state)
        const currentFrameIsEmpty = !previousState.selectionStart && !previousState.selectionEnd;
        const nextFrameInHistory = newHistoryStack.length > 0 ? newHistoryStack[newHistoryStack.length - 1] : null;
        const nextFrameIsEmpty = nextFrameInHistory
            ? (!nextFrameInHistory.selectionStart && !nextFrameInHistory.selectionEnd)
            : true; // If no next frame, consider it empty

        if (currentFrameIsEmpty && nextFrameIsEmpty) {
            // Both current and next frames are empty - disable undo button
            this._isAtInitialState = true;
        }

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

        // Get next state (last item in redo stack - LIFO)
        // The redo stack contains states in reverse order: [oldest_undone, ..., newest_undone]
        // So we take the last item (most recently undone state)
        const nextState = redo[redo.length - 1];

        // Remove from redo stack
        this._redoStack.update(stack => stack.slice(0, -1));

        // Push current state to history stack
        const currentCopy = this.deepCopySnapshot(currentSnapshot);
        this._historyStack.update(stack => [...stack, currentCopy]);

        // STEP 4: After redo, we're no longer at initial state (we've moved forward)
        this._isAtInitialState = false;

        return nextState;
    }

    /**
     * Clear all history (useful for resetting editor)
     */
    public clear(): void {
        this._historyStack.set([]);
        this._redoStack.set([]);
        // STEP 5: Reset to initial state when clearing history
        this._isAtInitialState = true;
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
            endHandle: snapshot.endHandle ? { ...snapshot.endHandle } : null,
            // STEP 6: Preserve the isInitialState flag when copying
            isInitialState: snapshot.isInitialState
        };
    }
}

