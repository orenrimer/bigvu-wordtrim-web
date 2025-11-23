import { Injectable, signal, ElementRef } from '@angular/core';

/**
 * Tutorial Service
 * Manages tutorial modal state and visibility
 * Based on PRD: Tutorial System (Section 7)
 */
@Injectable()
export class TutorialService {
    /**
     * Modal state: 'hidden' | 'tip' | 'video' | 'preview-tip'
     * - hidden: modal is not shown
     * - tip: showing editing tip with "Show Me How" button
     * - video: showing tutorial video
     * - preview-tip: showing preview mode tip (centered, no "Show Me How" button)
     */
    private readonly _modalState = signal<'hidden' | 'tip' | 'video' | 'preview-tip'>('hidden');
    public readonly modalState = this._modalState.asReadonly();

    /**
     * Custom tip content (title and text)
     * Used for preview mode tip and other custom tips
     */
    private readonly _customTipContent = signal<{ title: string; text: string } | null>(null);
    public readonly customTipContent = this._customTipContent.asReadonly();

    /**
     * Track if user has clicked on a word
     * Used to auto-dismiss tip modal on first word click
     */
    private readonly _hasClickedWord = signal<boolean>(false);
    public readonly hasClickedWord = this._hasClickedWord.asReadonly();

    // Track if position calculation is in progress to prevent multiple simultaneous calls
    private isPositionCalculating = false;

    /**
     * Show the editing tip modal
     */
    showTip(): void {
        this._modalState.set('tip');
        this._customTipContent.set(null); // Clear custom content
    }

    /**
     * Show custom tip modal with custom title and text
     * Used for preview mode tip and other custom tips
     * @param title Modal title
     * @param text Modal text content
     */
    showCustomTip(title: string, text: string): void {
        this._customTipContent.set({ title, text });
        this._modalState.set('preview-tip');
    }

    /**
     * Show the tutorial video modal
     */
    showVideo(): void {
        this._modalState.set('video');
    }

    /**
     * Hide the modal (any mode)
     */
    hide(): void {
        this._modalState.set('hidden');
        this._customTipContent.set(null); // Clear custom content when hiding
    }

    /**
     * Called when user clicks on a word
     * If modal is showing tip and user hasn't clicked before, dismiss it
     */
    onWordClick(): void {
        const hasClicked = this._hasClickedWord();
        const currentState = this._modalState();

        if (!hasClicked && currentState === 'tip') {
            this.hide();
        }

        this._hasClickedWord.set(true);
    }

    /**
     * Auto-show editing tip on initial load
     * Should be called from MainEditorContainer ngOnInit
     */
    autoShowOnInit(): void {
        // Only show if user hasn't clicked a word before (first visit)
        if (!this._hasClickedWord()) {
            this.showTip();
        }
    }

    /**
     * Reset tutorial state (for testing purposes)
     */
    reset(): void {
        this._modalState.set('hidden');
        this._hasClickedWord.set(false);
    }

