import { Component, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SegmentationLoaderService } from '../../services/segmentation-loader.service';
import { SkeletonLoaderComponent } from '../skeleton-loader/skeleton-loader.component';
import { environment } from '../../../environments/environment.development';

/**
 * Main Editor Container Component
 * Orchestrator component that manages all child components for the Wordtrim editor
 * Based on PRD: Component Architecture - MainEditorContainer
 * 
 * This component will coordinate:
 * - Video player
 * - Word chips display
 * - Timeline with handles
 * - Action bar (Remove, Keep Only, Restore, Unselect)
 * - Tutorial modal
 * - Undo/Redo functionality
 */
@Component({
  selector: 'app-main-editor-container',
  standalone: true,
  imports: [CommonModule, SkeletonLoaderComponent],
  templateUrl: './main-editor-container.component.html',
  styleUrl: './main-editor-container.component.scss'
})
export class MainEditorContainerComponent implements OnInit {
  // Expose service signals to template
  loadingState = this.segmentationService.loadingState;
  words = this.segmentationService.words;
  error = this.segmentationService.error;

  // Computed signals for template conditionals
  isLoading = computed(() => this.loadingState() === 'loading');
  hasError = computed(() => this.loadingState() === 'error');
  hasWords = computed(() => this.words().length > 0);

  constructor(private segmentationService: SegmentationLoaderService) { }

  ngOnInit(): void {
    // Load segmentation data from environment URL on component initialization
    this.loadSegmentation();
  }

  /**
   * Load segmentation data from configured URL
   */
  loadSegmentation(): void {
    this.segmentationService.loadSegmentation(environment.segmentationUrl).subscribe({
      next: () => {
        console.info('Segmentation loaded successfully', {
          wordCount: this.words().length
        });
      },
      error: (err) => {
        console.error('Failed to load segmentation', err);
      }
    });
  }

  /**
   * Retry loading segmentation after error
   */
  retryLoad(): void {
    this.segmentationService.reset();
    this.loadSegmentation();
  }
}