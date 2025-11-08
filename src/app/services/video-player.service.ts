import { Injectable, signal, computed, effect } from '@angular/core';
import Hls from 'hls.js';
import { Word, WordState } from '../models';

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
        });

        // Pause event
        this.videoElement.addEventListener('pause', () => {
            this._isPlaying.set(false);
        });

        // Time update event
        this.videoElement.addEventListener('timeupdate', () => {
            if (!this.videoElement) return;
            this._currentTime.set(this.videoElement.currentTime);

            // Handle preview mode - auto pause at end time
            if (this.isPreviewMode && this.previewEndTime !== null) {
                if (this.videoElement.currentTime >= this.previewEndTime) {
                    this.pause();
                    this.isPreviewMode = false;
                    this.previewEndTime = null;
                }
            }

            // Handle edited playback mode - skip deleted segments
            if (this.isEditedPlaybackMode && this.deletedSegments.length > 0) {
                this.skipDeletedSegments();
            }
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
     * @param startTime Word start time in seconds
     * @param isEndWord Whether this is an end word (play 3 seconds before)
     */
    public playWordPreview(startTime: number, isEndWord: boolean = false): void {
        if (!this.videoElement) return;

        // Calculate preview times
        const PREVIEW_DURATION = 3; // seconds
        let previewStart: number;
        let previewEnd: number;

        if (isEndWord) {
            // For end words, play 3 seconds before
            previewStart = Math.max(0, startTime - PREVIEW_DURATION);
            previewEnd = startTime;
        } else {
            // For normal words, play 3 seconds from start
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
     */
    public playEditedVideo(words: Word[]): void {
        if (!this.videoElement) return;

        // Calculate deleted segments
        this.deletedSegments = this.calculateDeletedSegments(words);

        // Set edited playback mode
        this.isEditedPlaybackMode = true;
        this.isPreviewMode = false;
        this.previewEndTime = null;

        // Start from beginning
        this.seek(0);
        this.play();
    }

    /**
     * Calculate deleted segments from words array
     * @param words Array of words with states
     * @returns Array of deleted time segments
     */
    private calculateDeletedSegments(words: Word[]): Array<{ start: number; end: number }> {
        const segments: Array<{ start: number; end: number }> = [];
        let currentDeletedStart: number | null = null;

        for (let i = 0; i < words.length; i++) {
            const word = words[i];

            if (word.state === WordState.DELETED) {
                // Start of deleted segment
                if (currentDeletedStart === null) {
                    currentDeletedStart = word.start;
                }
            } else {
                // End of deleted segment
                if (currentDeletedStart !== null) {
                    segments.push({
                        start: currentDeletedStart,
                        end: words[i - 1].end
                    });
                    currentDeletedStart = null;
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
     */
    private skipDeletedSegments(): void {
        if (!this.videoElement) return;

        const currentTime = this.videoElement.currentTime;

        // Check if current time is within a deleted segment
        for (const segment of this.deletedSegments) {
            if (currentTime >= segment.start && currentTime < segment.end) {
                // Skip to end of deleted segment
                this.seek(segment.end);
                break;
            }
        }
    }

    /**
     * Play video
     */
    public play(): void {
        if (!this.videoElement) return;

        const playPromise = this.videoElement.play();
        if (playPromise !== undefined) {
            playPromise.catch((error) => {
                console.error('Play error:', error);
                this._error.set('Failed to play video');
            });
        }
    }

    /**
     * Pause video
     */
    public pause(): void {
        if (!this.videoElement) return;
        this.videoElement.pause();
    }

    /**
     * Toggle play/pause
     */
    public togglePlayPause(): void {
        if (this._isPlaying()) {
            this.pause();
        } else {
            this.play();
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

