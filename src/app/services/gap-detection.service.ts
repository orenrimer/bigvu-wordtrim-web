import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { Word, WordState } from '../models';
import { Gap, GapState } from '../models/gap.interface';
import { VideoPlayerService } from './video-player.service';

/**
 * Gap Detection Service
 * Handles gap detection logic between words
 * Based on PRD Phase 2: Gap Detection & Review
 * 
 * Features:
 * - Detects gaps between visible words
 * - Configurable threshold (0.1s – 1.0s)
 * - Memoized gap detection for performance
 * - Gap state management (Selected/Remove, Ignored/Keep, Active/Deleted)
 */
@Injectable()
export class GapDetectionService {
    // Inject services
    private readonly videoPlayerService = inject(VideoPlayerService);

    // Constants
    private static readonly DEFAULT_THRESHOLD = 0.1; // seconds
    private static readonly MIN_THRESHOLD = 0.1; // seconds
    private static readonly MAX_THRESHOLD = 1.0; // seconds

    // Private writable signals
    private readonly _threshold = signal<number>(GapDetectionService.DEFAULT_THRESHOLD);
    private readonly _words = signal<Word[]>([]);
    private readonly _fillerWords = signal<Word[]>([]); // Filler words treated as gaps
    private readonly _gapStates = signal<Map<number, GapState>>(new Map());
    private readonly _selectedGapId = signal<number | null>(null);
    private readonly _deletedGaps = signal<Array<{ start: number; end: number }>>([]); // Deleted gaps for preview skipping

    // Special gap IDs for intro and outro
    public static readonly INTRO_GAP_ID = -1;
    public static readonly OUTRO_GAP_ID = -2;
    // Filler words use IDs starting from -1000 (set in segmentation-loader.service.ts)

    // Memoization cache
    private _memoizedGaps: Gap[] | null = null;
    private _memoizedWordsHash: string = '';
    private _memoizedThreshold: number = -1;
    private _memoizedVideoDuration: number = -1;

    // Public read-only signals
    public readonly threshold = this._threshold.asReadonly();
    public readonly selectedGapId = this._selectedGapId.asReadonly();

    constructor() {
        // Effect: Automatically mark all gaps as ACTIVE when first detected
        // This ensures all gaps start with ACTIVE state (marked for removal)
        effect(() => {
            const gaps = this.gaps();
            const gapStates = this._gapStates();
            const updatedStates = new Map(gapStates);
            let statesChanged = false;

            // Ensure all gaps have ACTIVE state (for removal)
            gaps.forEach(gap => {
                if (!updatedStates.has(gap.id)) {
                    // New gap detected - mark as ACTIVE automatically (to be removed)
                    updatedStates.set(gap.id, GapState.ACTIVE);
                    statesChanged = true;
                }
            });

            // Remove states for gaps that no longer exist
            const gapIds = new Set(gaps.map(g => g.id));
            updatedStates.forEach((state, gapId) => {
                if (!gapIds.has(gapId)) {
                    updatedStates.delete(gapId);
                    statesChanged = true;
                }
            });

            // Update states if changes were detected
            if (statesChanged) {
                this._gapStates.set(updatedStates);
            }
        });
    }

    /**
     * Computed signal: All detected gaps based on current words and threshold
     * Includes regular gaps between words AND filler words as gaps
     * Uses memoization for performance optimization
     */
    public readonly gaps = computed(() => {
        const words = this._words();
        const fillerWords = this._fillerWords();
        const threshold = this._threshold();
        const videoDuration = this.videoPlayerService.duration(); // Track video duration for memoization

        // Check if we can use memoized result
        const wordsHash = this.getWordsHash(words);
        const fillerWordsHash = this.getWordsHash(fillerWords);
        const combinedHash = `${wordsHash}|${fillerWordsHash}`;
        if (
            this._memoizedGaps !== null &&
            combinedHash === this._memoizedWordsHash &&
            threshold === this._memoizedThreshold &&
            videoDuration === this._memoizedVideoDuration
        ) {
            return this._memoizedGaps;
        }

        // Calculate gaps (includes regular gaps and filler words)
        const gaps = this.detectGaps(words, threshold, fillerWords);

        // Update memoization cache
        this._memoizedGaps = gaps;
        this._memoizedWordsHash = combinedHash;
        this._memoizedThreshold = threshold;
        this._memoizedVideoDuration = videoDuration;

        return gaps;
    });

