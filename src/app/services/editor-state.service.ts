import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { Word, WordState } from '../models';
import { EditorStateSnapshot } from './history.service';
import { HandlePosition } from './timeline.service';

/**
 * Editor State Service
 * Manages word selection state and word states using Angular Signals
 * Based on PRD: Word Selection Logic
 */
@Injectable({
    providedIn: 'root'
})
export class EditorStateService {
    // Private writable signals for state management
    private readonly _words = signal<Word[]>([]);
    private readonly _selectionStart = signal<Word | null>(null);
    private readonly _selectionEnd = signal<Word | null>(null);
    private readonly _currentPlaybackWordIndex = signal<number | null>(null);

    // Public read-only signals
    public readonly words = this._words.asReadonly();
    public readonly selectionStart = this._selectionStart.asReadonly();
    public readonly selectionEnd = this._selectionEnd.asReadonly();
    public readonly currentPlaybackWordIndex = this._currentPlaybackWordIndex.asReadonly();

    // Computed signal: selected words array (all words between start and end inclusive)
    public readonly selectedWords = computed(() => {
        const start = this._selectionStart();
        const end = this._selectionEnd();
        const words = this._words();

        if (!start) return [];
        if (!end) return [start];

        const startIndex = start.index;
        const endIndex = end.index;

        // Return all words between start and end (inclusive)
        return words.filter(word =>
            word.index >= startIndex && word.index <= endIndex
        );
    });

    // Computed signal: whether a selection is complete (has both start and end)
    public readonly hasCompleteSelection = computed(() =>
        this._selectionStart() !== null && this._selectionEnd() !== null
    );

    // Computed signal: whether any words are selected
    public readonly hasSelection = computed(() =>
        this._selectionStart() !== null
    );

    // Computed signal: count of deleted words in selection
    public readonly deletedWordsInSelection = computed(() =>
        this.selectedWords().filter(word =>
            word.state === WordState.DELETED ||
            word.state === WordState.DELETED_SELECTED_START ||
            word.state === WordState.DELETED_SELECTED_END ||
            word.state === WordState.DELETED_SELECTED_RANGE
        ).length
    );

    /**
     * Initialize the service with words from segmentation
     * @param words Array of words from segmentation loader
     */
    public initializeWords(words: Word[]): void {
        this._words.set([...words]);
        this.clearSelection();
    }

    /**
     * Handle word click for selection
     * Based on PRD: Word Selection Logic
     * 
     * Logic:
     * 1. First click → set as selection start
     * 2. Second click → set as selection end (if forward in time)
     * 3. Third click (after complete selection) → clear and start new
     * 4. Click before start → becomes new start
     * 
     * @param word The word that was clicked
     */
    public selectWord(word: Word): void {
        const start = this._selectionStart();
        const end = this._selectionEnd();

        // Case 1: No selection yet - set as start
        if (!start) {
            this._selectionStart.set(word);
            this.updateWordStates();
            return;
        }

        // Case 2: Have complete selection (start + end) - reset and start new
        if (start && end) {
            this.clearSelection();
            this._selectionStart.set(word);
            this.updateWordStates();
            return;
        }

        // Case 3: Have only start, clicking same word - set as both start and end
        if (start && !end && word.index === start.index) {
            this._selectionEnd.set(word);
            this.updateWordStates();
            return;
        }

        // Case 4: Have only start, clicking word before start - replace start
        if (start && !end && word.index < start.index) {
            this._selectionStart.set(word);
            this.updateWordStates();
            return;
        }

        // Case 5: Have only start, clicking word after start - set as end
        if (start && !end && word.index > start.index) {
            this._selectionEnd.set(word);
            this.updateWordStates();
            return;
        }
    }

    /**
     * Clear current selection
     * Resets all selected words to NORMAL or DELETED state
     */
    public clearSelection(): void {
        this._selectionStart.set(null);
        this._selectionEnd.set(null);
        this.updateWordStates();
    }

    /**
     * Update only the start word (for single-word drag in timeline)
     * @param word The new start word
     */
    public updateStartWord(word: Word): void {
        this._selectionStart.set(word);
        this._selectionEnd.set(null);
        this.updateWordStates();
    }

