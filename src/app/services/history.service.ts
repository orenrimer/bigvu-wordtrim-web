import { Injectable, signal, computed } from '@angular/core';
import { EditorStateSnapshot } from '../models';

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
@Injectable()
export class HistoryService {
    // Maximum history stack size to prevent memory leaks
    // After this limit, oldest states are removed (FIFO)
    private readonly MAX_HISTORY_SIZE = 50;

    // Private writable signals for history management
    private readonly _historyStack = signal<EditorStateSnapshot[]>([]);
    private readonly _redoStack = signal<EditorStateSnapshot[]>([]);

    // Flag to track if we're currently at the initial baseline state
    // When true, undo button should be disabled
    // Using signal so computed can react to changes
    private readonly _isAtInitialState = signal<boolean>(true);

    // Store the initial state separately (not in undo stack until first action)
    private _initialState: EditorStateSnapshot | null = null;

    // Public read-only signals
    public readonly historyStack = this._historyStack.asReadonly();
    public readonly redoStack = this._redoStack.asReadonly();

    // Computed signals for button states
    // Can't undo if we're at the initial baseline state (page load)
    public readonly canUndo = computed(() => {
        const isAtInitial = this._isAtInitialState();
        const historyLength = this._historyStack().length;
        return !isAtInitial && historyLength > 0;
    });
    public readonly canRedo = computed(() => this._redoStack().length > 0);

    /**
     * Set the initial state (called once on page load)
     * This state is stored separately and will be pushed to undo stack when first action occurs
     * @param initialState The initial empty state
     */
    public setInitialState(initialState: EditorStateSnapshot): void {
        // Initial state is already deep copied in captureState(), so we can use it directly
        // but we still need to copy to ensure isolation
        const stateCopy = this.deepCopySnapshot(initialState);
        stateCopy.isInitialState = true;
        this._initialState = stateCopy;
        this._isAtInitialState.set(true);
    }

    /**
     * Save previous state to history (before a new action)
     * This is called BEFORE an action is performed, to save the state that existed before the action
     * @param previousSnapshot The state that existed BEFORE the action (to be saved to history)
     */
    public pushState(previousSnapshot: EditorStateSnapshot): void {

        // Create deep copy of snapshot to avoid reference issues
        const stateCopy = this.deepCopySnapshot(previousSnapshot);

        // Don't mark as initial state when pushing (initial state is already pushed above if needed)
        stateCopy.isInitialState = false;

        // Add to history stack and limit size to prevent memory leaks
        this._historyStack.update(stack => {
            const newStack = [...stack, stateCopy];
            // Keep only the most recent MAX_HISTORY_SIZE states (remove oldest if exceeded)
            return newStack.length > this.MAX_HISTORY_SIZE
                ? newStack.slice(-this.MAX_HISTORY_SIZE)
                : newStack;
        });

        // We're no longer at initial state after pushing any state
        this._isAtInitialState.set(false);

        // Clear redo stack when new action is performed
        this._redoStack.set([]);
    }

    /**
     * Initialize history with empty initial state
     * Called once when page loads, after words are loaded
     */
    public initializeHistory(): void {
        // This will be called from loadSegmentation after words are loaded
        // We'll create the initial empty state there
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

        // Push current state to redo stack BEFORE popping from undo stack
        const currentCopy = this.deepCopySnapshot(currentSnapshot);
        this._redoStack.update(stack => [...stack, currentCopy]);

        // Pop the last item from history stack (LIFO)
        const previousState = history[history.length - 1];
        const newHistoryStack = history.slice(0, -1);

        // Update history stack
        this._historyStack.set(newHistoryStack);

        // Check if we're restoring to the initial state
        const isRestoringToInitial = previousState.isInitialState ||
            (newHistoryStack.length === 0 && this._initialState &&
                !previousState.selectionStartIndex && !previousState.selectionEndIndex);

        if (isRestoringToInitial) {
            // We're restoring to initial state - mark as at initial state
            this._isAtInitialState.set(true);
        } else {
            this._isAtInitialState.set(false);
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

        if (redo.length === 0) {
            return null;
        }

        // Push current state to undo stack BEFORE popping from redo stack
        const currentCopy = this.deepCopySnapshot(currentSnapshot);
        this._historyStack.update(stack => [...stack, currentCopy]);

        // Get next state (last item in redo stack - LIFO)
        const nextState = redo[redo.length - 1];

        // Remove from redo stack
        this._redoStack.update(stack => stack.slice(0, -1));

        // After redo, we're no longer at initial state (we've moved forward)
        this._isAtInitialState.set(false);

        return nextState;
    }

    /**
     * Clear all history (useful for resetting editor)
     */
    public clear(): void {
        this._historyStack.set([]);
        this._redoStack.set([]);
        this._initialState = null;
        this._isAtInitialState.set(true);
    }

    /**
     * Create deep copy of state snapshot to avoid reference issues
     * Note: Words array is already deep copied in captureState(), but we still need to copy
     * the array reference and other properties to ensure complete isolation
     * @param snapshot Snapshot to copy
     * @returns Deep copy of snapshot
     */
    private deepCopySnapshot(snapshot: EditorStateSnapshot): EditorStateSnapshot {
        // OPTIMIZATION: Only copy word states array (much smaller than full words array)
        return {
            wordStates: snapshot.wordStates ? [...snapshot.wordStates] : [],
            selectionStartIndex: snapshot.selectionStartIndex ?? null,
            selectionEndIndex: snapshot.selectionEndIndex ?? null,
            startHandle: snapshot.startHandle ? { ...snapshot.startHandle } : null,
            endHandle: snapshot.endHandle ? { ...snapshot.endHandle } : null,
            deletedSegments: snapshot.deletedSegments ? snapshot.deletedSegments.map(seg => ({ ...seg })) : [],
            // Preserve flags
            isInitialState: snapshot.isInitialState,
        };
    }
}

