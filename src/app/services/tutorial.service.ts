import { Injectable, signal } from '@angular/core';

/**
 * Tutorial Service
 * Manages tutorial modal state and visibility
 * Based on PRD: Tutorial System (Section 7)
 */
@Injectable({
    providedIn: 'root'
})
export class TutorialService {
    /**
     * Modal state: 'hidden' | 'tip' | 'video'
     * - hidden: modal is not shown
     * - tip: showing editing tip with "Show Me How" button
     * - video: showing tutorial video
     */
    private readonly _modalState = signal<'hidden' | 'tip' | 'video'>('hidden');
    public readonly modalState = this._modalState.asReadonly();

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

