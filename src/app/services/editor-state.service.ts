import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { Word, WordState, EditorStateSnapshot } from '../models';
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
    private readonly _deletedSegments = signal<Array<{ start: number; end: number }>>([]);

    // Public read-only signals
    public readonly words = this._words.asReadonly();
    public readonly selectionStart = this._selectionStart.asReadonly();
    public readonly selectionEnd = this._selectionEnd.asReadonly();
    public readonly currentPlaybackWordIndex = this._currentPlaybackWordIndex.asReadonly();
    public readonly deletedSegments = this._deletedSegments.asReadonly();

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
        this.clearDeletedSegments(); // Clear deleted segments when initializing new words
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
     * Saves fine-tuned handle times for proper output generation
     * @param fineTunedStart Optional fine-tuned start handle time (if handles were used)
     * @param fineTunedEnd Optional fine-tuned end handle time (if handles were used)
     * @returns True if operation succeeded, false if it would delete all words
     */
    public deleteSelectedWords(fineTunedStart?: number, fineTunedEnd?: number): boolean {
        const selected = this.selectedWords();
        if (selected.length === 0) return false;

        const selectedIndices = new Set(selected.map(w => w.index));

        // Check if this would delete all words
        if (this.wouldDeleteAllWords(selectedIndices)) {
            alert('You cannot remove the entire video');
            return false;
        }

        // Save fine-tuned deleted segment if provided
        // Handles are always provided together or not at all
        if (fineTunedStart !== undefined && fineTunedEnd !== undefined) {
            this.addDeletedSegment(fineTunedStart, fineTunedEnd);
        } else if (selected.length > 0) {
            // Fallback: use word boundaries if handles not provided
            const firstWord = selected[0];
            const lastWord = selected[selected.length - 1];
            this.addDeletedSegment(firstWord.start, lastWord.end);
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
     * Creates deleted segments for all non-selected words (using word boundaries)
     * @param fineTunedStart Optional fine-tuned start handle time (if handles were used for selection)
     * @param fineTunedEnd Optional fine-tuned end handle time (if handles were used for selection)
     * @returns True if operation succeeded, false if no selection
     */
    public keepOnlySelectedWords(fineTunedStart?: number, fineTunedEnd?: number): boolean {
        const selected = this.selectedWords();
        if (selected.length === 0) return false;

        // Note: No validation needed here because:
        // - Selected words are restored to NORMAL (even if deleted)
        // - This ensures at least the selected words remain in the video

        const currentWords = this._words();
        const selectedIndices = new Set(selected.map(w => w.index));

        // Get selection boundaries - use handles if available, otherwise use word boundaries
        const selectedFirstWord = selected[0];
        const selectedLastWord = selected[selected.length - 1];

        // Calculate selection start using same logic as restore
        // If fine-tuned start is provided, use it
        // Otherwise, if first selected word is the first word in video, start from 0
        // Otherwise, start from the end of the word before the first selected word
        let selectionStart: number;
        if (fineTunedStart !== undefined) {
            selectionStart = fineTunedStart;
        } else {
            const firstWordIndex = currentWords[0]?.index ?? -1;
            if (selectedFirstWord.index === firstWordIndex) {
                // First selected word is the first word - start from 0 to preserve intro
                selectionStart = 0;
            } else {
                // Find the word before the first selected word
                const wordBefore = currentWords.find(w => w.index === selectedFirstWord.index - 1);
                selectionStart = wordBefore ? wordBefore.end : selectedFirstWord.start;
            }
        }

        // Calculate selection end using similar logic
        // If fine-tuned end is provided, use it
        // Otherwise, if last selected word is the last word in video, use its end
        // Otherwise, use the start of the word after the last selected word
        let selectionEnd: number;
        if (fineTunedEnd !== undefined) {
            selectionEnd = fineTunedEnd;
        } else {
            const lastWordIndex = currentWords[currentWords.length - 1]?.index ?? -1;
            if (selectedLastWord.index === lastWordIndex) {
                // Last selected word is the last word - use its end
                selectionEnd = selectedLastWord.end;
            } else {
                // Find the word after the last selected word
                const wordAfter = currentWords.find(w => w.index === selectedLastWord.index + 1);
                selectionEnd = wordAfter ? wordAfter.start : selectedLastWord.end;
            }
        }

        // Create deleted segments for all non-selected words
        // Split into two segments: before selection and after selection
        const newDeletedSegments: Array<{ start: number; end: number }> = [];

        // Get first and last word indices for comparison
        const firstWordIndex = currentWords[0]?.index ?? -1;
        const lastWordIndex = currentWords[currentWords.length - 1]?.index ?? -1;

        // Add deleted segment before selection (if any words exist before)
        if (selectedFirstWord.index > firstWordIndex) {
            const firstWord = currentWords[0];
            if (firstWord) {
                newDeletedSegments.push({
                    start: firstWord.start,
                    end: selectionStart
                });
            }
        }

        // Add deleted segment after selection (if any words exist after)
        if (selectedLastWord.index < lastWordIndex) {
            const lastWord = currentWords[currentWords.length - 1];
            if (lastWord) {
                newDeletedSegments.push({
                    start: selectionEnd,
                    end: lastWord.end
                });
            }
        }

        // Set new deleted segments
        this._deletedSegments.set(newDeletedSegments);

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
     * Removes deleted segments that overlap with restored words
     * @param fineTunedStart Optional fine-tuned start handle time (if handles were moved)
     * @param fineTunedEnd Optional fine-tuned end handle time (if handles were moved)
     */
    public restoreSelectedWords(fineTunedStart?: number, fineTunedEnd?: number): void {
        const selected = this.selectedWords();
        if (selected.length === 0) return;

        const currentWords = this._words();
        const selectedIndices = new Set(selected.map(w => w.index));

        // Get restored range to remove deleted segments
        // Use fine-tuned handle times if provided, otherwise use word boundaries
        const firstWord = selected[0];
        const lastWord = selected[selected.length - 1];

        // If fine-tuned start is provided, use it
        // Otherwise, if first selected word is the first word in video, start from 0
        // Otherwise, start from the end of the word before the first selected word
        let restoredStart: number;
        if (fineTunedStart !== undefined) {
            restoredStart = fineTunedStart;
        } else {
            const firstWordIndex = currentWords[0]?.index ?? -1;
            if (firstWord.index === firstWordIndex) {
                // First selected word is the first word - start from 0 to preserve intro
                restoredStart = 0;
            } else {
                // Find the word before the first selected word
                const wordBefore = currentWords.find(w => w.index === firstWord.index - 1);
                restoredStart = wordBefore ? wordBefore.end : firstWord.start;
            }
        }

        // If fine-tuned end is provided, use it
        // Otherwise, use the end of the last selected word
        const restoredEnd = fineTunedEnd !== undefined ? fineTunedEnd : lastWord.end;

        // Remove deleted segments that overlap with restored range
        this.removeDeletedSegmentsInRange(restoredStart, restoredEnd);

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

        // Strategy: Find the word that best matches the current time
        // Priority 1: Word where time is within the word (start <= time < end)
        // Priority 2: Word where time is very close to start (within 50ms before start)
        // This prevents selecting the previous word when starting playback at word.start

        // First, try to find word where time is within the word boundaries
        let currentWord = words.find(w =>
            currentTime >= w.start && currentTime < w.end
        );

        // If not found, check if we're very close to a word start (within 50ms before)
        // This handles cases where seek is slightly before word.start due to precision issues
        // Find the word with the smallest distance to its start
        if (!currentWord) {
            let closestWord: { word: typeof words[0]; distance: number } | null = null;

            for (const word of words) {
                const timeUntilStart = word.start - currentTime;
                if (timeUntilStart >= 0 && timeUntilStart <= 0.05) { // Within 50ms before start
                    if (!closestWord || timeUntilStart < closestWord.distance) {
                        closestWord = { word, distance: timeUntilStart };
                    }
                }
            }

            if (closestWord) {
                currentWord = closestWord.word;
            }
        }

        // If still not found, check if time is exactly at word.end (within 10ms tolerance)
        if (!currentWord) {
            currentWord = words.find(w =>
                Math.abs(currentTime - w.end) < 0.01 && currentTime >= w.start
            );
        }

        // Final fallback: original logic (for edge cases)
        if (!currentWord) {
            currentWord = words.find(w =>
                currentTime >= w.start && currentTime <= w.end
            );
        }

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
        this._deletedSegments.set([]);
    }

    // ========== Fine-Tuned Deleted Segments Management ==========

    /**
     * Add a deleted segment with fine-tuned handle times
     * Called when user deletes a segment using Remove action
     * Merges overlapping deleted segments to avoid duplicates
     * @param start Fine-tuned start handle time in seconds
     * @param end Fine-tuned end handle time in seconds
     */
    public addDeletedSegment(start: number, end: number): void {
        const currentSegments = this._deletedSegments();
        const newSegment = { start, end };

        // Remove any existing deleted segments that overlap with the new segment
        // We'll replace them with the new one (which has the fine-tuned times)
        const filteredSegments = currentSegments.filter(segment => {
            // Check if segments overlap
            const overlaps = segment.start < end && segment.end > start;
            return !overlaps;
        });

        // Add the new segment and sort by start time
        const updatedSegments = [...filteredSegments, newSegment].sort((a, b) => a.start - b.start);
        this._deletedSegments.set(updatedSegments);
    }

    /**
     * Clear all deleted segments
     * Called when restoring state or resetting
     */
    public clearDeletedSegments(): void {
        this._deletedSegments.set([]);
    }

    /**
     * Remove deleted segments that overlap with restored words
     * Called when user restores deleted words
     * Cuts deleted segments instead of removing them completely if only part is restored
     * @param restoredStart Start time of restored segment
     * @param restoredEnd End time of restored segment
     */
    public removeDeletedSegmentsInRange(restoredStart: number, restoredEnd: number): void {
        const currentSegments = this._deletedSegments();
        const resultSegments: Array<{ start: number; end: number }> = [];

        for (const segment of currentSegments) {
            // Check if segments overlap
            const overlaps = segment.start < restoredEnd && segment.end > restoredStart;

            if (!overlaps) {
                // No overlap - keep segment as-is
                resultSegments.push(segment);
                continue;
            }

            // Segments overlap - cut the deleted segment, keeping only non-overlapping parts
            // Keep part before restored segment (if exists)
            if (segment.start < restoredStart) {
                resultSegments.push({ start: segment.start, end: restoredStart });
            }
            // Keep part after restored segment (if exists)
            if (restoredEnd < segment.end) {
                resultSegments.push({ start: restoredEnd, end: segment.end });
            }
            // If restored segment completely covers deleted segment, nothing is added
        }

        // Sort by start time
        resultSegments.sort((a, b) => a.start - b.start);

        // Merge adjacent segments (segments that touch or overlap)
        const mergedSegments: Array<{ start: number; end: number }> = [];
        for (const segment of resultSegments) {
            if (mergedSegments.length === 0) {
                mergedSegments.push(segment);
                continue;
            }

            const lastSegment = mergedSegments[mergedSegments.length - 1];
            // Check if segments are adjacent (touch) or overlap
            // Adjacent: lastSegment.end >= segment.start (they touch or overlap)
            if (lastSegment.end >= segment.start) {
                // Merge: extend the last segment to cover both
                lastSegment.end = Math.max(lastSegment.end, segment.end);
            } else {
                // Not adjacent - add as new segment
                mergedSegments.push(segment);
            }
        }

        this._deletedSegments.set(mergedSegments);
    }

    /**
     * Get all deleted segments with fine-tuned times
     * @returns Array of deleted segments with fine-tuned times
     */
    public getDeletedSegments(): Array<{ start: number; end: number }> {
        return this._deletedSegments();
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
        const words = this._words();

        // OPTIMIZATION: Only store word states, not full word objects
        // Word properties (text, start, end, confidence, index) never change
        const wordStates = words.map(word => word.state);

        return {
            wordStates: wordStates,
            selectionStartIndex: this._selectionStart()?.index ?? null,
            selectionEndIndex: this._selectionEnd()?.index ?? null,
            startHandle: startHandle ? { ...startHandle } : null,
            endHandle: endHandle ? { ...endHandle } : null,
            deletedSegments: this._deletedSegments().map(seg => ({ ...seg }))
        };
    }

    /**
     * Restore editor state from snapshot
     * Used by HistoryService for undo/redo
     * @param snapshot State snapshot to restore
     */
    public restoreState(snapshot: EditorStateSnapshot): void {
        // Get current words (word properties never change, only states)
        const currentWords = this._words();

        // Step 1: Restore word states
        let restoredWords: Word[];

        if (snapshot.wordStates && snapshot.wordStates.length > 0) {
            // New optimized format: only states array
            restoredWords = currentWords.map((word, index) => ({
                ...word,
                state: snapshot.wordStates[index] ?? word.state
            }));
        } else {
            // Fallback: use current words as-is
            restoredWords = currentWords.map(word => ({ ...word }));
        }

        this._words.set(restoredWords);

        // Step 2: Restore deleted segments with fine-tuned times
        const restoredDeletedSegments = (snapshot.deletedSegments || []).map(seg => ({ ...seg }));
        this._deletedSegments.set(restoredDeletedSegments);


        // Step 3: Restore selection AFTER words array is set
        // Support both new format (indices) and legacy format (Word objects)
        let restoredStart: Word | null = null;
        let restoredEnd: Word | null = null;

        if (snapshot.selectionStartIndex !== undefined && snapshot.selectionStartIndex !== null) {
            // New format: use index
            restoredStart = restoredWords.find(w => w.index === snapshot.selectionStartIndex!) ?? null;
        }
        if (snapshot.selectionEndIndex !== undefined && snapshot.selectionEndIndex !== null) {
            // New format: use index
            restoredEnd = restoredWords.find(w => w.index === snapshot.selectionEndIndex!) ?? null;
        }

        // Step 4: Set selection signals - this will trigger timeline effect to update handles
        this._selectionStart.set(restoredStart);
        this._selectionEnd.set(restoredEnd);

        // Note: We DON'T call updateWordStates() here because:
        // 1. Word states in snapshot are already correct (they were captured with correct states)
        // 2. Calling updateWordStates() would recalculate states, potentially overwriting restored states
        // 3. The selection signals are set, so UI will update reactively
        // 4. Timeline effect will update handles based on selection automatically
    }
}

