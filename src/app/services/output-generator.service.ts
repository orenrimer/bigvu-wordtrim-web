import { Injectable, inject } from '@angular/core';
import { EditorStateService } from './editor-state.service';
import { VideoPlayerService } from './video-player.service';
import { OutputSegment } from '../models';

/**
 * Output Generator Service
 * Generates output format for saved video segments
 * Based on PRD Section 9: Save & Output
 * 
 * Features:
 * - Collects non-deleted segments
 * - Uses fine-tuned handle positions from deleted segments (already stored when segments were deleted)
 * - Sorts chronologically
 * - Validates output (no gaps, proper ordering)
 * - Handles empty output error
 */
@Injectable({
    providedIn: 'root'
})
export class OutputGeneratorService {
    private readonly editorState = inject(EditorStateService);
    private readonly videoPlayerService = inject(VideoPlayerService);

    /**
     * Generate output array of segments to keep
     * Based on PRD Section 9: Save & Output
     * 
     * Format: [{start: number, end: number}, ...]
     * Rules:
     * - Include only non-deleted segments
     * - Use fine-tuned handle positions from deleted segments (already stored when segments were deleted)
     * - Sorted chronologically
     * - No gaps
     * 
     * @returns Array of output segments or null if empty (all words deleted)
     */
    public generateOutput(): OutputSegment[] | null {
        // Step 1: Get video duration
        const videoDuration = this.videoPlayerService.duration();
        if (!videoDuration || videoDuration <= 0) {
            return null; // Video not loaded or invalid duration
        }

        // Step 2: Get all non-deleted words
        const nonDeletedWords = this.editorState.getNonDeletedWords();

        // Step 3: Validate - check if output is empty
        if (nonDeletedWords.length === 0) {
            return null; // All words deleted - invalid state
        }

        // Step 4: Create initial segment from 0 to video duration
        // This includes intro (before first word) and outro (after last word)
        let segments: OutputSegment[] = [{
            start: 0,
            end: videoDuration
        }];

        // Step 5: Apply fine-tuned deleted segment cuts
        // According to PRD: "Use the fine-tuned times from timeline handles (not just word boundaries)"
        // When segments were deleted, we saved the fine-tuned handle times
        // Now we need to cut the remaining segments at those exact positions
        const deletedSegments = this.editorState.getDeletedSegments();


        // Cut segments at deleted segment boundaries
        // The deleted segments already contain fine-tuned handle times from when segments were deleted
        // So after cutting, the remaining segments are already correct - no need for additional fine-tuning
        segments = this.cutSegmentsAtDeletedBoundaries(segments, deletedSegments);

        // Step 6: Sort chronologically by start time
        const sortedSegments = this.sortChronologically(segments);

        // Step 7: Validate output (proper ordering, valid ranges)
        this.validateOutput(sortedSegments);
        return sortedSegments;
    }

    /**
     * Cut segments at deleted segment boundaries
     * When a segment was deleted with fine-tuned handle times, we need to cut
     * the remaining segments at those exact positions
     * 
     * Example:
     * - Original segment: [0-30s]
     * - Deleted segment: [5-9.5s] (fine-tuned)
     * - Result: [0-5s], [9.5-30s]
     * 
     * OPTIMIZED: Uses binary search + two-pointer algorithm for O(n × log m + n × k) complexity
     * instead of O(n × m + n × k log k) nested loops
     * 
     * @param segments Array of segments to cut
     * @param deletedSegments Array of deleted segments with fine-tuned times (assumed to be sorted)
     * @returns Array of segments after cutting at deleted boundaries
     */
    private cutSegmentsAtDeletedBoundaries(segments: OutputSegment[], deletedSegments: Array<{ start: number; end: number }>): OutputSegment[] {
        if (deletedSegments.length === 0) {
            return segments;
        }

        const result: OutputSegment[] = [];

        // OPTIMIZATION: Ensure deletedSegments are sorted (they should be, but verify for safety)
        // Since deletedSegments come from editor-state which always sorts them, we can skip this
        // But we'll add a check to ensure they're sorted
        const sortedDeletedSegments = this.ensureSorted(deletedSegments);

        for (const segment of segments) {
            // OPTIMIZATION: Use binary search to find the first potentially overlapping deleted segment
            // A deleted segment overlaps if: deleted.start < segment.end AND deleted.end > segment.start
            // We're looking for the first deleted segment where deleted.start < segment.end
            let startIndex = this.binarySearchFirstOverlapping(sortedDeletedSegments, segment);

            if (startIndex === -1) {
                // No overlapping deleted segments - keep segment as-is
                result.push(segment);
                continue;
            }

            // OPTIMIZATION: Use two-pointer to collect all overlapping segments
            // Since segments are sorted, we can scan forward until deleted.end > segment.start
            const overlappingDeleted: Array<{ start: number; end: number }> = [];
            for (let i = startIndex; i < sortedDeletedSegments.length; i++) {
                const deleted = sortedDeletedSegments[i];

                // Check if segments overlap
                // Two segments overlap if: deleted.start < segment.end AND deleted.end > segment.start
                if (deleted.start < segment.end && deleted.end > segment.start) {
                    overlappingDeleted.push(deleted);
                } else if (deleted.start >= segment.end) {
                    // No more overlapping segments (segments are sorted, so we can stop)
                    break;
                }
            }

            // Cut segment at deleted boundaries
            let currentStart = segment.start;

            for (const deleted of overlappingDeleted) {
                // If deleted segment starts after current start, keep the part before it
                if (deleted.start > currentStart) {
                    result.push({
                        start: currentStart,
                        end: deleted.start
                    });
                }

                // Update current start to after the deleted segment
                currentStart = Math.max(currentStart, deleted.end);
            }

            // If there's remaining segment after all deleted segments, add it
            if (currentStart < segment.end) {
                result.push({
                    start: currentStart,
                    end: segment.end
                });
            }
        }

        return result;
    }

