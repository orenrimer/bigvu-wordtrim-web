import { Injectable } from '@angular/core';

/**
 * Gap Segment Merger Service
 * Handles merging gaps with deleted segments and removing ignored gaps from deleted segments
 * Pure service that performs calculations without managing state
 */
@Injectable()
export class GapSegmentMergerService {
    private static readonly TOLERANCE = 0.001; // Small tolerance for floating point comparisons

    /**
     * Merge active gaps with deleted segments and remove ignored gaps from deleted segments
     * 
     * Rules for ACTIVE gaps:
     * 1. If the gap is active and not part of a deleted segment -> add the gap as a new deleted Segment
     * 2. If the gap is part of a deleted segment: don't change
     * 3. If the gap is active and is at the edge of a deleted segment, combine it into the gap
     * 
     * Rules for IGNORED gaps:
     * 4. If the gap is ignored and is completely contained within a deleted segment (not at edge) -> don't change the segment
     * 5. If the gap is ignored and is at the edge of a deleted segment -> remove/cut it from the deleted segment
     * 
     * @param currentSegments Current deleted segments array
     * @param activeGaps Array of active gaps to merge (gaps with GapState.ACTIVE)
     * @param ignoredGaps Array of ignored gaps to remove (gaps with GapState.IGNORED)
     * @returns Updated segments array with gaps merged/removed
     */
    public mergeGapsWithDeletedSegments(
        currentSegments: Array<{ start: number; end: number }>,
        activeGaps: Array<{ start: number; end: number }>,
        ignoredGaps: Array<{ start: number; end: number }> = []
    ): Array<{ start: number; end: number }> {
        let segments = [...currentSegments];

        // First, remove ignored gaps from deleted segments
        if (ignoredGaps.length > 0) {
            segments = this.removeGapsFromDeletedSegments(segments, ignoredGaps);
        }

        // Then, merge active gaps with deleted segments
        if (activeGaps.length === 0) {
            return segments;
        }

        const segmentsToAdd: Array<{ start: number; end: number }> = [];
        const segmentsToModify = new Map<number, { start: number; end: number }>();

        // Process each active gap
        for (const gap of activeGaps) {
            let gapProcessed = false;

            // Check each existing deleted segment
            for (let i = 0; i < segments.length; i++) {
                const segment = segments[i];

                // Rule 2: Check if gap is completely contained within the segment (don't change)
                if (gap.start >= segment.start && gap.end <= segment.end) {
                    // Gap is part of deleted segment - don't change
                    gapProcessed = true;
                    break;
                }

                // Rule 3: Check if gap is at the edge of segment (combine)
                // Gap touches segment at start edge (gap ends where segment starts)
                const touchesAtStart = Math.abs(gap.end - segment.start) < GapSegmentMergerService.TOLERANCE;
                // Gap touches segment at end edge (gap starts where segment ends)
                const touchesAtEnd = Math.abs(gap.start - segment.end) < GapSegmentMergerService.TOLERANCE;

                // Check if gap overlaps with segment (but not completely contained)
                const overlaps = gap.start < segment.end && gap.end > segment.start;

                if (overlaps || touchesAtStart || touchesAtEnd) {
                    // Gap overlaps or touches segment - merge them
                    const mergedStart = Math.min(gap.start, segment.start);
                    const mergedEnd = Math.max(gap.end, segment.end);

                    // Mark segment for modification (use the most extended version if multiple gaps modify same segment)
                    const existingModification = segmentsToModify.get(i);
                    if (existingModification) {
                        // Extend the modification if needed
                        const extendedStart = Math.min(mergedStart, existingModification.start);
                        const extendedEnd = Math.max(mergedEnd, existingModification.end);
                        segmentsToModify.set(i, { start: extendedStart, end: extendedEnd });
                    } else {
                        segmentsToModify.set(i, { start: mergedStart, end: mergedEnd });
                    }
                    gapProcessed = true;
                    break;
                }
            }

            // Rule 1: If gap wasn't processed (not part of any segment), add as new segment
            if (!gapProcessed) {
                segmentsToAdd.push({ start: gap.start, end: gap.end });
            }
        }

        // Apply modifications to existing segments
        const modifiedSegments = segments.map((segment, index) => {
            if (segmentsToModify.has(index)) {
                return segmentsToModify.get(index)!;
            }
            return segment;
        });

        // Combine modified segments with new segments
        const allSegments = [...modifiedSegments, ...segmentsToAdd];

        // Sort by start time
        allSegments.sort((a, b) => a.start - b.start);

        // Merge adjacent segments (segments that touch or overlap)
        return this.mergeAdjacentSegmentsByTime(allSegments);
    }

