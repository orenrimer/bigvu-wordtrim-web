import { Injectable } from '@angular/core';
import { Subject, Observable, fromEvent, timer, Subscription } from 'rxjs';
import { debounceTime, takeUntil, filter, tap, delay } from 'rxjs/operators';

/**
 * Scroll Service
 * Handles all scrolling behavior for the editor, including:
 * - Auto-scrolling during video playback
 * - Scrolling to gaps during gap review mode navigation
 * - Manual scroll detection and auto-scroll pause/resume
 */
@Injectable({
    providedIn: 'root'
})
export class ScrollService {
    // Constants for scroll behavior
    private static readonly MOBILE_BREAKPOINT_PX = 768;
    private static readonly AUTOSCROLL_RESUME_DELAY_MS = 5000; // Resume after 5 seconds of no manual scrolling
    private static readonly SCROLL_PADDING_MOBILE_PX = 30;
    private static readonly SCROLL_PADDING_DESKTOP_PX = 50;
    private static readonly PROGRAMMATIC_SCROLL_TIMEOUT_MS = 2000; // Time to ignore scroll events after programmatic scroll
    private static readonly PROGRAMMATIC_SCROLL_CLEANUP_DELAY_MS = 500; // Additional delay before clearing scroll end time
    private static readonly MOBILE_SCROLL_FINETUNE_DELAY_MS = 150; // Delay before fine-tuning mobile scroll position
    private static readonly MOBILE_SCROLL_OFFSET_RATIO = 0.2; // Position word at 20% from top on mobile
    private static readonly DESKTOP_SCROLL_OFFSET_RATIO = 0.5; // Center word on desktop (50%)
    private static readonly MOBILE_VISIBILITY_THRESHOLD_RATIO = 0.5; // Consider visible if within 50% of container height

    // Auto-scroll tracking
    private autoScrollPaused = false; // Whether auto-scroll is paused due to manual scroll
    private isProgrammaticScroll = false; // Flag to distinguish programmatic scrolls from manual ones
    private programmaticScrollEndTime = 0; // Timestamp when programmatic scroll should end

    // Track pending scroll subscriptions to cancel them on manual scroll
    private pendingScrollSubscriptions: Subscription[] = [];

    // RxJS Subject for debouncing auto-scroll resume
    private autoScrollResumeSubject = new Subject<void>();
    private destroy$ = new Subject<void>();

    // Observable for scroll events (per container)
    private scrollEvent$: Observable<Event> | null = null;
    private scrollSubscription: { unsubscribe: () => void } | null = null;

    // Track timeouts and animation frames for cleanup
    private activeTimeouts: number[] = [];
    private activeAnimationFrames: number[] = [];

    constructor() {
        // Set up debounced auto-scroll resume using RxJS
        this.autoScrollResumeSubject.pipe(
            debounceTime(ScrollService.AUTOSCROLL_RESUME_DELAY_MS),
            takeUntil(this.destroy$)
        ).subscribe(() => {
            this.autoScrollPaused = false;
        });
    }

    /**
     * Initialize scroll listener on the scroll container using RxJS
     * @param scrollContainer The scrollable container element
     */
    initializeScrollListener(scrollContainer: HTMLElement): () => void {
        // Clean up any existing subscription
        if (this.scrollSubscription) {
            this.scrollSubscription.unsubscribe();
            this.scrollSubscription = null;
        }

        // Create Observable from scroll events using RxJS
        this.scrollEvent$ = fromEvent<Event>(scrollContainer, 'scroll', { passive: true });

        // Subscribe to scroll events and filter out programmatic scrolls
        this.scrollSubscription = this.scrollEvent$.pipe(
            filter(() => {
                // Filter out programmatic scrolls
                const now = Date.now();
                return !this.isProgrammaticScroll && now >= this.programmaticScrollEndTime;
            }),
            tap(() => this.onManualScroll()),
            takeUntil(this.destroy$)
        ).subscribe();

        // Return cleanup function
        return () => {
            if (this.scrollSubscription) {
                this.scrollSubscription.unsubscribe();
                this.scrollSubscription = null;
            }
            this.scrollEvent$ = null;
        };
    }