    /**
     * Calculate the new state for a word based on current selection
     * @param word The word to calculate state for
     * @param startIndex Selection start index (or -1 if no start)
     * @param endIndex Selection end index (or -1 if no end)
     * @returns The new WordState for the word
     */
    private calculateWordState(word: Word, startIndex: number, endIndex: number): WordState {
        const wasDeleted = this.isWordDeleted(word);

        // No selection - return to normal or keep deleted
        if (startIndex === -1) {
            return wasDeleted ? WordState.DELETED : WordState.NORMAL;
        }

        // Only start selected
        if (endIndex === -1) {
            if (word.index === startIndex) {
                return wasDeleted ? WordState.DELETED_SELECTED_START : WordState.SELECTED_START;
            }
            return wasDeleted ? WordState.DELETED : WordState.NORMAL;
        }

        // Complete selection (start + end)
        if (word.index === startIndex) {
            return wasDeleted ? WordState.DELETED_SELECTED_START : WordState.SELECTED_START;
        }

        if (word.index === endIndex) {
            return wasDeleted ? WordState.DELETED_SELECTED_END : WordState.SELECTED_END;
        }

        if (word.index > startIndex && word.index < endIndex) {
            return wasDeleted ? WordState.DELETED_SELECTED_RANGE : WordState.SELECTED_RANGE;
        }

        // Not in selection
        return wasDeleted ? WordState.DELETED : WordState.NORMAL;
    }

    /**
     * Update word states based on current selection
     * Updates the state property of each word in the words array
     * Optimized to only create new objects for words that actually changed
     * 
     * Important: Deleted words can be selected (for restoration).
     * When selected, they get a combined state (e.g., DELETED_SELECTED_START)
     */
    private updateWordStates(): void {
        const start = this._selectionStart();
        const end = this._selectionEnd();
        const currentWords = this._words();

        const startIndex = start?.index ?? -1;
        const endIndex = end?.index ?? -1;

        const updatedWords = currentWords.map(word => {
            const newState = this.calculateWordState(word, startIndex, endIndex);

            // If state didn't change, return the same object (no new object creation)
            if (word.state === newState) {
                return word;
            }

            // State changed - create new object
            return {
                ...word,
                state: newState
            };
        });

        this._words.set(updatedWords);
    }

    /**
     * Check if a word is in a deleted state (including combined deleted+selected states)
     * @param word Word to check
     * @returns True if word is deleted
     */
    private isWordDeleted(word: Word): boolean {
        return word.state === WordState.DELETED ||
            word.state === WordState.DELETED_SELECTED_START ||
            word.state === WordState.DELETED_SELECTED_END ||
            word.state === WordState.DELETED_SELECTED_RANGE;
    }

    /**
     * Check if a word is in the current selection
     * @param word Word to check
     * @returns True if word is in selection
     */
    private isWordInSelection(word: Word): boolean {
        const start = this._selectionStart();
        const end = this._selectionEnd();

        if (!start) return false;
        if (!end) return word.index === start.index;

        return word.index >= start.index && word.index <= end.index;
    }

    /**
     * Check if operation would delete all non-deleted words in the video
     * @param wordsToDelete Set of word indices that would be deleted
     * @returns True if operation would delete all remaining words
     */
    private wouldDeleteAllWords(wordsToDelete: Set<number>): boolean {
        const currentWords = this._words();

        // Count non-deleted words
        const nonDeletedWords = currentWords.filter(word => !this.isWordDeleted(word));

        // Count how many of them we're about to delete
        const nonDeletedToDelete = nonDeletedWords.filter(word => wordsToDelete.has(word.index));

        // If we're deleting all non-deleted words, return true
        return nonDeletedWords.length === nonDeletedToDelete.length;
    }

    /**
     * Mark selected words as deleted
     * Used by segment actions in Feature 6
     * @returns True if operation succeeded, false if it would delete all words
     */
    public deleteSelectedWords(): boolean {
        const selected = this.selectedWords();
        if (selected.length === 0) return false;

        const selectedIndices = new Set(selected.map(w => w.index));

        // Check if this would delete all words
        if (this.wouldDeleteAllWords(selectedIndices)) {
            alert('You cannot remove the entire video');
            return false;
        }

        const currentWords = this._words();

        const updatedWords = currentWords.map(word =>
            selectedIndices.has(word.index)
                ? { ...word, state: WordState.DELETED }
                : word
        );

        this._words.set(updatedWords);
        this.clearSelection();
        return true;
    }

    /**
     * Mark all non-selected words as deleted (Keep Only action)
     * Restores selected words to NORMAL state (even if deleted)
     * Used by segment actions in Feature 6
     * @returns True if operation succeeded, false if no selection
     */
    public keepOnlySelectedWords(): boolean {
        const selected = this.selectedWords();
        if (selected.length === 0) return false;

        // Note: No validation needed here because:
        // - Selected words are restored to NORMAL (even if deleted)
        // - This ensures at least the selected words remain in the video

        const currentWords = this._words();
        const selectedIndices = new Set(selected.map(w => w.index));

        const updatedWords = currentWords.map(word =>
            selectedIndices.has(word.index)
                ? { ...word, state: WordState.NORMAL }
                : { ...word, state: WordState.DELETED }
        );

        this._words.set(updatedWords);
        this.clearSelection();
        return true;
    }

