import { Injectable, signal, computed, effect, inject, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import Hls from 'hls.js';
import { Word, WordState } from '../models';
import { EditorStateService } from './editor-state.service';
import { TimelineService } from './timeline.service';
import { HlsLoaderService } from './hls-loader.service';
import { VideoDataService } from './video-data.service';

/**
 * Aspect Ratio Types
 */
export type AspectRatio = '16:9' | '1:1' | '9:16';

/**
 * Video Player Service
 * Manages video playback with HLS.js integration
 * Based on PRD: Video Preview & Playback
 * 
 * Features:
 * - HLS.js video streaming
 * - Aspect ratio detection (16:9, 1:1, 9:16)
 * - 3-second preview on word click
 * - Full video playback
 * - Edited playback (skip deleted segments)
 * - Selected segment playback
 */
@Injectable({
    providedIn: 'root'
})
export class VideoPlayerService {
    // Inject services
    private editorStateService = inject(EditorStateService);
    private timelineService = inject(TimelineService);
    private hlsLoaderService = inject(HlsLoaderService);
    private videoDataService = inject(VideoDataService);

    // HLS.js instance
    private hls: Hls | null = null;
    private videoElement: HTMLVideoElement | null = null;

    // Private writable signals
    private readonly _isPlaying = signal<boolean>(false);
    private readonly _currentTime = signal<number>(0);
    private readonly _duration = signal<number>(0);
    private readonly _effectiveDuration = signal<number | null>(null); // Effective duration after intro/outro removal (Feature 13)
    private readonly _isLoading = signal<boolean>(false);
    private readonly _error = signal<string | null>(null);
    private readonly _aspectRatio = signal<AspectRatio>('16:9');

    constructor() {
        // Effect: Set aspect ratio IMMEDIATELY when metadata is loaded
        // This happens BEFORE the video player component is displayed, so the container has correct size
        effect(() => {
            const metadata = this.videoDataService.metadata();
            if (metadata && metadata.aspectRatio) {
                // Only update if the aspect ratio actually changed to avoid unnecessary updates
                const currentAspectRatio = this._aspectRatio();
                if (currentAspectRatio !== metadata.aspectRatio) {
                    // Set aspect ratio immediately - this happens as soon as metadata is loaded
                    // The player container will use this aspect ratio to determine its size
                    this._aspectRatio.set(metadata.aspectRatio);
                }
            } else if (!metadata) {
                // Reset to default when metadata is cleared
                const currentAspectRatio = this._aspectRatio();
                if (currentAspectRatio !== '16:9') {
                    this._aspectRatio.set('16:9');
                }
            }
        }, { allowSignalWrites: true });

        // Set up debounced togglePlayPause using RxJS
        this.togglePlayPauseSubject.pipe(
            debounceTime(150), // 150ms debounce - enough to prevent rapid clicks but still feels responsive
            takeUntil(this.destroy$)
        ).subscribe(() => {
            this.executeTogglePlayPause();
        });
    }

    // Public read-only signals
    public readonly isPlaying = this._isPlaying.asReadonly();
    public readonly currentTime = this._currentTime.asReadonly();
    public readonly duration = this._duration.asReadonly();
    public readonly effectiveDuration = this._effectiveDuration.asReadonly();
    public readonly isLoading = this._isLoading.asReadonly();
    public readonly error = this._error.asReadonly();
    public readonly aspectRatio = this._aspectRatio.asReadonly();

    // Computed signals
    public readonly formattedCurrentTime = computed(() => this.formatTime(this._currentTime()));
    // Feature 13: Use effective duration if set, otherwise use original duration
    public readonly formattedDuration = computed(() => {
        const effective = this._effectiveDuration();
        return this.formatTime(effective !== null ? effective : this._duration());
    });

    // Playback control state
    private isPreviewMode = false;
    private previewEndTime: number | null = null;
    private isEditedPlaybackMode = false;
    private deletedSegments: Array<{ start: number; end: number }> = [];
    private lastSkipTarget: number | null = null; // Track last skip target for logging
    private lastSeekTime: number | null = null; // Track last seek time to prevent infinite loops
    private isSeekingToSkip: boolean = false; // Flag to prevent recursive skip calls during seek
    private seekedEventListener: (() => void) | null = null; // Listener for seeked event
    private lastPlayStartTime: number | null = null; // Track last play start time to detect if selection changed
    private lastPlayStartIndex: number | null = null; // Track last play start word index to detect if selection changed

    // Event listener references for cleanup
    private videoEventListeners: Array<{ event: string; listener: EventListener }> = [];

    // Track temporary timeupdate listener for sequential preview playback
    private sequentialPreviewTimeUpdateListener: (() => void) | null = null;

    // RxJS Subject for debouncing togglePlayPause
    private togglePlayPauseSubject = new Subject<void>();
    private destroy$ = new Subject<void>();

    // Smooth playback checks
    private playbackCheckAnimationFrame: number | null = null;
    private readonly PREVIEW_STOP_THRESHOLD_MS = 0.05; // Stop if within 50ms of preview end time
    private readonly DELETED_SEGMENT_SKIP_THRESHOLD_MS = 0.05; // Skip if within 50ms of deleted segment end
    private readonly DELETED_SEGMENT_EARLY_DETECTION_MS = 0.008; // Early detection: anticipate 8ms before segment start (accounts for frame timing)
    private readonly SEGMENT_START_ENTRY_THRESHOLD_MS = 0.01; // Consider "just entered" if within 10ms after start (accounts for video frame timing)
    private readonly SEEK_ACCURACY_THRESHOLD_MS = 0.005; // Accept seek accuracy within 5ms

    // Loading timeout
    private loadingTimeout: number | null = null;
    private readonly LOADING_TIMEOUT_MS = 30000; // 30 seconds timeout

    /**
     * Clear loading timeout
     */
    private clearLoadingTimeout(): void {
        if (this.loadingTimeout !== null) {
            clearTimeout(this.loadingTimeout);
            this.loadingTimeout = null;
        }
    }

    /**
     * Get play start time from selection start word
     * Uses fine-tuned handle position if available and belongs to the word
     */
    private getPlayStartTime(selectionStart: Word): number {
        const startHandle = this.timelineService.startHandle();
        // Only use startHandle.time if it belongs to the current selected word
        return (startHandle?.wordIndex === selectionStart.index)
            ? startHandle.time
            : selectionStart.start;
    }

    /**
     * Get play start time from selection start word (simple version)
     * Uses fine-tuned handle position if available
     */
    private getPlayStartTimeSimple(selectionStart: Word): number {
        const startHandle = this.timelineService.startHandle();
        return startHandle?.time ?? selectionStart.start;
    }

    /**
     * Check if selection changed (by index or time)
     */
    private checkSelectionChanged(selectionStart: Word, playStart: number): boolean {
        const selectionIndexChanged = this.lastPlayStartIndex === null
            ? true
            : this.lastPlayStartIndex !== selectionStart.index;

        const selectionTimeChanged = this.lastPlayStartTime === null
            ? true
            : Math.abs(this.lastPlayStartTime - playStart) > 0.01;

        return selectionIndexChanged || selectionTimeChanged;
    }

    /**
     * Check if video has ended
     */
    private isVideoEnded(currentTime: number, duration: number): boolean {
        // Check video element's ended property first (most reliable)
        if (this.videoElement && this.videoElement.ended) {
            return true;
        }
        // Fallback to time-based check
        return duration > 0 && (currentTime >= duration || Math.abs(currentTime - duration) < 0.1);
    }

    /**
     * Update last play start tracking variables
     */
    private updateLastPlayStart(selectionStart: Word, playStart: number): void {
        this.lastPlayStartTime = playStart;
        this.lastPlayStartIndex = selectionStart.index;
    }

    /**
     * Clear preview mode
     */
    private clearPreviewMode(clearEditedMode: boolean = false): void {
        this.isPreviewMode = false;
        this.previewEndTime = null;
        if (clearEditedMode) {
            this.isEditedPlaybackMode = false;
        }
    }

    /**
     * Setup edited preview mode with deleted segments skipping
     */
    private setupEditedPreviewMode(words: Word[], endTime: number): void {
        this.deletedSegments = this.calculateDeletedSegments(words);
        this.isEditedPlaybackMode = true;
        this.isPreviewMode = true;
        this.previewEndTime = endTime;
    }

    /**
     * Initialize video player with HTML video element and video URL
     * @param videoElement HTML video element reference
     * @param videoUrl HLS video URL (m3u8)
     */
    public initializePlayer(videoElement: HTMLVideoElement, videoUrl: string): void {
        if (!videoElement) {
            this._error.set('Video element not provided');
            return;
        }

        this.videoElement = videoElement;
        this._isLoading.set(true);
        this._error.set(null);

        // Set loading timeout - if video doesn't load within timeout, show error
        this.clearLoadingTimeout();
        this.loadingTimeout = window.setTimeout(() => {
            if (this._isLoading()) {
                this._error.set('Failed to load video');
                this._isLoading.set(false);
            }
        }, this.LOADING_TIMEOUT_MS);

        // Initialize HLS using HlsLoaderService
        this.hls = this.hlsLoaderService.initialize(
            videoElement,
            videoUrl,
            {
                onManifestParsed: () => {
                    this.clearLoadingTimeout();
                    this._isLoading.set(false);
                },
                onError: (event, data) => {
                    // Only handle fatal errors
                    // Check if data is ErrorData (has fatal property) or if event is unsupported
                    const isFatal = (data && typeof data === 'object' && 'fatal' in data && data.fatal) || event === 'unsupported';

                    if (isFatal) {
                        // Create error message from data
                        let errorMessage = 'Failed to load video';

                        if ('message' in data && data.message) {
                            errorMessage = data.message;
                        } else if (event === 'unsupported') {
                            errorMessage = 'Video format not supported';
                        } else if ('type' in data && data.type) {
                            // Map HLS error types to simple messages
                            switch (data.type) {
                                case 'networkError':
                                    errorMessage = 'Failed to load video';
                                    break;
                                case 'mediaError':
                                    errorMessage = 'Video playback failed';
                                    break;
                                case 'muxError':
                                    errorMessage = 'Invalid video format';
                                    break;
                                default:
                                    errorMessage = 'Failed to load video';
                            }
                        }

                        this.clearLoadingTimeout();
                        this._error.set(errorMessage);
                        this._isLoading.set(false);
                    }
                }
            }
        );

        if (!this.hls && !this.hlsLoaderService.isNativeHlsSupported(videoElement)) {
            this._error.set('HLS is not supported in this browser');
            this._isLoading.set(false);
        }

        // Attach event listeners
        this.attachVideoEventListeners();
    }

    /**
     * Attach event listeners to video element
     */
    private attachVideoEventListeners(): void {
        if (!this.videoElement) return;

        // Clear any existing listeners first
        this.removeVideoEventListeners();

        // Play event
        const onPlay = () => {
            this._isPlaying.set(true);
            this.startPlaybackCheck();
        };
        this.videoElement.addEventListener('play', onPlay);
        this.videoEventListeners.push({ event: 'play', listener: onPlay });

        // Pause event
        const onPause = () => {
            this._isPlaying.set(false);
            this.stopPlaybackCheck();
        };
        this.videoElement.addEventListener('pause', onPause);
        this.videoEventListeners.push({ event: 'pause', listener: onPause });

        // Time update event - update current time signal and check preview end
        const onTimeUpdate = () => {
            if (!this.videoElement) return;
            this._currentTime.set(this.videoElement.currentTime);
            // Check preview end on timeupdate for more precise stopping
            this.checkPreviewEnd();
            // Check deleted segments on timeupdate for more precise skipping
            if (this.isEditedPlaybackMode && this.deletedSegments.length > 0) {
                this.skipDeletedSegments();
            }
            // Check skip accuracy and retry if needed
            // The actual accuracy check and flag clearing is handled by 'seeked' event
            if (this.lastSkipTarget !== null && this.isSeekingToSkip) {
                const currentTime = this.videoElement.currentTime;
                const seekAccuracy = Math.abs(currentTime - this.lastSkipTarget);
                // If seek accuracy is not good enough and seeked event hasn't cleared the flag yet,
                // do another seek to improve precision (but only once, to prevent loops)
                if (seekAccuracy < 0.1 && seekAccuracy > this.SEEK_ACCURACY_THRESHOLD_MS) {
                    const now = Date.now();
                    // Only seek again if we haven't tried in the last 100ms
                    if (this.lastSeekTime === null || (now - this.lastSeekTime) > 100) {
                        // Seek again to exact position for better precision
                        this.seek(this.lastSkipTarget);
                        this.lastSeekTime = now;
                    }
                }
            }
        };
        this.videoElement.addEventListener('timeupdate', onTimeUpdate);
        this.videoEventListeners.push({ event: 'timeupdate', listener: onTimeUpdate });

        // Seeked event - fired when seek operation completes
        // Use this for precise timing and to clear skip flags accurately
        this.seekedEventListener = () => {
            if (this.isSeekingToSkip && this.lastSkipTarget !== null) {
                // Verify seek accuracy
                const currentTime = this.videoElement?.currentTime;
                if (currentTime !== undefined) {
                    const seekAccuracy = Math.abs(currentTime - this.lastSkipTarget);
                    if (seekAccuracy <= this.SEEK_ACCURACY_THRESHOLD_MS) {
                        // Seek was accurate, clear flags
                        this.isSeekingToSkip = false;
                        this.lastSkipTarget = null;
                        this.lastSeekTime = null;
                    }
                    // If not accurate enough, keep flag set for potential retry in timeupdate
                }
            }
        };
        this.videoElement.addEventListener('seeked', this.seekedEventListener);
        this.videoEventListeners.push({ event: 'seeked', listener: this.seekedEventListener });

        // Duration change event
        const onLoadedMetadata = () => {
            if (!this.videoElement) return;
            this._duration.set(this.videoElement.duration);
            // Reset effective duration when video duration changes (e.g., new video loaded)
            this._effectiveDuration.set(null);
            // Aspect ratio is already set from metadata before video loads (via effect in constructor)
        };
        this.videoElement.addEventListener('loadedmetadata', onLoadedMetadata);
        this.videoEventListeners.push({ event: 'loadedmetadata', listener: onLoadedMetadata });

        // Ended event
        const onEnded = () => {
            // Update current time to duration to ensure videoEnded check works correctly
            if (this.videoElement) {
                this._currentTime.set(this.videoElement.duration);
            }

            this._isPlaying.set(false);
            this.isPreviewMode = false;
            this.isEditedPlaybackMode = false;
            this.stopPlaybackCheck();

            // Update last play start time if there's a start selection
            // This ensures that after video ends, next play will use the correct start word
            const selectionStart = this.editorStateService.selectionStart();
            const selectionEnd = this.editorStateService.selectionEnd();
            if (selectionStart && !selectionEnd) {
                const playStart = this.getPlayStartTimeSimple(selectionStart);
                this.updateLastPlayStart(selectionStart, playStart);
            } else {
                // No start selection - reset last play start time and index
                this.lastPlayStartTime = null;
                this.lastPlayStartIndex = null;
            }
        };
        this.videoElement.addEventListener('ended', onEnded);
        this.videoEventListeners.push({ event: 'ended', listener: onEnded });

        // Error event
        const onError = () => {
            if (!this.videoElement) return;
            const error = this.videoElement.error;
            let errorMessage = 'Unknown video error';

            if (error) {
                switch (error.code) {
                    case MediaError.MEDIA_ERR_ABORTED:
                        errorMessage = 'Video loading was aborted';
                        break;
                    case MediaError.MEDIA_ERR_NETWORK:
                        errorMessage = 'Failed to load video';
                        break;
                    case MediaError.MEDIA_ERR_DECODE:
                        errorMessage = 'Video playback failed';
                        break;
                    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                        errorMessage = 'Video format not supported';
                        break;
                    default:
                        errorMessage = 'Failed to load video';
                }
            }

            this._error.set(errorMessage);
            this._isLoading.set(false);
        };
        this.videoElement.addEventListener('error', onError);
        this.videoEventListeners.push({ event: 'error', listener: onError });
    }

    /**
     * Remove all video event listeners
     */
    private removeVideoEventListeners(): void {
        if (!this.videoElement) return;

        this.videoEventListeners.forEach(({ event, listener }) => {
            this.videoElement!.removeEventListener(event, listener);
        });
        this.videoEventListeners = [];
        this.seekedEventListener = null;
    }

    /**
     * Play 3-second preview from word start time
     * @param startTime Word start time
     * @param isEndWord Whether this is an end word (play 3 seconds before ending at word end)
     * @param wordEnd Word end time (used directly to avoid floating point precision errors)
     */
    public playWordPreview(startTime: number, isEndWord: boolean = false, wordEnd?: number): void {
        if (!this.videoElement) return;

        // If video is currently playing (not in preview mode), stop it first
        // This ensures that when selecting a new start word during playback, it stops and starts preview
        if (this._isPlaying() && !this.isPreviewMode) {
            this.pause();
        }

        // Feature 13: Get effective boundaries (after intro/outro removal)
        const effectiveStart = this.getEffectiveStartBoundary();
        const effectiveEnd = this.getEffectiveEndBoundary();

        // Calculate preview times
        const PREVIEW_DURATION = 3; // seconds
        let previewStart: number;
        let previewEnd: number;

        if (isEndWord && wordEnd !== undefined) {
            // For end words: play 3 seconds before ending at word end
            // Clamp to effective start boundary (no preview before intro removal point)
            previewStart = Math.max(effectiveStart, startTime - PREVIEW_DURATION);

            // Use word.end directly to avoid floating point precision errors
            // Clamp to effective end boundary (no preview after outro removal point)
            previewEnd = Math.min(effectiveEnd, wordEnd);

        } else {
            // For start words: play 3 seconds from start
            previewStart = Math.max(effectiveStart, startTime); // Ensure not before effective start
            // Clamp preview end to effective end boundary (no preview after outro removal point)
            previewEnd = Math.min(effectiveEnd, startTime + PREVIEW_DURATION);
        }

        // Set preview mode
        this.isPreviewMode = true;
        this.previewEndTime = previewEnd;
        this.isEditedPlaybackMode = false;

        // Note: We don't update lastPlayStartTime/lastPlayStartIndex here
        // They should only be updated when actual playback starts in togglePlayPause()
        // This ensures that selectionChanged detection works correctly

        // Seek and play
        this.seek(previewStart);
        this.play();
    }

    /**
     * Check if intro/outro segments have been removed (Feature 13)
     * Returns true if intro/outro segments exist in deleted segments
     */
    private hasIntroOutroRemoved(): boolean {
        const deletedSegments = this.editorStateService.getDeletedSegments();
        const videoDuration = this._duration();

        if (videoDuration <= 0 || deletedSegments.length === 0) {
            return false;
        }

        // Check if there's a deleted segment starting at 0 (intro removed)
        const hasIntro = deletedSegments.some(seg => seg.start === 0);
        // Check if there's a deleted segment ending at video duration (outro removed)
        const hasOutro = deletedSegments.some(seg => seg.end === videoDuration);

        return hasIntro || hasOutro;
    }

    /**
     * Get effective start boundary (after intro removal) (Feature 13)
     * Returns the start time of the first non-deleted word if intro was removed, otherwise 0
     */
    private getEffectiveStartBoundary(): number {
        // Only use effective boundary if intro/outro have been removed
        if (!this.hasIntroOutroRemoved()) {
            return 0; // Use original video start
        }

        const nonDeletedWords = this.editorStateService.getNonDeletedWords();
        if (nonDeletedWords.length === 0) {
            return 0; // Fallback to video start
        }
        return nonDeletedWords[0].start;
    }

    /**
     * Get effective end boundary (after outro removal) (Feature 13)
     * Returns the end time of the last non-deleted word if outro was removed, otherwise video duration
     */
    private getEffectiveEndBoundary(): number {
        // Only use effective boundary if intro/outro have been removed
        if (!this.hasIntroOutroRemoved()) {
            return this._duration(); // Use original video duration
        }

        const nonDeletedWords = this.editorStateService.getNonDeletedWords();
        if (nonDeletedWords.length === 0) {
            return this._duration(); // Fallback to video duration
        }
        return nonDeletedWords[nonDeletedWords.length - 1].end;
    }

    /**
     * Play selected segment from fine-tuned start to end
     * @param startTime Segment start time
     * @param endTime Segment end time
     */
    public playSegment(startTime: number, endTime: number): void {
        if (!this.videoElement) return;

        // Set preview mode with custom end time
        this.isPreviewMode = true;
        this.previewEndTime = endTime;
        this.isEditedPlaybackMode = false;

        // Seek and play
        this.seek(startTime);
        this.play();
    }

    /**
     * Play full video (ignoring deleted words)
     */
    public playFullVideo(): void {
        if (!this.videoElement) return;

        this.isPreviewMode = false;
        this.isEditedPlaybackMode = false;
        this.previewEndTime = null;

        this.seek(0);
        this.play();
    }

    /**
     * Play preview of start and end of unremoved segments (Feature 13)
     * Plays 3 seconds from the start of the first non-deleted word
     * and 3 seconds before the end of the last non-deleted word
     */
    public playPreviewStartEnd(): void {
        if (!this.videoElement) return;

        // Get all words (including deleted) to find original boundaries
        const allWords = this.editorStateService.words();

        if (allWords.length === 0) {
            console.warn('No words found for preview');
            return;
        }

        const PREVIEW_DURATION = 3; // seconds
        const videoDuration = this._duration();

        // Get deleted segments with fine-tuned times from EditorStateService
        const deletedSegments = this.editorStateService.getDeletedSegments();

        // Find the VERY FIRST word in the entire video (before any deletion)
        const veryFirstWord = allWords[0];
        const veryLastWord = allWords[allWords.length - 1];

        // Check if the first word's start is inside a deleted segment
        const firstWordInDeletedSegment = deletedSegments.find(seg =>
            seg.start <= veryFirstWord.start && seg.end >= veryFirstWord.start
        );

        // Check if the last word's end is inside a deleted segment
        const lastWordInDeletedSegment = deletedSegments.find(seg =>
            seg.start <= veryLastWord.end && seg.end >= veryLastWord.end
        );

        // Determine preview start: if first word is in deleted segment, start from end of that segment
        // Otherwise, start from the first word's start
        let firstPreviewStart: number;

        if (firstWordInDeletedSegment) {
            // First word is in deleted segment - start from end of deleted segment
            firstPreviewStart = firstWordInDeletedSegment.end;
        } else {
            // First word is not in deleted segment - start from first word's start
            firstPreviewStart = veryFirstWord.start;
        }

        // Play 3 seconds from start (full 3 seconds, not limited to word end)
        const firstPreviewEnd = Math.min(
            videoDuration,
            firstPreviewStart + PREVIEW_DURATION
        );

        // Determine preview end: if last word is in deleted segment, end at start of that segment
        // Otherwise, end at the last word's end
        let lastPreviewEnd: number;

        if (lastWordInDeletedSegment) {
            // Last word is in deleted segment - end at start of deleted segment
            lastPreviewEnd = lastWordInDeletedSegment.start;
        } else {
            // Last word is not in deleted segment - end at last word's end
            lastPreviewEnd = veryLastWord.end;
        }

        // Play 3 seconds before end (backwards, full 3 seconds)
        const lastPreviewStart = Math.max(
            0,
            lastPreviewEnd - PREVIEW_DURATION
        );

        // Play first preview, then second preview sequentially
        this.playPreviewSequentially([
            { start: firstPreviewStart, end: firstPreviewEnd },
            { start: lastPreviewStart, end: lastPreviewEnd }
        ]);
    }

    /**
     * Play edited video (skip deleted segments seamlessly)
     * @param words Array of all words with their states
     * @param startTime Optional start time (defaults to current time or 0)
     */
    public playEditedVideo(words: Word[], startTime?: number): void {
        if (!this.videoElement) return;

        // Calculate deleted segments
        this.deletedSegments = this.calculateDeletedSegments(words);

        // Set edited playback mode
        this.isEditedPlaybackMode = true;
        this.isPreviewMode = false;
        this.previewEndTime = null;

        // Seek to start time if provided, otherwise stay at current position or go to beginning
        if (startTime !== undefined) {
            this.seek(startTime);
        } else if (this._currentTime() === 0 || this._currentTime() >= this._duration()) {
            // Only seek to 0 if we're at the beginning or at the end
            this.seek(0);
        }
        // Otherwise keep current position and start playing from there

        this.play();
    }

    /**
     * Play selected segment with deleted word skipping
     * Combines segment playback with deleted segment skipping
     * @param words Array of all words with their states
     * @param startTime Start time of selection
     * @param endTime End time of selection
     */
    public playSelectedSegment(words: Word[], startTime: number, endTime: number): void {
        if (!this.videoElement) return;

        // Calculate deleted segments
        this.deletedSegments = this.calculateDeletedSegments(words);

        // Set both modes: edited playback (skip deleted) + preview mode (stop at end)
        this.isEditedPlaybackMode = true;
        this.isPreviewMode = true;
        this.previewEndTime = endTime;


        // Jump to selection start and play
        this.seek(startTime);
        this.play();
    }

    /**
     * Get deleted segments from editor state service
     * Uses fine-tuned handle positions stored in editor state
     * These segments contain the exact deletion boundaries (including fine-tuned positions)
     * @param words Array of words with states (unused, kept for compatibility)
     * @returns Array of deleted time segments with exact boundaries
     */
    private calculateDeletedSegments(words: Word[]): Array<{ start: number; end: number }> {
        // Use deleted segments from editor state service
        // These segments already contain fine-tuned handle positions
        // No need to recalculate - just return the exact segments
        return this.editorStateService.deletedSegments();
    }

    /**
     * Get the first non-deleted start time
     * Returns 0 if the beginning is not deleted, otherwise returns the end of the first deleted segment
     * @param words Array of words (used to get deleted segments)
     * @returns Start time (0 or end of first deleted segment if beginning is deleted)
     */
    private getFirstNonDeletedStartTime(words: Word[]): number {
        const deletedSegments = this.calculateDeletedSegments(words);

        // Check if time 0 is inside a deleted segment
        const beginningDeletedSegment = deletedSegments.find(seg => seg.start <= 0 && seg.end > 0);

        if (beginningDeletedSegment) {
            // Beginning is deleted - start from end of deleted segment
            return beginningDeletedSegment.end;
        } else {
            // Beginning is not deleted - start from 0
            return 0;
        }
    }

    /**
     * Skip deleted segments during edited playback
     * Uses exact deletion boundaries from editor state (including fine-tuned handle positions)
     * Uses early detection and seek to ensure precise skipping at segment boundaries
     * If in preview mode with end time, ensure we don't skip past it
     * 
     * OPTIMIZED: Uses binary search + two-pointer algorithm for O(log n + m) complexity
     * instead of O(n × m) nested loops
     */
    private skipDeletedSegments(): void {
        if (!this.videoElement) return;

        // Prevent recursive calls during seek operation
        if (this.isSeekingToSkip) return;

        const currentTime = this.videoElement.currentTime;
        const segments = this.deletedSegments;

        // Early exit if no segments
        if (segments.length === 0) return;

        // Find all consecutive deleted segments starting from current time
        // This handles cases where multiple deleted segments are adjacent
        let skipTarget: number | null = null;
        const threshold = 0.01; // 10ms threshold for considering segments as consecutive

        // OPTIMIZATION: Use binary search to find the first potentially relevant segment
        // We're looking for segments that could intersect with currentTime considering early detection thresholds
        // A segment is potentially relevant if:
        // - segment.end > currentTime - DELETED_SEGMENT_EARLY_DETECTION_MS (early detection before start)
        // - segment.start <= currentTime + SEGMENT_START_ENTRY_THRESHOLD_MS (just entered detection)
        let left = 0;
        let right = segments.length - 1;
        let startIndex = segments.length; // Start from end if no relevant segment found

        // Binary search for the first segment that might be relevant
        // We want the leftmost segment where segment.end > currentTime - DELETED_SEGMENT_EARLY_DETECTION_MS
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const segment = segments[mid];

            // Check if this segment could be relevant (its end is after currentTime - early detection threshold)
            if (segment.end > currentTime - this.DELETED_SEGMENT_EARLY_DETECTION_MS) {
                startIndex = mid;
                right = mid - 1; // Try to find an earlier segment
            } else {
                // Segment is too far behind, search right
                left = mid + 1;
            }
        }

        // If no relevant segment found (all segments are too far ahead), exit early
        if (startIndex >= segments.length) return;

        // OPTIMIZATION: Use two-pointer approach to find consecutive segments
        // Start from the potentially relevant segment and check forward
        for (let i = startIndex; i < segments.length; i++) {
            const segment = segments[i];
            const isWithinSegment = currentTime >= segment.start && currentTime < segment.end;
            const timeUntilSegmentStart = segment.start - currentTime;
            const timeUntilSegmentEnd = segment.end - currentTime;
            const timeAfterSegmentStart = currentTime - segment.start; // How much we've passed segment start

            // Early detection: anticipate segment start with frame-aware timing
            // This allows skipping just before entering the segment, preventing any visible playback
            const isVeryCloseToSegmentStart = timeUntilSegmentStart >= 0 && timeUntilSegmentStart <= this.DELETED_SEGMENT_EARLY_DETECTION_MS;

            // Early detection: skip if we just entered the segment (within 10ms after start)
            // This ensures we skip immediately when entering, accounting for video frame timing
            // 10ms threshold accounts for frame boundaries and timing precision
            const justEnteredSegment = timeAfterSegmentStart >= 0 && timeAfterSegmentStart <= this.SEGMENT_START_ENTRY_THRESHOLD_MS;

            // Early detection: if we're within segment and very close to end, skip immediately
            // This prevents overshooting and improves precision (similar to preview end logic)
            const isVeryCloseToSegmentEnd = isWithinSegment && timeUntilSegmentEnd >= 0 && timeUntilSegmentEnd <= this.DELETED_SEGMENT_SKIP_THRESHOLD_MS;

            if (isWithinSegment || isVeryCloseToSegmentStart || justEnteredSegment || isVeryCloseToSegmentEnd) {
                // Found a segment to skip - start with its end time
                skipTarget = segment.end;

                // OPTIMIZATION: Use two-pointer to find consecutive segments (linear scan forward)
                // Since segments are sorted, we can just check the next segments in order
                for (let j = i + 1; j < segments.length; j++) {
                    const nextSegment = segments[j];
                    const gapBetweenSegments = nextSegment.start - skipTarget;

                    // Check if next segment is consecutive (starts within threshold of current skip target)
                    if (gapBetweenSegments >= -threshold && gapBetweenSegments <= threshold) {
                        // Segments are consecutive or overlapping - extend skip target to end of next segment
                        skipTarget = Math.max(skipTarget, nextSegment.end);
                    } else {
                        // No more consecutive segments (segments are sorted, so we can stop)
                        break;
                    }
                }

                break; // Found the segment(s) to skip, no need to check further
            }

            // Early exit: if we've passed all potentially relevant segments, stop searching
            if (segment.start > currentTime + this.SEGMENT_START_ENTRY_THRESHOLD_MS) {
                break;
            }
        }

        // If we found segments to skip, perform the skip
        if (skipTarget !== null) {
            // If in preview mode, don't skip past the preview end time
            if (this.isPreviewMode && this.previewEndTime !== null) {
                skipTarget = Math.min(skipTarget, this.previewEndTime);

                // If the skip target equals or exceeds preview end, just pause
                if (skipTarget >= this.previewEndTime) {
                    this.pause();
                    this.clearPreviewMode(true);
                    return;
                }
            }

            // Clamp to video duration
            skipTarget = Math.min(skipTarget, this._duration());

            // Seek directly to end of deleted segment(s)
            // Early detection is handled by frequent checks (requestAnimationFrame + timeupdate event)
            this.isSeekingToSkip = true;
            this.lastSkipTarget = skipTarget;
            this.lastSeekTime = Date.now();
            this.seek(skipTarget);

            // Flag will be cleared by 'seeked' event listener (more accurate)
            // Fallback timeout in case seeked event doesn't fire (shouldn't happen, but safety net)
            setTimeout(() => {
                if (this.isSeekingToSkip) {
                    // Seeked event didn't fire or wasn't accurate enough, clear manually
                    this.isSeekingToSkip = false;
                    this.lastSkipTarget = null;
                    this.lastSeekTime = null;
                }
            }, 200);
        }
    }

    /**
     * Check if preview should end and stop playback if needed
     * Called from both timeupdate event (for precision) and interval (for reliability)
     * Uses early detection and seek to ensure precise stopping at previewEndTime
     */
    private checkPreviewEnd(): void {
        if (!this.videoElement) return;

        // Check preview mode - stop at precise end time
        if (this.isPreviewMode && this.previewEndTime !== null) {
            const currentTime = this.videoElement.currentTime;
            const timeUntilEnd = this.previewEndTime - currentTime;

            // If we've passed the end time or are very close (within threshold), stop precisely
            if (currentTime >= this.previewEndTime || timeUntilEnd <= this.PREVIEW_STOP_THRESHOLD_MS) {
                // Save preview end time before clearing it
                const savedPreviewEndTime = this.previewEndTime;

                // Pause first
                this.pause();
                this.clearPreviewMode();

                // If there's a start selection only (no end), reset position back to start word
                // This ensures that after preview ends, next play will start from the beginning
                const selectionStart = this.editorStateService.selectionStart();
                const selectionEnd = this.editorStateService.selectionEnd();

                if (selectionStart && !selectionEnd) {
                    // Get fine-tuned position if available
                    const playStart = this.getPlayStartTimeSimple(selectionStart);
                    // Reset position back to start word (fine-tuned position)
                    this.seek(playStart);
                    // Note: We don't update lastPlayStartTime/lastPlayStartIndex here
                    // They should only be updated when actual playback starts in togglePlayPause()
                    // This ensures that selectionChanged detection works correctly
                } else {
                    // For other cases (complete selection or no selection), seek to exact end time
                    this.seek(savedPreviewEndTime);
                    // Reset last play start time if no start selection
                    this.lastPlayStartTime = null;
                }

                // Clear current playback word when segment playback ends
                this.editorStateService.clearCurrentPlaybackWord();
                return;
            }
        }
    }

    /**
     * Start animation frame loop to check playback state every frame (~16ms at 60 FPS)
     * Uses requestAnimationFrame for better synchronization with browser rendering
     * Handles both preview mode ending and deleted segment skipping
     * Provides much more accurate timing than relying on timeupdate alone (which fires every ~250ms)
     * Also uses timeupdate event for additional precision
     */
    private startPlaybackCheck(): void {
        // Clear any existing animation frame
        this.stopPlaybackCheck();

        const checkPlayback = () => {
            if (!this.videoElement) {
                this.playbackCheckAnimationFrame = null;
                return;
            }

            // Check preview end (also checked in timeupdate for precision)
            this.checkPreviewEnd();

            // Check deleted segments - skip smoothly
            if (this.isEditedPlaybackMode && this.deletedSegments.length > 0) {
                this.skipDeletedSegments();
            }

            // Continue animation frame loop
            this.playbackCheckAnimationFrame = requestAnimationFrame(checkPlayback);
        };

        // Start the animation frame loop
        this.playbackCheckAnimationFrame = requestAnimationFrame(checkPlayback);
    }

    /**
     * Stop the playback check animation frame loop
     */
    private stopPlaybackCheck(): void {
        if (this.playbackCheckAnimationFrame !== null) {
            cancelAnimationFrame(this.playbackCheckAnimationFrame);
            this.playbackCheckAnimationFrame = null;
        }
    }

    /**
     * Play video
     * Immediately updates isPlaying state for instant UI feedback
     */
    public play(): void {
        if (!this.videoElement) return;

        const playPromise = this.videoElement.play();
        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    // Immediately update state on successful play
                    this._isPlaying.set(true);
                })
                .catch(() => {
                    this._error.set('Failed to play video');
                    this._isPlaying.set(false);
                });
        }
    }

    /**
     * Pause video
     * Immediately updates isPlaying state for instant UI feedback
     * If paused during preview mode, clears preview mode and resets to start word
     */
    public pause(): void {
        if (!this.videoElement) return;

        this.videoElement.pause();
        // Immediately update state (don't wait for 'pause' event)
        this._isPlaying.set(false);

        // If paused during preview mode, clear preview mode and reset to start word
        if (this.isPreviewMode) {
            const selectionStart = this.editorStateService.selectionStart();
            const selectionEnd = this.editorStateService.selectionEnd();

            if (selectionStart && !selectionEnd) {
                // Get fine-tuned position if available
                const playStart = this.getPlayStartTimeSimple(selectionStart);
                // Reset position back to start word (fine-tuned position)
                this.seek(playStart);
                // Note: We don't update lastPlayStartTime/lastPlayStartIndex here
                // They should only be updated when actual playback starts in togglePlayPause()
                // This ensures that selectionChanged detection works correctly
            }

            // Clear preview mode
            this.clearPreviewMode();
        }
    }

    /**
     * Stop video and clear all preview states
     * Used when tutorial modal opens to prevent conflicts
     */
    public stop(): void {
        if (!this.videoElement) return;

        // Pause the video
        this.pause();

        // Clear all preview states to prevent conflicts
        this.isPreviewMode = false;
        this.previewEndTime = null;
        this.isEditedPlaybackMode = false;

        // Clear current playback word
        this.editorStateService.clearCurrentPlaybackWord();
    }

    /**
     * Play multiple preview segments sequentially
     * Uses timeupdate event for smooth transitions without visible pause
     * @param segments Array of preview segments to play
     */
    private playPreviewSequentially(segments: Array<{ start: number; end: number }>): void {
        if (!this.videoElement || segments.length === 0) return;

        let currentSegmentIndex = 0;

        const playNextSegment = () => {
            // Check if video element still exists (component might have been destroyed)
            if (!this.videoElement) {
                return;
            }

            if (currentSegmentIndex >= segments.length) {
                // All segments played - pause and clear preview mode
                this.pause();
                this.clearPreviewMode();
                // Clean up listener
                if (this.sequentialPreviewTimeUpdateListener && this.videoElement) {
                    this.videoElement.removeEventListener('timeupdate', this.sequentialPreviewTimeUpdateListener);
                    this.sequentialPreviewTimeUpdateListener = null;
                }
                return;
            }

            const segment = segments[currentSegmentIndex];
            currentSegmentIndex++;

            // Set preview mode with segment end time
            this.isPreviewMode = true;
            this.previewEndTime = segment.end;
            this.isEditedPlaybackMode = false;

            // Seek to segment start and play
            this.seek(segment.start);
            this.play();

            // Clean up any existing sequential preview listener
            if (this.sequentialPreviewTimeUpdateListener && this.videoElement) {
                this.videoElement.removeEventListener('timeupdate', this.sequentialPreviewTimeUpdateListener);
                this.sequentialPreviewTimeUpdateListener = null;
            }

            // Set up listener for when this segment ends
            const onTimeUpdate = () => {
                if (!this.videoElement) return;

                const currentTime = this.videoElement.currentTime;
                const timeUntilEnd = segment.end - currentTime;

                // If we've reached or passed the end, move to next segment
                if (currentTime >= segment.end || timeUntilEnd <= 0.1) {
                    // Clean up listener
                    if (this.videoElement && this.sequentialPreviewTimeUpdateListener) {
                        this.videoElement.removeEventListener('timeupdate', this.sequentialPreviewTimeUpdateListener);
                        this.sequentialPreviewTimeUpdateListener = null;
                    }
                    // Small delay to ensure smooth transition
                    setTimeout(() => {
                        // Check if video element still exists before continuing
                        if (this.videoElement) {
                            playNextSegment();
                        }
                    }, 50);
                }
            };

            if (this.videoElement) {
                this.videoElement.addEventListener('timeupdate', onTimeUpdate);
                this.sequentialPreviewTimeUpdateListener = onTimeUpdate;
            }
        };

        // Start playing first segment
        playNextSegment();
    }

    /**
     * Toggle play/pause (debounced via RxJS Subject)
     * ALWAYS skips deleted segments during playback (PRD: Video Playback)
     * If there's a selection and video is paused, jump to selection start before playing
     * If there's a complete selection (start + end), play only that segment (skipping deleted words within)
     * Includes debouncing to prevent rapid clicks from causing crashes
     */
    public togglePlayPause(): void {
        // Emit to Subject for debouncing
        this.togglePlayPauseSubject.next();
    }

    /**
     * Execute toggle play/pause logic (called after debounce)
     */
    private executeTogglePlayPause(): void {
        if (this._isPlaying()) {
            this.pause();
        } else {
            // Get all words from editor state for deleted segment skipping
            const words = this.editorStateService.words();

            // Check if there's a selection
            const selectionStart = this.editorStateService.selectionStart();
            const selectionEnd = this.editorStateService.selectionEnd();

            if (selectionStart && selectionEnd) {
                // Check if the entire selected segment is deleted
                const selectedWords = this.editorStateService.selectedWords();
                const allDeleted = selectedWords.every(word =>
                    word.state === WordState.DELETED ||
                    word.state === WordState.DELETED_SELECTED_START ||
                    word.state === WordState.DELETED_SELECTED_END ||
                    word.state === WordState.DELETED_SELECTED_RANGE
                );

                // If entire segment is deleted, don't play anything
                if (allDeleted) {
                    return;
                }

                // Complete selection - play from start to end (skipping deleted words)
                // ALWAYS use fine-tuned handle positions for precise stopping
                const startHandle = this.timelineService.startHandle();
                const endHandle = this.timelineService.endHandle();
                const playStart = startHandle?.time ?? selectionStart.start;
                const playEnd = endHandle?.time ?? selectionEnd.end;

                // Get current time directly from video element (more reliable than signal after seek)
                const currentTime = this.videoElement?.currentTime ?? this._currentTime();
                const duration = this._duration();

                // Check if selection changed or video ended
                const selectionChanged = this.checkSelectionChanged(selectionStart, playStart);
                // Use signal for videoEnded check - signal is set to duration when video ends
                // (videoElement.currentTime may reset to 0 after video ends)
                const videoEnded = this.isVideoEnded(this._currentTime(), duration);
                const atSegmentEnd = currentTime >= playEnd || Math.abs(currentTime - playEnd) < 0.1;

                // If we're in preview mode, continue from current position but still stop at segment end
                if (this.isPreviewMode) {
                    this.setupEditedPreviewMode(words, playEnd);
                    this.play();
                } else if (selectionChanged || videoEnded || atSegmentEnd || currentTime < playStart) {
                    // Selection changed, video ended, at segment end, or before start - start from beginning
                    this.playSelectedSegment(words, playStart, playEnd);
                    this.updateLastPlayStart(selectionStart, playStart);
                } else {
                    // Continue from current position, but still stop at segment end
                    this.setupEditedPreviewMode(words, playEnd);
                    this.play();
                }
            } else if (selectionStart) {
                // Only start selected - get fine-tuned position
                const playStart = this.getPlayStartTime(selectionStart);
                const currentTime = this.videoElement?.currentTime ?? this._currentTime();
                const duration = this._duration();

                // Check if selection changed or video ended
                const selectionChanged = this.checkSelectionChanged(selectionStart, playStart);
                // Use signal for videoEnded check - signal is set to duration when video ends
                // (videoElement.currentTime may reset to 0 after video ends)
                const videoEnded = this.isVideoEnded(this._currentTime(), duration);

                // If we're in preview mode, continue from current position
                if (this.isPreviewMode) {
                    this.playEditedVideo(words);
                } else if (selectionChanged || videoEnded || currentTime < playStart) {
                    // Selection changed, video ended, or before start - start from start word
                    this.playEditedVideo(words, playStart);
                    this.updateLastPlayStart(selectionStart, playStart);
                } else {
                    // Continue from current position
                    this.playEditedVideo(words);
                }
            } else {
                // No selection - reset last play start time and index
                this.lastPlayStartTime = null;
                this.lastPlayStartIndex = null;
                // No selection - always start from beginning (unless beginning contains deleted segment)
                // ALWAYS skip deleted segments
                const startTime = this.getFirstNonDeletedStartTime(words);
                this.playEditedVideo(words, startTime);
            }
        }
    }

    /**
     * Seek to specific time
     * @param time Time in seconds
     */
    public seek(time: number): void {
        if (!this.videoElement) return;

        const clampedTime = Math.max(0, Math.min(time, this._duration()));
        this.videoElement.currentTime = clampedTime;
    }

    /**
     * Format time in MM:SS format
     * @param seconds Time in seconds
     * @returns Formatted time string
     */
    private formatTime(seconds: number): string {
        if (!isFinite(seconds) || seconds < 0) return '00:00';

        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);

        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Cleanup and destroy player
     */
    public destroy(): void {
        // Stop playback check interval
        this.stopPlaybackCheck();

        // Clear loading timeout
        this.clearLoadingTimeout();

        // Remove all video event listeners
        this.removeVideoEventListeners();

        // Clean up sequential preview timeupdate listener if exists
        if (this.sequentialPreviewTimeUpdateListener && this.videoElement) {
            this.videoElement.removeEventListener('timeupdate', this.sequentialPreviewTimeUpdateListener);
            this.sequentialPreviewTimeUpdateListener = null;
        }

        this.isSeekingToSkip = false;

        this.hlsLoaderService.destroy(this.hls, this.videoElement);
        this.hls = null;

        if (this.videoElement) {
            this.videoElement.pause();
            this.videoElement.src = '';
            this.videoElement.load();
            this.videoElement = null;
        }

        // Reset state
        this._isPlaying.set(false);
        this._currentTime.set(0);
        this._duration.set(0);
        this._effectiveDuration.set(null); // Reset effective duration
        this._isLoading.set(false);
        this._error.set(null);
        this.isPreviewMode = false;
        this.isEditedPlaybackMode = false;
        this.deletedSegments = [];
    }

    /**
     * Update effective duration based on intro/outro segments (Feature 13)
     * Effective duration = original duration - (intro_length + outro_length)
     * @param introLength Length of intro segment in seconds (from 0 to first word start)
     * @param outroLength Length of outro segment in seconds (from last word end to video duration)
     */
    public updateEffectiveDuration(introLength: number, outroLength: number): void {
        const originalDuration = this._duration();
        if (originalDuration <= 0) {
            console.warn('Cannot update effective duration: invalid video duration');
            return;
        }
        const effectiveDuration = originalDuration - introLength - outroLength;
        this._effectiveDuration.set(Math.max(0, effectiveDuration)); // Ensure non-negative
    }

    /**
     * Reset effective duration to original video duration (Feature 13)
     * Called when intro/outro segments are removed
     */
    public resetEffectiveDuration(): void {
        this._effectiveDuration.set(null);
    }

    /**
     * Reset player state
     */
    public reset(): void {
        this.destroy();
    }

    /**
     * Cleanup RxJS subscriptions and resources
     */
    ngOnDestroy(): void {
        // Clean up all resources
        this.destroy();

        // Clean up RxJS subscriptions
        this.destroy$.next();
        this.destroy$.complete();
    }
}

