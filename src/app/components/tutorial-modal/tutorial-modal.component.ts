import { Component, inject, HostListener, ViewChild, ElementRef, AfterViewInit, OnDestroy, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TutorialService } from '../../services/tutorial.service';
import { HlsLoaderService } from '../../services/hls-loader.service';
import { environment } from '../../../environments/environment.development';
import Hls from 'hls.js';

/**
 * Tutorial Modal Component
 * Displays tutorial content in two modes: tip and video
 * Based on PRD: Tutorial System (Section 7)
 */
@Component({
    selector: 'app-tutorial-modal',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './tutorial-modal.component.html',
    styleUrls: ['./tutorial-modal.component.scss']
})
export class TutorialModalComponent implements AfterViewInit, OnDestroy {
    // Inject services
    protected readonly tutorialService = inject(TutorialService);
    private hlsLoaderService = inject(HlsLoaderService);

    // Video element reference
    @ViewChild('tutorialVideo', { static: false }) videoElementRef!: ElementRef<HTMLVideoElement>;

    // Tutorial video URL from environment
    protected readonly tutorialVideoUrl = environment.tutorialVideoUrl;

    // HLS.js instance
    private hls: Hls | null = null;

    // Video playback state
    protected readonly isPlaying = signal<boolean>(false);

    constructor() {
        // Watch for modal state changes and initialize video when switching to video mode
        effect(() => {
            const modalState = this.tutorialService.modalState();
            if (modalState === 'video') {
                // Use setTimeout to ensure the view is updated and video element is available
                // Retry mechanism in case ViewChild isn't immediately available
                let retryCount = 0;
                const maxRetries = 10; // Max 10 retries (500ms total)
                const tryInitialize = () => {
                    if (this.videoElementRef?.nativeElement) {
                        this.initializeVideo();
                    } else if (retryCount < maxRetries) {
                        retryCount++;
                        setTimeout(tryInitialize, 50);
                    } else {
                        console.warn('Video element not available after retries');
                    }
                };
                setTimeout(tryInitialize, 0);
            } else {
                // Clean up when modal is hidden or in tip mode
                this.destroyHls();
            }
        });
    }

    /**
     * Handle ESC key press to close modal
     */
    @HostListener('document:keydown.escape', ['$event'])
    onEscapeKey(event: KeyboardEvent): void {
        const modalState = this.tutorialService.modalState();
        if (modalState !== 'hidden') {
            event.preventDefault();
            this.close();
        }
    }

    /**
     * Close the modal
     */
    close(): void {
        this.tutorialService.hide();
    }

    /**
     * Switch from tip mode to video mode
     */
    showVideo(): void {
        this.tutorialService.showVideo();
    }

    /**
     * Handle backdrop click (close modal)
     * Only used in video mode
     */
    onBackdropClick(event: MouseEvent): void {
        this.close();
    }

    /**
     * After view init - check if video should be initialized
     */
    ngAfterViewInit(): void {
        // If modal is already in video mode when component initializes
        if (this.tutorialService.modalState() === 'video' && this.videoElementRef) {
            this.initializeVideo();
        }
    }

    /**
     * Initialize HLS video player
     */
    private initializeVideo(): void {
        const videoElement = this.videoElementRef?.nativeElement;
        if (!videoElement) {
            console.warn('Tutorial video element not available');
            return;
        }

        // Clean up existing HLS instance if any
        this.destroyHls();

        // Initialize HLS using HlsLoaderService
        this.hls = this.hlsLoaderService.initialize(
            videoElement,
            this.tutorialVideoUrl,
            {
                onManifestParsed: () => {
                    // Video is ready to play - start playback automatically
                    setTimeout(() => {
                        if (videoElement && !videoElement.paused) {
                            // Already playing (autoplay worked)
                        } else {
                            // Try to play programmatically (fallback if autoplay was blocked)
                            videoElement?.play().catch((error) => {
                                console.warn('Autoplay was blocked, user interaction required:', error);
                            });
                        }
                    }, 100);
                },
                onError: (event, data) => {
                    console.error('Tutorial video HLS error:', {
                        event,
                        type: data?.type,
                        details: data?.details,
                        fatal: data?.fatal,
                        url: data?.url,
                        message: data?.message,
                        error: data?.error,
                        fullData: data
                    });
                }
            }
        );

        // Attach additional event listeners for video element
        // (similar to VideoPlayerService for consistency)
        this.attachVideoEventListeners(videoElement);
    }

    /**
     * Toggle play/pause
     */
    onTogglePlayPause(): void {
        const videoElement = this.videoElementRef?.nativeElement;
        if (!videoElement) return;

        if (videoElement.paused) {
            videoElement.play().catch((error) => {
                console.warn('Play failed:', error);
            });
        } else {
            videoElement.pause();
        }
    }

    /**
     * Attach event listeners to video element
     */
    private attachVideoEventListeners(videoElement: HTMLVideoElement): void {
        // Store cleanup functions
        const cleanupFunctions: Array<() => void> = [];

        // Play event - update isPlaying signal
        const onPlay = () => {
            this.isPlaying.set(true);
        };
        videoElement.addEventListener('play', onPlay);
        cleanupFunctions.push(() => videoElement.removeEventListener('play', onPlay));

        // Pause event - update isPlaying signal
        const onPause = () => {
            this.isPlaying.set(false);
        };
        videoElement.addEventListener('pause', onPause);
        cleanupFunctions.push(() => videoElement.removeEventListener('pause', onPause));

        // Loaded metadata event listener
        const onLoadedMetadata = () => {
            // Metadata loaded
        };
        videoElement.addEventListener('loadedmetadata', onLoadedMetadata);
        cleanupFunctions.push(() => videoElement.removeEventListener('loadedmetadata', onLoadedMetadata));

        // Error event - for debugging
        const onError = () => {
            const error = videoElement.error;
            console.error('Tutorial video element error:', error);
        };
        videoElement.addEventListener('error', onError);
        cleanupFunctions.push(() => videoElement.removeEventListener('error', onError));

        // Can play event listener
        const onCanPlay = () => {
            // Video can play
        };
        videoElement.addEventListener('canplay', onCanPlay);
        cleanupFunctions.push(() => videoElement.removeEventListener('canplay', onCanPlay));

        // Store cleanup functions on element
        (videoElement as any)._tutorialEventCleanup = () => {
            cleanupFunctions.forEach(cleanup => cleanup());
            delete (videoElement as any)._tutorialEventCleanup;
        };
    }

    /**
     * Clean up HLS instance
     */
    private destroyHls(): void {
        const videoElement = this.videoElementRef?.nativeElement;

        // Clean up event listeners if they exist
        if (videoElement && (videoElement as any)._tutorialEventCleanup) {
            (videoElement as any)._tutorialEventCleanup();
        }

        // Destroy HLS.js instance
        this.hlsLoaderService.destroy(this.hls);
        this.hls = null;

        // Clear video source
        if (videoElement) {
            videoElement.src = '';
            videoElement.load();
        }
    }

    /**
     * Cleanup on component destroy
     */
    ngOnDestroy(): void {
        this.destroyHls();
    }
}

