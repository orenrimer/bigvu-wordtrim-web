import { Injectable, signal, computed } from '@angular/core';
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

    // Public read-only signals
    public readonly words = this._words.asReadonly();
    public readonly selectionStart = this._selectionStart.asReadonly();
    public readonly selectionEnd = this._selectionEnd.asReadonly();

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
        this.selectedWords().filter(word => word.state === WordState.DELETED).length
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

        // Case 3: Have only start, clicking same word - do nothing (already selected as start)
        if (start && !end && word.index === start.index) {
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
     * Update word states based on current selection
     * Updates the state property of each word in the words array
     */
    private updateWordStates(): void {
        const start = this._selectionStart();
        const end = this._selectionEnd();
        const currentWords = this._words();

        const updatedWords = currentWords.map(word => {
            // Preserve deleted state if word is deleted
            if (word.state === WordState.DELETED && !this.isWordInSelection(word)) {
                return word;
            }

            // Determine new state based on selection
            if (!start) {
                // No selection - return to normal or keep deleted
                return {
                    ...word,
                    state: word.state === WordState.DELETED ? WordState.DELETED : WordState.NORMAL
                };
            }

            if (!end) {
                // Only start selected
                if (word.index === start.index) {
                    return { ...word, state: WordState.SELECTED_START };
                }
                return {
                    ...word,
                    state: word.state === WordState.DELETED ? WordState.DELETED : WordState.NORMAL
                };
            }

            // Complete selection (start + end)
            if (word.index === start.index) {
                return { ...word, state: WordState.SELECTED_START };
            }

            if (word.index === end.index) {
                return { ...word, state: WordState.SELECTED_END };
            }

            if (word.index > start.index && word.index < end.index) {
                return { ...word, state: WordState.SELECTED_RANGE };
            }

            // Not in selection
            return {
                ...word,
                state: word.state === WordState.DELETED ? WordState.DELETED : WordState.NORMAL
            };
        });

        this._words.set(updatedWords);
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
     * Mark selected words as deleted
     * Used by segment actions in Feature 6
     */
    public deleteSelectedWords(): void {
        const selected = this.selectedWords();
        if (selected.length === 0) return;

        const currentWords = this._words();
        const selectedIndices = new Set(selected.map(w => w.index));

        const updatedWords = currentWords.map(word =>
            selectedIndices.has(word.index)
                ? { ...word, state: WordState.DELETED }
                : word
        );

        this._words.set(updatedWords);
        this.clearSelection();
    }

    /**
     * Mark all non-selected words as deleted (Keep Only action)
     * Used by segment actions in Feature 6
     */
    public keepOnlySelectedWords(): void {
        const selected = this.selectedWords();
        if (selected.length === 0) return;

        const currentWords = this._words();
        const selectedIndices = new Set(selected.map(w => w.index));

        const updatedWords = currentWords.map(word =>
            selectedIndices.has(word.index)
                ? { ...word, state: WordState.NORMAL }
                : { ...word, state: WordState.DELETED }
        );

        this._words.set(updatedWords);
        this.clearSelection();
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

        const updatedWords = currentWords.map(word =>
            selectedIndices.has(word.index) && word.state === WordState.DELETED
                ? { ...word, state: WordState.NORMAL }
                : word
        );

        this._words.set(updatedWords);
        this.clearSelection();
    }

    /**
     * Get non-deleted words for output generation
     * Used by save/output in Feature 9
     * @returns Array of non-deleted words
     */
    public getNonDeletedWords(): Word[] {
        return this._words().filter(word => word.state !== WordState.DELETED);
    }

    /**
     * Reset service state
     * Useful for loading new segmentation
     */
    public reset(): void {
        this._words.set([]);
        this._selectionStart.set(null);
        this._selectionEnd.set(null);
    }
}

