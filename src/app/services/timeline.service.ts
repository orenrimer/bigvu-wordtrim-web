import { Injectable, signal, computed } from '@angular/core';
import { Word, WordState } from '../models';

/**
 * Handle Position
 * Represents the position of a timeline handle
 */
export interface HandlePosition {
    /** Time position in seconds */
    time: number;
    /** Percentage position on timeline (0-100) */
    percentage: number;
    /** Associated word index (if snapped to word) */
    wordIndex: number | null;
}

/**
 * Timeline State
 */
export interface TimelineState {
    startHandle: HandlePosition | null;
    endHandle: HandlePosition | null;
    totalDuration: number;
}

/**
 * Timeline Service
 * Manages timeline state and handle positions using Angular Signals
 * Based on PRD: Timeline Handles & Fine-Tuning
 * 
 * Features:
 * - Handle position management (start/end)
 * - Calculate positions from word selection
 * - Fine-tuning logic (sub-word precision)
 * - Update selection based on handle drag
 * - Handle interactions across deleted words
 */
@Injectable({
    providedIn: 'root'
})
export class TimelineService {
    // Private writable signals
    private readonly _startHandle = signal<HandlePosition | null>(null);
    private readonly _endHandle = signal<HandlePosition | null>(null);
    private readonly _totalDuration = signal<number>(0);
    private readonly _words = signal<Word[]>([]);
    private readonly _isSingleWordMode = signal<boolean>(false); // Track if we're in single-word mode

    // Public read-only signals
    public readonly startHandle = this._startHandle.asReadonly();
    public readonly endHandle = this._endHandle.asReadonly();
    public readonly totalDuration = this._totalDuration.asReadonly();
    public readonly isSingleWordMode = this._isSingleWordMode.asReadonly();

    // Computed signals
    public readonly hasHandles = computed(() =>
        this._startHandle() !== null || this._endHandle() !== null
    );

    public readonly selectedDuration = computed(() => {
        const start = this._startHandle();
        const end = this._endHandle();
        if (!start || !end) return 0;
        return end.time - start.time;
    });

    /**
     * Initialize timeline with words and duration
     * Creates two handles at start (0%) and end (100%) by default
     * @param words Array of words from segmentation
     * @param duration Total video duration in seconds
     */
    public initialize(words: Word[], duration: number): void {
        this._words.set([...words]);
        this._totalDuration.set(duration);
        // Don't create handles here - they will be created when user selects words
    }

    /**
     * Update words array (called when words change)
     * @param words Updated words array
     */
    public updateWords(words: Word[]): void {
        this._words.set([...words]);
    }

    /**
     * Calculate and set handle positions from word selection
     * Called when user selects words via WordChipComponent
     * Updates handle positions and ties them to words
     * @param startWord Selection start word
     * @param endWord Selection end word (optional)
     */
    public setHandlesFromSelection(startWord: Word, endWord: Word | null): void {
        const duration = this._totalDuration();

        if (!endWord) {
            // Single word mode - only show one handle in the middle of the word
            this._isSingleWordMode.set(true);
            const midpoint = (startWord.start + startWord.end) / 2;
            const handle: HandlePosition = {
                time: midpoint,
                percentage: (midpoint / duration) * 100,
                wordIndex: startWord.index
            };
            this._startHandle.set(handle);
            this._endHandle.set(null);
        } else {
            // Range selection mode - show both handles
            this._isSingleWordMode.set(false);

            // Set start handle at middle of start word
            const startMidpoint = (startWord.start + startWord.end) / 2;
            const startHandle: HandlePosition = {
                time: startMidpoint,
                percentage: (startMidpoint / duration) * 100,
                wordIndex: startWord.index
            };
            this._startHandle.set(startHandle);

            // Set end handle at end of end word
            const endHandle: HandlePosition = {
                time: endWord.end,
                percentage: (endWord.end / duration) * 100,
                wordIndex: endWord.index
            };
            this._endHandle.set(endHandle);
        }
    }

