import { Component, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SegmentationLoaderService } from '../../services/segmentation-loader.service';
import { EditorStateService } from '../../services/editor-state.service';
import { VideoPlayerService } from '../../services/video-player.service';
import { SkeletonLoaderComponent } from '../skeleton-loader/skeleton-loader.component';
import { WordChipComponent } from '../word-chip/word-chip.component';
import { ActionBarComponent } from '../action-bar/action-bar.component';
import { VideoPlayerComponent } from '../video-player/video-player.component';
import { Word } from '../../models';
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
  imports: [CommonModule, SkeletonLoaderComponent, WordChipComponent, ActionBarComponent, VideoPlayerComponent],
  templateUrl: './main-editor-container.component.html',
  styleUrl: './main-editor-container.component.scss'
})
export class MainEditorContainerComponent implements OnInit {
  // Expose segmentation service signals to template
  loadingState = this.segmentationService.loadingState;
  error = this.segmentationService.error;

  // Expose editor state signals to template
  words = this.editorState.words;
  selectionStart = this.editorState.selectionStart;
  selectionEnd = this.editorState.selectionEnd;
  selectedWords = this.editorState.selectedWords;
  hasSelection = this.editorState.hasSelection;
  hasCompleteSelection = this.editorState.hasCompleteSelection;

  // Computed signals for template conditionals
  isLoading = computed(() => this.loadingState() === 'loading');
  hasError = computed(() => this.loadingState() === 'error');
  hasWords = computed(() => this.words().length > 0);

  constructor(
    private segmentationService: SegmentationLoaderService,
    private editorState: EditorStateService,
    private videoService: VideoPlayerService
  ) { }

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
        // Initialize editor state with loaded words
        const loadedWords = this.segmentationService.words();
        this.editorState.initializeWords(loadedWords);

        console.info('Segmentation loaded successfully', {
          wordCount: this.words().length
        });
      },
      error: (err: Error) => {
        console.error('Failed to load segmentation', err);
      }
    });
  }

  /**
   * Retry loading segmentation after error
   */
  retryLoad(): void {
    this.segmentationService.reset();
    this.editorState.reset();
    this.loadSegmentation();
  }

  /**
   * Handle word click event
   * Delegates to EditorStateService for selection logic
   * Also triggers 3-second video preview based on PRD
   */
  onWordClick(word: Word): void {
    const currentStart = this.selectionStart();
    const currentEnd = this.selectionEnd();

    // Scenario 1: No selection - clicked word becomes start
    if (!currentStart) {
      this.editorState.selectWord(word);
      // Play 3 seconds forward from start
      this.videoService.playWordPreview(word.start, false);
      return;
    }

    // Scenario 2: Has start, no end - clicked word becomes end
    if (currentStart && !currentEnd && word.index > currentStart.index) {
      this.editorState.selectWord(word);
      // Play full segment from start to end
      this.videoService.playSegment(currentStart.start, word.end);
      return;
    }

    // Scenario 3: Complete selection AND clicking on the END word
    if (currentStart && currentEnd && word.index === currentEnd.index) {
      // Play 3 seconds backward to end word
      this.videoService.playWordPreview(word.end, true);
      // Reset selection
      this.editorState.clearSelection();
      return;
    }

    // All other cases: reset and start new selection
    this.editorState.selectWord(word);
    this.videoService.playWordPreview(word.start, false);
  }

  /**
   * Clear current selection
   * Used by action bar buttons in Feature 6
   */
  clearSelection(): void {
    this.editorState.clearSelection();
  }
}