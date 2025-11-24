import { Injectable, signal, computed } from '@angular/core';
import { Word, WordState } from '../models';
import { Gap, GapState } from '../models/gap.interface';

/**
 * Gap Detection Service
 * Handles gap detection logic between words
 * Based on PRD Phase 2: Gap Detection & Review
 * 
 * Features:
 * - Detects gaps between visible words
 * - Configurable threshold (0.1s – 1.0s)
 * - Memoized gap detection for performance
 * - Gap state management (Active/Remove, Ignored/Keep, Selected)
 */
@Injectable()
export class GapDetectionService {
    // Constants
    private static readonly DEFAULT_THRESHOLD = 0.1; // seconds
    private static readonly MIN_THRESHOLD = 0.1; // seconds
    private static readonly MAX_THRESHOLD = 1.0; // seconds

    // Private writable signals
    private readonly _threshold = signal<number>(GapDetectionService.DEFAULT_THRESHOLD);
    private readonly _words = signal<Word[]>([]);
    private readonly _gapStates = signal<Map<number, GapState>>(new Map());
    private readonly _selectedGapId = signal<number | null>(null);

    // Memoization cache
    private _memoizedGaps: Gap[] | null = null;
    private _memoizedWordsHash: string = '';
    private _memoizedThreshold: number = -1;

    // Public read-only signals
    public readonly threshold = this._threshold.asReadonly();
    public readonly selectedGapId = this._selectedGapId.asReadonly();

    /**
     * Computed signal: All detected gaps based on current words and threshold
     * Uses memoization for performance optimization
     */
    public readonly gaps = computed(() => {
        const words = this._words();
        const threshold = this._threshold();

        // Check if we can use memoized result
        const wordsHash = this.getWordsHash(words);
        if (
            this._memoizedGaps !== null &&
            wordsHash === this._memoizedWordsHash &&
            threshold === this._memoizedThreshold
        ) {
            return this._memoizedGaps;
        }

        // Calculate gaps
        const gaps = this.detectGaps(words, threshold);

        // Update memoization cache
        this._memoizedGaps = gaps;
        this._memoizedWordsHash = wordsHash;
        this._memoizedThreshold = threshold;

        return gaps;
    });

    /**
     * Computed signal: Gaps with their current states applied
     */
    public readonly gapsWithStates = computed(() => {
        const gaps = this.gaps();
        const gapStates = this._gapStates();
        const selectedId = this._selectedGapId();

        return gaps.map(gap => {
            // Apply selected state if this gap is selected
            if (selectedId === gap.id) {
                return { ...gap, state: GapState.SELECTED };
            }

            // Apply stored state, or default to ACTIVE if not set
            const storedState = gapStates.get(gap.id);
            return {
                ...gap,
                state: storedState ?? GapState.ACTIVE
            };
        });
    });

    /**
     * Computed signal: Count of gaps marked for removal (ACTIVE state)
     */
    public readonly activeGapsCount = computed(() => {
        return this.gapsWithStates().filter(gap => gap.state === GapState.ACTIVE).length;
    });

    /**
     * Initialize service with words
     * @param words Array of words from editor state
     */
    public initializeWords(words: Word[]): void {
        this._words.set([...words]);
        this._gapStates.set(new Map());
        this._selectedGapId.set(null);
        this.clearMemoization();
    }

    /**
     * Update words array (called when words change)
     * @param words Updated words array
     */
    public updateWords(words: Word[]): void {
        this._words.set([...words]);
        this.clearMemoization();
    }

    /**
     * Set threshold for gap detection
     * @param threshold Threshold value in seconds (0.1s – 1.0s)
     */
    public setThreshold(threshold: number): void {
        const clampedThreshold = Math.max(
            GapDetectionService.MIN_THRESHOLD,
            Math.min(GapDetectionService.MAX_THRESHOLD, threshold)
        );
        this._threshold.set(clampedThreshold);
        this.clearMemoization();
    }

    /**
     * Reset threshold to default value
     */
    public resetThreshold(): void {
        this._threshold.set(GapDetectionService.DEFAULT_THRESHOLD);
        this.clearMemoization();
    }