    /**
     * Update words container position by setting CSS custom properties
     * @param wordsContainerRef Reference to the words container element
     * @param wordsCount Number of words (to check if chips are rendered)
     * @param isRTL Whether the content is RTL
     * @returns Promise that resolves to true if position was updated successfully, false otherwise
     */
    public updateWordsContainerPosition(
        wordsContainerRef: ElementRef<HTMLElement> | null,
        wordsCount: number,
        isRTL: boolean
    ): Promise<boolean> {
        // Prevent multiple simultaneous position calculations
        if (this.isPositionCalculating) {
            // Return a promise that resolves when current calculation completes
            return new Promise((resolve) => {
                // Poll until calculation is done
                const checkDone = () => {
                    if (!this.isPositionCalculating) {
                        resolve(true);
                    } else {
                        setTimeout(checkDone, 50);
                    }
                };
                setTimeout(checkDone, 50);
            });
        }

        this.isPositionCalculating = true;
        return new Promise((resolve) => {
            // Retry mechanism in case ViewChild isn't immediately available
            // Also wait for word chips to be rendered in DOM
            let retryCount = 0;
            const maxRetries = 40; // Max 40 retries (2000ms total) - increased to wait for word chips rendering

            const tryUpdate = () => {
                if (wordsContainerRef?.nativeElement) {
                    const rect = wordsContainerRef.nativeElement.getBoundingClientRect();

                    // Only update if element has valid dimensions
                    if (rect.width > 0 && rect.height > 0) {
                        // Check if word chips are actually rendered
                        const wordChips = wordsContainerRef.nativeElement.querySelectorAll('app-word-chip');

                        // If we have words in the signal but no chips rendered yet, wait a bit more
                        if (wordsCount > 0 && wordChips.length === 0 && retryCount < maxRetries - 10) {
                            retryCount++;
                            setTimeout(tryUpdate, 50);
                            return;
                        }

                        // Calculate position based on first word chip element (not container)
                        // This ensures the modal aligns with the actual first word, not the container edge
                        const firstWordChip = wordChips.length > 0 ? wordChips[0] as HTMLElement : null;
                        if (firstWordChip) {
                            // Use single requestAnimationFrame to ensure layout is stable
                            requestAnimationFrame(() => {
                                const firstChipRect = firstWordChip.getBoundingClientRect();

                                // Verify the chip has valid dimensions and is actually visible
                                if (firstChipRect.width > 0 && firstChipRect.height > 0 && firstChipRect.left > 0) {
                                    // Ensure RTL class is set before calculating positions
                                    if (isRTL) {
                                        document.documentElement.classList.add('is-rtl');
                                    } else {
                                        document.documentElement.classList.remove('is-rtl');
                                    }

                                    // Use first chip's left position for horizontal alignment (LTR)
                                    // This aligns the modal with the first word, not the container edge
                                    const leftPosition = firstChipRect.left;
                                    document.documentElement.style.setProperty('--words-container-left', `${leftPosition}px`);

                                    // Calculate right position for RTL mode (align with right edge of words container)
                                    // This aligns the modal's right edge with the container's right border
                                    const wordsContainerRect = wordsContainerRef.nativeElement.getBoundingClientRect();
                                    const rightPosition = window.innerWidth - wordsContainerRect.right;
                                    document.documentElement.style.setProperty('--words-container-right', `${rightPosition}px`);

                                    // Calculate top position based on first word chip element
                                    const lineHeight = parseFloat(getComputedStyle(wordsContainerRef.nativeElement).lineHeight) ||
                                        parseFloat(getComputedStyle(firstWordChip).lineHeight) ||
                                        (window.innerWidth <= 768 ? 1.75 * 16 : 2.5 * 16); // fallback based on screen size
                                    const spacing = 16; // var(--spacing-4)
                                    const topPosition = firstChipRect.top + lineHeight + spacing;
                                    document.documentElement.style.setProperty('--words-container-top', `${topPosition}px`);

                                    // Set transform to none when using custom property (for responsive breakpoints)
                                    document.documentElement.style.setProperty('--words-container-transform', 'none');
                                    // Set animation name based on whether we're using custom positioning
                                    document.documentElement.style.setProperty('--tip-modal-animation', 'slideInFromBelowNoTransform');

                                    // Position successfully updated
                                    this.isPositionCalculating = false;
                                    resolve(true);
                                } else {
                                    // Retry if chip dimensions are invalid
                                    if (retryCount < maxRetries) {
                                        retryCount++;
                                        setTimeout(tryUpdate, 50);
                                    } else {
                                        this.isPositionCalculating = false;
                                        resolve(false);
                                    }
                                }
                            });
                            return; // Exit early, will resolve in requestAnimationFrame
                        } else {
                            // Fallback: use container position
                            // Only use fallback if we don't have words (empty state)
                            if (wordsCount === 0) {
                                // Use container position as fallback when no words are available
                                document.documentElement.style.setProperty('--words-container-left', `${rect.left}px`);

                                // Calculate right position for RTL mode (use container right as fallback)
                                const rightPosition = window.innerWidth - rect.right;
                                document.documentElement.style.setProperty('--words-container-right', `${rightPosition}px`);

                                const lineHeight = parseFloat(getComputedStyle(wordsContainerRef.nativeElement).lineHeight) ||
                                    (window.innerWidth <= 768 ? 1.75 * 16 : 2.5 * 16);
                                const spacing = 16;
                                const topPosition = rect.top + lineHeight + spacing;
                                document.documentElement.style.setProperty('--words-container-top', `${topPosition}px`);

                                // Set transform to none when using custom property (for responsive breakpoints)
                                document.documentElement.style.setProperty('--words-container-transform', 'none');
                                // Set animation name based on whether we're using custom positioning
                                document.documentElement.style.setProperty('--tip-modal-animation', 'slideInFromBelowNoTransform');

                                // Position successfully updated
                                this.isPositionCalculating = false;
                                resolve(true);
                                return;
                            } else {
                                // We have words but chips aren't rendered yet, retry
                                if (retryCount < maxRetries) {
                                    retryCount++;
                                    setTimeout(tryUpdate, 50);
                                    return;
                                }
                            }
                        }
                    }
                }

                // Element not ready yet, retry
                if (retryCount < maxRetries) {
                    retryCount++;
                    setTimeout(tryUpdate, 50);
                } else {
                    // If element not found after retries, reset to fallback (centered)
                    document.documentElement.style.removeProperty('--words-container-left');
                    document.documentElement.style.removeProperty('--words-container-top');
                    document.documentElement.style.removeProperty('--words-container-transform');
                    this.isPositionCalculating = false;
                    resolve(false);
                }
            };

            // Use requestAnimationFrame to ensure DOM is ready before measuring
            // This is better than setTimeout(..., 0) as it waits for the browser's next paint
            requestAnimationFrame(() => {
                tryUpdate();
            });
        });
    }

    /**
     * Update preview tip modal position (Feature 13.11)
     * @param transcriptContentRef Reference to the transcript content element
     * @param wordsContainerRef Reference to the words container element (unused, kept for API consistency)
     * @param isRTL Whether the content is RTL (unused, kept for API consistency)
     */
    public updatePreviewTipModalPosition(
        transcriptContentRef: ElementRef<HTMLElement> | null,
        wordsContainerRef: ElementRef<HTMLElement> | null,
        isRTL: boolean
    ): void {
        if (!transcriptContentRef?.nativeElement) {
            return;
        }

        const transcriptElement = transcriptContentRef.nativeElement;
        const rect = transcriptElement.getBoundingClientRect();

        // Calculate center X position of transcript-content
        const centerX = rect.left + rect.width / 2;

        // Calculate bottom Y position of transcript-content
        const bottomY = rect.bottom;

        // Set CSS custom properties for modal positioning
        document.documentElement.style.setProperty('--preview-tip-modal-center-x', `${centerX}px`);
        document.documentElement.style.setProperty('--preview-tip-modal-bottom', `${bottomY}px`);
    }
}

