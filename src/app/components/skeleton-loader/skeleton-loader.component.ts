import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Skeleton Loader Component
 * Displays animated loading placeholders for word chips during data loading
 * Based on PRD: Loading State - Show skeleton loader on word area while loading
 */
@Component({
    selector: 'app-skeleton-loader',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './skeleton-loader.component.html',
    styleUrl: './skeleton-loader.component.scss'
})
export class SkeletonLoaderComponent {
    /** Number of skeleton word placeholders to display */
    @Input() wordCount: number = 20;

    /**
     * Generate array for *ngFor iteration
     */
    get skeletonArray(): number[] {
        return Array(this.wordCount).fill(0).map((_, i) => i);
    }
}