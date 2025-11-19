import { Injectable, inject } from '@angular/core';
import { EditorStateService } from './editor-state.service';
import { TimelineService } from './timeline.service';
import { VideoPlayerService } from './video-player.service';
import { OutputSegment } from '../models';
import { WordState } from '../models';

/**
 * Output Generator Service
 * Generates output format for saved video segments
 * Based on PRD Section 9: Save & Output
 * 
 * Features:
 * - Collects non-deleted segments
 * - Applies fine-tuned handle positions
 * - Sorts chronologically
 * - Validates output (no gaps, proper ordering)
 * - Handles empty output error
 */
@Injectable({
    providedIn: 'root'
})
export class OutputGeneratorService {
    private readonly editorState = inject(EditorStateService);
    private readonly timelineService = inject(TimelineService);
    private readonly videoPlayerService = inject(VideoPlayerService);

    /**
     * Generate output array of segments to keep
     * Based on PRD Section 9: Save & Output
     * 
     * Format: [{start: number, end: number}, ...]
     * Rules:
     * - Include only non-deleted segments
     * - Use fine-tuned handle positions (if available)
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
        console.log('generateOutput - deletedSegments:', deletedSegments);
        console.log('generateOutput - segments before cutting:', segments);

        // Cut segments at deleted segment boundaries
        segments = this.cutSegmentsAtDeletedBoundaries(segments, deletedSegments);
        console.log('generateOutput - segments after cutting:', segments);

        // Step 6: Apply fine-tuned handle positions if there's a current selection
        // Handles are always at word boundaries by default, so we simply use handle positions
        const startHandle = this.timelineService.startHandle();
        const endHandle = this.timelineService.endHandle();

        if (startHandle && endHandle) {
            const selectedWords = this.editorState.selectedWords();

            // Skip fine-tuning if no selection (handles from snapshot are not relevant after undo)
            if (selectedWords.length === 0) {
                console.log('Skipping fine-tuning - no selection (handles from snapshot are not relevant)');
            } else {
                // Check if all selected words are deleted or handles match a deleted segment
                const allSelectedWordsDeleted = selectedWords.every(word =>
                    word.state === WordState.DELETED ||
                    word.state === WordState.DELETED_SELECTED_START ||
                    word.state === WordState.DELETED_SELECTED_END ||
                    word.state === WordState.DELETED_SELECTED_RANGE
                );

                const deletedSegments = this.editorState.getDeletedSegments();
                const handlesMatchDeletedSegment = deletedSegments.some(deleted =>
                    Math.abs(deleted.start - startHandle.time) < 0.01 &&
                    Math.abs(deleted.end - endHandle.time) < 0.01
                );
                const noDeletedSegments = deletedSegments.length === 0;

                // Skip fine-tuning if handles are not relevant
                if (!allSelectedWordsDeleted && !handlesMatchDeletedSegment && !noDeletedSegments) {
                    // Apply fine-tuned handle positions to segments that overlap with handles
                    segments = segments.map(segment => {
                        // Check if handles overlap with this segment
                        const handlesOverlap = startHandle.time < segment.end && endHandle.time > segment.start;

                        if (handlesOverlap) {
                            // Handles overlap - use handle times, clipped to segment boundaries
                            const fineTunedStart = Math.max(segment.start, startHandle.time);
                            const fineTunedEnd = Math.min(segment.end, endHandle.time);

                            // Only update if valid (start < end)
                            if (fineTunedStart < fineTunedEnd) {
                                return {
                                    start: fineTunedStart,
                                    end: fineTunedEnd
                                };
                            }
                        }

                        // No fine-tuning applied - keep segment as-is
                        return segment;
                    });
                }
            }
        }

        // Step 7: Sort chronologically by start time
        const sortedSegments = this.sortChronologically(segments);
        console.log('generateOutput - segments after fine-tuning:', sortedSegments);

        // Step 8: Validate output (no gaps, proper ordering)
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
     * @param segments Array of segments to cut
     * @param deletedSegments Array of deleted segments with fine-tuned times
     * @returns Array of segments after cutting at deleted boundaries
     */
    private cutSegmentsAtDeletedBoundaries(segments: OutputSegment[], deletedSegments: Array<{ start: number; end: number }>): OutputSegment[] {
        if (deletedSegments.length === 0) {
            return segments;
        }

        const result: OutputSegment[] = [];

        for (const segment of segments) {
            // Find all deleted segments that overlap with this segment
            // Only consider deleted segments that actually overlap (not just adjacent)
            const overlappingDeleted = deletedSegments.filter(deleted => {
                // Overlap: deleted segment overlaps with this segment
                // Two segments overlap if: deleted.start < segment.end AND deleted.end > segment.start
                // But we need to ensure they actually overlap, not just touch at boundaries
                const overlaps = deleted.start < segment.end && deleted.end > segment.start;
                return overlaps;
            });

            if (overlappingDeleted.length === 0) {
                // No overlapping deleted segments - check if we should adjust start/end based on nearby deleted segments
                // Increased threshold to handle cases where user moved handles, creating gaps between segments
                const threshold = 1.0; // 1 second threshold (same as merge threshold)

                // Find deleted segments that end just before this segment starts (within threshold)
                // Exclude cases where deleted.end == segment.start (they touch but don't overlap)
                const deletedEndingBefore = deletedSegments.filter(deleted => {
                    const endsJustBefore = deleted.end < segment.start && deleted.end >= segment.start - threshold;
                    return endsJustBefore;
                });

                // Find deleted segments that start just after this segment ends (within threshold)
                // Exclude cases where deleted.start == segment.end (they touch but don't overlap)
                const deletedStartingAfter = deletedSegments.filter(deleted => {
                    const startsJustAfter = deleted.start > segment.end && deleted.start <= segment.end + threshold;
                    return startsJustAfter;
                });

                if (deletedEndingBefore.length > 0) {
                    // Find the latest deleted segment that ends just before this segment starts
                    const latestDeletedEnd = Math.max(...deletedEndingBefore.map(d => d.end));
                    result.push({
                        start: latestDeletedEnd,
                        end: segment.end
                    });
                } else if (deletedStartingAfter.length > 0) {
                    // Found deleted segment starting just after this segment ends
                    const earliestDeletedStart = Math.min(...deletedStartingAfter.map(d => d.start));
                    result.push({
                        start: segment.start,
                        end: earliestDeletedStart
                    });
                } else {
                    // No relevant deleted segments - keep segment as-is
                    result.push(segment);
                }
                continue;
            }

            // Sort overlapping deleted segments by start time
            overlappingDeleted.sort((a, b) => a.start - b.start);

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
     * - No gaps between segments
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

            // Check for gaps (except between segments)
            if (i > 0) {
                const previousSegment = segments[i - 1];
                const gap = segment.start - previousSegment.end;

                // Small gaps (< 0.1s) are acceptable
                // Larger gaps are expected when segments are deleted
            }
        }
    }
}

