import { Component, OnInit, OnDestroy, ElementRef, ViewChild, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { TimelineService } from '../../services/timeline.service';
import { EditorStateService } from '../../services/editor-state.service';
import { VideoPlayerService } from '../../services/video-player.service';
import { WordState } from '../../models';

/**
 * Timeline Component
 * Displays word timeline with draggable start/end handles
 * Based on PRD: Timeline Handles & Fine-Tuning
 * 
 * Features:
 * - Visual timeline of all words
 * - Draggable start and end handles
 * - Selected segment highlighting
 * - Sub-word precision (fine-tuning)
 * - Works with deleted words
 */
@Component({
    selector: 'app-timeline',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './timeline.component.html',
    styleUrls: ['./timeline.component.scss']
})
export class TimelineComponent implements OnInit, OnDestroy {
    @ViewChild('timelineTrack', { static: false }) timelineTrack?: ElementRef<HTMLDivElement>;
    @ViewChild('startHandle', { static: false }) startHandleElement?: ElementRef<HTMLDivElement>;
    @ViewChild('endHandle', { static: false }) endHandleElement?: ElementRef<HTMLDivElement>;

    // Public service access for template
    public timelineService: TimelineService;
    private editorStateService: EditorStateService;
    private videoPlayerService: VideoPlayerService;

    // Safety margin to prevent spillover to next word (in seconds)
    private readonly PLAYBACK_SAFETY_MARGIN = 0.15; // 150ms before end

    // Drag state (public for template access)
    public isDraggingStart = false;
    public isDraggingEnd = false;
    public isDraggingPlayback = false;
    private dragStartX = 0;
    private dragStartTime = 0;

    // Video frames for timeline display (gradient placeholders)
    // Can be replaced with server-side thumbnails in the future
    public videoFrames: Array<{ index: number; thumbnail: string | null }> =
        Array.from({ length: 15 }, (_, i) => ({ index: i, thumbnail: null }));

    // Mouse event handlers (bound to preserve context)
    private boundMouseMove = this.onMouseMove.bind(this);
    private boundMouseUp = this.onMouseUp.bind(this);

    // RxJS Subjects for debouncing
    private handleDragSubject = new Subject<void>();
    private destroy$ = new Subject<void>();

    constructor(
        timelineService: TimelineService,
        editorStateService: EditorStateService,
        videoPlayerService: VideoPlayerService
    ) {
        // Assign injected services
        this.timelineService = timelineService;
        this.editorStateService = editorStateService;
        this.videoPlayerService = videoPlayerService;

        // Effect: Update handles when selection changes
        effect(() => {
            const selectionStart = this.editorStateService.selectionStart();
            const selectionEnd = this.editorStateService.selectionEnd();

            if (selectionStart) {
                this.timelineService.setHandlesFromSelection(selectionStart, selectionEnd);
            } else {
                this.timelineService.clearHandles();
            }
        }, { allowSignalWrites: true });

        // Effect: Update timeline when words change
        effect(() => {
            const words = this.editorStateService.words();
            const duration = this.videoPlayerService.duration();

            if (words.length > 0 && duration > 0) {
                this.timelineService.initialize(words, duration);
                this.generateVideoFrames(duration);
            }
        }, { allowSignalWrites: true });
    }

    ngOnInit(): void {
        // Add global mouse event listeners for dragging
        document.addEventListener('mousemove', this.boundMouseMove);
        document.addEventListener('mouseup', this.boundMouseUp);

        // Set up debounced handle drag updates
        // Debounce selection updates during drag for smoother UX
        this.handleDragSubject.pipe(
            debounceTime(100), // Wait 100ms after last drag event
            takeUntil(this.destroy$)
        ).subscribe(() => {
            this.updateSelectionFromHandles();
        });
    }

    /**
     * Generate video frame placeholders for timeline display
     * Creates gradient placeholders that will be displayed
     * 
     * Future: Can be replaced with server-side thumbnails or client-side generation
     * 
     * @param duration Video duration in seconds
     */
    private generateVideoFrames(duration: number): void {
        // Generate approximately 10-20 frames depending on duration
        const frameCount = Math.min(20, Math.max(10, Math.ceil(duration / 3)));

        // Create frames with gradient placeholders (no actual thumbnails)
        this.videoFrames = Array.from({ length: frameCount }, (_, i) => ({
            index: i,
            thumbnail: null // null = show gradient placeholder
        }));
    }

    ngOnDestroy(): void {
        // Complete RxJS subjects to prevent memory leaks
        this.destroy$.next();
        this.destroy$.complete();
        this.handleDragSubject.complete();

        // Remove global mouse event listeners
        document.removeEventListener('mousemove', this.boundMouseMove);
        document.removeEventListener('mouseup', this.boundMouseUp);
    }

    /**
     * Start dragging start handle
     */
    onStartHandleMouseDown(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();

        this.isDraggingStart = true;
        this.dragStartX = event.clientX;

        const startHandle = this.timelineService.startHandle();
        this.dragStartTime = startHandle?.time ?? 0;
    }

    /**
     * Start dragging end handle
     */
    onEndHandleMouseDown(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();

        this.isDraggingEnd = true;
        this.dragStartX = event.clientX;

        const endHandle = this.timelineService.endHandle();
        this.dragStartTime = endHandle?.time ?? 0;
    }

    /**
     * Start dragging playback handle (when no selection)
     */
    onPlaybackHandleMouseDown(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();

        this.isDraggingPlayback = true;
        this.dragStartX = event.clientX;
        this.dragStartTime = this.currentTime();
    }

    /**
     * Handle mouse move during drag
     */
    private onMouseMove(event: MouseEvent): void {
        if (!this.isDraggingStart && !this.isDraggingEnd && !this.isDraggingPlayback) return;
        if (!this.timelineTrack) return;

        const trackElement = this.timelineTrack.nativeElement;
        const trackRect = trackElement.getBoundingClientRect();
        const trackWidth = trackRect.width;

        // Calculate mouse position relative to track
        const mouseX = event.clientX - trackRect.left;
        const percentage = Math.max(0, Math.min(100, (mouseX / trackWidth) * 100));

        // Update appropriate handle
        if (this.isDraggingPlayback) {
            // Seek video to dragged position
            const time = (percentage / 100) * this.duration();
            this.videoPlayerService.seek(time);
        } else {
            const time = this.timelineService.percentageToTime(percentage);

            if (this.isDraggingStart) {
                this.timelineService.updateStartHandle(time);
                // Trigger debounced selection update
                this.handleDragSubject.next();
            } else if (this.isDraggingEnd) {
                this.timelineService.updateEndHandle(time);
                // Trigger debounced selection update
                this.handleDragSubject.next();
            }
        }
    }

    /**
     * Find word for start handle based on handle position
     * If handle passed the midpoint of a word, select the next word
     */
    private findWordForStartHandle(handleTime: number, words: any[]): any | null {
        // Find the word that contains the handle time
        const currentWord = words.find(w => handleTime >= w.start && handleTime <= w.end);

        if (!currentWord) {
            // Handle is not on any word, find closest word
            return words.find(w => handleTime < w.start) || words[words.length - 1];
        }

        const midpoint = (currentWord.start + currentWord.end) / 2;

        // If handle passed the midpoint, select the next word
        if (handleTime > midpoint) {
            const nextWord = words.find(w => w.index === currentWord.index + 1);
            return nextWord || currentWord; // If no next word, stay on current
        }

        return currentWord;
    }

    /**
     * Find word for end handle based on handle position
     * If handle passed the midpoint of a word (going backwards), select the previous word
     */
    private findWordForEndHandle(handleTime: number, words: any[]): any | null {
        // Find the word that contains the handle time
        const currentWord = words.find(w => handleTime >= w.start && handleTime <= w.end);

        if (!currentWord) {
            // Handle is not on any word, find closest word
            const reversedWords = [...words].reverse();
            return reversedWords.find(w => handleTime > w.end) || words[0];
        }

        const midpoint = (currentWord.start + currentWord.end) / 2;

        // If handle is before the midpoint, select the previous word
        if (handleTime < midpoint) {
            const prevWord = words.find(w => w.index === currentWord.index - 1);
            return prevWord || currentWord; // If no previous word, stay on current
        }

        return currentWord;
    }

    /**
     * Handle mouse up - end drag
     * When handle is dragged for the first time (not tied to word), select the word at handle position
     */
    private onMouseUp(event: MouseEvent): void {
        if (!this.isDraggingStart && !this.isDraggingEnd && !this.isDraggingPlayback) return;

        const words = this.editorStateService.words();

        // Handle START drag - update start word based on handle position
        if (this.isDraggingStart) {
            const startHandle = this.timelineService.startHandle();
            const isSingleWordMode = this.timelineService.isSingleWordMode();

            if (startHandle) {
                // Find word using midpoint logic
                const wordAtHandle = this.findWordForStartHandle(startHandle.time, words);

                if (wordAtHandle) {
                    const currentEnd = this.editorStateService.selectionEnd();

                    // In single word mode, clear selection and start fresh
                    if (isSingleWordMode && !currentEnd) {
                        this.editorStateService.clearSelection();
                        this.editorStateService.selectWord(wordAtHandle);
                    } else {
                        // In range mode, update start word and keep end word
                        this.editorStateService.selectWord(wordAtHandle);
                        if (currentEnd) {
                            this.editorStateService.selectWord(currentEnd);
                        }
                    }
                }
            }

            // Play from new start position
            const bounds = this.timelineService.getSelectionBounds();
            if (bounds) {
                // After dragging start handle, check if we have an end word
                const currentEnd = this.editorStateService.selectionEnd();

                if (currentEnd) {
                    // If we have end word, play segment from start to end with safety margin
                    const endTimeWithMargin = Math.max(bounds.start, bounds.end - this.PLAYBACK_SAFETY_MARGIN);
                    this.videoPlayerService.playSegment(bounds.start, endTimeWithMargin);
                } else {
                    // If no end word, play from start to end of video
                    this.videoPlayerService.seek(bounds.start);
                    this.videoPlayerService.play();
                }
            }
        }

        // Handle END drag - update end word based on handle position
        if (this.isDraggingEnd) {
            const endHandle = this.timelineService.endHandle();

            if (endHandle) {
                // Find word using midpoint logic
                const wordAtHandle = this.findWordForEndHandle(endHandle.time, words);

                if (wordAtHandle) {
                    // Keep existing start word and update end word
                    const currentStart = this.editorStateService.selectionStart();
                    if (currentStart) {
                        this.editorStateService.selectWord(currentStart);
                        this.editorStateService.selectWord(wordAtHandle);
                    }
                }
            }

            // Play preview leading up to the new end position
            const bounds = this.timelineService.getSelectionBounds();
            if (bounds) {
                // After dragging end handle, check distance from start
                const timeDifference = bounds.end - bounds.start;
                let previewStart: number;

                if (timeDifference < 3) {
                    // If start word is less than 3 seconds before end, play from start
                    previewStart = bounds.start;
                } else {
                    // If start word is 3+ seconds before end, play last 3 seconds
                    previewStart = Math.max(0, bounds.end - 3);
                }

                const previewEnd = Math.max(previewStart, bounds.end - this.PLAYBACK_SAFETY_MARGIN);
                this.videoPlayerService.playSegment(previewStart, previewEnd);
            }
        }

        this.isDraggingStart = false;
        this.isDraggingEnd = false;
        this.isDraggingPlayback = false;
    }

    /**
     * Update word selection based on current handle positions
     * Called during handle drag to update word selection
     * Only updates if handles are already tied to words
     * Note: In single word mode (no endHandle), this function exits early
     * and the selection is updated only on mouseUp
     */
    private updateSelectionFromHandles(): void {
        const words = this.timelineService.getWords();
        const startHandle = this.timelineService.startHandle();
        const endHandle = this.timelineService.endHandle();

        // In single word mode, don't update selection during drag
        // Selection will be updated in onMouseUp instead
        if (!startHandle || !endHandle) return;

        // Only update selection if handles are already tied to words (after first touch)
        if (startHandle.wordIndex === null || endHandle.wordIndex === null) {
            return; // Wait until first touch to select words
        }

        // Range selection - calculate selected word indices
        const selectedIndices = this.timelineService.calculateSelectedWordIndices();

        if (selectedIndices.length === 0) {
            return;
        }

        // Get start and end words from indices
        const startIndex = Math.min(...selectedIndices);
        const endIndex = Math.max(...selectedIndices);

        const startWord = words.find(w => w.index === startIndex);
        const endWord = words.find(w => w.index === endIndex);

        if (startWord && endWord) {
            // Update selection with both start and end
            this.editorStateService.selectWord(startWord);
            if (startWord !== endWord) {
                this.editorStateService.selectWord(endWord);
            }
        }
    }

    /**
     * Get deleted word segments for visualization
     */
    get deletedSegments(): Array<{ start: number; end: number; startPercentage: number; endPercentage: number }> {
        const words = this.timelineService.getWords();
        const duration = this.timelineService.totalDuration();

        if (duration === 0) return [];

        const segments: Array<{ start: number; end: number; startPercentage: number; endPercentage: number }> = [];
        let currentDeletedStart: number | null = null;

        for (let i = 0; i < words.length; i++) {
            const word = words[i];

            // Check all deleted states (including deleted+selected)
            const isDeleted = word.state === WordState.DELETED ||
                word.state === WordState.DELETED_SELECTED_START ||
                word.state === WordState.DELETED_SELECTED_END ||
                word.state === WordState.DELETED_SELECTED_RANGE;

            if (isDeleted) {
                // Start of deleted segment
                if (currentDeletedStart === null) {
                    currentDeletedStart = word.start;
                }
            } else {
                // End of deleted segment
                if (currentDeletedStart !== null) {
                    const end = words[i - 1].end;
                    segments.push({
                        start: currentDeletedStart,
                        end: end,
                        startPercentage: (currentDeletedStart / duration) * 100,
                        endPercentage: (end / duration) * 100
                    });
                    currentDeletedStart = null;
                }
            }
        }

        // Handle case where last word(s) are deleted
        if (currentDeletedStart !== null) {
            const end = words[words.length - 1].end;
            segments.push({
                start: currentDeletedStart,
                end: end,
                startPercentage: (currentDeletedStart / duration) * 100,
                endPercentage: (end / duration) * 100
            });
        }

        return segments;
    }

    /**
     * Get selected segment bounds for visualization
     */
    get selectedSegmentBounds(): { startPercentage: number; endPercentage: number } | null {
        const startHandle = this.timelineService.startHandle();
        const endHandle = this.timelineService.endHandle();

        if (!startHandle || !endHandle) return null;

        return {
            startPercentage: startHandle.percentage,
            endPercentage: endHandle.percentage
        };
    }

    /**
     * Get current video time for template
     */
    currentTime() {
        return this.videoPlayerService.currentTime();
    }

    /**
     * Get video duration for template
     */
    duration() {
        return this.videoPlayerService.duration();
    }

    /**
     * Format time in seconds to MM:SS format
     * @param timeInSeconds Time in seconds
     * @returns Formatted time string (e.g., "00:03")
     */
    formatTime(timeInSeconds: number): string {
        const minutes = Math.floor(timeInSeconds / 60);
        const seconds = Math.floor(timeInSeconds % 60);
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    /**
     * Format time in seconds to MM:SS.mmm format (with milliseconds)
     * @param timeInSeconds Time in seconds
     * @returns Formatted time string with milliseconds (e.g., "00:03.250")
     */
    formatTimeWithMs(timeInSeconds: number): string {
        const minutes = Math.floor(timeInSeconds / 60);
        const seconds = Math.floor(timeInSeconds % 60);
        const milliseconds = Math.floor((timeInSeconds % 1) * 1000);
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
    }
}

