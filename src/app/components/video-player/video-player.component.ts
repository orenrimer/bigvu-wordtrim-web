import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, ViewEncapsulation, computed, inject, effect, signal } from '@angular/core';
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
    
    // Signal to track window width for responsive calculations
    private windowWidth = signal<number>(typeof window !== 'undefined' ? window.innerWidth : 1920);
    
    // Store resize listener cleanup function
    private resizeListener: (() => void) | null = null;

    // Expose service signals to template
    isPlaying = this.videoService.isPlaying;
    currentTime = this.videoService.currentTime;
    duration = this.videoService.duration;
    isLoading = this.videoService.isLoading;
    error = this.videoService.error;
    aspectRatio = this.videoService.aspectRatio;
    formattedCurrentTime = this.videoService.formattedCurrentTime;
    formattedDuration = this.videoService.formattedDuration;

    // Computed signal for aspect ratio value (for CSS)
    // This will automatically update when aspectRatio signal changes or window width changes
    aspectRatioValue = computed(() => {
        const width = this.windowWidth();
        // Check if we're on mobile (screen width <= 768px)
        if (width <= 768) {
            return '16 / 9';
        }
        const ratio = this.aspectRatio();
        return ratio.replace(':', ' / ') || '16 / 9';
    });

    // Computed signal for container height based on aspect ratio
    // This will automatically update when aspectRatio signal changes or window width changes
    containerHeight = computed(() => {
        const ratio = this.aspectRatio();
        const width = this.windowWidth();
        
        // On mobile (max-width: 768px), always use 16:9 aspect ratio
        if (width <= 768) {
            // For 16:9 on mobile, calculate height based on available width
            // Typically mobile width is full screen, but we'll use a reasonable height
            // If width is constrained, height = width / (16/9)
            // For now, we'll use a fixed height that works well on mobile
            return '198px'; // Standard height for 16:9 on mobile (352px width / (16/9) = 198px)
        }
        
        // Check if we're on smaller screens (max-width: 1440px)
        // On smaller screens, width is limited to 352px, so height needs to adjust
        if (width <= 1440) {
            // For 16:9: width = 352px, height = 352 / (16/9) = 198px
            // For 9:16: width = 352px, height = 352 / (9/16) = 625.78px
            // For 1:1: width = 352px, height = 352px
            if (ratio === '9:16') {
                return '625.78px';
            } else if (ratio === '1:1') {
                return '352px';
            } else {
                // 16:9
                return '198px';
            }
        }
        
        // Default heights for larger screens:
        // 16:9 → 468px
        // 9:16 → 625.78px
        // 1:1 → 468px
        if (ratio === '9:16') {
            return '625.78px';
        } else {
            // 16:9 or 1:1
            return '468px';
        }
    });

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
        // Effect: Initialize video player (set src) when metadata is loaded and view is ready
        // Aspect ratio is already set in VideoPlayerService constructor when metadata loads
        // So the player container is already the correct size before this runs
        effect(() => {
            const metadata = this.videoDataService.metadata();
            const videoElement = this.videoElementRef?.nativeElement;

            // Only initialize once when both metadata and video element are ready
            if (metadata && videoElement && !this.isPlayerInitialized) {
                // At this point, aspect ratio is already set in VideoPlayerService, so player is correct size
                // Now we set the video src
                this.videoService.initializePlayer(
                    videoElement,
                    metadata.hlsPlaylistUrl
                );
                this.isPlayerInitialized = true;
            }
        }, { allowSignalWrites: true });
    }

    ngOnInit(): void {
        // Set initial window width immediately to avoid computed signals using default value
        // This ensures aspect ratio and height calculations are correct from the start
        if (typeof window !== 'undefined') {
            this.windowWidth.set(window.innerWidth);
        }
    }

    ngAfterViewInit(): void {
        // Listen to window resize events to update windowWidth signal
        // Use requestAnimationFrame to debounce resize events and avoid excessive updates
        if (typeof window !== 'undefined') {
            let resizeTimeout: number | null = null;
            const updateWidth = () => {
                // Clear any pending resize update
                if (resizeTimeout !== null) {
                    cancelAnimationFrame(resizeTimeout);
                }
                
                // Schedule update for next animation frame to debounce rapid resize events
                resizeTimeout = requestAnimationFrame(() => {
                    this.windowWidth.set(window.innerWidth);
                    resizeTimeout = null;
                });
            };
            
            // Listen to resize events
            window.addEventListener('resize', updateWidth, { passive: true });
            
            // Store cleanup function for ngOnDestroy
            this.resizeListener = () => {
                if (resizeTimeout !== null) {
                    cancelAnimationFrame(resizeTimeout);
                }
                window.removeEventListener('resize', updateWidth);
            };
        }
        
        // Video player initialization is now handled by the effect
        // which waits for both video element and metadata to be ready
    }

    ngOnDestroy(): void {
        // Cleanup resize listener
        if (this.resizeListener) {
            this.resizeListener();
            this.resizeListener = null;
        }
        
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

}

