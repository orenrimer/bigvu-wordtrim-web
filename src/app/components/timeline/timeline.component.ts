import { Component, OnInit, OnDestroy, ElementRef, ViewChild, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { TimelineService } from '../../services/timeline.service';
import { EditorStateService } from '../../services/editor-state.service';
import { VideoPlayerService } from '../../services/video-player.service';
import { HistoryService } from '../../services/history.service';
import { VideoDataService } from '../../services/video-data.service';
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
    private isRestoringHandlePosition = false; // Flag to prevent effect from running after restoring handle position

    // Store selection before drag to check if word changed
    private currentStartBeforeChange: any = null;
    private currentEndBeforeChange: any = null;
    // Store state snapshot before drag starts (for first word selection)
    private stateBeforeDrag: any = null;

    // Video frames for timeline display (gradient placeholders or thumbnails)
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
        historyService: HistoryService,
        private videoDataService: VideoDataService
    ) {
        // Assign injected services
        this.timelineService = timelineService;
        this.editorStateService = editorStateService;
        this.videoPlayerService = videoPlayerService;
        this.historyService = historyService;

        // Effect: Update handles when selection changes
        // Skip during drag to prevent handle snap
        // Also skip if handles already exist and are within the selected words (preserve fine-tuned positions)
        effect(() => {
            const selectionStart = this.editorStateService.selectionStart();
            const selectionEnd = this.editorStateService.selectionEnd();
            const isRestoringHandles = this.timelineService.isRestoringHandles();

            // Don't update handles during drag - allow free positioning
            if (this.isHandleDragging) return;

            // Don't update handles while restoring fine-tuned position (from undo/redo)
            if (isRestoringHandles) return;

            // Also check local flag for backward compatibility
            if (this.isRestoringHandlePosition) return;

            if (selectionStart) {
                // Check if handles already exist
                const existingStartHandle = this.timelineService.startHandle();
                const existingEndHandle = this.timelineService.endHandle();

                // If handles already exist, preserve them (they may have fine-tuning)
                // Only update if handles don't exist or if selection changed significantly
                const hasStartHandle = existingStartHandle !== null;
                const hasEndHandle = existingEndHandle !== null;
                const needsEndHandle = selectionEnd !== null;

                // Only update handles if:
                // 1. Start handle doesn't exist but selection start exists
                // 2. End handle doesn't exist but selection end exists (and we need it)
                // 3. We have end selection but no end handle (or vice versa)
                const needsUpdate = (!hasStartHandle && selectionStart) ||
                    (needsEndHandle && !hasEndHandle) ||
                    (!needsEndHandle && hasEndHandle);

                if (needsUpdate) {
                    this.timelineService.setHandlesFromSelection(selectionStart, selectionEnd);
                }
                // Otherwise, preserve existing handles (they may have fine-tuning from restore)
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
                // Only generate frames if we don't have thumbnails yet (metadata effect will handle it)
                const metadata = this.videoDataService.metadata();
                if (!metadata || !metadata.thumbnails || metadata.thumbnails.length === 0) {
                    // Generate frames without thumbnails (will be updated by metadata effect when available)
                    this.generateVideoFrames(duration);
                }
            }
        }, { allowSignalWrites: true });

        // Effect: Update video frames with thumbnails when metadata is loaded
        effect(() => {
            const metadata = this.videoDataService.metadata();
            const duration = this.videoPlayerService.duration();

            if (metadata && duration > 0 && metadata.thumbnails.length > 0) {
                // Regenerate frames with thumbnails
                this.generateVideoFrames(duration, metadata.thumbnails);
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
            debounceTime(50), // Wait 50ms after last drag event
            takeUntil(this.destroy$)
        ).subscribe(() => {
            this.updateSelectionFromHandles();
        });
    }

    /**
     * Validate thumbnail URL by attempting to load it
     * @param url Thumbnail URL to validate
     * @returns Promise that resolves to true if thumbnail loads successfully, false otherwise
     */
    private async validateThumbnailUrl(url: string): Promise<boolean> {
        return new Promise((resolve) => {
            const img = new Image();
            const timeout = setTimeout(() => {
                resolve(false);
            }, 5000); // 5 second timeout

            img.onload = () => {
                clearTimeout(timeout);
                resolve(true);
            };

            img.onerror = () => {
                clearTimeout(timeout);
                resolve(false);
            };

            img.src = url;
        });
    }

    /**
     * Generate video frame placeholders for timeline display
     * Creates gradient placeholders or uses thumbnails from video metadata
     * 
     * @param duration Video duration in seconds
     * @param thumbnails Optional array of thumbnails from video metadata
     */
    private generateVideoFrames(duration: number, thumbnails?: Array<{ width: number; height: number; url: string }>): void {
        // Calculate frame count based on timeline-track width divided by frame width
        // Frame width is 60px (min-width from CSS)
        const frameWidth = 60; // pixels
        let timelineTrackWidth = 352; // Default width (timeline-container width)

        // Try to get actual width from DOM element if available
        if (this.timelineTrack?.nativeElement) {
            timelineTrackWidth = this.timelineTrack.nativeElement.offsetWidth;
        }

        // Calculate number of frames: timeline-track width / frame width
        const frameCount = Math.floor(timelineTrackWidth / frameWidth);

        // Select appropriate thumbnail if available
        let selectedThumbnailUrl: string | null = null;
        if (thumbnails && thumbnails.length > 0) {
            // Use VideoDataService to select appropriate thumbnail based on stream size
            // Returns null if no valid thumbnails are available (handles gracefully)
            selectedThumbnailUrl = this.videoDataService.selectThumbnail(thumbnails);

            // If thumbnail URL is selected, validate it can be loaded
            if (selectedThumbnailUrl) {
                // Pre-validate thumbnail URL (will fallback to gradient if invalid)
                this.validateThumbnailUrl(selectedThumbnailUrl).then((isValid: boolean) => {
                    if (!isValid) {
                        // If thumbnail fails to load, remove it from frames
                        this.videoFrames.forEach(frame => {
                            if (frame.thumbnail === selectedThumbnailUrl) {
                                frame.thumbnail = null;
                            }
                        });
                    }
                }).catch(() => {
                    // If validation fails, remove thumbnail from frames
                    this.videoFrames.forEach(frame => {
                        if (frame.thumbnail === selectedThumbnailUrl) {
                            frame.thumbnail = null;
                        }
                    });
                });
            }
        }

        // Create frames with thumbnails or gradient placeholders
        this.videoFrames = Array.from({ length: frameCount }, (_, i) => ({
            index: i,
            thumbnail: selectedThumbnailUrl // Use selected thumbnail URL or null for gradient placeholder
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
     * If handle passed the midpoint of a word, select the previous word (word exits selection)
     * 
     * Example: User selects words 1-10, drags end handle to middle of word 7
     * - Selection updates to words 1-6
     * - Word 7 is no longer in selected state
     * - Timeline handle stays at the dragged position (between word 6 end and word 7 start)
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

        // If handle passed the midpoint, select the previous word (current word exits selection)
        if (handleTime < midpoint) {
            const prevWord = words.find(w => w.index === currentWord.index - 1);
            return prevWord || currentWord; // If no previous word, stay on current
        }

        // If handle is before or at midpoint, select the current word
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
                // Save the fine-tuned handle position BEFORE selecting word (which will snap handles)
                const fineTunedStartTime = startHandle.time;

                // Find word using midpoint logic
                const wordAtHandle = this.findWordForStartHandle(startHandle.time, words);

                if (wordAtHandle) {
                    const currentEnd = this.editorStateService.selectionEnd();

                    // If there was no selection before drag started (first word selection via slider)
                    // The stateBeforeDrag was already saved in onStartHandleMouseDown
                    // We'll use it if the word actually changes (handled below in the state saving logic)

                    // Set flag BEFORE selectWord to prevent effect from snapping handles
                    this.isRestoringHandlePosition = true;

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

                    // Restore the fine-tuned handle position (don't snap to word start)
                    // The selectWord() call would trigger setHandlesFromSelection which snaps to word start,
                    // but we prevented that with the flag, and now we restore the exact position
                    this.timelineService.updateStartHandle(fineTunedStartTime);

                    // Clear flag after restoring position
                    setTimeout(() => {
                        this.isRestoringHandlePosition = false;
                    }, 0);
                }
            }

            // Play from new start position
            const currentEnd = this.editorStateService.selectionEnd();
            const currentStart = this.editorStateService.selectionStart();

            if (currentEnd && currentStart) {
                // Play segment from start to end using fine-tuned handle positions
                // Use handle positions if available (fine-tuned), otherwise use word boundaries
                const startHandle = this.timelineService.startHandle();
                const endHandle = this.timelineService.endHandle();

                // Use handle positions if available (fine-tuned), otherwise use word boundaries
                const playStart = startHandle?.time ?? currentStart.start;
                const playEnd = endHandle?.time ?? currentEnd.end;

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
                // Save the fine-tuned handle position BEFORE selecting word (which will snap handles)
                const fineTunedEndTime = endHandle.time;

                // Find word using midpoint logic
                wordAtHandle = this.findWordForEndHandle(endHandle.time, words);

                if (wordAtHandle) {
                    // Set flag BEFORE selectWord to prevent effect from snapping handles
                    this.isRestoringHandlePosition = true;

                    // Keep existing start word and update end word
                    const currentStart = this.editorStateService.selectionStart();
                    if (currentStart) {
                        this.editorStateService.selectWord(currentStart);
                        this.editorStateService.selectWord(wordAtHandle);
                    }

                    // Restore the fine-tuned handle position (don't snap to word end)
                    // The selectWord() call would trigger setHandlesFromSelection which snaps to word end,
                    // but we prevented that with the flag, and now we restore the exact position
                    this.timelineService.updateEndHandle(fineTunedEndTime);

                    // Clear flag after restoring position
                    setTimeout(() => {
                        this.isRestoringHandlePosition = false;
                    }, 0);
                }
            }

            // Play preview leading up to the new end handle position
            const currentStart = this.editorStateService.selectionStart();
            if (currentStart && endHandle) {
                // Use the fine-tuned end handle time (exact position)
                const endHandleTime = endHandle.time;

                // After dragging end handle, check distance from start
                const timeDifference = endHandleTime - currentStart.start;
                let previewStart: number;

                if (timeDifference < 3) {
                    // If start word is less than 3 seconds before end, play from start word
                    previewStart = currentStart.start;
                } else {
                    // If start word is 3+ seconds before end, play last 3 seconds before end handle
                    previewStart = Math.max(0, endHandleTime - 3);
                }

                // Use end handle time directly (no margin) - same logic as playWordPreview
                const previewEnd = endHandleTime;

                this.videoPlayerService.playSegment(previewStart, previewEnd);
            }
        }

        // Re-enable handle updates
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

    /**
     * Parse time string (MM:SS.mmm or seconds) to seconds
     * @param timeString Time string in format MM:SS.mmm or just seconds
     * @returns Time in seconds or null if invalid
     */
    private parseTimeString(timeString: string): number | null {
        if (!timeString || !timeString.trim()) return null;

        const trimmed = timeString.trim();

        // Try to parse as MM:SS.mmm format
        const timeMatch = trimmed.match(/^(\d+):(\d+)(?:\.(\d+))?$/);
        if (timeMatch) {
            const minutes = parseInt(timeMatch[1], 10);
            const seconds = parseInt(timeMatch[2], 10);
            const milliseconds = timeMatch[3] ? parseInt(timeMatch[3].padEnd(3, '0').substring(0, 3), 10) : 0;

            if (isNaN(minutes) || isNaN(seconds) || isNaN(milliseconds)) return null;

            return minutes * 60 + seconds + milliseconds / 1000;
        }

        // Try to parse as plain seconds (number)
        const seconds = parseFloat(trimmed);
        if (!isNaN(seconds) && seconds >= 0) {
            return seconds;
        }

        return null;
    }

    /**
     * Handle start time input change
     * Updates start handle position based on user input
     */
    onStartTimeInput(event: Event): void {
        const input = event.target as HTMLInputElement;
        const timeString = input.value;
        const timeInSeconds = this.parseTimeString(timeString);

        if (timeInSeconds === null) {
            // Invalid input - restore original value
            const startHandle = this.timelineService.startHandle();
            if (startHandle) {
                input.value = this.formatTimeWithMs(startHandle.time);
            }
            return;
        }

        // Clamp to valid range
        const duration = this.duration();
        const clampedTime = Math.max(0, Math.min(timeInSeconds, duration));

        // Update handle position
        this.timelineService.updateStartHandle(clampedTime);

        // Update selection based on new handle position
        const words = this.editorStateService.words();
        const wordAtHandle = this.findWordForStartHandle(clampedTime, words);

        if (wordAtHandle) {
            const currentEnd = this.editorStateService.selectionEnd();

            // Set flag to prevent effect from snapping handles
            this.isRestoringHandlePosition = true;

            if (this.timelineService.isSingleWordMode() && !currentEnd) {
                this.editorStateService.clearSelection();
                this.editorStateService.selectWord(wordAtHandle);
            } else {
                this.editorStateService.selectWord(wordAtHandle);
                if (currentEnd) {
                    this.editorStateService.selectWord(currentEnd);
                }
            }

            // Restore fine-tuned position
            this.timelineService.updateStartHandle(clampedTime);

            setTimeout(() => {
                this.isRestoringHandlePosition = false;
            }, 0);
        }

        // Update input value to show formatted time
        input.value = this.formatTimeWithMs(clampedTime);
    }

    /**
     * Handle end time input change
     * Updates end handle position based on user input
     */
    onEndTimeInput(event: Event): void {
        const input = event.target as HTMLInputElement;
        const timeString = input.value;
        const timeInSeconds = this.parseTimeString(timeString);

        if (timeInSeconds === null) {
            // Invalid input - restore original value
            const endHandle = this.timelineService.endHandle();
            if (endHandle) {
                input.value = this.formatTimeWithMs(endHandle.time);
            }
            return;
        }

        // Clamp to valid range
        const duration = this.duration();
        const clampedTime = Math.max(0, Math.min(timeInSeconds, duration));

        // Update handle position
        this.timelineService.updateEndHandle(clampedTime);

        // Update selection based on new handle position
        const words = this.editorStateService.words();
        const wordAtHandle = this.findWordForEndHandle(clampedTime, words);

        if (wordAtHandle) {
            const currentStart = this.editorStateService.selectionStart();

            // Set flag to prevent effect from snapping handles
            this.isRestoringHandlePosition = true;

            if (currentStart) {
                this.editorStateService.selectWord(currentStart);
                this.editorStateService.selectWord(wordAtHandle);
            }

            // Restore fine-tuned position
            this.timelineService.updateEndHandle(clampedTime);

            setTimeout(() => {
                this.isRestoringHandlePosition = false;
            }, 0);
        }

        // Update input value to show formatted time
        input.value = this.formatTimeWithMs(clampedTime);
    }
}