    /**
     * Toggle gap state between ACTIVE and IGNORED
     * @param gapId ID of the gap to toggle
     */
    public toggleGapState(gapId: number): void {
        const gapStates = new Map(this._gapStates());
        const currentState = gapStates.get(gapId);

        // Toggle between ACTIVE and IGNORED
        const newState = currentState === GapState.IGNORED
            ? GapState.ACTIVE
            : GapState.IGNORED;

        gapStates.set(gapId, newState);
        this._gapStates.set(gapStates);
    }

    /**
     * Set gap state explicitly
     * @param gapId ID of the gap
     * @param state New state to set
     */
    public setGapState(gapId: number, state: GapState): void {
        const gapStates = new Map(this._gapStates());
        gapStates.set(gapId, state);
        this._gapStates.set(gapStates);
    }

    /**
     * Select a gap (for focus/highlight)
     * @param gapId ID of the gap to select, or null to deselect
     */
    public selectGap(gapId: number | null): void {
        this._selectedGapId.set(gapId);
    }

    /**
     * Mark all gaps ≥ threshold as ACTIVE (initial state when entering Gap Review Mode)
     */
    public markAllGapsAsActive(): void {
        const gaps = this.gaps();
        const gapStates = new Map<number, GapState>();

        gaps.forEach(gap => {
            gapStates.set(gap.id, GapState.ACTIVE);
        });

        this._gapStates.set(gapStates);
    }

    /**
     * Reset all gap states (clear manual selections)
     */
    public resetGapStates(): void {
        this._gapStates.set(new Map());
        this._selectedGapId.set(null);
    }

    /**
     * Get gaps that are marked for removal (ACTIVE state)
     * @returns Array of gaps marked for removal
     */
    public getGapsToRemove(): Gap[] {
        return this.gapsWithStates().filter(gap => gap.state === GapState.ACTIVE);
    }

    /**
     * Generate segments after gap removal
     * Based on PRD Phase 2: Gap Removal & Timing Optimization
     * 
     * Algorithm:
     * 1. Get gaps marked for removal
     * 2. Split words into segments based on removed gaps
     * 3. For each segment: start = firstWord.start, end = lastWord.end (strict timing, no padding)
     * 4. If all gaps removed → forms a single segment
     * 
     * @param words Array of words to process (should be non-deleted words)
     * @returns Array of segments with strict timing, or null if empty
     */
    public generateSegmentsAfterGapRemoval(words: Word[]): Array<{ start: number; end: number }> | null {
        if (words.length === 0) {
            return null;
        }

        // Get gaps marked for removal (ACTIVE state)
        const gapsToRemove = this.getGapsToRemove();

        // If no gaps to remove, return single segment with strict timing
        if (gapsToRemove.length === 0) {
            // Single segment: start = firstWord.start, end = lastWord.end
            const sortedWords = [...words].sort((a, b) => a.index - b.index);
            return [{
                start: sortedWords[0].start,
                end: sortedWords[sortedWords.length - 1].end
            }];
        }

        // Sort words by index to ensure proper order
        const sortedWords = [...words].sort((a, b) => a.index - b.index);

        // Create a set of gap IDs for quick lookup
        const gapIdsToRemove = new Set(gapsToRemove.map(gap => gap.id));

        // Split words into segments based on removed gaps
        const segments: Array<{ start: number; end: number }> = [];
        let currentSegmentWords: Word[] = [];

        for (let i = 0; i < sortedWords.length; i++) {
            const word = sortedWords[i];
            currentSegmentWords.push(word);

            // Check if there's a gap after this word that should be removed
            // Gap ID is the index of the word before the gap
            const hasGapToRemove = gapIdsToRemove.has(word.index);

            // If gap should be removed, or this is the last word, finalize current segment
            if (hasGapToRemove || i === sortedWords.length - 1) {
                if (currentSegmentWords.length > 0) {
                    // Strict timing: start = firstWord.start, end = lastWord.end (no padding)
                    const firstWord = currentSegmentWords[0];
                    const lastWord = currentSegmentWords[currentSegmentWords.length - 1];

                    segments.push({
                        start: firstWord.start,
                        end: lastWord.end
                    });
                }
                currentSegmentWords = [];
            }
        }

        // Validate and return
        if (segments.length === 0) {
            return null;
        }

        // Sort chronologically (should already be sorted, but ensure it)
        const sortedSegments = segments.sort((a, b) => a.start - b.start);

        // Validate segments (proper ordering, non-overlapping, duration > 0)
        this.validateSegments(sortedSegments);

        return sortedSegments;
    }

