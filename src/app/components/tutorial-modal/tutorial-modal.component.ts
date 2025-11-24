import { Component, inject, HostListener, ViewChild, ElementRef, AfterViewInit, OnDestroy, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TutorialService } from '../../services/tutorial.service';
import { HlsLoaderService } from '../../services/hls-loader.service';
import { environment } from '../../../environments/environment.development';
import Hls from 'hls.js';

/**
 * Extended HTMLVideoElement with cleanup function for event listeners
 */
interface VideoElementWithCleanup extends HTMLVideoElement {
    _tutorialEventCleanup?: () => void;
}

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
    // Constants for timing and delays
    private static readonly VIDEO_INIT_DELAY_MS = 10; // Delay before initializing video to ensure DOM is ready
    private static readonly VIDEO_RETRY_DELAY_MS = 100; // Delay before retrying video initialization
    private static readonly POSITION_CHECK_DELAY_MS = 200; // Delay before checking position again for layout shifts
    private static readonly POSITION_RETRY_INTERVAL_MS = 50; // Interval between position check retries
    private static readonly POSITION_MAX_RETRIES = 60; // Max retries for position check (3000ms total)
    private static readonly VIDEO_PLAYBACK_DELAY_MS = 100; // Delay before starting video playback

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

    // Track active timeouts for cleanup
    private activeTimeouts: number[] = [];

    // Track active animation frames for cleanup
    private activeAnimationFrames: number[] = [];

    // Track video initialization timeout separately to prevent it from being cleared prematurely
    private videoInitTimeoutId: number | null = null;

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
        }, { allowSignalWrites: true });

        // Watch for modal state changes and initialize video when switching to video mode
        effect(() => {
            const modalState = this.tutorialService.modalState();
            if (modalState === 'video') {
                // Clear any existing video initialization timeout
                if (this.videoInitTimeoutId !== null) {
                    window.clearTimeout(this.videoInitTimeoutId);
                    this.videoInitTimeoutId = null;
                }

                // Schedule initialization outside reactive context using setTimeout
                // This ensures ViewChild is available after Angular's change detection completes
                // Use a small delay to ensure the component is fully rendered
                this.videoInitTimeoutId = window.setTimeout(() => {
                    this.videoInitTimeoutId = null;
                    // Use requestAnimationFrame to ensure DOM is ready
                    const rafId = requestAnimationFrame(() => {
                        // Remove from tracking when executed
                        const index = this.activeAnimationFrames.indexOf(rafId);
                        if (index > -1) {
                            this.activeAnimationFrames.splice(index, 1);
                        }

                        if (this.videoElementRef?.nativeElement) {
                            this.initializeVideo();
                        } else {
                            // If still not available, retry with a longer delay
                            const retryTimeoutId = window.setTimeout(() => {
                                if (this.videoElementRef?.nativeElement) {
                                    this.initializeVideo();
                                } else {
                                    console.warn('Video element not available after retry, modal may not be rendered yet');
                                }
                            }, TutorialModalComponent.VIDEO_RETRY_DELAY_MS);
                            this.activeTimeouts.push(retryTimeoutId);
                        }
                    });
                    this.activeAnimationFrames.push(rafId);
                }, TutorialModalComponent.VIDEO_INIT_DELAY_MS);
            } else {
                // Clean up when modal is hidden or in tip mode
                // Clear video initialization timeout specifically
                if (this.videoInitTimeoutId !== null) {
                    window.clearTimeout(this.videoInitTimeoutId);
                    this.videoInitTimeoutId = null;
                }
                // Clear other timeouts and animation frames (tip-related)
                this.clearAllTimeouts();
                this.clearAllAnimationFrames();
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
                    const timeoutId1 = window.setTimeout(() => {
                        const newLeft = getComputedStyle(document.documentElement).getPropertyValue('--words-container-left').trim();
                        const newTop = getComputedStyle(document.documentElement).getPropertyValue('--words-container-top').trim();

                        if (newLeft !== leftValue || newTop !== topValue) {
                            // Position changed, trigger position recalculation
                            // This will be handled by the main component's effect
                        }
                    }, TutorialModalComponent.POSITION_CHECK_DELAY_MS);
                    this.activeTimeouts.push(timeoutId1);

                    return true;
                };

                // Check immediately first (properties might already be set)
                if (!checkPosition()) {
                    // Properties not set yet or words not rendered, retry
                    let retryCount = 0;
                    const maxRetries = TutorialModalComponent.POSITION_MAX_RETRIES;
                    const retryCheck = () => {
                        if (checkPosition()) {
                            return; // Found, stop retrying
                        }
                        if (retryCount < maxRetries) {
                            retryCount++;
                            const timeoutId = window.setTimeout(retryCheck, TutorialModalComponent.POSITION_RETRY_INTERVAL_MS);
                            this.activeTimeouts.push(timeoutId);
                        }
                        // If max retries reached, don't show tip (no fallback)
                    };
                    const timeoutId2 = window.setTimeout(retryCheck, TutorialModalComponent.POSITION_RETRY_INTERVAL_MS);
                    this.activeTimeouts.push(timeoutId2);
                } else {
                    // Position was already ready, set it immediately
                    this.isPositionReady.set(true);
                }
            } else {
                // Reset when not in tip mode
                // Only clear tip-related timeouts and animation frames, not video initialization timeout
                // Check if we're switching to video mode - if so, don't clear video timeout
                const currentModalState = this.tutorialService.modalState();
                if (currentModalState !== 'video') {
                    // Only clear tip timeouts and animation frames if not switching to video mode
                    this.clearAllTimeouts();
                    this.clearAllAnimationFrames();
                }
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
        // Use a small delay to ensure ViewChild is fully available
        if (this.tutorialService.modalState() === 'video') {
            const timeoutId = window.setTimeout(() => {
                if (this.videoElementRef?.nativeElement) {
                    this.initializeVideo();
                } else {
                    // If still not available, the effect will handle it
                    console.warn('Video element not available in ngAfterViewInit');
                }
            }, TutorialModalComponent.VIDEO_INIT_DELAY_MS);
            this.activeTimeouts.push(timeoutId);
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

        // Ensure video element is in the DOM
        if (!videoElement.isConnected) {
            console.warn('Tutorial video element is not connected to DOM, retrying...');
            // Retry after a short delay
            const timeoutId = window.setTimeout(() => {
                this.initializeVideo();
            }, TutorialModalComponent.VIDEO_RETRY_DELAY_MS);
            this.activeTimeouts.push(timeoutId);
            return;
        }

        // Validate video URL
        if (!this.tutorialVideoUrl || this.tutorialVideoUrl.trim() === '') {
            console.error('Tutorial video URL is not configured');
            return;
        }

        // Clean up existing HLS instance if any
        this.destroyHls();

        // Ensure video element is in a clean state before initialization
        // Remove any existing src attribute and reset video element
        videoElement.removeAttribute('src');
        videoElement.load();

        // Initialize HLS using HlsLoaderService
        this.hls = this.hlsLoaderService.initialize(
            videoElement,
            this.tutorialVideoUrl,
            {
                onManifestParsed: () => {
                    // Video is ready to play - start playback automatically
                    const timeoutId = window.setTimeout(() => {
                        if (videoElement && !videoElement.paused) {
                            // Already playing (autoplay worked)
                        } else {
                            // Try to play programmatically (fallback if autoplay was blocked)
                            videoElement?.play().catch((error) => {
                                console.warn('Autoplay was blocked, user interaction required:', error);
                            });
                        }
                    }, TutorialModalComponent.VIDEO_PLAYBACK_DELAY_MS);
                    this.activeTimeouts.push(timeoutId);
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

                    // Check if data is ErrorData (has fatal/details properties) using type guards
                    const isFatal = data && typeof data === 'object' && 'fatal' in data && data.fatal;
                    const hasDetails = data && typeof data === 'object' && 'details' in data && data.details;
                    const detailsValue = hasDetails ? data.details : null;

                    // Only log fatal errors or non-ignored errors
                    if (isFatal || (hasDetails && detailsValue && typeof detailsValue === 'string' && !nonFatalErrorsToIgnore.includes(detailsValue))) {
                        if (isFatal) {
                            console.error('Tutorial video HLS fatal error:', {
                                event,
                                type: 'type' in data ? data.type : undefined,
                                details: hasDetails ? detailsValue : undefined,
                                fatal: isFatal,
                                url: 'url' in data ? data.url : undefined,
                                message: 'message' in data ? data.message : undefined,
                                error: 'error' in data ? data.error : undefined,
                                videoUrl: this.tutorialVideoUrl
                            });
                        } else {
                            // Log non-fatal but potentially interesting errors as warnings
                            console.warn('Tutorial video HLS warning:', {
                                type: 'type' in data ? data.type : undefined,
                                details: hasDetails ? detailsValue : undefined,
                                message: 'message' in data ? data.message : undefined,
                                videoUrl: this.tutorialVideoUrl
                            });
                        }
                    }
                    // Silently ignore non-fatal errors that are handled automatically by HLS.js
                }
            }
        );

        // Check if initialization failed
        // Note: hls can be null if using native HLS (Safari), which is still valid
        if (!this.hls && !this.hlsLoaderService.isNativeHlsSupported(videoElement)) {
            console.error('Tutorial video: HLS is not supported in this browser');
            return;
        }

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
            if (error) {
                let errorMessage = 'Unknown error';
                switch (error.code) {
                    case error.MEDIA_ERR_ABORTED:
                        errorMessage = 'Video loading aborted';
                        break;
                    case error.MEDIA_ERR_NETWORK:
                        errorMessage = 'Network error while loading video';
                        break;
                    case error.MEDIA_ERR_DECODE:
                        errorMessage = 'Error decoding video';
                        break;
                    case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                        errorMessage = 'Video format not supported';
                        break;
                }
                console.error('Tutorial video element error:', {
                    code: error.code,
                    message: errorMessage,
                    videoUrl: this.tutorialVideoUrl,
                    src: videoElement.src,
                    networkState: videoElement.networkState,
                    readyState: videoElement.readyState
                });
            } else {
                console.error('Tutorial video element error (no error details available)', {
                    videoUrl: this.tutorialVideoUrl,
                    src: videoElement.src,
                    networkState: videoElement.networkState,
                    readyState: videoElement.readyState
                });
            }
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
        const elementWithCleanup = videoElement as VideoElementWithCleanup;
        elementWithCleanup._tutorialEventCleanup = () => {
            cleanupFunctions.forEach(cleanup => cleanup());
            delete elementWithCleanup._tutorialEventCleanup;
        };
    }

    /**
     * Clear all active timeouts
     */
    private clearAllTimeouts(): void {
        this.activeTimeouts.forEach(timeoutId => {
            window.clearTimeout(timeoutId);
        });
        this.activeTimeouts = [];
    }

    /**
     * Clear all active animation frames
     */
    private clearAllAnimationFrames(): void {
        this.activeAnimationFrames.forEach(rafId => {
            cancelAnimationFrame(rafId);
        });
        this.activeAnimationFrames = [];
    }

    /**
     * Clean up HLS instance
     */
    private destroyHls(): void {
        const videoElement = this.videoElementRef?.nativeElement;

        // Clean up event listeners if they exist
        const elementWithCleanup = videoElement as VideoElementWithCleanup;
        if (elementWithCleanup && elementWithCleanup._tutorialEventCleanup) {
            elementWithCleanup._tutorialEventCleanup();
        }

        // Pause video before cleanup to prevent errors
        if (videoElement && !videoElement.paused) {
            videoElement.pause();
        }

        // Destroy HLS.js instance
        this.hlsLoaderService.destroy(this.hls, videoElement);
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
        // Clear video initialization timeout
        if (this.videoInitTimeoutId !== null) {
            window.clearTimeout(this.videoInitTimeoutId);
            this.videoInitTimeoutId = null;
        }

        // Clear all active timeouts
        this.clearAllTimeouts();

        // Clear all active animation frames
        this.clearAllAnimationFrames();

        // Clean up HLS instance and event listeners
        this.destroyHls();
    }
}

