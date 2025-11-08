import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Word } from '../../models';

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

    /** Emits when the word is clicked */
    @Output() wordClicked = new EventEmitter<Word>();

    /**
     * Handle word click event
     */
    onClick(): void {
        this.wordClicked.emit(this.word);
    }

    /**
     * Format timing for display (e.g., "4.08s")
     */
    get formattedTiming(): string {
        return `${this.word.start.toFixed(2)}s - ${this.word.end.toFixed(2)}s`;
    }
}