    /**
     * Check if auto-scroll is currently paused
     */
    isAutoScrollPaused(): boolean {
        return this.autoScrollPaused;
    }

    /**
     * Scroll to a word chip element
     * @param wordIndex Index of the word to scroll to
     * @param scrollContainer The scrollable container element
     * @param wordsContainer The container holding word chips
     * @param words Array of all words to find the word by index
     */
    scrollToWord(
        wordIndex: number,
        scrollContainer: HTMLElement,
        wordsContainer: HTMLElement,
        words: Array<{ index: number }>
    ): void {
        // Find the word in the array that matches the index
        const wordIndexInArray = words.findIndex(w => w.index === wordIndex);

        if (wordIndexInArray === -1) {
            return; // Word not found (might be intro/outro chip or deleted)
        }

        // Find the word chip element - chips are rendered in the same order as the array
        const wordChips = wordsContainer.querySelectorAll('app-word-chip');

        if (!wordChips || wordIndexInArray >= wordChips.length) {
            return;
        }

        const targetChip = wordChips[wordIndexInArray] as HTMLElement;

        if (!targetChip) {
            return;
        }

        this.scrollToElement(targetChip, scrollContainer, true);
    }

    /**
     * Scroll to a gap bracket element
     * @param gapId ID of the gap to scroll to
     * @param scrollContainer The scrollable container element
     * @param wordsContainer The container holding gap brackets
     * @param wordsWithGaps Array of words and gaps interleaved
     */
    scrollToGap(
        gapId: number | null,
        scrollContainer: HTMLElement,
        wordsContainer: HTMLElement,
        wordsWithGaps: Array<{ type: 'word' | 'gap'; gap?: { id: number }; word?: { index: number } }>
    ): void {
        if (gapId === null) {
            return;
        }

        // Get the wordsWithGaps array to find the gap index
        const gapIndex = wordsWithGaps.findIndex(item => item.type === 'gap' && item.gap?.id === gapId);

        if (gapIndex === -1) {
            return; // Gap not found
        }

        // Find all gap bracket elements - they are rendered in the same order as gaps appear in wordsWithGaps
        // We need to count how many gap brackets appear before this index in the wordsWithGaps array
        let gapBracketIndex = 0;
        for (let i = 0; i < gapIndex; i++) {
            if (wordsWithGaps[i].type === 'gap') {
                gapBracketIndex++;
            }
        }

        const gapBrackets = wordsContainer.querySelectorAll('app-gap-bracket');

        if (!gapBrackets || gapBracketIndex >= gapBrackets.length) {
            return;
        }

        const targetGapBracket = gapBrackets[gapBracketIndex] as HTMLElement;

        if (!targetGapBracket) {
            return;
        }

        this.scrollToElement(targetGapBracket, scrollContainer, false);
    }