    /**
     * Restore selected deleted words to normal state
     * Used by segment actions in Feature 6
     */
    public restoreSelectedWords(): void {
        const selected = this.selectedWords();
        if (selected.length === 0) return;

        const currentWords = this._words();
        const selectedIndices = new Set(selected.map(w => w.index));

        const updatedWords = currentWords.map(word => {
            if (selectedIndices.has(word.index) && this.isWordDeleted(word)) {
                return { ...word, state: WordState.NORMAL };
            }
            return word;
        });

        this._words.set(updatedWords);
        this.clearSelection();
    }

    /**
     * Get non-deleted words for output generation
     * Used by save/output in Feature 9
     * @returns Array of non-deleted words
     */
    public getNonDeletedWords(): Word[] {
        return this._words().filter(word => !this.isWordDeleted(word));
    }

    /**
     * Update current playback word based on video time
     * Called during video playback to highlight the current word
     * @param currentTime Current video time in seconds
     */
    public updateCurrentPlaybackWord(currentTime: number): void {
        const words = this._words();

        // Find word at current time
        const currentWord = words.find(w =>
            currentTime >= w.start && currentTime <= w.end
        );

        if (currentWord) {
            this._currentPlaybackWordIndex.set(currentWord.index);
        } else {
            this._currentPlaybackWordIndex.set(null);
        }
    }

    /**
     * Clear current playback word (when video is paused or stopped)
     */
    public clearCurrentPlaybackWord(): void {
        this._currentPlaybackWordIndex.set(null);
    }

    /**
     * Reset service state
     * Useful for loading new segmentation
     */
    public reset(): void {
        this._words.set([]);
        this._selectionStart.set(null);
        this._selectionEnd.set(null);
        this._currentPlaybackWordIndex.set(null);
    }

    // ========== Feature 8: Undo/Redo State Management ==========

    /**
     * Capture current editor state snapshot
     * Used by HistoryService for undo/redo
     * Creates a deep copy to prevent reference issues
     * @param startHandle Timeline start handle position (or null)
     * @param endHandle Timeline end handle position (or null)
     * @returns Editor state snapshot (deep copy)
     */
    public captureState(startHandle: HandlePosition | null, endHandle: HandlePosition | null): EditorStateSnapshot {
        // Create deep copy of words array to prevent reference issues
        // This is done here instead of in HistoryService to avoid double copying
        const snapshot = {
            words: this._words().map(word => ({ ...word })),
            selectionStart: this._selectionStart() ? { ...this._selectionStart()! } : null,
            selectionEnd: this._selectionEnd() ? { ...this._selectionEnd()! } : null,
            startHandle: startHandle ? { ...startHandle } : null,
            endHandle: endHandle ? { ...endHandle } : null
        };

        return snapshot;
    }

    /**
     * Restore editor state from snapshot
     * Used by HistoryService for undo/redo
     * @param snapshot State snapshot to restore
     */
    public restoreState(snapshot: EditorStateSnapshot): void {

        // Step 1: Restore words array (states are already set in snapshot)
        // IMPORTANT: Word states in snapshot are already correct, so we restore them as-is
        const restoredWords = snapshot.words.map(word => ({ ...word }));
        this._words.set(restoredWords);

        // Step 2: Restore selection AFTER words array is set
        // Use Map for O(1) lookup instead of O(n) find operations
        const wordsByIndex = new Map<number, Word>();
        restoredWords.forEach(word => {
            wordsByIndex.set(word.index, word);
        });

        const restoredStart = snapshot.selectionStart
            ? wordsByIndex.get(snapshot.selectionStart.index) || null
            : null;
        const restoredEnd = snapshot.selectionEnd
            ? wordsByIndex.get(snapshot.selectionEnd.index) || null
            : null;


        // Step 3: Set selection signals - this will trigger timeline effect to update handles
        // Set both signals in the same change detection cycle to avoid intermediate states
        this._selectionStart.set(restoredStart);
        this._selectionEnd.set(restoredEnd);

        // Note: We DON'T call updateWordStates() here because:
        // 1. Word states in snapshot are already correct (they were captured with correct states)
        // 2. Calling updateWordStates() would recalculate states, potentially overwriting restored states
        // 3. The selection signals are set, so UI will update reactively
        // 4. Timeline effect will update handles based on selection automatically
    }
}

