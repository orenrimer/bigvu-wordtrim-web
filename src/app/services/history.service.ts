import { Injectable, signal, computed } from '@angular/core';
import { EditorStateSnapshot } from '../models';
import { environment } from '../../environments/environment';

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
        this.logStacks('Initial State Set');
    }

    /**
     * Save previous state to history (before a new action)
     * This is called BEFORE an action is performed, to save the state that existed before the action
     * @param previousSnapshot The state that existed BEFORE the action (to be saved to history)
     * @param isActionBarAction Whether this snapshot was created after an action bar action (default: false)
     */
    public pushState(previousSnapshot: EditorStateSnapshot, isActionBarAction: boolean = false): void {

        // Create deep copy of snapshot to avoid reference issues
        const stateCopy = this.deepCopySnapshot(previousSnapshot);

        // Mark if this is an action bar action
        stateCopy.isActionBarAction = isActionBarAction;

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

        this.logStacks('After pushState');
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
            if (environment.enableDebugLogs) {
                console.log('[HistoryService] undo() - No history, returning null');
            }
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

        // Check if the previous state (the one we're restoring to) was an action bar action
        // If yes, clear the redo stack to disable redo after undo of action bar actions
        if (previousState.isActionBarAction) {
            this._redoStack.set([]);
        }

        this.logStacks('After UNDO');
        if (environment.enableDebugLogs) {
            console.log(`Restoring to: ${this.formatState(previousState)}`);
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
            if (environment.enableDebugLogs) {
                console.log('[HistoryService] redo() - No redo available, returning null');
            }
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

        this.logStacks('After REDO');
        if (environment.enableDebugLogs) {
            console.log(`Restoring to: ${this.formatState(nextState)}`);
        }

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
     * Helper method to format state snapshot for logging
     */
    private formatState(state: EditorStateSnapshot): string {
        // Support both new and legacy formats
        let start: string;
        let end: string;

        if (state.selectionStartIndex !== undefined && state.selectionStartIndex !== null) {
            // New format: use index (we don't have word text, so just show index)
            start = `index(${state.selectionStartIndex})`;
        } else {
            start = 'null';
        }

        if (state.selectionEndIndex !== undefined && state.selectionEndIndex !== null) {
            // New format: use index
            end = `index(${state.selectionEndIndex})`;
        } else {
            end = 'null';
        }

        const initial = state.isInitialState ? ' [INITIAL]' : '';
        return `(${start} -> ${end})${initial}`;
    }

    /**
     * Helper method to log stacks in a clear format
     * Only logs in development mode to avoid performance impact in production
     */
    private logStacks(operation: string): void {
        if (!environment.enableDebugLogs) return;

        const undoStack = this._historyStack();
        const redoStack = this._redoStack();

        console.groupCollapsed(`========== ${operation} ==========`);
        console.log('UNDO Stack (bottom to top):');
        if (undoStack.length === 0) {
            console.log('  [empty]');
        } else {
            undoStack.forEach((state, index) => {
                console.log(`  [${index}] ${this.formatState(state)}`);
            });
        }

        console.log('\nREDO Stack (bottom to top):');
        if (redoStack.length === 0) {
            console.log('  [empty]');
        } else {
            redoStack.forEach((state, index) => {
                console.log(`  [${index}] ${this.formatState(state)}`);
            });
        }
        console.groupEnd();
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
            isActionBarAction: snapshot.isActionBarAction,
        };
    }
}