    /**
     * Scroll an element into view
     * @param targetElement The element to scroll to
     * @param scrollContainer The scrollable container element
     * @param checkAutoScrollPaused Whether to check if auto-scroll is paused (for word scrolling during playback)
     */
    private scrollToElement(
        targetElement: HTMLElement,
        scrollContainer: HTMLElement,
        checkAutoScrollPaused: boolean
    ): void {
        const elementRect = targetElement.getBoundingClientRect();
        const containerRect = scrollContainer.getBoundingClientRect();

        // Check if we're on mobile
        const isMobile = window.innerWidth <= ScrollService.MOBILE_BREAKPOINT_PX;

        // Check if element is already visible (with some padding)
        const padding = isMobile
            ? ScrollService.SCROLL_PADDING_MOBILE_PX
            : ScrollService.SCROLL_PADDING_DESKTOP_PX;
        const isVisible = elementRect.top >= (containerRect.top + padding) &&
            elementRect.bottom <= (containerRect.bottom - padding);

        if (!isVisible) {
            // Don't scroll if auto-scroll is paused (for word scrolling during playback)
            if (checkAutoScrollPaused && this.autoScrollPaused) {
                return;
            }

            // Set flag and timestamp BEFORE scrolling to prevent triggering manual scroll detection
            const scrollStartTime = Date.now();
            this.isProgrammaticScroll = true;
            this.programmaticScrollEndTime = scrollStartTime + ScrollService.PROGRAMMATIC_SCROLL_TIMEOUT_MS;

            // Use requestAnimationFrame to ensure flag is set before scroll happens
            const rafId = requestAnimationFrame(() => {
                // Double-check that auto-scroll is still not paused (for word scrolling)
                if (checkAutoScrollPaused && this.autoScrollPaused) {
                    this.isProgrammaticScroll = false;
                    this.programmaticScrollEndTime = 0;
                    this.activeAnimationFrames = this.activeAnimationFrames.filter(id => id !== rafId);
                    return;
                }

                if (isMobile) {
                    // On mobile, use scrollIntoView which handles positioning more reliably
                    // Use 'nearest' to avoid large jumps, then fine-tune if needed
                    targetElement.scrollIntoView({
                        behavior: 'smooth',
                        block: 'nearest',
                        inline: 'nearest'
                    });

                    // Fine-tune position after initial scroll to keep element visible in upper portion
                    const fineTuneTimeoutId = window.setTimeout(() => {
                        const finalElementRect = targetElement.getBoundingClientRect();
                        const finalContainerRect = scrollContainer.getBoundingClientRect();
                        const finalContainerHeight = finalContainerRect.height;

                        // Check if element is in a good position
                        const elementTopRelative = finalElementRect.top - finalContainerRect.top;
                        const desiredTopPosition = finalContainerHeight * ScrollService.MOBILE_SCROLL_OFFSET_RATIO;

                        // Only adjust if element is outside the visible area or too low
                        if (elementTopRelative < 0 || elementTopRelative > finalContainerHeight * ScrollService.MOBILE_VISIBILITY_THRESHOLD_RATIO) {
                            const currentScrollTop = scrollContainer.scrollTop;
                            const adjustment = elementTopRelative - desiredTopPosition;
                            scrollContainer.scrollTo({
                                top: currentScrollTop + adjustment,
                                behavior: 'smooth'
                            });
                        }
                        this.activeTimeouts = this.activeTimeouts.filter(id => id !== fineTuneTimeoutId);
                    }, ScrollService.MOBILE_SCROLL_FINETUNE_DELAY_MS);
                    this.activeTimeouts.push(fineTuneTimeoutId);
                } else {
                    // Desktop: Use precise calculation
                    const currentElementRect = targetElement.getBoundingClientRect();
                    const currentContainerRect = scrollContainer.getBoundingClientRect();
                    const containerHeight = scrollContainer.clientHeight;
                    const elementHeight = currentElementRect.height;

                    // Calculate the element's position relative to the scroll container
                    const elementRelativeTop = currentElementRect.top - currentContainerRect.top + scrollContainer.scrollTop;

                    // Calculate target scroll position - center on desktop
                    const scrollOffset = containerHeight * ScrollService.DESKTOP_SCROLL_OFFSET_RATIO;
                    const targetScrollTop = elementRelativeTop - scrollOffset + (elementHeight / 2);

                    // Ensure we don't scroll beyond container bounds
                    const maxScrollTop = scrollContainer.scrollHeight - containerHeight;
                    const clampedScrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));

                    // Scroll only the transcript-content container, not the page
                    scrollContainer.scrollTo({
                        top: clampedScrollTop,
                        behavior: 'smooth'
                    });
                }

                // Remove RAF from tracking array when completed
                this.activeAnimationFrames = this.activeAnimationFrames.filter(id => id !== rafId);

                // Reset flag after scroll animation completes
                const timeoutId1 = window.setTimeout(() => {
                    this.isProgrammaticScroll = false;
                    // Keep programmaticScrollEndTime set for a bit longer to catch any delayed scroll events
                    const timeoutId2 = window.setTimeout(() => {
                        this.programmaticScrollEndTime = 0;
                        // Remove from tracking array when completed
                        this.activeTimeouts = this.activeTimeouts.filter(id => id !== timeoutId2);
                    }, ScrollService.PROGRAMMATIC_SCROLL_CLEANUP_DELAY_MS);
                    this.activeTimeouts.push(timeoutId2);
                    // Remove from tracking array when completed
                    this.activeTimeouts = this.activeTimeouts.filter(id => id !== timeoutId1);
                }, ScrollService.PROGRAMMATIC_SCROLL_TIMEOUT_MS);
                this.activeTimeouts.push(timeoutId1);
            });
            this.activeAnimationFrames.push(rafId);
        }
    }

    /**
     * Handle manual scroll event
     * Pauses auto-scroll and schedules resume after 5 seconds (debounced via RxJS)
     * Note: Programmatic scrolls are already filtered out by the RxJS pipe
     */
    private onManualScroll(): void {
        // Pause auto-scroll immediately
        this.autoScrollPaused = true;

        // Cancel any pending scroll subscriptions to prevent them from executing
        this.pendingScrollSubscriptions.forEach(subscription => {
            subscription.unsubscribe();
        });
        this.pendingScrollSubscriptions = [];

        // Cancel any ongoing programmatic scroll to prevent interference
        this.isProgrammaticScroll = false;
        this.programmaticScrollEndTime = 0;

        // Emit to Subject for debounced resume (5 seconds)
        // This will reset autoScrollPaused to false after 5 seconds of no manual scrolling
        // Each manual scroll resets the 5-second timer (debounce behavior via RxJS)
        this.autoScrollResumeSubject.next();
    }

    /**
     * Schedule a scroll to word (for auto-scroll during playback) using RxJS
     * Returns a Subscription that can be unsubscribed to cancel
     */
    scheduleScrollToWord(
        wordIndex: number,
        scrollContainer: HTMLElement,
        wordsContainer: HTMLElement,
        words: Array<{ index: number }>,
        delayMs: number = 0
    ): Subscription {
        // Use RxJS timer instead of setTimeout
        const scrollSubscription = timer(delayMs).pipe(
            takeUntil(this.destroy$),
            filter(() => !this.autoScrollPaused) // Check if auto-scroll is still enabled
        ).subscribe(() => {
            // Check again before scrolling - user might have scrolled manually in the meantime
            if (!this.autoScrollPaused) {
                this.scrollToWord(wordIndex, scrollContainer, wordsContainer, words);
            }
            // Remove from tracking array when completed
            this.pendingScrollSubscriptions = this.pendingScrollSubscriptions.filter(sub => sub !== scrollSubscription);
        });

        this.pendingScrollSubscriptions.push(scrollSubscription);
        return scrollSubscription;
    }

    /**
     * Cancel a scheduled scroll subscription
     */
    cancelScheduledScroll(subscription: Subscription): void {
        subscription.unsubscribe();
        this.pendingScrollSubscriptions = this.pendingScrollSubscriptions.filter(sub => sub !== subscription);
    }

    /**
     * Cancel all scheduled scrolls using RxJS unsubscribe
     */
    cancelAllScheduledScrolls(): void {
        this.pendingScrollSubscriptions.forEach(subscription => {
            subscription.unsubscribe();
        });
        this.pendingScrollSubscriptions = [];
    }

    /**
     * Cleanup method - cancels all pending operations and unsubscribes from RxJS observables
     * Note: Since this is a singleton service (providedIn: 'root'),
     * cleanup is handled per-component via cancelAllScheduledScrolls()
     */
    cleanup(): void {
        // Unsubscribe from scroll events
        if (this.scrollSubscription) {
            this.scrollSubscription.unsubscribe();
            this.scrollSubscription = null;
        }
        this.scrollEvent$ = null;

        // Complete destroy subject to clean up all subscriptions
        this.destroy$.next();
        this.destroy$.complete();

        // Cancel all pending scroll subscriptions using RxJS unsubscribe
        this.pendingScrollSubscriptions.forEach(subscription => subscription.unsubscribe());

        // Cancel all pending timeouts and animation frames
        this.activeTimeouts.forEach(timeoutId => window.clearTimeout(timeoutId));
        this.activeAnimationFrames.forEach(rafId => window.cancelAnimationFrame(rafId));

        this.pendingScrollSubscriptions = [];
        this.activeTimeouts = [];
        this.activeAnimationFrames = [];
    }
}

