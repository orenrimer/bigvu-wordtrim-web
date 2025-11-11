import { Injectable, signal, computed, effect, inject } from '@angular/core';
import Hls from 'hls.js';
import { Word, WordState } from '../models';
import { EditorStateService } from './editor-state.service';
import { TimelineService } from './timeline.service';

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

    // Smooth playback checks
    private playbackCheckInterval: number | null = null;
    private readonly PLAYBACK_CHECK_INTERVAL_MS = 50; // Check every 50ms for accurate preview/skip

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

        // Check if HLS is supported
        if (Hls.isSupported()) {
            this.initializeHls(videoUrl);
        } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS support (Safari)
            this.initializeNativeHls(videoUrl);
        } else {
            this._error.set('HLS is not supported in this browser');
            this._isLoading.set(false);
        }

        // Attach event listeners
        this.attachVideoEventListeners();
    }

    /**
     * Initialize HLS.js player
     */
    private initializeHls(videoUrl: string): void {
        if (!this.videoElement) return;

        // Resolve URL (convert relative paths to absolute)
        const resolvedUrl = this.resolveUrl(videoUrl);
        console.info('🎬 Loading HLS video from:', resolvedUrl);

        // Create HLS instance
        this.hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
        });

        // Bind HLS to video element
        this.hls.loadSource(resolvedUrl);
        this.hls.attachMedia(this.videoElement);

        // HLS event handlers
        this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
            this._isLoading.set(false);
            console.info('✅ Video loaded successfully');
            console.info('📐 Current aspect ratio:', this._aspectRatio());
        });

        this.hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                this._error.set(`Video Error: ${data.type}`);
                this._isLoading.set(false);
                console.error('❌ HLS fatal error:', data);
            } else {
                console.warn('⚠️ HLS non-fatal error:', data);
            }
        });
    }

    /**
     * Initialize native HLS support (Safari)
     */
    private initializeNativeHls(videoUrl: string): void {
        if (!this.videoElement) return;

        // Resolve URL (convert relative paths to absolute)
        const resolvedUrl = this.resolveUrl(videoUrl);
        console.info('🎬 Loading native HLS video from:', resolvedUrl);

        this.videoElement.src = resolvedUrl;

        // Ensure video loads
        this.videoElement.load();

        this.videoElement.addEventListener('loadedmetadata', () => {
            this._isLoading.set(false);
            console.info('✅ Native HLS loaded successfully');
        });
    }

    /**
     * Resolve video URL (handles both absolute and relative paths)
     * @param url Video URL
     * @returns Resolved absolute URL
     */
    private resolveUrl(url: string): string {
        // If already absolute (http/https), return as-is
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url;
        }

        // For relative paths, prepend origin
        const path = url.startsWith('/') ? url : `/${url}`;
        return `${window.location.origin}${path}`;
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

        // Time update event - just update current time signal
        this.videoElement.addEventListener('timeupdate', () => {
            if (!this.videoElement) return;
            this._currentTime.set(this.videoElement.currentTime);
        });

        // Duration change event
        this.videoElement.addEventListener('loadedmetadata', () => {
            if (!this.videoElement) return;
            this._duration.set(this.videoElement.duration);
            this.detectAspectRatio();
            console.info('📹 Video metadata loaded - Aspect ratio detected:', this._aspectRatio(),
                `(${this.videoElement.videoWidth}x${this.videoElement.videoHeight})`);
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
            this._error.set(error ? `Video Error: ${error.message}` : 'Unknown video error');
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

        if (width === 0 || height === 0) return;

        const ratio = width / height;

        // Determine aspect ratio with tolerance
        if (Math.abs(ratio - 16 / 9) < 0.1) {
            this._aspectRatio.set('16:9');
        } else if (Math.abs(ratio - 1) < 0.1) {
            this._aspectRatio.set('1:1');
        } else if (Math.abs(ratio - 9 / 16) < 0.1) {
            this._aspectRatio.set('9:16');
        } else {
            // Default to 16:9 for unknown ratios
            this._aspectRatio.set('16:9');
        }
    }

    /**
     * Play 3-second preview from word start time
     * @param startTime Word start time
     * @param isEndWord Whether this is an end word (play 3 seconds before word with smart ending)
     * @param wordDuration Duration of the word (for smart margin calculation)
     */
    public playWordPreview(startTime: number, isEndWord: boolean = false, wordDuration?: number): void {
        if (!this.videoElement) return;

        // Calculate preview times
        const PREVIEW_DURATION = 3; // seconds
        let previewStart: number;
        let previewEnd: number;

        if (isEndWord && wordDuration !== undefined) {
            // For end words: play 3 seconds before with smart ending to prevent spillover
            previewStart = Math.max(0, startTime - PREVIEW_DURATION);

            // Always use 33% margin from word end to prevent spillover (play 2/3 of word)
            const margin = wordDuration * (1.0 / 3.0);
            previewEnd = startTime + wordDuration - margin;

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
     * Calculate deleted segments from words array
     * Includes margin before deleted segment (33% of previous word) to prevent audio spillover
     * Plays 2/3 of the previous word before skipping
     * @param words Array of words with states
     * @returns Array of deleted time segments with pre-skip margin
     */
    private calculateDeletedSegments(words: Word[]): Array<{ start: number; end: number }> {
        const segments: Array<{ start: number; end: number }> = [];
        let currentDeletedStart: number | null = null;
        let deleteSegmentStartIndex: number | null = null;

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
                    deleteSegmentStartIndex = i;

                    // Start skipping from 2/3 of the previous word (play 2/3, skip last 1/3)
                    if (i > 0) {
                        const prevWord = words[i - 1];
                        const prevWordDuration = prevWord.end - prevWord.start;
                        const prevWordSkipPoint = prevWord.start + (prevWordDuration * (2.0 / 3.0));
                        currentDeletedStart = prevWordSkipPoint;
                    } else {
                        // First word is deleted - start from beginning
                        currentDeletedStart = word.start;
                    }
                }
            } else {
                // End of deleted segment
                if (currentDeletedStart !== null) {
                    segments.push({
                        start: currentDeletedStart,
                        end: words[i - 1].end
                    });
                    currentDeletedStart = null;
                    deleteSegmentStartIndex = null;
                }
            }
        }

        // Handle case where last word(s) are deleted
        if (currentDeletedStart !== null) {
            segments.push({
                start: currentDeletedStart,
                end: words[words.length - 1].end
            });
        }

        return segments;
    }

    /**
     * Skip deleted segments during edited playback
     * Deleted segments already include 33% pre-margin from previous word (play 2/3 of previous word)
     * If in preview mode with end time, ensure we don't skip past it
     */
    private skipDeletedSegments(): void {
        if (!this.videoElement) return;

        const currentTime = this.videoElement.currentTime;

        // Check if current time is within a deleted segment
        for (const segment of this.deletedSegments) {
            if (currentTime >= segment.start && currentTime < segment.end) {
                // Skip target is end of segment (no additional margin needed)
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

                // Skip to end of deleted segment (or preview end, whichever is earlier)
                this.seek(skipTarget);
                break;
            }
        }
    }

    /**
     * Start interval to check playback state every 50ms
     * Handles both preview mode ending and deleted segment skipping
     * Provides much more accurate timing than relying on timeupdate alone (which fires every ~250ms)
     */
    private startPlaybackCheck(): void {
        // Clear any existing interval
        this.stopPlaybackCheck();

        this.playbackCheckInterval = window.setInterval(() => {
            if (!this.videoElement) return;

            const currentTime = this.videoElement.currentTime;

            // Check preview mode - stop at precise end time
            if (this.isPreviewMode && this.previewEndTime !== null) {
                if (currentTime >= this.previewEndTime) {
                    this.pause();
                    this.isPreviewMode = false;
                    this.previewEndTime = null;
                    return;
                }
            }

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
                .catch((error) => {
                    console.error('Play error:', error);
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
                    console.warn('⚠️ Cannot play: entire selected segment is deleted');
                    return;
                }

                // Complete selection - play from start word beginning to end word end (skipping deleted words)
                // Always use 33% margin from end word to prevent spillover (play 2/3 of word)
                const endWordDuration = selectionEnd.end - selectionEnd.start;
                const margin = endWordDuration * (1.0 / 3.0);

                // Play from start of first word to end of last word (with margin)
                const playStart = selectionStart.start;
                const playEnd = selectionEnd.end - margin;

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
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }

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

