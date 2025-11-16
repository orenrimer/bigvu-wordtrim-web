import { Injectable, signal, computed, effect, inject } from '@angular/core';
import Hls from 'hls.js';
import { Word, WordState } from '../models';
import { EditorStateService } from './editor-state.service';
import { TimelineService } from './timeline.service';
import { HlsLoaderService } from './hls-loader.service';

/**
 * Video Player State
 */
export interface VideoPlayerState {
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    isLoading: boolean;
    error: string | null;
}

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

    // HLS.js instance
    private hls: Hls | null = null;
    private videoElement: HTMLVideoElement | null = null;

    // Private writable signals
    private readonly _isPlaying = signal<boolean>(false);
    private readonly _currentTime = signal<number>(0);
    private readonly _duration = signal<number>(0);
    private readonly _isLoading = signal<boolean>(false);
    private readonly _error = signal<string | null>(null);
    private readonly _aspectRatio = signal<AspectRatio>('16:9');
    private readonly _videoUrl = signal<string | null>(null);

    // Public read-only signals
    public readonly isPlaying = this._isPlaying.asReadonly();
    public readonly currentTime = this._currentTime.asReadonly();
    public readonly duration = this._duration.asReadonly();
    public readonly isLoading = this._isLoading.asReadonly();
    public readonly error = this._error.asReadonly();
    public readonly aspectRatio = this._aspectRatio.asReadonly();

    // Computed signals
    public readonly formattedCurrentTime = computed(() => this.formatTime(this._currentTime()));
    public readonly formattedDuration = computed(() => this.formatTime(this._duration()));

    // Playback control state
    private isPreviewMode = false;
    private previewEndTime: number | null = null;
    private isEditedPlaybackMode = false;
    private deletedSegments: Array<{ start: number; end: number }> = [];
    private lastSkipTarget: number | null = null; // Track last skip target for logging
    private lastSeekTime: number | null = null; // Track last seek time to prevent infinite loops

    // Smooth playback checks
    private playbackCheckInterval: number | null = null;
    private readonly PLAYBACK_CHECK_INTERVAL_MS = 16; // Check every ~16ms (60 FPS) for accurate preview/skip
    private readonly PREVIEW_STOP_THRESHOLD_MS = 0.05; // Stop if within 50ms of preview end time
    private readonly DELETED_SEGMENT_SKIP_THRESHOLD_MS = 0.05; // Skip if within 50ms of deleted segment start

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
        this._videoUrl.set(videoUrl);
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
                    if (data?.fatal || event === 'unsupported') {
                        // Create error message from data
                        let errorMessage = 'Failed to load video';

                        if (data?.message) {
                            errorMessage = data.message;
                        } else if (event === 'unsupported') {
                            errorMessage = 'Video format not supported';
                        } else if (data?.type) {
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

        // Play event
        this.videoElement.addEventListener('play', () => {
            this._isPlaying.set(true);
            this.startPlaybackCheck();
        });

        // Pause event
        this.videoElement.addEventListener('pause', () => {
            this._isPlaying.set(false);
            this.stopPlaybackCheck();
        });

        // Time update event - update current time signal and check preview end
        this.videoElement.addEventListener('timeupdate', () => {
            if (!this.videoElement) return;
            this._currentTime.set(this.videoElement.currentTime);
            // Check preview end on timeupdate for more precise stopping
            this.checkPreviewEnd();
            // Check deleted segments on timeupdate for more precise skipping
            if (this.isEditedPlaybackMode && this.deletedSegments.length > 0) {
                this.skipDeletedSegments();
            }
            // Log skip accuracy if we just performed a skip
            if (this.lastSkipTarget !== null) {
                const currentTime = this.videoElement.currentTime;
                const seekAccuracy = Math.abs(currentTime - this.lastSkipTarget);
                // Only log if we're close to the skip target (within 0.1s) to avoid false positives
                if (seekAccuracy < 0.1) {
                    console.log('[SKIP] Deleted segment skip - AFTER:', {
                        actualTime: currentTime.toFixed(6) + 's',
                        expectedTime: this.lastSkipTarget.toFixed(6) + 's',
                        seekAccuracy: seekAccuracy.toFixed(6) + 's',
                        seekPrecision: seekAccuracy < 0.001 ? 'EXACT' : seekAccuracy < 0.01 ? 'GOOD' : 'APPROXIMATE'
                    });

                    // If seek accuracy is not exact, do another seek to improve precision
                    // But only if we haven't already tried recently (prevent infinite loops)
                    if (seekAccuracy >= 0.001) {
                        const now = Date.now();
                        // Only seek again if we haven't tried in the last 100ms
                        if (this.lastSeekTime === null || (now - this.lastSeekTime) > 100) {
                            // Seek again to exact position for better precision
                            this.seek(this.lastSkipTarget);
                            this.lastSeekTime = now;
                        } else {
                            // Already tried recently, accept current accuracy
                            this.lastSkipTarget = null;
                            this.lastSeekTime = null;
                        }
                    } else {
                        // Seek was accurate enough, clear the tracking
                        this.lastSkipTarget = null;
                        this.lastSeekTime = null;
                    }
                } else {
                    // Too far from target, clear tracking (might be a different skip)
                    this.lastSkipTarget = null;
                    this.lastSeekTime = null;
                }
            }
        });

        // Duration change event
        this.videoElement.addEventListener('loadedmetadata', () => {
            if (!this.videoElement) return;
            this._duration.set(this.videoElement.duration);
            this.detectAspectRatio();
        });

        // Ended event
        this.videoElement.addEventListener('ended', () => {
            this._isPlaying.set(false);
            this.isPreviewMode = false;
            this.isEditedPlaybackMode = false;
            this.stopPlaybackCheck();
        });

        // Error event
        this.videoElement.addEventListener('error', () => {
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
        });
    }

    /**
     * Detect aspect ratio from video dimensions
     * Supports: 16:9, 1:1, 9:16
     */
    private detectAspectRatio(): void {
        if (!this.videoElement) return;

        const width = this.videoElement.videoWidth;
        const height = this.videoElement.videoHeight;

        if (width === 0 || height === 0) {
            return;
        }

        const ratio = width / height;

        // Determine aspect ratio with tolerance
        // Check ratios in order: 9:16 (vertical), 1:1 (square), 16:9 (horizontal)
        const ratio9_16 = 9 / 16; // 0.5625
        const ratio1_1 = 1; // 1.0
        const ratio16_9 = 16 / 9; // 1.777...

        if (Math.abs(ratio - ratio9_16) < 0.1) {
            this._aspectRatio.set('9:16');
        } else if (Math.abs(ratio - ratio1_1) < 0.1) {
            this._aspectRatio.set('1:1');
        } else if (Math.abs(ratio - ratio16_9) < 0.1) {
            this._aspectRatio.set('16:9');
        } else {
            // Default to 16:9 for unknown ratios
            this._aspectRatio.set('16:9');
        }
    }

    /**
     * Play 3-second preview from word start time
     * @param startTime Word start time
     * @param isEndWord Whether this is an end word (play 3 seconds before ending at word end)
     * @param wordEnd Word end time (used directly to avoid floating point precision errors)
     */
    public playWordPreview(startTime: number, isEndWord: boolean = false, wordEnd?: number): void {
        if (!this.videoElement) return;

        // Calculate preview times
        const PREVIEW_DURATION = 3; // seconds
        let previewStart: number;
        let previewEnd: number;

        if (isEndWord && wordEnd !== undefined) {
            // For end words: play 3 seconds before ending at word end
            previewStart = Math.max(0, startTime - PREVIEW_DURATION);

            // Use word.end directly to avoid floating point precision errors
            previewEnd = wordEnd;

        } else {
            // For start words: play 3 seconds from start
            previewStart = startTime;
            previewEnd = Math.min(this._duration(), startTime + PREVIEW_DURATION);
        }

        // Set preview mode
        this.isPreviewMode = true;
        this.previewEndTime = previewEnd;
        this.isEditedPlaybackMode = false;

        // Seek and play
        this.seek(previewStart);
        this.play();
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
     * Skip deleted segments during edited playback
     * Uses exact deletion boundaries from editor state (including fine-tuned handle positions)
     * Uses early detection and seek to ensure precise skipping at segment boundaries
     * If in preview mode with end time, ensure we don't skip past it
     */
    private skipDeletedSegments(): void {
        if (!this.videoElement) return;

        const currentTime = this.videoElement.currentTime;

        // Check if current time is within a deleted segment
        for (const segment of this.deletedSegments) {
            const isWithinSegment = currentTime >= segment.start && currentTime < segment.end;

            if (isWithinSegment) {
                // Skip target is end of segment (exact position)
                let skipTarget = segment.end;

                // If in preview mode, don't skip past the preview end time
                if (this.isPreviewMode && this.previewEndTime !== null) {
                    skipTarget = Math.min(skipTarget, this.previewEndTime);

                    // If the skip target equals or exceeds preview end, just pause
                    if (skipTarget >= this.previewEndTime) {
                        this.pause();
                        this.isPreviewMode = false;
                        this.previewEndTime = null;
                        this.isEditedPlaybackMode = false;
                        return;
                    }
                }

                // Clamp to video duration
                skipTarget = Math.min(skipTarget, this._duration());

                // Log skip details for debugging
                const timeDifference = skipTarget - currentTime;
                console.log('[SKIP] Deleted segment skip - BEFORE:', {
                    currentTime: currentTime.toFixed(6) + 's',
                    skipTarget: skipTarget.toFixed(6) + 's',
                    segmentStart: segment.start.toFixed(6) + 's',
                    segmentEnd: segment.end.toFixed(6) + 's',
                    timeDifference: timeDifference.toFixed(6) + 's',
                    skipPrecision: Math.abs(timeDifference) < 0.001 ? 'EXACT' : 'APPROXIMATE'
                });

                // Seek to exact end of deleted segment for precise skipping
                // Early detection is handled by frequent checks (16ms interval + timeupdate event)
                this.lastSkipTarget = skipTarget; // Store for logging in timeupdate
                this.seek(skipTarget);

                break;
            }
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
                // Seek to exact end time before pausing to ensure precision
                this.seek(this.previewEndTime);
                this.pause();
                this.isPreviewMode = false;
                this.previewEndTime = null;
                return;
            }
        }
    }

    /**
     * Start interval to check playback state every ~16ms (60 FPS)
     * Handles both preview mode ending and deleted segment skipping
     * Provides much more accurate timing than relying on timeupdate alone (which fires every ~250ms)
     * Also uses timeupdate event for additional precision
     */
    private startPlaybackCheck(): void {
        // Clear any existing interval
        this.stopPlaybackCheck();

        this.playbackCheckInterval = window.setInterval(() => {
            if (!this.videoElement) return;

            // Check preview end (also checked in timeupdate for precision)
            this.checkPreviewEnd();

            // Check deleted segments - skip smoothly
            if (this.isEditedPlaybackMode && this.deletedSegments.length > 0) {
                this.skipDeletedSegments();
            }
        }, this.PLAYBACK_CHECK_INTERVAL_MS);
    }

    /**
     * Stop the playback check interval
     */
    private stopPlaybackCheck(): void {
        if (this.playbackCheckInterval !== null) {
            clearInterval(this.playbackCheckInterval);
            this.playbackCheckInterval = null;
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
     */
    public pause(): void {
        if (!this.videoElement) return;
        this.videoElement.pause();
        // Immediately update state (don't wait for 'pause' event)
        this._isPlaying.set(false);
    }

    /**
     * Toggle play/pause
     * ALWAYS skips deleted segments during playback (PRD: Video Playback)
     * If there's a selection and video is paused, jump to selection start before playing
     * If there's a complete selection (start + end), play only that segment (skipping deleted words within)
     */
    public togglePlayPause(): void {
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
                // If handles exist, use their exact positions; otherwise use word boundaries
                const startHandle = this.timelineService.startHandle();
                const endHandle = this.timelineService.endHandle();

                // Use handle positions if available (fine-tuned), otherwise use word boundaries
                // playSelectedSegment will stop exactly at playEnd using checkPreviewEnd()
                const playStart = startHandle?.time ?? selectionStart.start;
                const playEnd = endHandle?.time ?? selectionEnd.end;

                this.playSelectedSegment(words, playStart, playEnd);
            } else if (selectionStart) {
                // Only start selected - jump to start word beginning and play with deleted skipping
                this.playEditedVideo(words, selectionStart.start);
            } else {
                // No selection - play from beginning, ALWAYS skip deleted segments
                this.playEditedVideo(words, 0);
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
        this.hlsLoaderService.destroy(this.hls);
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
        this._isLoading.set(false);
        this._error.set(null);
        this.isPreviewMode = false;
        this.isEditedPlaybackMode = false;
        this.deletedSegments = [];
    }

    /**
     * Reset player state
     */
    public reset(): void {
        this.destroy();
    }
}

