import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Word, WordState } from '../../models';

/**
 * Word Chip Component
 * Displays a single word from the transcription with visual state indicators
 * Based on PRD: Word States & DESIGN_GUIDE.md specifications
 */
@Component({
    selector: 'app-word-chip',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './word-chip.component.html',
    styleUrl: './word-chip.component.scss'
})
export class WordChipComponent {
    /** Word object containing text, timing, and state information */
    @Input({ required: true }) word!: Word;

    /** Whether to show timing information (start-end) */
    @Input() showTiming: boolean = false;

    /** Index of the currently playing word (for playback highlighting) */
    @Input() currentPlaybackWordIndex: number | null = null;

    /** Emits when the word is clicked */
    @Output() wordClicked = new EventEmitter<Word>();

    /** Emits when arrow key is pressed to navigate to next/previous word */
    @Output() arrowKeyPressed = new EventEmitter<'left' | 'right'>();

    /**
     * Check if this word is currently being played
     */
    get isCurrentPlaybackWord(): boolean {
        return this.currentPlaybackWordIndex !== null && 
               this.word.index === this.currentPlaybackWordIndex;
    }

    /**
     * Check if this word is selected (start, end, or in range)
     */
    get isSelected(): boolean {
        return this.word.state === WordState.SELECTED_START ||
               this.word.state === WordState.SELECTED_END ||
               this.word.state === WordState.SELECTED_RANGE ||
               this.word.state === WordState.DELETED_SELECTED_START ||
               this.word.state === WordState.DELETED_SELECTED_END ||
               this.word.state === WordState.DELETED_SELECTED_RANGE;
    }

    /**
     * Handle word click event
     */
    onClick(): void {
        this.wordClicked.emit(this.word);
    }

    /**
     * Handle keyboard navigation
     * Arrow Left: navigate to previous word
     * Arrow Right: navigate to next word
     */
    onKeyDown(event: KeyboardEvent): void {
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            this.arrowKeyPressed.emit('left');
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            this.arrowKeyPressed.emit('right');
        }
    }

    /**
     * Format timing for display (e.g., "4.08s")
     */
    get formattedTiming(): string {
        return `${this.word.start.toFixed(2)}s - ${this.word.end.toFixed(2)}s`;
    }
}