    /**
     * Update start handle position (called during drag)
     * @param time New time position in seconds
     * @returns Updated handle position
     */
    public updateStartHandle(time: number): HandlePosition {
        const duration = this._totalDuration();
        const clampedTime = Math.max(0, Math.min(time, duration));

        // In single word mode, snap to center of word
        if (this._isSingleWordMode()) {
            const words = this._words();
            const word = words.find(w => clampedTime >= w.start && clampedTime <= w.end);

            if (word) {
                const midpoint = (word.start + word.end) / 2;
                const handle: HandlePosition = {
                    time: midpoint,
                    percentage: (midpoint / duration) * 100,
                    wordIndex: word.index
                };
                this._startHandle.set(handle);
                return handle;
            }
        }

        // Range mode - free positioning
        const handle: HandlePosition = {
            time: clampedTime,
            percentage: (clampedTime / duration) * 100,
            wordIndex: this.findWordIndexAtTime(clampedTime)
        };

        this._startHandle.set(handle);
        return handle;
    }

    /**
     * Update end handle position (called during drag)
     * @param time New time position in seconds
     * @returns Updated handle position
     */
    public updateEndHandle(time: number): HandlePosition {
        const duration = this._totalDuration();
        const startTime = this._startHandle()?.time ?? 0;
        const clampedTime = Math.max(startTime, Math.min(time, duration));

        const handle: HandlePosition = {
            time: clampedTime,
            percentage: (clampedTime / duration) * 100,
            wordIndex: this.findWordIndexAtTime(clampedTime)
        };

        this._endHandle.set(handle);
        return handle;
    }

    /**
     * Find word index at specific time position
     * @param time Time in seconds
     * @returns Word index or null
     */
    private findWordIndexAtTime(time: number): number | null {
        const words = this._words();
        const word = words.find(w => time >= w.start && time <= w.end);
        return word ? word.index : null;
    }

    /**
     * Calculate which words should be in selection based on handle positions
     * Implements sub-word precision logic:
     * - If handle is past midpoint of word, word exits selection
     * @returns Array of word indices that should be selected
     */
    public calculateSelectedWordIndices(): number[] {
        const startHandle = this._startHandle();
        const endHandle = this._endHandle();
        const words = this._words();

        if (!startHandle || !endHandle) return [];

        const selectedIndices: number[] = [];

        for (const word of words) {
            // Check if word is within selection range
            const wordMidpoint = (word.start + word.end) / 2;

            // Word is selected if its midpoint is between the handles
            if (wordMidpoint >= startHandle.time && wordMidpoint <= endHandle.time) {
                selectedIndices.push(word.index);
            }
        }

        return selectedIndices;
    }

    /**
     * Get selection bounds (start and end times) from handle positions
     * Used for video preview and output generation
     * @returns Object with start and end times, or null
     */
    public getSelectionBounds(): { start: number; end: number } | null {
        const startHandle = this._startHandle();
        const endHandle = this._endHandle();

        if (!startHandle) return null;

        // Single word mode - return bounds of the word under the handle
        if (this._isSingleWordMode() && !endHandle) {
            const words = this._words();
            const word = words.find(w => startHandle.wordIndex === w.index);
            if (word) {
                return {
                    start: word.start,
                    end: word.end
                };
            }
            return null;
        }

        // Range mode - return handle positions
        if (!endHandle) return null;

        return {
            start: startHandle.time,
            end: endHandle.time
        };
    }

    /**
     * Clear handles (called when selection is cleared)
     */
    public clearHandles(): void {
        this._startHandle.set(null);
        this._endHandle.set(null);
        this._isSingleWordMode.set(false);
    }

    /**
     * Check if time position is within a deleted word segment
     * @param time Time in seconds
     * @returns True if position is in deleted segment
     */
    public isTimeInDeletedSegment(time: number): boolean {
        const words = this._words();
        const word = words.find(w => time >= w.start && time <= w.end);
        return word ? word.state === WordState.DELETED : false;
    }

    /**
     * Get all words in current timeline
     * @returns Array of words
     */
    public getWords(): Word[] {
        return this._words();
    }

    /**
     * Convert time to percentage position on timeline
     * @param time Time in seconds
     * @returns Percentage (0-100)
     */
    public timeToPercentage(time: number): number {
        const duration = this._totalDuration();
        if (duration === 0) return 0;
        return (time / duration) * 100;
    }

    /**
     * Convert percentage position to time
     * @param percentage Percentage (0-100)
     * @returns Time in seconds
     */
    public percentageToTime(percentage: number): number {
        const duration = this._totalDuration();
        return (percentage / 100) * duration;
    }

    /**
     * Reset service state
     */
    public reset(): void {
        this._startHandle.set(null);
        this._endHandle.set(null);
        this._totalDuration.set(0);
        this._words.set([]);
    }
}

