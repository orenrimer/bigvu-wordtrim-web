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

    /** Emits when the gap bracket is clicked */
    @Output() gapClicked = new EventEmitter<Gap>();

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
     * Check if gap is in Selected state (marked for removal - blue)
     */
    get isSelected(): boolean {
        return this.gap.state === GapState.SELECTED;
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
        const stateText = this.isSelected ? 'marked for removal' :
            this.isIgnored ? 'will be preserved' :
                this.isActive ? 'deleted' :
                    'unknown';
        return `Gap ${this.formattedDuration}, ${stateText}. Click to toggle.`;
    }
}