    /**
     * Remove ignored gaps from deleted segments
     * Only removes ignored gaps if they are at the edge of a deleted segment
     * If ignored gap is completely contained within segment (not at edge), don't change the segment
     * 
     * @param segments Current deleted segments
     * @param ignoredGaps Array of ignored gaps to remove
     * @returns Updated segments with ignored gaps removed (only at edges)
     */
    private removeGapsFromDeletedSegments(
        segments: Array<{ start: number; end: number }>,
        ignoredGaps: Array<{ start: number; end: number }>
    ): Array<{ start: number; end: number }> {
        let resultSegments: Array<{ start: number; end: number }> = [...segments];

        // Process each ignored gap
        for (const ignoredGap of ignoredGaps) {
            const updatedSegments: Array<{ start: number; end: number }> = [];

            for (const segment of resultSegments) {
                // Check if ignored gap overlaps with segment
                const overlaps = ignoredGap.start < segment.end && ignoredGap.end > segment.start;

                if (!overlaps) {
                    // No overlap - keep segment as-is
                    updatedSegments.push(segment);
                    continue;
                }

                // Check if ignored gap is completely contained within segment (not at edge)
                const isCompletelyContained = ignoredGap.start > segment.start && ignoredGap.end < segment.end;

                if (isCompletelyContained) {
                    // Ignored gap is part of deleted segment but not at edge - don't change
                    updatedSegments.push(segment);
                    continue;
                }

                // Check if ignored gap is at the edge of the segment
                const touchesAtStart = Math.abs(ignoredGap.end - segment.start) < GapSegmentMergerService.TOLERANCE;
                const touchesAtEnd = Math.abs(ignoredGap.start - segment.end) < GapSegmentMergerService.TOLERANCE;
                const startsAtSegmentStart = Math.abs(ignoredGap.start - segment.start) < GapSegmentMergerService.TOLERANCE;
                const endsAtSegmentEnd = Math.abs(ignoredGap.end - segment.end) < GapSegmentMergerService.TOLERANCE;

                // If ignored gap is at edge, remove it from the segment
                if (touchesAtStart || startsAtSegmentStart || touchesAtEnd || endsAtSegmentEnd) {
                    // Ignored gap is at edge - cut it out
                    // Keep part before ignored gap (if exists)
                    if (segment.start < ignoredGap.start) {
                        updatedSegments.push({
                            start: segment.start,
                            end: ignoredGap.start
                        });
                    }
                    // Keep part after ignored gap (if exists)
                    if (ignoredGap.end < segment.end) {
                        updatedSegments.push({
                            start: ignoredGap.end,
                            end: segment.end
                        });
                    }
                    // If ignored gap completely covers segment, nothing is added (segment is removed)
                } else {
                    // Ignored gap overlaps but is not at edge - don't change segment
                    updatedSegments.push(segment);
                }
            }

            resultSegments = updatedSegments;
        }

        // Sort by start time
        resultSegments.sort((a, b) => a.start - b.start);

        // Merge adjacent segments (segments that touch or overlap)
        return this.mergeAdjacentSegmentsByTime(resultSegments);
    }

    /**
     * Remove deleted segments that overlap with restored range
     * Cuts deleted segments instead of removing them completely if only part is restored
     * If there are active gaps inside the restored segment, keeps them as standalone deleted segments
     * 
     * @param currentSegments Current deleted segments array
     * @param restoredStart Start time of restored segment
     * @param restoredEnd End time of restored segment
     * @param activeGaps Array of active gaps (gaps with GapState.ACTIVE) - gaps inside restored range will be kept
     * @returns Updated segments array with restored range removed but active gaps preserved
     */
    public removeDeletedSegmentsInRange(
        currentSegments: Array<{ start: number; end: number }>,
        restoredStart: number,
        restoredEnd: number,
        activeGaps: Array<{ start: number; end: number }> = []
    ): Array<{ start: number; end: number }> {
        const resultSegments: Array<{ start: number; end: number }> = [];

        // Get active gaps that are inside the restored range
        const activeGapsInRange = activeGaps.filter(gap =>
            gap.start >= restoredStart && gap.end <= restoredEnd
        );

        for (const segment of currentSegments) {
            // Check if segments overlap
            const overlaps = segment.start < restoredEnd && segment.end > restoredStart;

            if (!overlaps) {
                // No overlap - keep segment as-is
                resultSegments.push(segment);
                continue;
            }

            // Segments overlap - need to handle active gaps inside the restored range
            // Find active gaps that are inside this segment and inside the restored range
            const activeGapsInSegment = activeGapsInRange.filter(gap =>
                gap.start >= segment.start && gap.end <= segment.end &&
                gap.start >= restoredStart && gap.end <= restoredEnd
            );

            if (activeGapsInSegment.length > 0) {
                // There are active gaps inside the segment - keep them as standalone deleted segments
                // Keep part before restored segment (if exists)
                if (segment.start < restoredStart) {
                    resultSegments.push({ start: segment.start, end: restoredStart });
                }

                // Add active gaps as standalone deleted segments
                activeGapsInSegment.forEach(gap => {
                    resultSegments.push({ start: gap.start, end: gap.end });
                });

                // Keep part after restored segment (if exists)
                if (restoredEnd < segment.end) {
                    resultSegments.push({ start: restoredEnd, end: segment.end });
                }
            } else {
                // No active gaps inside - cut the deleted segment normally
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
        }

        // Sort by start time
        resultSegments.sort((a, b) => a.start - b.start);

        // Merge adjacent segments (segments that touch or overlap)
        return this.mergeAdjacentSegmentsByTime(resultSegments);
    }

    /**
     * Merge adjacent segments by time only (simple time-based merging)
     * @param segments Array of segments to merge
     * @returns Merged array of segments
     */
    private mergeAdjacentSegmentsByTime(segments: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
        if (segments.length === 0) {
            return segments;
        }

        const mergedSegments: Array<{ start: number; end: number }> = [];

        for (const segment of segments) {
            if (mergedSegments.length === 0) {
                mergedSegments.push({ ...segment });
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
                mergedSegments.push({ ...segment });
            }
        }

        return mergedSegments;
    }
}