    /**
     * Computed signal: Gaps with their current states applied
     * All gaps are automatically marked as ACTIVE when first detected (via effect)
     */
    public readonly gapsWithStates = computed(() => {
        const gaps = this.gaps();
        const gapStates = this._gapStates();

        return gaps.map(gap => {
            // Apply stored state, or default to ACTIVE if not set (shouldn't happen due to effect)
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
     * Computed signal: Count of filler words (gaps with fillerWordText)
     */
    public readonly fillerWordsCount = computed(() => {
        return this.gapsWithStates().filter(gap => gap.fillerWordText).length;
    });

    /**
     * Initialize service with words and filler words
     * @param words Array of words from editor state
     * @param fillerWords Array of filler words (optional)
     */
    public initializeWords(words: Word[], fillerWords: Word[] = []): void {
        this._words.set([...words]);
        this._fillerWords.set([...fillerWords]);
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
     * Update filler words array
     * @param fillerWords Updated filler words array
     */
    public updateFillerWords(fillerWords: Word[]): void {
        this._fillerWords.set([...fillerWords]);
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
     * Set gap state explicitly
     * @param gapId ID of the gap
     * @param state New state to set
     */
    public setGapState(gapId: number, state: GapState): void {
        const gapStates = new Map(this._gapStates());
        gapStates.set(gapId, state);
        this._gapStates.set(gapStates);
        // Note: Selection is independent of state, so we don't need to update anything else
    }

    /**
     * Select a gap (for visual focus/highlight only)
     * Selection is purely visual - does not change the gap's logical state (ACTIVE/IGNORED)
     * @param gapId ID of the gap to select, or null to deselect
     */
    public selectGap(gapId: number | null): void {
        // Only update the selected gap ID - don't change gap states
        this._selectedGapId.set(gapId);
    }

    /**
     * Mark all gaps ≥ threshold as ACTIVE (initial state when entering Gap Review Mode)
     * Preserves existing gap states - only sets ACTIVE for gaps that don't have a saved state
     */
    public markAllGapsAsActive(): void {
        const gaps = this.gaps();
        const existingStates = this._gapStates();
        const gapStates = new Map<number, GapState>(existingStates); // Start with existing states

        // Only set ACTIVE for gaps that don't have a saved state
        gaps.forEach(gap => {
            if (!gapStates.has(gap.id)) {
                gapStates.set(gap.id, GapState.ACTIVE);
            }
            // If gap already has a state (IGNORED or ACTIVE), keep it
        });

        this._gapStates.set(gapStates);
    }

    /**
     * Mark all gaps as IGNORED (remove all from removal list)
     * Used by "Remove All" button in Gap Review Mode
     */
    public markAllGapsAsIgnored(): void {
        const gaps = this.gaps();
        const gapStates = new Map<number, GapState>();

        gaps.forEach(gap => {
            gapStates.set(gap.id, GapState.IGNORED);
        });

        this._gapStates.set(gapStates);
    }

    /**
     * Mark all gaps as ACTIVE (deleted)
     * Used by "Remove All" button in Gap Review Mode
     */
    public markAllGapsAsDeleted(): void {
        const gaps = this.gaps();
        const gapStates = new Map<number, GapState>();

        gaps.forEach(gap => {
            gapStates.set(gap.id, GapState.ACTIVE);
        });

        this._gapStates.set(gapStates);
    }

    /**
     * Reset all gap states (clear manual selections)
     * Note: Filler words are not cleared, only their states are reset
     */
    public resetGapStates(): void {
        this._gapStates.set(new Map());
        this._selectedGapId.set(null);
        this._deletedGaps.set([]); // Also clear deleted gaps
        // Note: Filler words persist - they are part of the segmentation data
    }

    /**
     * Navigate to previous gap
     * Uses selectGap() to properly handle state restoration
     * @returns ID of previous gap, or null if none
     */
    public selectPreviousGap(): number | null {
        const gaps = this.gapsWithStates();
        const currentGapId = this._selectedGapId();

        if (gaps.length === 0) return null;

        if (currentGapId === null) {
            // No gap selected - select last gap
            const lastGap = gaps[gaps.length - 1];
            this.selectGap(lastGap.id);
            return lastGap.id;
        }

        // Find current gap index
        const currentIndex = gaps.findIndex(gap => gap.id === currentGapId);
        if (currentIndex === -1) {
            // Current gap not found - select last gap
            const lastGap = gaps[gaps.length - 1];
            this.selectGap(lastGap.id);
            return lastGap.id;
        }

        // Select previous gap (wrap to last if at first)
        const previousIndex = currentIndex === 0 ? gaps.length - 1 : currentIndex - 1;
        const previousGap = gaps[previousIndex];
        this.selectGap(previousGap.id);
        return previousGap.id;
    }

    /**
     * Navigate to next gap
     * Uses selectGap() to properly handle state restoration
     * @returns ID of next gap, or null if none
     */
    public selectNextGap(): number | null {
        const gaps = this.gapsWithStates();
        const currentGapId = this._selectedGapId();

        if (gaps.length === 0) return null;

        if (currentGapId === null) {
            // No gap selected - select first gap
            const firstGap = gaps[0];
            this.selectGap(firstGap.id);
            return firstGap.id;
        }

        // Find current gap index
        const currentIndex = gaps.findIndex(gap => gap.id === currentGapId);
        if (currentIndex === -1) {
            // Current gap not found - select first gap
            const firstGap = gaps[0];
            this.selectGap(firstGap.id);
            return firstGap.id;
        }

        // Select next gap (wrap to first if at last)
        const nextIndex = currentIndex === gaps.length - 1 ? 0 : currentIndex + 1;
        const nextGap = gaps[nextIndex];
        this.selectGap(nextGap.id);
        return nextGap.id;
    }

    /**
     * Mark specific gap as ACTIVE (deleted)
     * Also adds the gap to deleted gaps array for preview skipping
     * @param gapId ID of the gap to mark as active/deleted
     * @returns Gap information if found, null otherwise. Includes shouldPlayPreview flag
     */
    public markGapAsDeleted(gapId: number): { gap: Gap; shouldPlayPreview: boolean } | null {
        this.setGapState(gapId, GapState.ACTIVE);

        // Add gap to deleted gaps array for preview skipping
        const gaps = this.gapsWithStates();
        const gap = gaps.find(g => g.id === gapId);

        if (!gap) {
            return null;
        }

        this.addDeletedGap(gap.start, gap.end);

        // Get video duration from video player service
        const videoDuration = this.videoPlayerService.duration();

        // Check if gap can play preview
        let shouldPlayPreview = false;
        if (videoDuration > 0) {
            const PREVIEW_THRESHOLD = 1.5; // seconds - minimum space needed before/after for preview

            // Special handling for intro and outro gaps
            if (gapId === GapDetectionService.INTRO_GAP_ID) {
                // Intro gap: Can preview if there's content after the gap (at least 1.5 seconds)
                shouldPlayPreview = gap.end <= (videoDuration - PREVIEW_THRESHOLD);
            } else if (gapId === GapDetectionService.OUTRO_GAP_ID) {
                // Outro gap: Can preview if there's content before the gap (at least 1.5 seconds)
                shouldPlayPreview = gap.start >= PREVIEW_THRESHOLD;
            } else {
                // Regular gap: Need space before and after
                shouldPlayPreview = gap.start >= PREVIEW_THRESHOLD &&
                    gap.end <= (videoDuration - PREVIEW_THRESHOLD);
            }
        }

        return { gap, shouldPlayPreview };
    }

    /**
     * Add a gap to deleted gaps array
     * Used for preview playback skipping
     * @param start Gap start time
     * @param end Gap end time
     */
    public addDeletedGap(start: number, end: number): void {
        const deletedGaps = this._deletedGaps();
        // Check if gap already exists (avoid duplicates)
        const exists = deletedGaps.some(g => g.start === start && g.end === end);
        if (!exists) {
            this._deletedGaps.set([...deletedGaps, { start, end }]);
        }
    }

    /**
     * Get deleted gaps array
     * @returns Array of deleted gaps with start and end times
     */
    public getDeletedGaps(): Array<{ start: number; end: number }> {
        return this._deletedGaps();
    }

    /**
     * Clear deleted gaps array
     */
    public clearDeletedGaps(): void {
        this._deletedGaps.set([]);
    }

    /**
     * Mark specific gap as IGNORED (Keep)
     * @param gapId ID of the gap to mark as ignored
     * @returns Gap information if found, null otherwise. Includes shouldPlayPreview flag
     */
    public markGapAsIgnored(gapId: number): { gap: Gap; shouldPlayPreview: boolean } | null {
        this.setGapState(gapId, GapState.IGNORED);

        const gaps = this.gapsWithStates();
        const gap = gaps.find(g => g.id === gapId);

        if (!gap) {
            return null;
        }

        // Get video duration from video player service
        const videoDuration = this.videoPlayerService.duration();

        // Check if gap can play preview
        let shouldPlayPreview = false;
        if (videoDuration > 0) {
            const PREVIEW_THRESHOLD = 1.5; // seconds - minimum space needed before/after for preview

            // Special handling for intro and outro gaps
            if (gapId === GapDetectionService.INTRO_GAP_ID) {
                // Intro gap: Can preview if there's content after the gap (at least 1.5 seconds)
                shouldPlayPreview = gap.end <= (videoDuration - PREVIEW_THRESHOLD);
            } else if (gapId === GapDetectionService.OUTRO_GAP_ID) {
                // Outro gap: Can preview if there's content before the gap (at least 1.5 seconds)
                shouldPlayPreview = gap.start >= PREVIEW_THRESHOLD;
            } else {
                // Regular gap: Need space before and after
                shouldPlayPreview = gap.start >= PREVIEW_THRESHOLD &&
                    gap.end <= (videoDuration - PREVIEW_THRESHOLD);
            }
        }

        return { gap, shouldPlayPreview };
    }

    /**
     * Get current state of a specific gap
     * @param gapId ID of the gap
     * @returns Current state of the gap, or ACTIVE if not set
     */
    public getGapState(gapId: number): GapState {
        const gapStates = this._gapStates();
        return gapStates.get(gapId) ?? GapState.ACTIVE;
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

        // Create a set of gap IDs for quick lookup (for regular gaps)
        const gapIdsToRemove = new Set(gapsToRemove.map(gap => gap.id));

        // Create a set of time ranges for removed gaps (including filler words)
        // This helps us identify if there's a gap (regular or filler) that should be removed
        const removedGapRanges = new Set<string>();
        gapsToRemove.forEach(gap => {
            removedGapRanges.add(`${gap.start}-${gap.end}`);
        });

        // Split words into segments based on removed gaps
        const segments: Array<{ start: number; end: number }> = [];
        let currentSegmentWords: Word[] = [];

        for (let i = 0; i < sortedWords.length; i++) {
            const word = sortedWords[i];
            currentSegmentWords.push(word);

            // Check if there's a gap after this word that should be removed
            // For regular gaps: Gap ID is the index of the word before the gap
            // For filler words: Check if there's a removed gap that overlaps with the space after this word
            let hasGapToRemove = gapIdsToRemove.has(word.index);

            // Also check for filler word gaps that overlap with the space after this word
            if (!hasGapToRemove && i < sortedWords.length - 1) {
                const nextWord = sortedWords[i + 1];
                const gapStart = word.end;
                const gapEnd = nextWord.start;
                const gapRangeKey = `${gapStart}-${gapEnd}`;
                hasGapToRemove = removedGapRanges.has(gapRangeKey);
            }

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
     * Detect gaps between words, including intro and outro gaps
     * Also includes filler words as gaps
     * Formula: GapDuration = NextWord.start - PreviousWord.end
     * Only gaps between visible (non-deleted) words are detected
     * Also detects intro gap (0 to first word) and outro gap (last word to video end)
     * Filler words are treated as gaps with their own IDs (negative IDs starting from -1000)
     * 
     * @param words Array of words to analyze
     * @param threshold Minimum gap duration to consider valid
     * @param fillerWords Array of filler words to include as gaps
     * @returns Array of detected gaps (regular gaps + filler words)
     */
    private detectGaps(words: Word[], threshold: number, fillerWords: Word[] = []): Gap[] {
        const gaps: Gap[] = [];
        const videoDuration = this.videoPlayerService.duration();

        // Gap detection is only called in gap review mode, so ignore word states
        // Treat all words as visible (deleted words are temporarily restored in gap review mode)

        if (words.length === 0) {
            return gaps; // No words, no gaps
        }

        // Sort by index to ensure proper order
        const sortedWords = [...words].sort((a, b) => a.index - b.index);

        const firstWord = sortedWords[0];
        const lastWord = sortedWords[sortedWords.length - 1];

        // Detect intro gap: from 0 to first word start
        if (firstWord.start >= threshold && videoDuration > 0) {
            gaps.push({
                id: GapDetectionService.INTRO_GAP_ID,
                beforeWordIndex: -1, // Special value for intro
                afterWordIndex: firstWord.index,
                duration: firstWord.start,
                state: GapState.ACTIVE, // Default state
                start: 0,
                end: firstWord.start
            });
        }

        // Detect gaps between consecutive words
        for (let i = 0; i < sortedWords.length - 1; i++) {
            const currentWord = sortedWords[i];
            const nextWord = sortedWords[i + 1];

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

        // Detect outro gap: from last word end to video duration
        if (videoDuration > 0 && lastWord.end < videoDuration) {
            const outroDuration = videoDuration - lastWord.end;
            if (outroDuration >= threshold) {
                gaps.push({
                    id: GapDetectionService.OUTRO_GAP_ID,
                    beforeWordIndex: lastWord.index,
                    afterWordIndex: -2, // Special value for outro
                    duration: outroDuration,
                    state: GapState.ACTIVE, // Default state
                    start: lastWord.end,
                    end: videoDuration
                });
            }
        }

        // Add filler words as gaps
        // Filler words are treated as gaps and can be marked for removal
        fillerWords.forEach(fillerWord => {
            // Filler words already have negative IDs (starting from -1000)
            // They are treated as gaps, so we create a Gap object for each filler word
            gaps.push({
                id: fillerWord.index, // Use the filler word's index (negative ID)
                beforeWordIndex: this.findWordBeforeFiller(fillerWord, sortedWords),
                afterWordIndex: this.findWordAfterFiller(fillerWord, sortedWords),
                duration: fillerWord.end - fillerWord.start,
                state: GapState.ACTIVE, // Default state (will be overridden by effect if state exists)
                start: fillerWord.start,
                end: fillerWord.end,
                fillerWordText: fillerWord.word // Store the filler word text for display
            });
        });

        // Sort gaps chronologically by start time to ensure proper ordering
        // This ensures intro gap comes first, then regular gaps and filler words, then outro gap
        gaps.sort((a, b) => a.start - b.start);

        return gaps;
    }

    /**
     * Find the word index before a filler word
     * @param fillerWord The filler word to find the previous word for
     * @param words Array of words (sorted by index)
     * @returns Index of the word before the filler, or -1 if at start
     */
    private findWordBeforeFiller(fillerWord: Word, words: Word[]): number {
        // Find the last word that ends before or at the filler word start
        for (let i = words.length - 1; i >= 0; i--) {
            if (words[i].end <= fillerWord.start) {
                return words[i].index;
            }
        }
        return -1; // No word before (at start)
    }

    /**
     * Find the word index after a filler word
     * @param fillerWord The filler word to find the next word for
     * @param words Array of words (sorted by index)
     * @returns Index of the word after the filler, or -2 if at end
     */
    private findWordAfterFiller(fillerWord: Word, words: Word[]): number {
        // Find the first word that starts after or at the filler word end
        for (let i = 0; i < words.length; i++) {
            if (words[i].start >= fillerWord.end) {
                return words[i].index;
            }
        }
        return -2; // No word after (at end)
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
        this._memoizedVideoDuration = -1;
    }

}

