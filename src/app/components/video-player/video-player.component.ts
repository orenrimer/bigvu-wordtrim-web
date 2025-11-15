import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, ViewEncapsulation, computed, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { VideoPlayerService } from '../../services/video-player.service';
import { EditorStateService } from '../../services/editor-state.service';
import { VideoDataService } from '../../services/video-data.service';
import { WordState } from '../../models';

/**
 * Video Player Component
 * Custom video player with HLS.js support and playback controls
 * Based on PRD: Video Player Component
 * 
 * Features:
 * - Responsive to aspect ratios (16:9, 1:1, 9:16)
 * - Playback controls (play/pause, progress bar, time display)
 * - HLS video streaming
 * - Preview and full playback modes
 */
@Component({
    selector: 'app-video-player',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './video-player.component.html',
    styleUrl: './video-player.component.scss',
    encapsulation: ViewEncapsulation.None // Disable view encapsulation to check if that's the issue
})
export class VideoPlayerComponent implements OnInit, AfterViewInit, OnDestroy {
    @ViewChild('videoElement', { static: false }) videoElementRef!: ElementRef<HTMLVideoElement>;

    private editorState = inject(EditorStateService);
    private videoDataService = inject(VideoDataService);

    // Track if player has been initialized to avoid re-initialization
    private isPlayerInitialized = false;

    // Expose service signals to template
    isPlaying = this.videoService.isPlaying;
    currentTime = this.videoService.currentTime;
    duration = this.videoService.duration;
    isLoading = this.videoService.isLoading;
    error = this.videoService.error;
    aspectRatio = this.videoService.aspectRatio;
    formattedCurrentTime = this.videoService.formattedCurrentTime;
    formattedDuration = this.videoService.formattedDuration;

    /**
     * Check if entire selected segment is deleted
     * If true, play button should be disabled
     */
    protected readonly isEntireSegmentDeleted = computed(() => {
        const hasComplete = this.editorState.hasCompleteSelection();
        if (!hasComplete) return false;

        const selectedWords = this.editorState.selectedWords();
        if (selectedWords.length === 0) return false;

        // Check if ALL selected words are deleted
        return selectedWords.every(word =>
            word.state === WordState.DELETED ||
            word.state === WordState.DELETED_SELECTED_START ||
            word.state === WordState.DELETED_SELECTED_END ||
            word.state === WordState.DELETED_SELECTED_RANGE
        );
    });

    constructor(public videoService: VideoPlayerService) {
        // Effect: Initialize video player when metadata is loaded and view is ready
        effect(() => {
            const metadata = this.videoDataService.metadata();
            const videoElement = this.videoElementRef?.nativeElement;

            // Only initialize once when both metadata and video element are ready
            if (metadata && videoElement && !this.isPlayerInitialized) {
                this.videoService.initializePlayer(
                    videoElement,
                    metadata.hlsPlaylistUrl
                );
                this.isPlayerInitialized = true;
            }
        }, { allowSignalWrites: true });
    }

    ngOnInit(): void {
        // Initialization logic
    }

    ngAfterViewInit(): void {
        // Video player initialization is now handled by the effect
        // which waits for both video element and metadata to be ready
    }

    ngOnDestroy(): void {
        // Cleanup player on component destroy
        this.videoService.destroy();
    }

    /**
     * Toggle play/pause
     */
    onTogglePlayPause(): void {
        this.videoService.togglePlayPause();
    }

    /**
     * Handle progress bar click for seeking
     * @param event Mouse event on progress bar
     */
    onProgressBarClick(event: MouseEvent): void {
        const progressBar = event.currentTarget as HTMLElement;
        const rect = progressBar.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const percentage = clickX / rect.width;
        const seekTime = percentage * this.duration();

        this.videoService.seek(seekTime);
    }

    /**
     * Calculate progress percentage for progress bar
     */
    getProgressPercentage(): number {
        const current = this.currentTime();
        const total = this.duration();
        if (total === 0) return 0;
        return (current / total) * 100;
    }

    /**
     * Get CSS class for aspect ratio container
     */
    getAspectRatioClass(): string {
        const ratio = this.aspectRatio();
        return `video-container--${ratio.replace(':', '-')}`;
    }

    /**
     * Get aspect ratio value for CSS style binding
     * Returns format like "16 / 9", "9 / 16", or "1 / 1"
     * Defaults to "16 / 9" if aspect ratio is not yet detected
     * On mobile (screen width <= 768px), always returns "16 / 9"
     */
    getAspectRatioValue(): string {
        // Check if we're on mobile (screen width <= 768px)
        if (typeof window !== 'undefined' && window.innerWidth <= 768) {
            return '16 / 9';
        }

        const ratio = this.aspectRatio();
        return ratio.replace(':', ' / ') || '16 / 9';
    }
}