    /**
     * Validate segments after gap removal
     * Ensures:
     * - Proper time ordering
     * - Valid time ranges (start < end, duration > 0)
     * - Non-overlapping segments
     * @param segments Array of segments to validate
     * @throws Error if validation fails
     */
    private validateSegments(segments: Array<{ start: number; end: number }>): void {
        if (segments.length === 0) {
            throw new Error('Segments array is empty');
        }

        // Validate each segment
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];

            // Check valid time range (start < end)
            if (segment.start >= segment.end) {
                throw new Error(`Invalid segment at index ${i}: start (${segment.start}) >= end (${segment.end})`);
            }

            // Check duration > 0
            const duration = segment.end - segment.start;
            if (duration <= 0) {
                throw new Error(`Invalid segment at index ${i}: duration (${duration}) <= 0`);
            }

            // Check proper ordering and non-overlapping (segments should be sorted by start time)
            if (i > 0) {
                const previousSegment = segments[i - 1];

                // Check ordering
                if (segment.start < previousSegment.start) {
                    throw new Error(`Segments not properly ordered: segment at index ${i} starts before previous segment`);
                }

                // Check non-overlapping (previous segment end should be <= current segment start)
                // Note: With gap removal, segments should not overlap, but they may be adjacent
                if (previousSegment.end > segment.start) {
                    throw new Error(`Segments overlap: segment at index ${i} starts before previous segment ends`);
                }
            }
        }
    }

    /**
     * Detect gaps between words
     * Formula: GapDuration = NextWord.start - PreviousWord.end
     * Only gaps between visible (non-deleted) words are detected
     * 
     * @param words Array of words to analyze
     * @param threshold Minimum gap duration to consider valid
     * @returns Array of detected gaps
     */
    private detectGaps(words: Word[], threshold: number): Gap[] {
        const gaps: Gap[] = [];

        // Filter to only visible words (not deleted)
        const visibleWords = words.filter(word =>
            word.state !== WordState.DELETED &&
            word.state !== WordState.DELETED_SELECTED_START &&
            word.state !== WordState.DELETED_SELECTED_END &&
            word.state !== WordState.DELETED_SELECTED_RANGE
        );

        // Sort by index to ensure proper order
        visibleWords.sort((a, b) => a.index - b.index);

        // Detect gaps between consecutive visible words
        for (let i = 0; i < visibleWords.length - 1; i++) {
            const currentWord = visibleWords[i];
            const nextWord = visibleWords[i + 1];

            // Calculate gap duration
            const gapDuration = nextWord.start - currentWord.end;

            // Only include gaps that meet the threshold
            if (gapDuration >= threshold) {
                gaps.push({
                    id: currentWord.index, // Use index of word before gap as ID
                    beforeWordIndex: currentWord.index,
                    afterWordIndex: nextWord.index,
                    duration: gapDuration,
                    state: GapState.ACTIVE, // Default state
                    start: currentWord.end,
                    end: nextWord.start
                });
            }
        }

        return gaps;
    }

    /**
     * Generate a hash for words array for memoization
     * @param words Array of words
     * @returns Hash string
     */
    private getWordsHash(words: Word[]): string {
        // Create a simple hash based on word indices and states
        return words.map(w => `${w.index}:${w.state}`).join(',');
    }

    /**
     * Clear memoization cache
     */
    private clearMemoization(): void {
        this._memoizedGaps = null;
        this._memoizedWordsHash = '';
        this._memoizedThreshold = -1;
    }

}

