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
 * - States: Active (Remove), Ignored (Keep/Disabled), Deleted
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
     * Check if gap is in Active state (marked for removal)
     */
    get isActive(): boolean {
        return this.gap.state === GapState.ACTIVE;
    }

    /**
     * Check if gap is in Ignored state (will be preserved)
     */
    get isIgnored(): boolean {
        return this.gap.state === GapState.IGNORED;
    }

    /**
     * Check if gap is in Deleted state
     */
    get isDeleted(): boolean {
        return this.gap.state === GapState.DELETED;
    }

    /**
     * Handle gap bracket click event
     * Process clicks on ACTIVE and IGNORED gaps (toggle between them)
     * Don't process clicks on DELETED gaps
     */
    onClick(): void {
        // Don't process clicks on DELETED gaps
        if (this.isDeleted) {
            return;
        }
        this.gapClicked.emit(this.gap);
    }

    /**
     * Get ARIA label for accessibility
     */
    get ariaLabel(): string {
        const stateText = this.isActive ? 'marked for removal' :
            this.isIgnored ? 'will be preserved' :
                this.isDeleted ? 'deleted' :
                    'unknown';
        return `Gap ${this.formattedDuration}, ${stateText}. Click to toggle.`;
    }
}

