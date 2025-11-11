import { Injectable, signal, computed, effect } from '@angular/core';
import { Word, WordState } from '../models';

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
     * Update word states based on current selection
     * Updates the state property of each word in the words array
     * 
     * Important: Deleted words can be selected (for restoration).
     * When selected, they get a combined state (e.g., DELETED_SELECTED_START)
     */
    private updateWordStates(): void {
        const start = this._selectionStart();
        const end = this._selectionEnd();
        const currentWords = this._words();

        const updatedWords = currentWords.map(word => {
            // Check if word was originally deleted (before any selection changes)
            const wasDeleted = this.isWordDeleted(word);

            // No selection - return to normal or keep deleted
            if (!start) {
                return {
                    ...word,
                    state: wasDeleted ? WordState.DELETED : WordState.NORMAL
                };
            }

            // Only start selected
            if (!end) {
                if (word.index === start.index) {
                    return {
                        ...word,
                        state: wasDeleted ? WordState.DELETED_SELECTED_START : WordState.SELECTED_START
                    };
                }
                return {
                    ...word,
                    state: wasDeleted ? WordState.DELETED : WordState.NORMAL
                };
            }

            // Complete selection (start + end)
            if (word.index === start.index) {
                return {
                    ...word,
                    state: wasDeleted ? WordState.DELETED_SELECTED_START : WordState.SELECTED_START
                };
            }

            if (word.index === end.index) {
                return {
                    ...word,
                    state: wasDeleted ? WordState.DELETED_SELECTED_END : WordState.SELECTED_END
                };
            }

            if (word.index > start.index && word.index < end.index) {
                return {
                    ...word,
                    state: wasDeleted ? WordState.DELETED_SELECTED_RANGE : WordState.SELECTED_RANGE
                };
            }

            // Not in selection
            return {
                ...word,
                state: wasDeleted ? WordState.DELETED : WordState.NORMAL
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
     * Used by segment actions in Feature 6
     * @returns True if operation succeeded, false if selection contains only deleted words
     */
    public keepOnlySelectedWords(): boolean {
        const selected = this.selectedWords();
        if (selected.length === 0) return false;

        // Check if selection has any non-deleted words (would result in empty video if all deleted)
        const hasNonDeletedWords = selected.some(word => !this.isWordDeleted(word));
        if (!hasNonDeletedWords) {
            alert('You cannot remove the entire video');
            return false;
        }

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
}

