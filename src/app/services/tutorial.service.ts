import { Injectable, signal } from '@angular/core';

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
}

