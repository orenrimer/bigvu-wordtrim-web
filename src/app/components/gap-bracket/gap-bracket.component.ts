import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Gap, GapState } from '../../models/gap.interface';

/**
 * Gap Bracket Component
 * Displays a gap between words with visual state indicators
 * Based on PRD Phase 2: Gap Visualization (Brackets UI)
 * 
 * Features:
 * - Displays gap duration: (0.4s)
 * - One decimal digit precision
 * - Clickable to toggle gap state
 * - States: Selected (Remove), Ignored (Keep/Disabled), Active (Deleted)
 */
@Component({
    selector: 'app-gap-bracket',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './gap-bracket.component.html',
    styleUrl: './gap-bracket.component.scss'
})
export class GapBracketComponent {
    /** Gap object containing duration, state, and position information */
    @Input({ required: true }) gap!: Gap;

    /** ID of the currently selected gap (for visual selection only) */
    @Input() selectedGapId: number | null = null;

    /** Emits when the gap bracket is clicked */
    @Output() gapClicked = new EventEmitter<Gap>();

    /**
     * Check if this gap represents a filler word
     * @returns true if gap has filler word text
     */
    get isFillerWord(): boolean {
        return !!this.gap.fillerWordText;
    }

    /**
     * Format gap duration for display with one decimal digit precision
     * @returns Formatted string like "0.4s"
     */
    get formattedDuration(): string {
        return `${this.gap.duration.toFixed(1)}`;
    }

    /**
     * Get just the number part of the duration (without 's')
     * Used for strikethrough styling in IGNORED state
     * @returns Formatted string like "0.4"
     */
    get durationNumber(): string {
        return this.gap.duration.toFixed(1);
    }

    /**
     * Get display text for the gap bracket
     * Returns filler word text if available, otherwise returns duration
     * @returns Display text like "(um)" or "(0.4s)"
     */
    get displayText(): string {
        if (this.isFillerWord && this.gap.fillerWordText) {
            return `(${this.gap.fillerWordText})`;
        }
        return `(${this.durationNumber}s)`;
    }

    /**
     * Check if gap is visually selected (for highlighting)
     * Selection is independent of logical state (ACTIVE/IGNORED)
     */
    get isSelected(): boolean {
        return this.selectedGapId === this.gap.id;
    }

    /**
     * Check if gap is in Ignored state (will be preserved)
     */
    get isIgnored(): boolean {
        return this.gap.state === GapState.IGNORED;
    }

    /**
     * Check if gap is in Active state (deleted - gray with strikethrough)
     */
    get isActive(): boolean {
        return this.gap.state === GapState.ACTIVE;
    }

    /**
     * Handle gap bracket click event
     * Process clicks on ACTIVE and SELECTED gaps (toggle between them)
     * IGNORED gaps can also be clicked to toggle
     */
    onClick(): void {
        // Allow clicks on all gaps - toggle will handle the state logic
        this.gapClicked.emit(this.gap);
    }

    /**
     * Get ARIA label for accessibility
     */
    get ariaLabel(): string {
        const stateText = this.isIgnored ? 'will be preserved' :
            this.isActive ? 'deleted' :
                'marked for removal';
        const selectedText = this.isSelected ? ', selected' : '';
        const gapDescription = this.isFillerWord && this.gap.fillerWordText
            ? `Filler word "${this.gap.fillerWordText}"`
            : `Gap ${this.formattedDuration}`;
        return `${gapDescription}, ${stateText}${selectedText}. Click to toggle.`;
    }
}

