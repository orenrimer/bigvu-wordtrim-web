import { Component, inject, HostListener, ViewChild, ElementRef, AfterViewInit, OnDestroy, effect, signal, computed } from '@angular/core';
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

    // Tip modal element reference
    @ViewChild('tipModal', { static: false }) tipModalRef!: ElementRef<HTMLElement>;

    // Tutorial video URL from environment
    protected readonly tutorialVideoUrl = environment.tutorialVideoUrl;

    // HLS.js instance
    private hls: Hls | null = null;

    // Video playback state
    protected readonly isPlaying = signal<boolean>(false);

    // Track if position is ready (CSS custom properties are set)
    protected readonly isPositionReady = signal<boolean>(false);

    // Track RTL mode state
    protected readonly isRTL = signal<boolean>(false);

    constructor() {
        // Watch for tip modal state and update RTL check
        effect(() => {
            const modalState = this.tutorialService.modalState();
            if (modalState === 'tip') {
                // Check RTL when tip modal is shown
                this.isRTL.set(document.documentElement.classList.contains('is-rtl'));
            }
        });

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

        // Watch for tip mode and check if position is ready
        // The modal should only show when:
        // 1. Modal state is 'tip'
        // 2. Words container position has been calculated (CSS custom properties are set)
        // 3. Words are actually rendered in the DOM
        effect(() => {
            const modalState = this.tutorialService.modalState();
            if (modalState === 'tip') {
                // Reset position ready state
                this.isPositionReady.set(false);

                // Check if CSS custom properties are set (position has been calculated)
                // AND if words container actually exists in DOM with words
                const checkPosition = () => {
                    const leftValue = getComputedStyle(document.documentElement).getPropertyValue('--words-container-left').trim();
                    const topValue = getComputedStyle(document.documentElement).getPropertyValue('--words-container-top').trim();

                    // Check if CSS custom properties are set and valid
                    if (!leftValue || !topValue || leftValue === '' || topValue === '' || leftValue === '0px' || topValue === '0px') {
                        return false;
                    }

                    // Also verify that words container exists and has word chips rendered
                    const wordsContainer = document.querySelector('.words-container');
                    if (!wordsContainer) {
                        return false;
                    }

                    // Check if there are actual word chips rendered (not just empty container)
                    const wordChips = wordsContainer.querySelectorAll('app-word-chip');
                    if (wordChips.length === 0) {
                        return false;
                    }

                    // All conditions met - position is ready
                    this.isPositionReady.set(true);

                    // Update RTL state when position is ready
                    this.isRTL.set(document.documentElement.classList.contains('is-rtl'));

                    // After showing modal, verify position doesn't change due to layout shifts
                    // Check position again after a short delay to catch any layout shifts
                    setTimeout(() => {
                        const newLeft = getComputedStyle(document.documentElement).getPropertyValue('--words-container-left').trim();
                        const newTop = getComputedStyle(document.documentElement).getPropertyValue('--words-container-top').trim();

                        if (newLeft !== leftValue || newTop !== topValue) {
                            // Position changed, trigger position recalculation
                            // This will be handled by the main component's effect
                        }
                    }, 200);

                    return true;
                };

                // Check immediately first (properties might already be set)
                if (!checkPosition()) {
                    // Properties not set yet or words not rendered, retry
                    let retryCount = 0;
                    const maxRetries = 60; // Max 60 retries (3000ms total)
                    const retryCheck = () => {
                        if (checkPosition()) {
                            return; // Found, stop retrying
                        }
                        if (retryCount < maxRetries) {
                            retryCount++;
                            setTimeout(retryCheck, 50);
                        }
                        // If max retries reached, don't show tip (no fallback)
                    };
                    setTimeout(retryCheck, 50);
                } else {
                    // Position was already ready, set it immediately
                    this.isPositionReady.set(true);
                }
            } else {
                // Reset when not in tip mode
                this.isPositionReady.set(false);
            }
        }, { allowSignalWrites: true });
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

        // Validate video URL
        if (!this.tutorialVideoUrl || this.tutorialVideoUrl.trim() === '') {
            console.error('Tutorial video URL is not configured');
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
                    // Filter out non-fatal errors that HLS.js handles automatically
                    // These errors don't require user intervention and are handled internally
                    const nonFatalErrorsToIgnore = [
                        'bufferSeekOverHole',      // HLS.js automatically seeks over buffer holes
                        'bufferStalled',           // HLS.js automatically recovers from stalls
                        'bufferStalledError',      // HLS.js automatically recovers from buffer stalls
                        'bufferAppending',         // Normal buffering operation
                        'bufferAppended'           // Normal buffering operation
                    ];

                    // Only log fatal errors or non-ignored errors
                    if (data?.fatal || (data?.details && !nonFatalErrorsToIgnore.includes(data.details))) {
                        if (data?.fatal) {
                            console.error('Tutorial video HLS fatal error:', {
                                event,
                                type: data?.type,
                                details: data?.details,
                                fatal: data?.fatal,
                                url: data?.url,
                                message: data?.message,
                                error: data?.error
                            });
                        } else {
                            // Log non-fatal but potentially interesting errors as warnings
                            console.warn('Tutorial video HLS warning:', {
                                type: data?.type,
                                details: data?.details,
                                message: data?.message
                            });
                        }
                    }
                    // Silently ignore non-fatal errors that are handled automatically by HLS.js
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

        // Pause video before cleanup to prevent errors
        if (videoElement && !videoElement.paused) {
            videoElement.pause();
        }

        // Destroy HLS.js instance
        this.hlsLoaderService.destroy(this.hls);
        this.hls = null;

        // Clear video source without triggering load error
        // Remove src attribute instead of setting to empty string to avoid "Invalid URI" error
        if (videoElement) {
            videoElement.removeAttribute('src');
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

