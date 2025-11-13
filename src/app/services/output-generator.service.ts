import { Injectable, inject } from '@angular/core';
import { EditorStateService } from './editor-state.service';
import { TimelineService } from './timeline.service';
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
        // Step 1: Get all non-deleted words
        const nonDeletedWords = this.editorState.getNonDeletedWords();

        // Step 2: Validate - check if output is empty
        if (nonDeletedWords.length === 0) {
            return null; // All words deleted - invalid state
        }

        // Step 3: Collect segments from all non-deleted words
        // Group consecutive words into segments (based on word boundaries)
        let segments = this.collectSegments(nonDeletedWords);

        // Step 4: Apply fine-tuned deleted segment cuts
        // According to PRD: "Use the fine-tuned times from timeline handles (not just word boundaries)"
        // When segments were deleted, we saved the fine-tuned handle times
        // Now we need to cut the remaining segments at those exact positions
        const deletedSegments = this.editorState.getDeletedSegments();

        // Cut segments at deleted segment boundaries
        segments = this.cutSegmentsAtDeletedBoundaries(segments, deletedSegments);

        // Step 5: Apply fine-tuned handle positions if there's a current selection
        // This handles the case where user has selected a segment but hasn't deleted it yet
        const startHandle = this.timelineService.startHandle();
        const endHandle = this.timelineService.endHandle();

        if (startHandle && endHandle) {
            // Check if selected words are deleted - if so, don't apply fine-tuning
            // Fine-tuning should only apply to non-deleted selections
            const selectedWords = this.editorState.selectedWords();

            // Check if handles overlap with any existing segment (even if no words are selected)
            // This handles the case after Restore where selection is cleared but handles remain
            const handlesOverlapSegment = segments.some(segment =>
                (startHandle.time >= segment.start && startHandle.time <= segment.end) ||
                (endHandle.time >= segment.start && endHandle.time <= segment.end) ||
                (startHandle.time <= segment.start && endHandle.time >= segment.end)
            );

            // If no words are selected, check if handles overlap with a segment
            if (selectedWords.length === 0) {
                if (handlesOverlapSegment) {
                    // Apply fine-tuning to segments that match the handles
                    segments = segments.map((segment, index) => {
                        // Check if handles overlap with this segment or are adjacent to it
                        const handleStartInSegment = startHandle.time >= segment.start && startHandle.time <= segment.end;
                        const handleEndInSegment = endHandle.time >= segment.start && endHandle.time <= segment.end;
                        const handleStartBeforeSegment = startHandle.time < segment.start;
                        const handleEndAfterSegment = endHandle.time > segment.end;
                        const handlesSpanSegment = startHandle.time <= segment.start && endHandle.time >= segment.end;
                        const handlesWithinSegment = startHandle.time >= segment.start && endHandle.time <= segment.end;

                        // Check if handles are close to segment boundaries (within 0.1s threshold)
                        const threshold = 0.1;
                        const handleStartNearStart = Math.abs(startHandle.time - segment.start) <= threshold;
                        const handleEndNearEnd = Math.abs(endHandle.time - segment.end) <= threshold;

                        let fineTunedStart = segment.start;
                        let fineTunedEnd = segment.end;
                        let wasFineTuned = false;

                        if (handlesWithinSegment) {
                            // Both handles are within this segment - use handle times
                            fineTunedStart = startHandle.time;
                            fineTunedEnd = endHandle.time;
                            wasFineTuned = true;
                        } else if (handlesSpanSegment) {
                            // Handles span this entire segment - use handle times
                            fineTunedStart = startHandle.time;
                            fineTunedEnd = endHandle.time;
                            wasFineTuned = true;
                        } else if (handleStartInSegment && handleEndInSegment) {
                            // Both handles are within this segment - use handle times
                            fineTunedStart = startHandle.time;
                            fineTunedEnd = endHandle.time;
                            wasFineTuned = true;
                        } else if (handleStartInSegment) {
                            // Start handle is within this segment - trim from start handle
                            fineTunedStart = startHandle.time;
                            // Also check if end handle is near the end of the segment
                            if (handleEndNearEnd || handleEndAfterSegment) {
                                fineTunedEnd = endHandle.time;
                            }
                            wasFineTuned = true;
                        } else if (handleEndInSegment) {
                            // End handle is within this segment - trim to end handle
                            fineTunedEnd = endHandle.time;
                            // Also check if start handle is near the start of the segment
                            if (handleStartNearStart || handleStartBeforeSegment) {
                                fineTunedStart = startHandle.time;
                            }
                            wasFineTuned = true;
                        } else if (handleStartBeforeSegment && handleEndAfterSegment) {
                            // Handles span this entire segment (even if outside boundaries)
                            fineTunedStart = startHandle.time;
                            fineTunedEnd = endHandle.time;
                            wasFineTuned = true;
                        } else if (handleStartNearStart && handleEndNearEnd) {
                            // Both handles are near segment boundaries - use handle times
                            fineTunedStart = startHandle.time;
                            fineTunedEnd = endHandle.time;
                            wasFineTuned = true;
                        } else if (startHandle.time < segment.end && endHandle.time > segment.start) {
                            // Handles partially overlap with this segment
                            fineTunedStart = Math.max(segment.start, startHandle.time);
                            fineTunedEnd = Math.min(segment.end, endHandle.time);
                            wasFineTuned = true;
                        } else if (handleStartNearStart) {
                            // Start handle is near the start of the segment
                            fineTunedStart = startHandle.time;
                            wasFineTuned = true;
                        } else if (handleEndNearEnd) {
                            // End handle is near the end of the segment
                            fineTunedEnd = endHandle.time;
                            wasFineTuned = true;
                        }

                        // Only update if valid (start < end)
                        if (wasFineTuned && fineTunedStart < fineTunedEnd) {
                            return {
                                start: fineTunedStart,
                                end: fineTunedEnd
                            };
                        }

                        // No fine-tuning applied - keep segment as-is (word boundaries)
                        return segment;
                    });
                }
            } else {
                // Check if any selected words are deleted
                const anySelectedWordsDeleted = selectedWords.some(word =>
                    word.state === WordState.DELETED ||
                    word.state === WordState.DELETED_SELECTED_START ||
                    word.state === WordState.DELETED_SELECTED_END ||
                    word.state === WordState.DELETED_SELECTED_RANGE
                );

                // Check if all selected words are deleted
                const allSelectedWordsDeleted = selectedWords.every(word =>
                    word.state === WordState.DELETED ||
                    word.state === WordState.DELETED_SELECTED_START ||
                    word.state === WordState.DELETED_SELECTED_END ||
                    word.state === WordState.DELETED_SELECTED_RANGE
                );

                // Also check if there's a deleted segment that matches the handles
                // This handles the case where user undid a deletion but handles are still there
                const deletedSegments = this.editorState.getDeletedSegments();
                const handlesMatchDeletedSegment = deletedSegments.some(deleted =>
                    Math.abs(deleted.start - startHandle.time) < 0.01 &&
                    Math.abs(deleted.end - endHandle.time) < 0.01
                );

                // Check if there are no deleted segments at all
                // If no deleted segments exist, it means everything was restored (after undo)
                // In this case, don't apply fine-tuning because the handles are from before the deletion
                const noDeletedSegments = deletedSegments.length === 0;

                // Don't apply fine-tuning if:
                // 1. All selected words are deleted (they won't be in output anyway)
                // 2. Handles match a deleted segment (user undid deletion but handles remain - don't fine-tune deleted segment)
                // 3. No deleted segments exist (after undo, everything was restored - handles are from before deletion)
                // Note: We DO apply fine-tuning if words are restored (after restore, words are not deleted but handles exist)
                if (allSelectedWordsDeleted || handlesMatchDeletedSegment || noDeletedSegments) {
                    // Skip fine-tuning
                } else {
                    // Apply fine-tuned handle positions to segments
                    segments = segments.map((segment, index) => {
                        // Check if handles overlap with this segment or are adjacent to it
                        const handleStartInSegment = startHandle.time >= segment.start && startHandle.time <= segment.end;
                        const handleEndInSegment = endHandle.time >= segment.start && endHandle.time <= segment.end;
                        const handleStartBeforeSegment = startHandle.time < segment.start;
                        const handleEndAfterSegment = endHandle.time > segment.end;
                        const handlesSpanSegment = startHandle.time <= segment.start && endHandle.time >= segment.end;
                        const handlesWithinSegment = startHandle.time >= segment.start && endHandle.time <= segment.end;

                        // Check if handles are close to segment boundaries (within 0.1s threshold)
                        const threshold = 0.1;
                        const handleStartNearStart = Math.abs(startHandle.time - segment.start) <= threshold;
                        const handleEndNearEnd = Math.abs(endHandle.time - segment.end) <= threshold;

                        let fineTunedStart = segment.start;
                        let fineTunedEnd = segment.end;
                        let wasFineTuned = false;

                        if (handlesWithinSegment) {
                            // Both handles are within this segment - use handle times
                            fineTunedStart = startHandle.time;
                            fineTunedEnd = endHandle.time;
                            wasFineTuned = true;
                        } else if (handlesSpanSegment) {
                            // Handles span this entire segment - use handle times
                            fineTunedStart = startHandle.time;
                            fineTunedEnd = endHandle.time;
                            wasFineTuned = true;
                        } else if (handleStartInSegment && handleEndInSegment) {
                            // Both handles are within this segment - use handle times
                            fineTunedStart = startHandle.time;
                            fineTunedEnd = endHandle.time;
                            wasFineTuned = true;
                        } else if (handleStartInSegment) {
                            // Start handle is within this segment - trim from start handle
                            fineTunedStart = startHandle.time;
                            // Also check if end handle is near the end of the segment
                            if (handleEndNearEnd || handleEndAfterSegment) {
                                fineTunedEnd = endHandle.time;
                            }
                            wasFineTuned = true;
                        } else if (handleEndInSegment) {
                            // End handle is within this segment - trim to end handle
                            fineTunedEnd = endHandle.time;
                            // Also check if start handle is near the start of the segment
                            if (handleStartNearStart || handleStartBeforeSegment) {
                                fineTunedStart = startHandle.time;
                            }
                            wasFineTuned = true;
                        } else if (handleStartBeforeSegment && handleEndAfterSegment) {
                            // Handles span this entire segment (even if outside boundaries)
                            fineTunedStart = startHandle.time;
                            fineTunedEnd = endHandle.time;
                            wasFineTuned = true;
                        } else if (handleStartNearStart && handleEndNearEnd) {
                            // Both handles are near segment boundaries - use handle times
                            fineTunedStart = startHandle.time;
                            fineTunedEnd = endHandle.time;
                            wasFineTuned = true;
                        } else if (startHandle.time < segment.end && endHandle.time > segment.start) {
                            // Handles partially overlap with this segment
                            fineTunedStart = Math.max(segment.start, startHandle.time);
                            fineTunedEnd = Math.min(segment.end, endHandle.time);
                            wasFineTuned = true;
                        } else if (handleStartNearStart) {
                            // Start handle is near the start of the segment
                            fineTunedStart = startHandle.time;
                            wasFineTuned = true;
                        } else if (handleEndNearEnd) {
                            // End handle is near the end of the segment
                            fineTunedEnd = endHandle.time;
                            wasFineTuned = true;
                        }

                        // Only update if valid (start < end)
                        if (wasFineTuned && fineTunedStart < fineTunedEnd) {
                            return {
                                start: fineTunedStart,
                                end: fineTunedEnd
                            };
                        }

                        // No fine-tuning applied - keep segment as-is (word boundaries)
                        return segment;
                    });
                }
            }
        }

        // Step 6: Sort chronologically by start time
        const sortedSegments = this.sortChronologically(segments);

        // Step 7: Merge consecutive segments (segments with no gaps between them)
        // After cutting at deleted boundaries, we may have many small segments that should be merged
        const mergedSegments = this.mergeConsecutiveSegments(sortedSegments);

        // Step 8: Validate output (no gaps, proper ordering)
        this.validateOutput(mergedSegments);
        return mergedSegments;
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
            console.log(`\nProcessing segment: [${segment.start.toFixed(3)}s - ${segment.end.toFixed(3)}s]`);

            // Find all deleted segments that overlap with this segment
            // Only consider deleted segments that actually overlap, not ones that just end before
            const overlappingDeleted = deletedSegments.filter(deleted => {
                // Overlap: deleted segment overlaps with this segment
                const overlaps = deleted.start < segment.end && deleted.end > segment.start;
                return overlaps;
            });

            if (overlappingDeleted.length === 0) {
                // No overlapping deleted segments - check if we should adjust start/end based on nearby deleted segments
                // Increased threshold to handle cases where user moved handles, creating gaps between segments
                const threshold = 1.0; // 1 second threshold (same as merge threshold)

                // Find deleted segments that end just before this segment starts (within threshold)
                const deletedEndingBefore = deletedSegments.filter(deleted => {
                    const endsJustBefore = deleted.end <= segment.start && deleted.end >= segment.start - threshold;
                    return endsJustBefore;
                });

                // Find deleted segments that start just after this segment ends (within threshold)
                // This handles the case where user moved start handle, leaving a gap between segment end and deleted start
                const deletedStartingAfter = deletedSegments.filter(deleted => {
                    const startsJustAfter = deleted.start >= segment.end && deleted.start <= segment.end + threshold;
                    return startsJustAfter;
                });

                if (deletedEndingBefore.length > 0) {
                    // Find the latest deleted segment that ends just before this segment starts
                    const latestDeletedEnd = Math.max(...deletedEndingBefore.map(d => d.end));
                    console.log(`  No overlapping deleted segments, but found deleted segment ending at ${latestDeletedEnd.toFixed(3)}s just before segment start`);
                    console.log(`  Adjusted segment start from ${segment.start.toFixed(3)}s to ${latestDeletedEnd.toFixed(3)}s (after deleted segment)`);
                    result.push({
                        start: latestDeletedEnd,
                        end: segment.end
                    });
                } else if (deletedStartingAfter.length > 0) {
                    // Found deleted segment starting just after this segment ends
                    // Extend the segment to the start of the deleted segment (similar to end handle logic)
                    // This preserves the part between segment.end and deleted.start (the fine-tuned part)
                    const earliestDeletedStart = Math.min(...deletedStartingAfter.map(d => d.start));
                    console.log(`  No overlapping deleted segments, but found deleted segment starting at ${earliestDeletedStart.toFixed(3)}s just after segment end`);
                    console.log(`  Extended segment end from ${segment.end.toFixed(3)}s to ${earliestDeletedStart.toFixed(3)}s (before deleted segment)`);
                    result.push({
                        start: segment.start,
                        end: earliestDeletedStart
                    });
                } else {
                    // No relevant deleted segments - keep segment as-is
                    console.log(`  No relevant deleted segments - keeping segment as-is`);
                    result.push(segment);
                }
                continue;
            }

            console.log(`  Found ${overlappingDeleted.length} overlapping deleted segment(s)`);

            // Sort overlapping deleted segments by start time
            overlappingDeleted.sort((a, b) => a.start - b.start);

            // Start with the original segment start
            let actualStart = segment.start;

            // Cut segment at deleted boundaries
            let currentStart = actualStart;

            for (const deleted of overlappingDeleted) {
                console.log(`  Processing deleted segment: [${deleted.start.toFixed(3)}s - ${deleted.end.toFixed(3)}s]`);
                console.log(`  Current start: ${currentStart.toFixed(3)}s`);

                // If deleted segment starts after current start, keep the part before it
                if (deleted.start > currentStart) {
                    const beforeSegment = {
                        start: currentStart,
                        end: deleted.start
                    };
                    result.push(beforeSegment);
                    console.log(`  ✓ Added segment before deleted: [${beforeSegment.start.toFixed(3)}s - ${beforeSegment.end.toFixed(3)}s]`);
                } else {
                    console.log(`  ✗ Skipped segment before deleted (deleted starts at or before current start)`);
                }

                // Update current start to after the deleted segment
                const previousStart = currentStart;
                currentStart = Math.max(currentStart, deleted.end);
                console.log(`  Updated current start from ${previousStart.toFixed(3)}s to ${currentStart.toFixed(3)}s`);
            }

            // If there's remaining segment after all deleted segments, add it
            if (currentStart < segment.end) {
                const afterSegment = {
                    start: currentStart,
                    end: segment.end
                };
                result.push(afterSegment);
                console.log(`  ✓ Added segment after deleted: [${afterSegment.start.toFixed(3)}s - ${afterSegment.end.toFixed(3)}s]`);
            } else {
                console.log(`  ✗ No segment after deleted (current start ${currentStart.toFixed(3)}s >= segment end ${segment.end.toFixed(3)}s)`);
            }
        }

        return result;
    }

    /**
     * Merge consecutive segments (segments with no gaps between them)
     * After cutting at deleted boundaries, we may have many small segments that should be merged
     * 
     * Example:
     * - Input: [17.500s - 21.355s], [21.355s - 29.675s], [29.675s - 38.260s]
     * - Output: [17.500s - 38.260s]
     * 
     * @param segments Array of segments to merge
     * @returns Array of merged segments
     */
    private mergeConsecutiveSegments(segments: OutputSegment[]): OutputSegment[] {
        if (segments.length === 0) return [];

        const merged: OutputSegment[] = [];
        let currentSegment = { ...segments[0] };

        console.log(`\n=== Merging Consecutive Segments ===`);
        console.log(`Input segments: ${segments.length}`);

        for (let i = 1; i < segments.length; i++) {
            const nextSegment = segments[i];
            const gap = nextSegment.start - currentSegment.end;
            // Increased threshold to 1 second to handle gaps between words
            // Words can have small gaps between them (silence, pauses) but should still be merged
            const threshold = 1.0; // 1 second threshold for considering segments consecutive

            if (gap <= threshold) {
                // Segments are consecutive (no gap or small gap) - merge them
                console.log(`  Merging: [${currentSegment.start.toFixed(3)}s - ${currentSegment.end.toFixed(3)}s] + [${nextSegment.start.toFixed(3)}s - ${nextSegment.end.toFixed(3)}s] (gap: ${gap.toFixed(3)}s)`);
                currentSegment.end = nextSegment.end;
            } else {
                // Gap detected - save current segment and start new one
                console.log(`  Gap detected (${gap.toFixed(3)}s) - saving segment: [${currentSegment.start.toFixed(3)}s - ${currentSegment.end.toFixed(3)}s]`);
                merged.push(currentSegment);
                currentSegment = { ...nextSegment };
            }
        }

        // Add the last segment
        console.log(`  Final segment: [${currentSegment.start.toFixed(3)}s - ${currentSegment.end.toFixed(3)}s]`);
        merged.push(currentSegment);

        console.log(`Output segments: ${merged.length}`);
        console.log('=====================================\n');

        return merged;
    }

    /**
     * Format time in seconds to MM:SS.mmm format
     * @param timeInSeconds Time in seconds
     * @returns Formatted time string (e.g., "00:03.250")
     */
    private formatTime(timeInSeconds: number): string {
        const minutes = Math.floor(timeInSeconds / 60);
        const seconds = Math.floor(timeInSeconds % 60);
        const milliseconds = Math.floor((timeInSeconds % 1) * 1000);
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
    }

    /**
     * Collect segments from non-deleted words
     * Groups consecutive words into continuous segments
     * @param words Array of non-deleted words
     * @returns Array of segments
     */
    private collectSegments(words: any[]): OutputSegment[] {
        if (words.length === 0) return [];

        const segments: OutputSegment[] = [];
        let currentSegmentStart = words[0].start;
        let currentSegmentEnd = words[0].end;

        for (let i = 1; i < words.length; i++) {
            const currentWord = words[i];
            const previousWord = words[i - 1];

            // Check if there's a gap between words (more than a small threshold)
            // If words are consecutive (no gap), merge into same segment
            const gap = currentWord.start - previousWord.end;
            const threshold = 0.1; // 100ms threshold for considering words consecutive

            if (gap <= threshold) {
                // Words are consecutive - extend current segment
                currentSegmentEnd = currentWord.end;
            } else {
                // Gap detected - save current segment and start new one
                segments.push({
                    start: currentSegmentStart,
                    end: currentSegmentEnd
                });
                currentSegmentStart = currentWord.start;
                currentSegmentEnd = currentWord.end;
            }
        }

        // Add the last segment
        segments.push({
            start: currentSegmentStart,
            end: currentSegmentEnd
        });

        return segments;
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

                // Small gaps (< 0.1s) are acceptable, but log warning for larger gaps
                if (gap > 0.1) {
                    console.warn(`Gap detected between segments: ${gap.toFixed(2)}s`);
                }
            }
        }
    }
}

