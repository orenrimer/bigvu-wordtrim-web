import { Component, OnInit, OnDestroy, ElementRef, ViewChild, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { TimelineService } from '../../services/timeline.service';
import { EditorStateService } from '../../services/editor-state.service';
import { VideoPlayerService } from '../../services/video-player.service';
import { HistoryService } from '../../services/history.service';
import { Word, WordState } from '../../models';

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
    private historyService: HistoryService;

    // Drag state (public for template access)
    public isDraggingStart = false;
    public isDraggingEnd = false;
    public isDraggingPlayback = false;
    private dragStartX = 0;
    private dragStartTime = 0;
    private isHandleDragging = false; // Flag to prevent handle snap during drag

    // Store selection before drag to check if word changed
    private currentStartBeforeChange: any = null;
    private currentEndBeforeChange: any = null;
    // Store state snapshot before drag starts (for first word selection)
    private stateBeforeDrag: any = null;

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
        videoPlayerService: VideoPlayerService,
        historyService: HistoryService
    ) {
        // Assign injected services
        this.timelineService = timelineService;
        this.editorStateService = editorStateService;
        this.videoPlayerService = videoPlayerService;
        this.historyService = historyService;

        // Effect: Update handles when selection changes
        // Skip during drag to prevent handle snap
        effect(() => {
            const selectionStart = this.editorStateService.selectionStart();
            const selectionEnd = this.editorStateService.selectionEnd();

            // Don't update handles during drag - allow free positioning
            if (this.isHandleDragging) return;

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

        // Store the current selection BEFORE drag starts
        // We'll use this to check if the word changed after drag ends
        this.currentStartBeforeChange = this.editorStateService.selectionStart();
        this.currentEndBeforeChange = this.editorStateService.selectionEnd();

        // Store state snapshot before drag starts
        // This captures the state BEFORE any handle movement
        // We'll use this snapshot if the word changes after drag ends
        this.stateBeforeDrag = this.editorStateService.captureState(
            this.timelineService.startHandle(),
            this.timelineService.endHandle()
        );

        this.isDraggingStart = true;
        this.isHandleDragging = true; // Prevent handle snap during drag
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

        // Store the current selection BEFORE drag starts
        // We'll use this to check if the word changed after drag ends
        this.currentStartBeforeChange = this.editorStateService.selectionStart();
        this.currentEndBeforeChange = this.editorStateService.selectionEnd();

        // Store state snapshot before drag starts
        // This captures the state BEFORE any handle movement
        // We'll use this snapshot if the word changes after drag ends
        this.stateBeforeDrag = this.editorStateService.captureState(
            this.timelineService.startHandle(),
            this.timelineService.endHandle()
        );

        this.isDraggingEnd = true;
        this.isHandleDragging = true; // Prevent handle snap during drag
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

        // Use stored selection from before drag (set in onStartHandleMouseDown/onEndHandleMouseDown)
        // This allows us to check if the word actually changed

        // Handle START drag - update start word based on handle position
        if (this.isDraggingStart) {
            const startHandle = this.timelineService.startHandle();
            const isSingleWordMode = this.timelineService.isSingleWordMode();

            if (startHandle) {
                // Find word using midpoint logic
                const wordAtHandle = this.findWordForStartHandle(startHandle.time, words);

                if (wordAtHandle) {
                    const currentEnd = this.editorStateService.selectionEnd();

                    // If there was no selection before drag started (first word selection via slider)
                    // The stateBeforeDrag was already saved in onStartHandleMouseDown
                    // We'll use it if the word actually changes (handled below in the state saving logic)

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
            const currentEnd = this.editorStateService.selectionEnd();
            const currentStart = this.editorStateService.selectionStart();

            if (currentEnd && currentStart) {
                // If we have end word, play segment from start word to end word
                // Always use 33% margin from end word to prevent spillover (play 2/3 of word)
                const endWordDuration = currentEnd.end - currentEnd.start;
                const margin = endWordDuration * (1.0 / 3.0);

                const playStart = currentStart.start;
                const playEnd = currentEnd.end - margin;
                this.videoPlayerService.playSegment(playStart, playEnd);
            } else if (currentStart) {
                // If no end word, play from start word beginning with deleted skipping
                this.videoPlayerService.playEditedVideo(words, currentStart.start);
            }
        }

        // Handle END drag - update end word based on handle position
        if (this.isDraggingEnd) {
            const endHandle = this.timelineService.endHandle();
            let wordAtHandle = null;

            if (endHandle) {
                // Find word using midpoint logic
                wordAtHandle = this.findWordForEndHandle(endHandle.time, words);

                if (wordAtHandle) {
                    // Keep existing start word and update end word
                    const currentStart = this.editorStateService.selectionStart();
                    if (currentStart) {
                        this.editorStateService.selectWord(currentStart);
                        this.editorStateService.selectWord(wordAtHandle);
                    }
                }
            }

            // Play preview leading up to the new end word with smart margin
            const currentStart = this.editorStateService.selectionStart();
            if (currentStart && wordAtHandle) {
                // After dragging end handle, check distance from start
                const timeDifference = wordAtHandle.end - currentStart.start;
                let previewStart: number;

                if (timeDifference < 3) {
                    // If start word is less than 3 seconds before end, play from start word
                    previewStart = currentStart.start;
                } else {
                    // If start word is 3+ seconds before end, play last 3 seconds before end word
                    previewStart = Math.max(0, wordAtHandle.end - 3);
                }

                // Always use 33% margin from end word to prevent spillover (play 2/3 of word)
                const endWordDuration = wordAtHandle.end - wordAtHandle.start;
                const margin = endWordDuration * (1.0 / 3.0);
                const previewEnd = wordAtHandle.end - margin;

                this.videoPlayerService.playSegment(previewStart, previewEnd);
            }
        }

        // Re-enable handle updates - this will trigger the effect to snap handle to final position
        this.isHandleDragging = false;

        // Capture state after handle drag ends (Feature 8: Undo/Redo)
        // IMPORTANT: State is ONLY saved here, when drag ends (onMouseUp), NOT during drag.
        // The updateSelectionFromHandles() function updates UI during drag but does NOT save state.
        // State is saved ONLY if the final word selection actually changed after drag.
        // We save the PREVIOUS state (before the change) to history, not the current state.
        // NOTE: If there was no selection before (first word selection), state was already saved above
        if (this.isDraggingStart) {
            // For start handle drag, check if start word actually changed
            const currentStartAfterChange = this.editorStateService.selectionStart();
            const hadSelectionBefore = this.currentStartBeforeChange !== null;
            const startWordChanged = this.currentStartBeforeChange &&
                currentStartAfterChange &&
                this.currentStartBeforeChange.index !== currentStartAfterChange.index;

            // Save state if word changed (or if this is first word selection)
            if ((startWordChanged && hadSelectionBefore) || (!hadSelectionBefore && this.stateBeforeDrag)) {
                // Use the snapshot we saved before drag started (much more efficient)
                if (this.stateBeforeDrag) {
                    this.historyService.pushState(this.stateBeforeDrag);
                    this.stateBeforeDrag = null; // Clear after use
                }
            }
            // If start word didn't change and we had selection before, we don't save any state
        } else if (this.isDraggingEnd) {
            // For end handle drag, check if end word actually changed
            const currentEndAfterChange = this.editorStateService.selectionEnd();
            const endWordChanged = this.currentEndBeforeChange &&
                currentEndAfterChange &&
                this.currentEndBeforeChange.index !== currentEndAfterChange.index;

            if (endWordChanged && this.stateBeforeDrag) {
                // Use the snapshot we saved before drag started (much more efficient)
                this.historyService.pushState(this.stateBeforeDrag);
                this.stateBeforeDrag = null; // Clear after use
            }
            // If end word didn't change, we don't save any state
        }

        this.isDraggingStart = false;
        this.isDraggingEnd = false;
        this.isDraggingPlayback = false;

        // Clear state before drag
        this.stateBeforeDrag = null;
    }

    /**
     * Update word selection based on current handle positions
     * Called during handle drag to update word selection in real-time
     * Updates word highlighting while handle positioning is prevented by isHandleDragging flag
     */
    private updateSelectionFromHandles(): void {
        const words = this.timelineService.getWords();
        const startHandle = this.timelineService.startHandle();
        const endHandle = this.timelineService.endHandle();

        if (!startHandle) return;

        // Single word mode - update selection to show highlighted word during drag
        if (!endHandle) {
            // Find the word at the current handle position
            const wordAtHandle = words.find(w =>
                startHandle.time >= w.start && startHandle.time <= w.end
            );

            if (wordAtHandle) {
                // Update selection - the isHandleDragging flag prevents handle snap
                // NOTE: This is UI-only update - no history state is saved here
                this.editorStateService.clearSelection();
                this.editorStateService.selectWord(wordAtHandle);
            }
            return;
        }

        // Range selection mode - only update if handles are tied to words
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

        // Use Map for O(1) lookup instead of O(n) find operations
        const wordsByIndex = new Map<number, Word>();
        words.forEach(word => {
            wordsByIndex.set(word.index, word);
        });

        const startWord = wordsByIndex.get(startIndex);
        const endWord = wordsByIndex.get(endIndex);

        if (startWord && endWord) {
            // Update selection - the isHandleDragging flag prevents handle snap
            // NOTE: This is UI-only update - no history state is saved here
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