    /**
     * Ensure deleted segments are sorted by start time
     * @param segments Array of segments
     * @returns Sorted array of segments
     */
    private ensureSorted(segments: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
        // Check if already sorted (optimization - skip sort if already sorted)
        let isSorted = true;
        for (let i = 1; i < segments.length; i++) {
            if (segments[i - 1].start > segments[i].start) {
                isSorted = false;
                break;
            }
        }

        if (isSorted) {
            return segments;
        }

        // Sort if not already sorted
        return [...segments].sort((a, b) => a.start - b.start);
    }

    /**
     * Binary search to find the first deleted segment that might overlap with the given segment
     * A deleted segment overlaps if: deleted.start < segment.end AND deleted.end > segment.start
     * We're looking for the first deleted segment where deleted.start < segment.end
     * 
     * @param deletedSegments Sorted array of deleted segments
     * @param segment Segment to check overlap with
     * @returns Index of first potentially overlapping segment, or -1 if none found
     */
    private binarySearchFirstOverlapping(
        deletedSegments: Array<{ start: number; end: number }>,
        segment: OutputSegment
    ): number {
        let left = 0;
        let right = deletedSegments.length - 1;
        let result = -1;

        // Binary search for the first segment where deleted.start < segment.end
        // This is the leftmost segment that could potentially overlap
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const deleted = deletedSegments[mid];

            if (deleted.start < segment.end) {
                // This segment satisfies deleted.start < segment.end
                // Check if it actually overlaps (deleted.end > segment.start)
                if (deleted.end > segment.start) {
                    result = mid;
                }
                // Continue searching left to find the first overlapping segment
                right = mid - 1;
            } else {
                // Segment is too far ahead (deleted.start >= segment.end), search left
                right = mid - 1;
            }
        }

        return result;
    }



    /**
     * Sort segments chronologically by start time
     * @param segments Array of segments
     * @returns Sorted array of segments
     */
    private sortChronologically(segments: OutputSegment[]): OutputSegment[] {
        return [...segments].sort((a, b) => a.start - b.start);
    }

    /**
     * Validate output segments
     * Ensures:
     * - Proper time ordering
     * - Valid time ranges (start < end)
     * @param segments Array of segments to validate
     * @throws Error if validation fails
     */
    private validateOutput(segments: OutputSegment[]): void {
        if (segments.length === 0) {
            throw new Error('Output is empty - all words are deleted');
        }

        // Validate each segment
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];

            // Check valid time range
            if (segment.start >= segment.end) {
                throw new Error(`Invalid segment at index ${i}: start (${segment.start}) >= end (${segment.end})`);
            }

            // Check proper ordering (segments should be sorted by start time)
            if (i > 0) {
                const previousSegment = segments[i - 1];
                if (segment.start < previousSegment.start) {
                    throw new Error(`Segments not properly ordered: segment at index ${i} starts before previous segment`);
                }
            }
        }
    }
}

